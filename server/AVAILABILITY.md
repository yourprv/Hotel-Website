Room availability flow

Overview

- Admins modify rooms via admin UI or API. The server persists room data in `rooms.json` and broadcasts real-time updates via Socket.IO (`room_update`) and an SSE endpoint (`/events`).

API endpoints added or improved

- GET /api/rooms — returns the full rooms list
- GET /api/rooms/available — returns rooms suitable for requested guest counts and availability. Query params: `checkin`, `checkout`, `adults`, `children`. Returns: `{ rooms: [...], maxSingleCapacity }`.

Compatibility admin endpoints (new)

- POST /api/admin/update/:type — admin update (total, available, delta)
- POST /api/admin/add/:type — add rooms (body { qty: number })
- POST /api/admin/remove/:type — immediate remove or block (body { qty, until }). Supports shorthand day-range like `"5-6"` used by tests.
- GET /api/admin/blocks — list scheduled blocks
- POST /api/admin/blocks/cancel — cancel block by `{ id }`
- POST /api/admin/reset — reset scheduled blocks and availability to totals

Real-time updates

- The server emits `room_update` Socket.IO events with shape `{ rooms, time }` on changes (update, block, unblock).
- The SSE endpoint `/events` sends updates (default `message` event) for clients that prefer EventSource.

Security & Notes

- Admin endpoints require the same `x-admin-password` header as before. They use `requireAdmin` middleware.
- The availability endpoint is intentionally conservative; with no persisted bookings, it filters by capacity and available count only. It leaves room for future integrations with booking dates.

Files removed (safe cleanup)

- `server/tmp-list-blocks.js` — temporary script (no references)
- `server/tmp-server.js` — temporary script (no references)
- `server/rooms.json.bak` — backup file (not referenced at runtime)
- `server/server.err` — log file
- `server/last_search_results.txt` — temporary data file
- `server/new-rooms.json` — sample data file (not referenced)

These files had no imports or runtime references and were removed to reduce repo clutter. If you want any file restored, I can add it back as an archive.
