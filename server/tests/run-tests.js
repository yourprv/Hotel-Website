const fetch = require('node-fetch');
const assert = require('assert');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function request(path, opts) {
  const url = BASE + path;
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch(e) { body = text; }
  return { status: res.status, body };
}

async function run() {
  console.log('Starting tests against', BASE);

  // 1. auth
  let r = await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }) });
  assert.strictEqual(r.status, 200, 'admin auth should succeed');
  const token = r.body && r.body.token;
  assert.ok(token, 'token returned');
  console.log('Auth ok');

  // 2. get rooms
  r = await request('/api/rooms');
  assert.strictEqual(r.status, 200);
  const rooms = r.body;
  assert.ok(Array.isArray(rooms) && rooms.length > 0, 'rooms list present');
  const roomType = rooms[0].type;
  console.log('Got rooms, using roomType=', roomType);

  // 3. create block with shorthand day-range: choose today and tomorrow
  const now = new Date();
  const s = now.getDate();
  const t = new Date(now.getTime() + 24*3600*1000).getDate();
  const dayRange = `${s}-${t}`;
  r = await request(`/api/admin/remove/${encodeURIComponent(roomType)}`, { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': token }, body: JSON.stringify({ until: dayRange, qty: 1 }) });
  assert.strictEqual(r.status, 200, 'create block should return 200');
  assert.ok(r.body && r.body.block && r.body.block.id, 'block returned');
  const blockId = r.body.block.id;
  console.log('Created block', blockId);

  // 4. list blocks
  r = await request('/api/admin/blocks', { method: 'GET', headers: { 'x-admin-password': token } });
  assert.strictEqual(r.status, 200, 'blocks list ok');
  const blocks = r.body && r.body.blocks;
  assert.ok(Array.isArray(blocks) && blocks.find(b => b.id === blockId), 'created block appears');
  console.log('Block listed');

  // 5. cancel block
  r = await request('/api/admin/blocks/cancel', { method: 'POST', headers: { 'Content-Type':'application/json', 'x-admin-password': token }, body: JSON.stringify({ id: blockId }) });
  assert.strictEqual(r.status, 200, 'cancel block ok');
  assert.ok(r.body && r.body.ok, 'cancel returned ok');
  console.log('Block cancelled');

  // 6. verify block gone
  r = await request('/api/admin/blocks', { method: 'GET', headers: { 'x-admin-password': token } });
  const blocks2 = r.body && r.body.blocks;
  assert.ok(Array.isArray(blocks2) && !blocks2.find(b => b.id === blockId), 'block no longer present');

  console.log('All tests passed');
}

run().catch(err => {
  console.error('Tests failed:', err && err.stack || err);
  process.exitCode = 2;
});
