// server.js — cleaned and fixed version
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios'); // Add axios for HTTP requests
// Load environment variables from .env when present
require('dotenv').config();
// Optional Secret Manager client (only loaded when configured)
let SecretManagerClient;
try {
  SecretManagerClient = require('@google-cloud/secret-manager').SecretManagerServiceClient;
} catch (e) {
  SecretManagerClient = null; // not installed or not available
}

// ---------------------------------------
// ✅ Gemini / Secrets sanity check
// ---------------------------------------
function checkGeminiConfig() {
  const hasGeminiKey = !!process.env.GEMINI_API_KEY || !!process.env.LEGACY_GEMINI_KEY;
  if (!hasGeminiKey) {
    console.warn('⚠️ Gemini API not configured. Set GEMINI_API_KEY (preferred) or LEGACY_GEMINI_KEY in environment.');
    if (process.env.REQUIRE_GEMINI === '1') {
      console.error('REQUIRE_GEMINI=1 and no Gemini key found. Exiting to avoid running without AI capability.');
      process.exit(1);
    }
  } else {
    // Warn if using legacy key only; don't print the key
    if (process.env.LEGACY_GEMINI_KEY && !process.env.GEMINI_API_KEY) {
      console.warn('Using LEGACY_GEMINI_KEY (legacy API key). Consider rotating to GEMINI_API_KEY (OAuth/service-account token) for better security.');
    }
  }
}
checkGeminiConfig();

// ---------------------------------------
// ✅ Setup
// ---------------------------------------
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// ---------------------------------------
// ✅ Middleware
// ---------------------------------------
app.use(express.json());
// Serve static assets and enable clean URLs (e.g., `/about` -> `about.html`).
// `extensions: ['html']` lets requests without `.html` resolve to the corresponding file.
// `index: 'home.html'` makes `/` serve `home.html` by default.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], index: 'home.html' }));

// ---------------------------------------
// ✅ Search API (Serper)
// ---------------------------------------
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) return res.status(400).json({ error: 'SERPER_API_KEY not configured on server' });

  try {
    const out = await axios.post('https://google.serper.dev/search', { q: query }, {
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY },
      timeout: 15000
    });
    return res.json({ results: out.data, success: true });
  } catch (err) {
    console.error('Search error:', err && (err.message || err));
    const status = err.response?.status || 500;
    const body = err.response?.data || err.message;
    return res.status(status).json({ error: 'Search failed', detail: body });
  }
});

