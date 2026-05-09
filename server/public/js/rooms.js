// rooms.js - shared script for fetching and displaying room availability
const Rooms = (function () {
  const API_BASE = 'https://hotel-maxx-backend.onrender.com';
  let socket = null;
  let intervalId = null;

  function initSocket() {
    if (socket) return;
    socket = io(); // Connect to socket.io server

    socket.on('room_update', (data) => {
      // Accept both { rooms, time } shape and plain rooms arrays for compatibility
      const rooms = Array.isArray(data) ? data : (data && data.rooms ? data.rooms : []);
      // Update UI whenever room data changes
      renderRoomsWithData(rooms);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
  }

  function fetchRooms() {
    return fetch(`${API_BASE}/api/rooms`).then(res => {
      if (!res.ok) throw new Error('Failed to fetch rooms');
      return res.json();
    });
  }

  function getRoomAvailabilityText(room) {
    if (room.available > 0) {
      return `Available Rooms: ${room.available}`;
    }
    return 'No rooms available';
  }

  function renderRoomsWithData(rooms) {
    const containers = document.querySelectorAll('.room-container');
    containers.forEach(container => {
      container.innerHTML = '';
      rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'room-card';
        card.innerHTML = `
          <h3 class="room-type">${room.type}</h3>
          <p class="room-availability">
            ${getRoomAvailabilityText(room)}
            ${room.blocked > 0 ? ` (${room.blocked} blocked)` : ''}
          </p>
          <button class="book-btn" ${room.available === 0 ? 'disabled' : ''}>Book</button>
        `;
        container.appendChild(card);
      });
    });
  }

  function renderRooms(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.classList.add('room-container'); // Add class for easy selection

    // Initialize socket.io connection
    initSocket();

    // Initial fetch and render
    fetchRooms().then(rooms => {
      renderRoomsWithData(rooms);
    }).catch(err => {
      console.error('Error rendering rooms:', err);
    });
  }

  function startAutoRefresh(containerSelector, intervalMs = 5000) {
    stopAutoRefresh();
    renderRooms(containerSelector);
    intervalId = setInterval(() => renderRooms(containerSelector), intervalMs);
  }

  function stopAutoRefresh() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // Admin actions
  async function adminAdd(type) {
    const headers = {};
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    const resp = await fetch(`https://hotel-maxx-backend.onrender.com/api/admin/add/${encodeURIComponent(type)}`, { method: 'POST', headers });
    if (!resp.ok) throw new Error('Add failed');
    return resp.json();
  }

  // body may be { until: ISOstring, price: number }
  async function adminRemove(type, body) {
    const headers = {};
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    let opts = { method: 'POST', headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`https://hotel-maxx-backend.onrender.com/api/admin/remove/${encodeURIComponent(type)}`, opts);
    if (!resp.ok) throw new Error('Remove failed');
    return resp.json();
  }

  async function adminFetchBlocks() {
    const headers = {};
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/blocks', { headers });
    if (!resp.ok) throw new Error('Failed to fetch blocks');
    return resp.json();
  }

  async function adminCancelBlock(id) {
    const headers = { 'Content-Type': 'application/json' };
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/blocks/cancel', { method: 'POST', headers, body: JSON.stringify({ id }) });
    if (!resp.ok) throw new Error('Cancel block failed');
    return resp.json();
  }

  async function adminUpdate(type, data) {
    const headers = { 'Content-Type': 'application/json' };
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    const resp = await fetch(`https://hotel-maxx-backend.onrender.com/api/admin/update/${encodeURIComponent(type)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('Update failed');
    return resp.json();
  }

  async function adminReset() {
    const headers = {};
    if (window.ADMIN_TOKEN) headers['x-admin-password'] = window.ADMIN_TOKEN;
    const resp = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/reset', { method: 'POST', headers });
    if (!resp.ok) throw new Error('Reset failed');
    return resp.json();
  }

  return { renderRooms, startAutoRefresh, stopAutoRefresh, adminAdd, adminRemove, adminUpdate, adminReset };
})();

// Expose to window
window.Rooms = Rooms;

// --- SSE listener for live updates ---
;(function attachSse() {
  if (!window.EventSource) return;
  let es;
  function connect() {
    es = new EventSource('/events');
    // Listen for named 'rooms' events (if sent) and for default 'message' events
    function handleSsePayload(payload) {
      // If the page provides a fetchAvailable() (check.html), call it to let the page refresh properly.
      if (typeof window.fetchAvailable === 'function') {
        try { window.fetchAvailable(); } catch (err) { /* ignore page-level errors */ }
        return;
      }
      // Fallback: if a page has container .rooms-container, re-render it from SSE payload
      const container = document.querySelector('.rooms-container');
      if (container) {
        container.innerHTML = '';
        (payload.rooms || []).forEach(r => {
          const card = document.createElement('div');
          card.className = 'room-card';
          const avail = (typeof r.availableRooms === 'number' ? r.availableRooms : (typeof r.available === 'number' ? r.available : 0));
          const total = (typeof r.totalRooms === 'number' ? r.totalRooms : (typeof r.total === 'number' ? r.total : 0));
          card.innerHTML = `
            <h3 class="room-type">${r.type}</h3>
            <p class="room-availability">${avail > 0 ? `Available: ${avail}/${total}` : 'Fully Booked'}</p>
            <button class="book-btn" ${avail === 0 ? 'disabled' : ''}>Book</button>
          `;
          container.appendChild(card);
        });
      }
    }

    es.addEventListener('rooms', (e) => {
      try {
        const payload = JSON.parse(e.data);
        handleSsePayload(payload);
      } catch (err) {
        console.error('SSE rooms parse error', err);
      }
    });

    es.addEventListener('message', (e) => {
      try {
        const payload = JSON.parse(e.data);
        handleSsePayload(payload);
      } catch (err) {
        // Some servers may send plain messages; ignore parse errors
      }
    });

    es.addEventListener('error', (ev) => {
      console.warn('SSE error', ev);
      // attempt reconnect handled by browser EventSource automatically
    });
  }
  connect();
  // expose for debugging
  window._ROOMS_SSE = { connect };
})();
