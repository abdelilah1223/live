const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

// Middleware Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));
app.use(express.json());
app.use(express.static('public'));

// PeerJS Server Configuration
const peerServer = ExpressPeerServer(http, {
    debug: true,
    path: '/',  // Important: This should be '/'
    proxied: true,
    allow_discovery: true,
    generateClientId: () => uuidv4()
});

// Mount PeerJS server at /peerjs
app.use('/peerjs', peerServer);

// Socket.IO Server Configuration
const io = new Server(http, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    serveClient: false,
    cookie: false,
    allowEIO3: true,
    perMessageDeflate: {
        threshold: 1024,
        zlibDeflateOptions: {
            level: 3
        }
    }
});

// Store active users and rooms
const activeUsers = new Map();      // userId -> socketId
const activePeers = new Map();      // userId -> peerId
const activeRooms = new Map();      // roomId -> [socketId1, socketId2, ...]

// Helper function to check if user is in a call
function isUserInCall(userId) {
    const userSocketId = activeUsers.get(userId);
    if (!userSocketId) return false;
    
    for (const room of activeRooms.values()) {
        if (room.includes(userSocketId)) {
            return true;
        }
    }
    return false;
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Handle user registration
    socket.on('register', (userId) => {
        activeUsers.set(userId, socket.id);
        socket.userId = userId;
        socket.emit('registered', userId);
        console.log(`User ${userId} registered with socket ${socket.id}`);
    });

    // Handle peer ID registration
    socket.on('register-peer', (peerId) => {
        if (socket.userId) {
            activePeers.set(socket.userId, peerId);
            console.log(`User ${socket.userId} registered with PeerJS ID ${peerId}`);
        }
    });

    // Handle random call request
    socket.on('requestRandomCall', () => {
        const availableUsers = Array.from(activeUsers.entries())
            .filter(([id, socketId]) => socketId !== socket.id && !isUserInCall(id));
        
        if (availableUsers.length > 0) {
            const randomUser = availableUsers[Math.floor(Math.random() * availableUsers.length)];
            const roomId = uuidv4();
            activeRooms.set(roomId, [socket.id, randomUser[1]]);
            
            io.to(socket.id).emit('randomCallMatched', { 
                roomId, 
                peerId: randomUser[0],
                targetPeerId: activePeers.get(randomUser[0])
            });
            
            io.to(randomUser[1]).emit('incomingCall', { 
                roomId, 
                peerId: socket.userId,
                callerPeerId: activePeers.get(socket.userId)
            });
            
            console.log(`Random call created between ${socket.userId} and ${randomUser[0]}`);
        } else {
            socket.emit('noUsersAvailable');
            console.log('No users available for random call');
        }
    });

    // Handle direct call request
    socket.on('requestDirectCall', (targetUserId) => {
        const targetSocketId = activeUsers.get(targetUserId);
        
        if (!targetSocketId) {
            socket.emit('userNotAvailable');
            console.log(`User ${targetUserId} not available`);
            return;
        }

        if (isUserInCall(targetUserId)) {
            socket.emit('userInCall');
            console.log(`User ${targetUserId} is in another call`);
            return;
        }

        const roomId = uuidv4();
        activeRooms.set(roomId, [socket.id, targetSocketId]);
        
        io.to(targetSocketId).emit('incomingCall', { 
            roomId, 
            peerId: socket.userId,
            callerPeerId: activePeers.get(socket.userId)
        });
        
        console.log(`Direct call initiated from ${socket.userId} to ${targetUserId}`);
    });

    // Handle call acceptance
    socket.on('acceptCall', (roomId) => {
        const room = activeRooms.get(roomId);
        if (room) {
            const [callerSocketId] = room;
            io.to(callerSocketId).emit('callAccepted', { 
                roomId, 
                peerId: socket.userId,
                targetPeerId: activePeers.get(socket.userId)
            });
            console.log(`Call accepted in room ${roomId}`);
        }
    });

    // Handle call rejection
    socket.on('rejectCall', (roomId) => {
        const room = activeRooms.get(roomId);
        if (room) {
            const [callerSocketId] = room;
            io.to(callerSocketId).emit('callRejected');
            activeRooms.delete(roomId);
            console.log(`Call rejected in room ${roomId}`);
        }
    });

    // Handle group call creation
    socket.on('createGroupCall', () => {
        const roomId = uuidv4();
        activeRooms.set(roomId, [socket.id]);
        socket.join(roomId);
        socket.emit('groupCallCreated', { roomId });
        console.log(`Group call created with room ${roomId}`);
    });

    // Handle group call join
    socket.on('joinGroupCall', (roomId) => {
        if (!roomId || !activeRooms.has(roomId)) {
            socket.emit('invalidRoom');
            console.log(`Invalid room attempt: ${roomId}`);
            return;
        }

        const room = activeRooms.get(roomId);
        if (room.includes(socket.id)) {
            socket.emit('alreadyInRoom');
            console.log(`User already in room: ${roomId}`);
            return;
        }

        room.push(socket.id);
        socket.join(roomId);
        
        // Notify all participants about the new user
        socket.to(roomId).emit('newUserJoined', { 
            peerId: socket.userId,
            newPeerId: activePeers.get(socket.userId)
        });
        
        console.log(`User ${socket.userId} joined group call ${roomId}`);
    });

    // Handle signaling data
    socket.on('signal', ({ roomId, signal, targetPeerId }) => {
        const targetSocketId = activeUsers.get(targetPeerId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('signal', { 
                peerId: socket.userId, 
                signal 
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.userId) {
            activeUsers.delete(socket.userId);
            activePeers.delete(socket.userId);
            
            // Clean up rooms
            for (const [roomId, users] of activeRooms.entries()) {
                if (users.includes(socket.id)) {
                    users.forEach(userSocketId => {
                        if (userSocketId !== socket.id) {
                            io.to(userSocketId).emit('peerDisconnected', { 
                                peerId: socket.userId 
                            });
                        }
                    });
                    activeRooms.delete(roomId);
                    console.log(`Room ${roomId} cleaned up after disconnect`);
                }
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeUsers: activeUsers.size,
        activePeers: activePeers.size,
        activeRooms: activeRooms.size
    });
});

// PeerJS server events
peerServer.on('connection', (client) => {
    console.log('PeerJS client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log('PeerJS client disconnected:', client.getId());
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`PeerJS server running at /peerjs`);
    console.log(`Socket.IO server running at /socket.io/`);
});