// ---------------------------------------
// ✅ CORS setup
// ---------------------------------------
const allowedOrigins = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'https://generativelanguage.googleapis.com'
]);
if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(',').forEach(o => o && allowedOrigins.add(o.trim()));
}
// CORS options: allow requests from known front-end origins and allow server-to-server calls
// (which have no Origin header). For production, set CORS_ORIGIN env var to a comma-separated
// list of allowed origins.
const corsOptions = {
  origin: (origin, callback) => {
    // If no origin (e.g. server-to-server requests, curl, Postman), allow.
    if (!origin) return callback(null, true);

    // Allow exact matches from the whitelist
    if (allowedOrigins.has(origin)) return callback(null, true);

    // Allow subdomains of local testing domains (optional): treat localhost/127.0.0.1 as allowed
    try {
      const u = new URL(origin);
      const hostname = u.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return callback(null, true);
    } catch (e) {
      // ignore URL parse errors
    }

    // Otherwise block with a descriptive error (will appear in server logs)
    const msg = `Not allowed by CORS: ${origin}`;
    return callback(new Error(msg));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password']
};
app.use(cors(corsOptions));

// ---------------------------------------
// ✅ Constants and helpers
// ---------------------------------------
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');
const ACTIVITY_LOG = path.join(__dirname, 'activity.log');
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').trim();

function logActivity(entry) {
  fs.appendFileSync(ACTIVITY_LOG, `[${new Date().toISOString()}] ${entry}\n`, 'utf8');
}
function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function findRoom(rooms, type) {
  return rooms.find(
    r => r.type.toLowerCase() === type.toLowerCase() || r.name.toLowerCase() === type.toLowerCase()
  );
}

// Helper: safely stringify error details for client-facing `detail` fields
function serializeErrorDetails(d) {
  if (!d && d !== 0) return '';
  if (typeof d === 'string') return d;
  try {
    const s = JSON.stringify(d, null, 2);
    return s.length > 1000 ? s.slice(0, 1000) + '... (truncated)' : s;
  } catch (e) {
    try {
      return String(d);
    } catch (e2) {
      return '[unserializable error]';
    }
  }
}

// Optional: load Gemini key from Google Secret Manager if configured
async function loadGeminiKeyFromSecretManager() {
  const name = process.env.SECRET_MANAGER_NAME;
  if (!name || !SecretManagerClient) return;
  try {
    const client = new SecretManagerClient();
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload && version.payload.data && version.payload.data.toString('utf8');
    if (payload) {
      if (!process.env.GEMINI_API_KEY && !process.env.LEGACY_GEMINI_KEY) {
        process.env.GEMINI_API_KEY = payload.trim();
        console.log('Loaded GEMINI_API_KEY from Secret Manager');
      } else {
        console.log('Gemini key already provided in environment; secret manager value will not override it.');
      }
    }
  } catch (err) {
    console.warn('Could not load Gemini key from Secret Manager:', err && err.message ? err.message : err);
  }
}

// ---------------------------------------
// ✅ Site context loader (extracts text from public HTML pages)
// ---------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
let SITE_CONTEXT = '';

function extractTextFromHtml(html) {
  // Remove scripts/styles and tags, then normalize whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadSiteContext() {
  try {
    const candidateFiles = ['home.html', 'aboutus.html', 'rooms.html', 'ourservices.html', 'booking.html', 'contact.html', 'gallery.html'];
    const parts = [];
    for (const f of candidateFiles) {
      const p = path.join(PUBLIC_DIR, f);
      if (fs.existsSync(p)) {
        const html = fs.readFileSync(p, 'utf8');
        const txt = extractTextFromHtml(html);
        if (txt) parts.push(`== ${f} ==\n${txt.slice(0, 1200)}`);
      }
    }
    SITE_CONTEXT = parts.join('\n\n');
    if (SITE_CONTEXT) console.log('Loaded site context from public HTML files');
  } catch (err) {
    console.warn('Failed to build site context:', err && err.message ? err.message : err);
    SITE_CONTEXT = '';
  }
}

// Load site context at startup
loadSiteContext();

// Helper to call Gemini API with improved error handling and flexible auth
async function callGemini(prompt, options = {}) {
  const key = process.env.GEMINI_API_KEY || process.env.LEGACY_GEMINI_KEY;
  if (!key) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY in environment.');
  }

  // Normalize model name: allow either `models/...` or bare model id
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-pro').trim();
  const normalize = s => String(s || '').replace(/^models\//i, '').trim();
  let modelName = normalize(rawModel);

  // If a legacy key is provided explicitly, use ?key=param; otherwise prefer Authorization header
  const useKeyParam = !!process.env.LEGACY_GEMINI_KEY && !process.env.GEMINI_API_KEY;

  const headers = { 'Content-Type': 'application/json' };
  if (!useKeyParam) headers.Authorization = `Bearer ${key}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 1024
    }
  };
  if (options.safetySettings) body.safetySettings = options.safetySettings;

  const buildUrl = m => {
    return useKeyParam
      ? `https://generativelanguage.googleapis.com/v1/models/${m}:generateContent?key=${key}`
      : `https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`;
  };

  // First attempt: try the configured model name
  try {
    const resp = await axios.post(buildUrl(modelName), body, { headers, timeout: options.timeout || 15000 });
    return resp;
  } catch (err) {
    // Attach response info when available for better diagnostics
    const enriched = new Error('Gemini API call failed: ' + (err.message || 'unknown'));
    enriched.originalError = err;

    if (err.response) {
      enriched.status = err.response.status;
      enriched.responseData = err.response.data;
      enriched.responseDataString = serializeErrorDetails(err.response.data);

      // Detect rate-limit / too many requests and attach friendly user message.
      if (err.response.status === 429 || /rate limit|too many requests|exceeded/i.test(String(err.response.data || ''))) {
        enriched.isRateLimit = true;
        enriched.userMessage = 'We are sorry for interruption, the AI server is down please try again in one minute';
        enriched.status = 503;
      }

      // If model not found (404), attempt to list available models and retry with a reasonable fallback
      if (err.response.status === 404 && /not found/i.test(String(err.response.data?.error?.message || ''))) {
        try {
          const listUrl = useKeyParam
            ? `https://generativelanguage.googleapis.com/v1/models?key=${key}`
            : 'https://generativelanguage.googleapis.com/v1/models';
          const listResp = await axios.get(listUrl, { headers: useKeyParam ? {} : headers, timeout: 8000 });
          const avail = (listResp.data && listResp.data.models) ? listResp.data.models.map(m => m.name || m.model || m) : [];
          enriched.availableModels = avail;

          // Choose best fallback by matching tokens from requested model
          const tokens = modelName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          let best = null;
          let bestScore = -1;

          for (const cand of avail) {
            const candNorm = normalize(cand).toLowerCase();
            let score = 0;
            for (const t of tokens) if (t && candNorm.includes(t)) score += 2;
            // small boost if both contain 'gemma' (user requested Gemma)
            if (/gemma/.test(modelName.toLowerCase()) && /gemma/.test(candNorm)) score += 3;
            if (score > bestScore) {
              bestScore = score;
              best = candNorm;
            }
          }

          // fallback to first available model if no good match
          if (!best && avail.length) best = normalize(avail[0]);

          if (best && best !== modelName) {
            console.log('Model not available; falling back to available model:', best);
            try {
              const retryResp = await axios.post(buildUrl(best), body, { headers, timeout: options.timeout || 15000 });
              // annotate response with the fallback model used
              retryResp.fallbackModelUsed = best;
              return retryResp;
            } catch (err2) {
              enriched.fallbackTried = best;
              enriched.fallbackError = err2;
            }
          }
        } catch (listErr) {
          enriched.listModelsError = listErr && listErr.message ? listErr.message : String(listErr);
        }
      }
    } else if (err.responseData) {
      enriched.responseData = err.responseData;
      enriched.responseDataString = serializeErrorDetails(err.responseData);
    }
    throw enriched;
  }
}

