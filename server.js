const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

app.use(cors());
app.use(express.static('public'));

// Store active users and their sessions
const activeUsers = new Map();
const activeRooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user registration
    socket.on('register', (userId) => {
        activeUsers.set(userId, socket.id);
        socket.userId = userId;
        socket.emit('registered', userId);
    });

    // Handle random call request
    socket.on('requestRandomCall', () => {
        const availableUsers = Array.from(activeUsers.entries())
            .filter(([id, socketId]) => socketId !== socket.id && !isUserInCall(id));
        
        if (availableUsers.length > 0) {
            const randomUser = availableUsers[Math.floor(Math.random() * availableUsers.length)];
            const roomId = uuidv4();
            activeRooms.set(roomId, [socket.id, randomUser[1]]);
            
            io.to(socket.id).emit('randomCallMatched', { roomId, peerId: randomUser[0] });
            io.to(randomUser[1]).emit('incomingCall', { roomId, peerId: socket.userId });
        } else {
            socket.emit('noUsersAvailable');
        }
    });

    // Handle direct call request
    socket.on('requestDirectCall', (targetUserId) => {
        const targetSocketId = activeUsers.get(targetUserId);
        
        if (!targetSocketId) {
            socket.emit('userNotAvailable');
            return;
        }

        if (isUserInCall(targetUserId)) {
            socket.emit('userInCall');
            return;
        }

        const roomId = uuidv4();
        activeRooms.set(roomId, [socket.id, targetSocketId]);
        
        io.to(targetSocketId).emit('incomingCall', { roomId, peerId: socket.userId });
    });

    // Handle call acceptance
    socket.on('acceptCall', (roomId) => {
        const room = activeRooms.get(roomId);
        if (room) {
            io.to(room[0]).emit('callAccepted', { roomId, peerId: socket.userId });
        }
    });

    // Handle call rejection
    socket.on('rejectCall', (roomId) => {
        const room = activeRooms.get(roomId);
        if (room) {
            io.to(room[0]).emit('callRejected');
            activeRooms.delete(roomId);
        }
    });

    // Handle WebRTC signaling
    socket.on('signal', ({ roomId, signal }) => {
        const room = activeRooms.get(roomId);
        if (room) {
            const targetSocketId = room.find(id => id !== socket.id);
            io.to(targetSocketId).emit('signal', { peerId: socket.userId, signal });
        }
    });

    // Handle group call creation
    socket.on('createGroupCall', () => {
        const roomId = uuidv4();
        activeRooms.set(roomId, [socket.id]);
        socket.emit('groupCallCreated', { roomId });
    });

    // Handle group call join
    socket.on('joinGroupCall', (roomId) => {
        const room = activeRooms.get(roomId);
        if (room) {
            room.push(socket.id);
            socket.join(roomId);
            io.to(roomId).emit('userJoinedGroupCall', { peerId: socket.userId });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (socket.userId) {
            activeUsers.delete(socket.userId);
            // Clean up rooms
            for (const [roomId, users] of activeRooms.entries()) {
                if (users.includes(socket.id)) {
                    users.forEach(userId => {
                        if (userId !== socket.id) {
                            io.to(userId).emit('peerDisconnected');
                        }
                    });
                    activeRooms.delete(roomId);
                }
            }
        }
    });
});

function isUserInCall(userId) {
    for (const room of activeRooms.values()) {
        if (room.includes(activeUsers.get(userId))) {
            return true;
        }
    }
    return false;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 