Frontend capacity rules (Hotel Maxx)

Summary:
- Implemented frontend-only room capacity rules and extra-bed handling.

Rules enforced on frontend (check.html + booking.html):
- Standard Suite / Deluxe Room / Junior Suite: max 2 adults + 1 child (max 3 guests).
- Triple Deluxe: max 3 adults + 1 child (max 4 guests).
- If user exceeds a room's capacity, the UI suggests booking multiple rooms or adding one extra bed for रु 500 (extra bed adds capacity for one additional guest).

Notes:
- These checks are enforced only in the frontend UI; backend endpoints, database and server-side logic remain unchanged.
- `check.html` now displays the canonical room names and capacity hints, and includes an "Add extra bed" flow that sets `extraBed=1` on the booking link.
- `booking.html` now shows a capacity warning, an "Add extra bed (रु 500)" checkbox, and blocks bookings that exceed even capacity + a single extra bed.
- `booking.html` also subscribes to Socket.IO `room_update` broadcasts and displays per-room availability badges and disables room options when the server reports zero availability.

Files changed (frontend only):
- server/public/check.html
- server/public/booking.html

If you want, I can also add a small unit / integration test or a short user-facing note on the booking page explaining the extra-bed policy to guests.