// ---------------------------------------
// ✅ Admin Auth Middleware
// ---------------------------------------
function requireAdmin(req, res, next) {
  const pass =
    req.headers['x-admin-password'] ||
    req.headers['x-admin-token'] ||
    req.body?.adminPassword ||
    req.body?.password;
  if (!pass || pass.trim() !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/admin/auth', (req, res) => {
  const pass = (req.body?.password || '').trim();
  if (!pass) return res.status(400).json({ error: 'Password required' });
  if (pass === ADMIN_PASSWORD) return res.json({ ok: true, token: pass });
  return res.status(401).json({ error: 'Invalid password' });
});

// ---------------------------------------
// ✅ Socket.io real-time broadcast
// ---------------------------------------
function broadcastRooms() {
  const rooms = readJSON(ROOMS_FILE);
  io.emit('room_update', { rooms, time: new Date().toISOString() });
}

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);
  socket.emit('room_update', { rooms: readJSON(ROOMS_FILE), time: new Date().toISOString() });
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// ---------------------------------------
// ✅ Scheduler
// ---------------------------------------
const scheduledJobs = new Map();

function scheduleBlockRestore(blockId, roomType, untilTs, qty) {
  const delay = Math.max(0, untilTs - Date.now());
  if (scheduledJobs.has(blockId)) clearTimeout(scheduledJobs.get(blockId));

  const id = setTimeout(() => {
    const rooms = readJSON(ROOMS_FILE);
    const room = findRoom(rooms, roomType);
    if (!room) return;

    room.available = Math.min(room.totalRooms || 0, (room.available || 0) + (qty || 1));
    if (Array.isArray(room.scheduledBlocks))
      room.scheduledBlocks = room.scheduledBlocks.filter(b => b.id !== blockId);

    writeJSON(ROOMS_FILE, rooms);
    scheduledJobs.delete(blockId);
    broadcastRooms();
    logActivity(`Auto-restored ${qty} ${roomType} at ${new Date().toISOString()}`);
  }, delay);

  scheduledJobs.set(blockId, id);
}

// ---------------------------------------
// ✅ API endpoints
// ---------------------------------------
app.get('/api/rooms', (req, res) => res.json(readJSON(ROOMS_FILE)));

