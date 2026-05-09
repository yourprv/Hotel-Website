// app.js - unified client for admin and user pages (socket.io + REST)
(function () {
  const socket = io();

  // Utility
  function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }

  // Normalize various datetime inputs into an ISO-ish string the server can parse.
  // Accepts formats like "2025-10-23 03:00:00am", "2025-10-23T15:00:00", or "2025-10-23 3:00pm"
  function normalizeDateTimeInput(input) {
    if (!input) return null;
    let s = String(input).trim();
    // replace space between date and time with T if present and not already T
    s = s.replace(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\s+/, '$1T');
    // handle trailing am/pm
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]m))?$/i);
    if (m) {
      const datePart = m[1];
      let timePart = m[2];
      const ampm = m[3] ? m[3].toLowerCase() : null;
      const parts = timePart.split(':');
      let hh = parseInt(parts[0], 10);
      const mm = parts[1] || '00';
      const ss = parts[2] || '00';
      if (ampm) {
        if (ampm === 'pm' && hh < 12) hh += 12;
        if (ampm === 'am' && hh === 12) hh = 0;
      }
      const hhStr = String(hh).padStart(2, '0');
      return `${datePart}T${hhStr}:${mm}:${ss}`;
    }
    // fallback: return original string (server also has flexible parsing)
    return s;
  }

  // --- ADMIN SIDE ---
  const loginBox = document.getElementById('loginBox');
  const adminPanel = document.getElementById('adminPanel');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const loginMsg = document.getElementById('loginMsg');
  const roomsGrid = document.getElementById('roomsGrid');
  const activityLog = document.getElementById('activityLog');
  const resetBtn = document.getElementById('resetBtn');

  let ADMIN_TOKEN = null;

  async function fetchActivity() {
    try {
      const resp = await fetch('/activity.log');
      if (!resp.ok) return;
      const txt = await resp.text();
      if (activityLog) activityLog.textContent = txt.split('\n').reverse().slice(0,200).join('\n');
    } catch (e) { /* ignore */ }
  }

  function renderAdminRooms(data) {
    if (!roomsGrid) return;
    roomsGrid.innerHTML = '';
    (data || []).forEach(r => {
      const card = el('div', 'p-4 bg-white rounded shadow');
      const avail = Number(r.available || r.availableRooms || 0);
      const blocked = Array.isArray(r.scheduledBlocks) ? r.scheduledBlocks.reduce((s,b)=>s+(b.qty||1),0) : 0;
      card.innerHTML = `
        <h3 class="text-lg font-semibold">${r.type}</h3>
        <p class="text-sm text-gray-600">Total: ${r.total || r.totalRooms || 0}</p>
        <p class="mt-2">Available: <strong id="avail-${r.type}">${avail}</strong></p>
        <p>Blocked: <strong id="blocked-${r.type}">${blocked}</strong></p>
      `;
      // controls
      const controls = el('div','mt-3 flex gap-2');
      const addBtn = el('button','px-2 py-1 bg-green-500 text-white rounded','+ Add');
      const remBtn = el('button','px-2 py-1 bg-yellow-500 text-white rounded','- Remove');
      const blockBtn = el('button','px-2 py-1 bg-red-600 text-white rounded','Block Until');
      const restoreBtn = el('button','px-2 py-1 bg-blue-600 text-white rounded','Restore Now');

      controls.appendChild(addBtn);
      controls.appendChild(remBtn);
      controls.appendChild(blockBtn);
      controls.appendChild(restoreBtn);
      card.appendChild(controls);

      addBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/update', { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': ADMIN_TOKEN }, body: JSON.stringify({ type: r.type, available: avail+1 }) });
          if (!resp.ok) throw new Error('Add failed');
          await refreshRooms();
        } catch (e) { alert('Add failed'); }
      });

      remBtn.addEventListener('click', async () => {
        try {
          const qty = Number(prompt('How many to remove (block)?', '1')) || 1;
          let untilStr = prompt('Block until (e.g. 2025-10-23T15:00:00 or 2025-10-23 03:00:00am)');
          if (!untilStr) return;
          untilStr = normalizeDateTimeInput(untilStr);
          const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/block', { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': window.ADMIN_TOKEN || ADMIN_TOKEN }, body: JSON.stringify({ type: r.type, qty, until: untilStr, reason: 'manual' }) });
          if (!resp.ok) throw new Error('Block failed');
          await refreshRooms();
          await fetchActivity();
        } catch (e) { alert('Block failed: ' + (e.message || '')); }
      });

      blockBtn.addEventListener('click', async () => {
        try {
          const qty = Number(prompt('Number of rooms to block?', '1')) || 1;
          let untilStr = prompt('Block until (e.g. 2025-10-23T15:00:00 or 2025-10-23 03:00:00am)');
          if (!untilStr) return;
          untilStr = normalizeDateTimeInput(untilStr);
          const reason = prompt('Reason for block?', 'maintenance') || '';
          const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/block', { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': window.ADMIN_TOKEN || ADMIN_TOKEN }, body: JSON.stringify({ type: r.type, qty, until: untilStr, reason }) });
          if (!resp.ok) throw new Error('Block failed');
          await refreshRooms();
          await fetchActivity();
        } catch (e) { alert('Block failed'); }
      });

      restoreBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/unblock', { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': ADMIN_TOKEN }, body: JSON.stringify({ type: r.type, qty: 1 }) });
          if (!resp.ok) throw new Error('Restore failed');
          await refreshRooms();
          await fetchActivity();
        } catch (e) { alert('Restore failed'); }
      });

      roomsGrid.appendChild(card);
    });
  }

  async function refreshRooms() {
    try {
      const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/rooms');
      const rooms = await resp.json();
      renderAdminRooms(rooms);
    } catch (e) { console.error(e); }
  }

  if (loginBtn) loginBtn.addEventListener('click', async () => {
    // Trim whitespace to avoid accidental spaces causing login failures
    const pass = String(document.getElementById('adminPassword').value || '').trim();
    try {
      const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: pass }) });
      if (!resp.ok) { loginMsg.textContent = 'Invalid password'; return; }
  const data = await resp.json();
  ADMIN_TOKEN = data.token;
  // expose globally for other modules/scripts
  try { window.ADMIN_TOKEN = ADMIN_TOKEN; } catch (e) {}
  loginBox.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  await refreshRooms();
  await fetchActivity();
    } catch (e) { loginMsg.textContent = 'Login error'; }
  });

  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    ADMIN_TOKEN = null;
    adminPanel.classList.add('hidden');
    loginBox.classList.remove('hidden');
  });

  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset all rooms to defaults?')) return;
    try {
      const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/reset', { method: 'POST', headers: { 'x-admin-password': ADMIN_TOKEN } });
      if (!resp.ok) throw new Error('Reset failed');
      await refreshRooms();
      await fetchActivity();
    } catch (e) { alert('Reset failed'); }
  });

  // --- USER SIDE: availability display and check ---
  // Expose fetchAvailable for pages like check.html that rely on it
  window.fetchAvailable = async function (checkin, checkout, roomType) {
    try {
      const url = new URL('https://hotel-maxx-backend.onrender.com/api/rooms');
      const resp = await fetch(url);
      const rooms = await resp.json();
      // if user provided dates, query booking availability per type
      if (checkin && checkout && roomType) {
        const avResp = await fetch('https://hotel-maxx-backend.onrender.com/api/rooms/available?checkin=' + encodeURIComponent(checkin) + '&checkout=' + encodeURIComponent(checkout));
        const data = await avResp.json();
        // find requested type
        const found = (data.rooms || []).find(r => r.type.toLowerCase() === roomType.toLowerCase());
        return { ok: true, available: found ? found.availableRooms : 0 };
      }
      return { ok: true, rooms };
    } catch (e) { return { ok: false, error: e.message }; }
  };

  // --- Real-Time Updates ---
socket.on('room_update', (data) => {
  const { availableRooms, blockedRooms } = data;
  document.getElementById('availableRooms').textContent = availableRooms;
  document.getElementById('blockedRooms').textContent = blockedRooms;
});

  // expose minimal API for other scripts
  window.HotelApp = { refreshRooms, fetchActivity };
})();
