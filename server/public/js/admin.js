// admin.js - Admin panel functionality with real-time updates
(function () {
    let socket = null;
    let adminToken = null;
    let activityEntries = [];

    function initSocket() {
        if (socket) return;
        socket = io();

        socket.on('connect', () => {
            updateConnectionStatus(true);
            addActivityEntry('Connected to server');
        });

        socket.on('room_update', (data) => {
            renderAdminRooms(data.rooms);
            updateStats(data.rooms);
            addActivityEntry(`Room data updated at ${new Date(data.time).toLocaleTimeString()}`);
        });

        socket.on('disconnect', () => {
            updateConnectionStatus(false);
            addActivityEntry('Disconnected from server');
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            updateConnectionStatus(false);
            addActivityEntry('Connection error - retrying...');
        });
    }

    function updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        if (!statusEl) return;

        if (connected) {
            statusEl.className = 'fixed top-4 right-4 status-indicator status-live z-50';
            statusEl.innerHTML = '<span class="pulse pulse-green"></span><span>Live</span>';
        } else {
            statusEl.className = 'fixed top-4 right-4 status-indicator status-offline z-50';
            statusEl.innerHTML = '<span class="pulse pulse-red"></span><span>Offline</span>';
        }
    }

    function addActivityEntry(message) {
        const logEl = document.getElementById('activityLog');
        if (!logEl) return;

        const timestamp = new Date().toLocaleTimeString();
        activityEntries.unshift({ time: timestamp, message });

        // Keep only last 50 entries
        if (activityEntries.length > 50) activityEntries.pop();

        logEl.innerHTML = activityEntries
            .map(e => `<div class="activity-entry"><span class="text-indigo-400">[${e.time}]</span> ${e.message}</div>`)
            .join('');
    }

    function formatDateTime(date) {
        return date.toISOString().slice(0, 16);
    }

    function getMinDateTime() {
        return formatDateTime(new Date());
    }

    function showBlockModal(roomName) {
        const modal = document.getElementById('blockModal');
        const roomNameInput = document.getElementById('blockRoomName');
        const blockUntilInput = document.getElementById('blockUntil');

        roomNameInput.value = roomName;
        blockUntilInput.min = getMinDateTime();
        blockUntilInput.value = formatDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));

        modal.classList.remove('hidden');
    }

    function updateStats(rooms) {
        const total = rooms.reduce((sum, r) => sum + (r.totalRooms || r.total || 0), 0);
        const available = rooms.reduce((sum, r) => sum + (r.available || 0), 0);
        const blocked = rooms.reduce((sum, r) => {
            const blocks = r.scheduledBlocks || [];
            return sum + blocks.reduce((s, b) => s + (b.qty || 1), 0);
        }, 0);

        document.getElementById('totalRooms').textContent = total;
        document.getElementById('availableRooms').textContent = available;
        document.getElementById('blockedRooms').textContent = blocked;
    }

    function renderAdminRooms(rooms) {
        const container = document.getElementById('roomsContainer');
        if (!container) return;

        container.innerHTML = '';
        rooms.forEach(room => {
            const blockedQty = (room.scheduledBlocks || []).reduce((s, b) => s + (b.qty || 1), 0);
            const isBlocked = blockedQty > 0;
            const blockInfo = isBlocked && room.scheduledBlocks[0]
                ? new Date(room.scheduledBlocks[0].until).toLocaleString()
                : null;

            const card = document.createElement('div');
            card.className = `room-card ${isBlocked ? 'blocked' : ''}`;
            card.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${room.type || room.name}</h3>
                        <p class="text-gray-500 text-sm">Capacity: ${room.capacity || 2} guests</p>
                    </div>
                    <div class="text-right">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${room.available > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${room.available > 0 ? 'Available' : 'Fully Booked'}
                        </span>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-3 mb-3 text-center">
                    <div class="bg-gray-50 rounded-lg p-2">
                        <p class="text-xs text-gray-500">Total</p>
                        <p class="font-bold text-gray-800">${room.totalRooms || room.total || 0}</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-2">
                        <p class="text-xs text-gray-500">Available</p>
                        <p class="font-bold text-green-600">${room.available || 0}</p>
                    </div>
                    <div class="bg-amber-50 rounded-lg p-2">
                        <p class="text-xs text-gray-500">Blocked</p>
                        <p class="font-bold text-amber-600">${blockedQty}</p>
                    </div>
                </div>
                ${isBlocked ? `
                    <p class="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg mb-3">
                        ⏰ Blocked until: ${blockInfo}
                    </p>
                ` : ''}
                <div class="room-actions">
                    <button onclick="Admin.addRoom('${room.name}')"
                            class="btn-action btn-success">
                        + Add
                    </button>
                    <button onclick="Admin.removeRoom('${room.name}')"
                            class="btn-action btn-danger"
                            ${room.available === 0 ? 'disabled' : ''}>
                        - Remove
                    </button>
                    <button onclick="Admin.showBlockModal('${room.name}')"
                            class="btn-action btn-blue"
                            ${room.available === 0 ? 'disabled' : ''}>
                        🔒 Block
                    </button>
                    ${isBlocked ? `
                        <button onclick="Admin.restoreRoom('${room.name}')"
                                class="btn-action btn-warning">
                            🔓 Restore
                        </button>
                    ` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    }

    async function handleLogin() {
        const password = document.getElementById('adminPassword').value;
        const loginMsg = document.getElementById('loginMsg');

        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await response.json();
            if (data.ok) {
                adminToken = data.token;
                document.getElementById('loginBox').classList.add('hidden');
                document.getElementById('adminPanel').classList.remove('hidden');
                loginMsg.textContent = '';
                addActivityEntry('Admin logged in successfully');
                fetchRooms();
            } else {
                loginMsg.textContent = data.error || 'Invalid password';
            }
        } catch (error) {
            console.error('Login error:', error);
            loginMsg.textContent = 'Login failed. Please try again.';
        }
    }

    async function addRoom(roomName) {
        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminToken
                },
                body: JSON.stringify({
                    type: roomName,
                    delta: 1
                })
            });

            const data = await response.json();
            if (!data.ok) {
                throw new Error(data.error || 'Failed to add room');
            }
            addActivityEntry(`Added 1 room to ${roomName}`);
        } catch (error) {
            console.error('Error adding room:', error);
            alert(error.message || 'Failed to add room');
        }
    }

    async function removeRoom(roomName) {
        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminToken
                },
                body: JSON.stringify({
                    type: roomName,
                    delta: -1
                })
            });

            const data = await response.json();
            if (!data.ok) {
                throw new Error(data.error || 'Failed to remove room');
            }
            addActivityEntry(`Removed 1 room from ${roomName}`);
        } catch (error) {
            console.error('Error removing room:', error);
            alert(error.message || 'Failed to remove room');
        }
    }

    async function blockRoom(roomName) {
        const blockUntil = document.getElementById('blockUntil').value;
        if (!blockUntil) {
            alert('Please select a block end time');
            return;
        }

        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/block', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminToken
                },
                body: JSON.stringify({
                    type: roomName,
                    qty: 1,
                    until: new Date(blockUntil).toISOString(),
                    reason: 'Admin blocked'
                })
            });

            const data = await response.json();
            if (!data.ok) {
                throw new Error(data.error || 'Failed to block room');
            }
            document.getElementById('blockModal').classList.add('hidden');
            addActivityEntry(`Blocked 1 ${roomName} until ${new Date(blockUntil).toLocaleString()}`);
        } catch (error) {
            console.error('Error blocking room:', error);
            alert(error.message || 'Failed to block room');
        }
    }

    async function restoreRoom(roomName) {
        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/unblock', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminToken
                },
                body: JSON.stringify({ type: roomName })
            });

            const data = await response.json();
            if (!data.ok) {
                throw new Error(data.error || 'Failed to restore room');
            }
            addActivityEntry(`Restored blocked ${roomName}`);
        } catch (error) {
            console.error('Error restoring room:', error);
            alert(error.message || 'Failed to restore room');
        }
    }

    async function fetchRooms() {
        try {
            const response = await fetch('https://hotel-maxx-backend.onrender.com/api/rooms');
            const rooms = await response.json();
            renderAdminRooms(rooms);
            updateStats(rooms);
        } catch (error) {
            console.error('Error fetching rooms:', error);
        }
    }

    function init() {
        initSocket();

        document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
        document.getElementById('adminPassword')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });

        document.getElementById('confirmBlock')?.addEventListener('click', () => {
            const roomName = document.getElementById('blockRoomName').value;
            blockRoom(roomName);
        });

        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            adminToken = null;
            document.getElementById('adminPanel').classList.add('hidden');
            document.getElementById('loginBox').classList.remove('hidden');
            document.getElementById('adminPassword').value = '';
            addActivityEntry('Admin logged out');
        });

        fetchRooms();
    }

    // Export public API
    window.Admin = {
        init,
        addRoom,
        removeRoom,
        showBlockModal,
        restoreRoom
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    Admin.init();
});