// Availability endpoint used by the public-facing availability checker (check.html)
app.get('/api/rooms/available', (req, res) => {
  try {
    const { checkin, checkout, adults = 2, children = 0 } = req.query;
    const guests = Math.max(0, Number(adults || 0) + Number(children || 0));

    // Load rooms and normalize fields for clients (avoid leaking internal-only fields)
    const rooms = readJSON(ROOMS_FILE).map(r => ({
      type: r.type || r.name,
      name: r.name || r.type,
      capacity: r.capacity || 2,
      price: r.price,
      description: r.description,
      totalRooms: typeof r.totalRooms === 'number' ? r.totalRooms : (typeof r.total === 'number' ? r.total : 0),
      available: typeof r.available === 'number' ? r.available : 0,
      scheduledBlocks: r.scheduledBlocks || []
    }));

    // Basic availability filtering: prefer rooms that fit the requested guest count and are available.
    let filtered = rooms;
    if (guests > 0) {
      filtered = rooms.filter(r => (r.capacity || 0) >= guests && (r.available || 0) > 0);
    } else {
      filtered = rooms.filter(r => (r.available || 0) > 0);
    }

    const maxSingleCapacity = rooms.reduce((m, r) => Math.max(m, r.capacity || 2), 0);

    return res.json({ rooms: filtered, maxSingleCapacity });
  } catch (err) {
    console.error('Error in /api/rooms/available:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Failed to compute availability' });
  }
});

app.post('/api/update', requireAdmin, (req, res) => {
  const { type, total, available, delta } = req.body;
  const rooms = readJSON(ROOMS_FILE);
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room type not found' });

  // Support incremental updates via delta parameter
  if (typeof delta === 'number') {
    room.totalRooms = Math.max(0, (room.totalRooms || 0) + delta);
    room.available = Math.max(0, Math.min(room.totalRooms, (room.available || 0) + delta));
  } else {
    // Existing absolute value behavior
    if (typeof total === 'number') room.totalRooms = total;
    if (typeof available === 'number') room.available = Math.min(available, room.totalRooms);
  }
  writeJSON(ROOMS_FILE, rooms);

  logActivity(`UPDATE ${type} total=${room.totalRooms} available=${room.available}`);
  broadcastRooms();
  res.json({ ok: true, room });
});

app.post('/api/block', requireAdmin, (req, res) => {
  const { type, qty = 1, reason = '', until } = req.body;
  const rooms = readJSON(ROOMS_FILE);
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room type not found' });
  if ((room.available || 0) < qty)
    return res.status(400).json({ error: 'Not enough available rooms to block' });

  const untilTs = Date.parse(until);
  if (isNaN(untilTs)) return res.status(400).json({ error: 'Invalid until date/time' });

  room.available -= qty;
  const id = `BLK-${uuidv4()}`;
  const block = { id, qty, reason, until: new Date(untilTs).toISOString() };
  room.scheduledBlocks = room.scheduledBlocks || [];
  room.scheduledBlocks.push(block);

  writeJSON(ROOMS_FILE, rooms);
  scheduleBlockRestore(id, type, untilTs, qty);
  logActivity(`BLOCK ${type} qty=${qty} until=${block.until} reason=${reason}`);
  broadcastRooms();
  res.json({ ok: true, block, room });
});

app.post('/api/unblock', requireAdmin, (req, res) => {
  const { id, type, qty } = req.body;
  const rooms = readJSON(ROOMS_FILE);

  if (id) {
    for (const r of rooms) {
      const blockIdx = (r.scheduledBlocks || []).findIndex(b => b.id === id);
      if (blockIdx !== -1) {
        const blk = r.scheduledBlocks.splice(blockIdx, 1)[0];
        r.available = Math.min(r.totalRooms, (r.available || 0) + (blk.qty || 1));
        if (scheduledJobs.has(id)) {
          clearTimeout(scheduledJobs.get(id));
          scheduledJobs.delete(id);
        }
        writeJSON(ROOMS_FILE, rooms);
        logActivity(`UNBLOCK ${id} type=${r.type}`);
        broadcastRooms();
        return res.json({ ok: true, room: r });
      }
    }
    return res.status(404).json({ error: 'Block not found' });
  }

  if (!type) return res.status(400).json({ error: 'id or type required' });
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const q = qty || 1;
  room.available = Math.min(room.totalRooms, (room.available || 0) + q);
  writeJSON(ROOMS_FILE, rooms);
  logActivity(`UNBLOCK type=${type} qty=${q}`);
  broadcastRooms();
  res.json({ ok: true, room });
});

// -----------------------------
// ✅ Admin compatibility endpoints
// These map older /api/admin/* paths to the same logic and broadcast updates.
// -----------------------------

