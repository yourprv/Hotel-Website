const http = require('http');
const https = require('https');
const { URL } = require('url');

function doFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = opts.headers || {};
    if (data) headers['Content-Type'] = 'application/json';
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        method: opts.method || 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try { const json = JSON.parse(body || '{}'); resolve({ status: res.statusCode, body: json }); }
          catch (err) { resolve({ status: res.statusCode, body: body }); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async function run() {
  const base = 'http://localhost:5000';
  console.log('Running tests against', base);

  // 1) auth
  const auth = await doFetch(base + '/api/admin/auth', { method: 'POST', body: { password: 'admin123' } });
  console.log('auth status', auth.status, 'body', auth.body);
  if (auth.status !== 200 || !auth.body || !auth.body.token) {
    console.error('Auth failed - cannot continue tests');
    process.exit(2);
  }
  const token = auth.body.token;

  // 2) read rooms
  const before = await doFetch(base + '/api/rooms');
  console.log('rooms before:', before.status);
  if (!Array.isArray(before.body)) { console.error('Unexpected rooms list'); process.exit(2); }
  const sample = before.body[0];
  const type = encodeURIComponent(sample.type);

  // 3) update available -> set available to 1
  const upd = await doFetch(base + '/api/admin/update/' + type, { method: 'POST', headers: { 'x-admin-password': token }, body: { available: 1, total: sample.total || sample.totalRooms || 1 } });
  console.log('update status', upd.status, 'body', upd.body);
  if (upd.status !== 200) { console.error('Update failed'); process.exit(2); }

  // 4) remove qty 1 immediately
  const rem = await doFetch(base + '/api/admin/remove/' + type, { method: 'POST', headers: { 'x-admin-password': token }, body: { qty: 1 } });
  console.log('remove status', rem.status, 'body', rem.body);
  if (rem.status !== 200) { console.error('Remove failed'); process.exit(2); }

  // 5) read rooms again
  const after = await doFetch(base + '/api/rooms');
  console.log('rooms after:', after.status);
  const newSample = after.body.find(r => r.type === sample.type);
  console.log('available before:', sample.available, 'after:', newSample.available);

  console.log('Tests completed');
  process.exit(0);
})();