app.post('/api/admin/update/:type', requireAdmin, (req, res) => {
  const type = req.params.type;
  const { total, available, delta } = req.body || {};
  const rooms = readJSON(ROOMS_FILE);
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (typeof delta === 'number') {
    room.totalRooms = Math.max(0, (room.totalRooms || 0) + delta);
    room.available = Math.max(0, Math.min(room.totalRooms, (room.available || 0) + delta));
  } else {
    if (typeof total === 'number') room.totalRooms = total;
    if (typeof available === 'number') room.available = Math.min(room.totalRooms, available);
  }

  writeJSON(ROOMS_FILE, rooms);
  logActivity(`ADMIN UPDATE ${type} total=${room.totalRooms} available=${room.available}`);
  broadcastRooms();
  res.json({ ok: true, room });
});

app.post('/api/admin/remove/:type', requireAdmin, (req, res) => {
  const type = req.params.type;
  const { qty = 1, until } = req.body || {};
  const rooms = readJSON(ROOMS_FILE);
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (until) {
    // Support simple day-range shorthand like "5-6" (used by tests) as well as ISO datetimes.
    let untilTs = Date.parse(until);
    if (isNaN(untilTs) && typeof until === 'string' && /^\d+\-\d+$/.test(until.trim())) {
      const [s, t] = until.trim().split('-').map(n => Number(n));
      const now = new Date();
      // Interpret as current month/year; set until to the end of the end-day
      const guessed = new Date(now.getFullYear(), now.getMonth(), t + 1, 0, 0, 0);
      untilTs = guessed.getTime();
    }
    if (isNaN(untilTs)) return res.status(400).json({ error: 'Invalid until date' });
    if ((room.available || 0) < qty) return res.status(400).json({ error: 'Not enough available rooms' });

    room.available -= qty;
    const id = `BLK-${uuidv4()}`;
    const block = { id, qty, reason: 'Admin remove', until: new Date(untilTs).toISOString() };
    room.scheduledBlocks = room.scheduledBlocks || [];
    room.scheduledBlocks.push(block);

    writeJSON(ROOMS_FILE, rooms);
    scheduleBlockRestore(id, type, untilTs, qty);
    logActivity(`ADMIN BLOCK ${type} qty=${qty} until=${block.until}`);
    broadcastRooms();
    return res.json({ ok: true, block, room });
  }

  room.available = Math.max(0, (room.available || 0) - qty);
  writeJSON(ROOMS_FILE, rooms);
  logActivity(`ADMIN REMOVE ${type} qty=${qty}`);
  broadcastRooms();
  res.json({ ok: true, room });
});

app.post('/api/admin/add/:type', requireAdmin, (req, res) => {
  const type = req.params.type;
  const amount = Number(req.body?.qty || 1);
  const rooms = readJSON(ROOMS_FILE);
  const room = findRoom(rooms, type);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  room.totalRooms = (room.totalRooms || room.total || 0) + amount;
  room.available = Math.min(room.totalRooms, (room.available || 0) + amount);
  writeJSON(ROOMS_FILE, rooms);
  logActivity(`ADMIN ADD ${type} qty=${amount}`);
  broadcastRooms();
  res.json({ ok: true, room });
});

app.get('/api/admin/blocks', requireAdmin, (req, res) => {
  const rooms = readJSON(ROOMS_FILE);
  const blocks = [];
  rooms.forEach(r => (r.scheduledBlocks || []).forEach(b => blocks.push({ ...b, type: r.type || r.name })));
  res.json({ blocks });
});

app.post('/api/admin/blocks/cancel', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const rooms = readJSON(ROOMS_FILE);
  for (const r of rooms) {
    const idx = (r.scheduledBlocks || []).findIndex(b => b.id === id);
    if (idx !== -1) {
      const blk = r.scheduledBlocks.splice(idx, 1)[0];
      r.available = Math.min(r.totalRooms, (r.available || 0) + (blk.qty || 1));
      if (scheduledJobs.has(id)) {
        clearTimeout(scheduledJobs.get(id));
        scheduledJobs.delete(id);
      }
      writeJSON(ROOMS_FILE, rooms);
      logActivity(`ADMIN UNBLOCK ${id} type=${r.type}`);
      broadcastRooms();
      return res.json({ ok: true, room: r });
    }
  }
  return res.status(404).json({ error: 'Block not found' });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const rooms = readJSON(ROOMS_FILE);
  rooms.forEach(r => {
    r.scheduledBlocks = [];
    r.available = r.totalRooms || r.total || r.available || 0;
  });
  writeJSON(ROOMS_FILE, rooms);
  logActivity('ADMIN RESET');
  broadcastRooms();
  res.json({ ok: true, rooms });
});

// Gemini API endpoint for direct model access
app.post('/api/gemini', async (req, res) => {
  const { message, searchResults } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const resp = await callGemini(message, { temperature: 0.7, maxOutputTokens: 1024 });
    const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('Gemini returned unexpected shape:', JSON.stringify(resp.data, null, 2));
      return res.status(502).json({ error: 'Invalid response from Gemini API', success: false, details: resp.data });
    }

    res.json({ response: text, success: true });
  } catch (error) {
    console.error('Error in /api/gemini:', error && (error.message || error));
    // If Gemini is rate-limited, return a friendly plain-text message to the client
    if (error && error.isRateLimit) {
      console.warn('Gemini rate limit hit, returning friendly message');
      return res.status(503).send(error.userMessage);
    }
    const statusCode = error.status || error.originalError?.response?.status || 500;
    const detailsRaw = error.responseData || error.originalError?.message || error.message;
    const detail = error.responseDataString || serializeErrorDetails(detailsRaw);
    const availableModels = error.availableModels || error.originalError?.availableModels;
    res.status(statusCode).json({ error: 'Failed to process the message', detail, details: detailsRaw, success: false, availableModels });
  }
});

// ---------------------------------------
// ✅ AI Route
// ---------------------------------------
app.post('/api/ai', async (req, res) => {
  const { prompt, searchMode } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) console.warn('⚠️ SERPER_API_KEY not set. Web search (searchMode) will fail without a valid Serper API key.');
  if (!process.env.GEMINI_API_KEY && !process.env.LEGACY_GEMINI_KEY) {
    console.error('GEMINI_API_KEY not set in environment');
    return res.status(500).json({ error: 'AI service is not configured. Missing Gemini API key.' });
  }

  try {
    console.log('Received AI prompt:', prompt);

    // Short-circuit simple casual greetings to keep responses brief
    const _trimmedPrompt = (prompt || '').trim();
    if (/^(hi|hey|hello|bro|yo|sup)[.!?]?$/i.test(_trimmedPrompt)) {
      // Return a short casual reply without calling the model
      const casualReply = /bro/i.test(_trimmedPrompt) ? 'Hey bro — how can I help?' : 'Hi! How can I help?';
      return res.json({ response: casualReply, success: true });
    }

    // Build a final prompt that includes site context and strict style guidelines
    let finalPrompt = `You are Maxx AI, the intelligent assistant for Hotel Maxx. Your role is to provide helpful, professional, and knowledgeable responses about our hotel services, amenities, and hospitality offerings. Always maintain a warm, welcoming tone while being precise and informative.`;

    // Response style guidelines — follow these exactly
    finalPrompt += `\n\nResponse style guidelines:\n- Keep responses short and clear (2–4 sentences maximum) unless the user explicitly asks for more.\n- Do NOT over-explain; avoid repetition and filler words.\n- Answer directly and efficiently; be friendly but not overly talkative.\n- Only provide extra details if the user asks for them.\n- If the user's input is a direct question, respond with a medium-length answer (about 3–5 sentences), not long.\n- If the user sends a simple greeting (e.g., "hi" or "bro"), reply casually and briefly (one short sentence).`;

    // Base context (kept concise) — site-specific details appended from public files when available
    finalPrompt += `\n\nContext about Hotel Maxx (brief):\n- Luxury 5-star hotel; personalized service; rooms: Standard, Deluxe, Suite, Presidential Suite; amenities: restaurants, 24/7 room service, spa, fitness center, pool, business facilities, concierge.`;

    // Add pre-extracted site context (short snippets) to help the assistant specialize answers
    if (SITE_CONTEXT) {
      finalPrompt += `\n\nSite Context:\n${SITE_CONTEXT}`;
    }

    // Add user's question
    finalPrompt += `\n\nUser request: ${prompt}`;

    // If searchMode is requested, fetch Serper results and append them
    let sources = [];
    let searchError = null;
    if (searchMode) {
      console.log('Search mode enabled. Fetching results from Serper API.');

      if (!SERPER_API_KEY) {
        searchError = { code: 'MISSING_KEY', message: 'SERPER_API_KEY not configured on server' };
        console.warn('Search mode requested but SERPER_API_KEY is missing');
      } else {
        try {
          const serperResponse = await axios.post(
            'https://google.serper.dev/search',
            { q: prompt },
            {
              headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': SERPER_API_KEY,
              },
              timeout: 15000
            }
          );

          const searchResults = serperResponse.data || {};
          console.log('Serper search status OK');

          // Extract a compact list of sources (robust to shape differences)
          const organic = Array.isArray(searchResults.organic) ? searchResults.organic : [];
          sources = organic.slice(0, 6).map(o => ({
            title: o.title || o.link || o.source?.title || 'Untitled',
            link: o.link || o.source?.link || null,
            snippet: o.snippet || o.description || ''
          }));

          // Append a short representative summary of the top results to the Gemini prompt
          const summaryParts = sources.map((s, idx) => `${idx + 1}. ${s.title} - ${s.snippet}`);
          if (summaryParts.length) finalPrompt += `\n\nSearch Results Summary:\n${summaryParts.join('\n')}`;
        } catch (err) {
          // Capture Serper errors (403 unauthorized, etc.) but continue — Gemini will still be used
          const status = err.response?.status;
          const body = err.response?.data || err.message;
          searchError = { code: status || 'ERROR', message: typeof body === 'string' ? body : JSON.stringify(body) };
          console.warn('Serper fetch failed:', searchError);
          finalPrompt += `\n\nNote: Web search failed with: ${searchError.message}. Proceed using site context and internal knowledge.`;
        }
      }
    }

    // Call Gemini API with the final prompt via helper
    const resp = await callGemini(finalPrompt, {
      temperature: 0.6,
      maxOutputTokens: 800,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    });

    console.log('Raw Gemini response:', JSON.stringify(resp.data, null, 2));

    if (!resp.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid or empty response from Gemini API');
    }

    const geminiResponse = resp.data.candidates[0].content.parts[0].text;
    const cleanedResponse = geminiResponse.trim();
    console.log('Cleaned response (truncated):', cleanedResponse.slice(0, 800));

    res.json({ response: cleanedResponse, success: true, sources, searchError });
  } catch (error) {
    console.error('Error processing AI request:', error && (error.message || error));
    // If Gemini is rate-limited, return a friendly plain-text message to the client
    if (error && error.isRateLimit) {
      console.warn('Gemini rate limit hit during /api/ai, returning friendly message');
      return res.status(503).send(error.userMessage);
    }
    const statusCode = error.response?.status || error.status || 500;
    const detailsRaw = error.response?.data || error.response?.data?.error || error.message;
    const detail = (error.response && serializeErrorDetails(error.response.data)) || serializeErrorDetails(detailsRaw);

    // Log diagnostic info without exposing secrets
    if (error.response) {
      console.error('Gemini response status:', error.response.status);
      if (error.response.data) console.error('Gemini response body (truncated):', serializeErrorDetails(error.response.data));
    }

    const availableModels = error.availableModels || error.originalError?.availableModels;
    res.status(statusCode).json({
      error: 'Failed to process the prompt',
      detail,
      details: detailsRaw,
      success: false,
      availableModels
    });
  }
});

// ---------------------------------------
// ✅ SSE endpoint (Live updates)
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendUpdate = () => {
    const rooms = readJSON(ROOMS_FILE);
    res.write(`data: ${JSON.stringify({ rooms, time: new Date().toISOString() })}\n\n`);
  };
  const interval = setInterval(sendUpdate, 10000);
  sendUpdate();

  req.on('close', () => clearInterval(interval));
});

// Fallback for unmatched HTML GET requests: serve custom 404 page if available
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts || !req.accepts('html')) return next();
  const notFoundPage = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFoundPage)) {
    res.status(404).sendFile(notFoundPage);
    return;
  }
  res.status(404).send('404 Not Found');
});

// ---------------------------------------
// ✅ Start Server
// ---------------------------------------
// Try to load secrets (non-blocking) then start server
(async () => {
  try {
    await loadGeminiKeyFromSecretManager();
  } catch (e) {
    console.warn('Secret Manager load failed at startup:', e && e.message ? e.message : e);
  }
  // Re-run config check after attempting to load secrets
  checkGeminiConfig();
  server.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
  });
})();

