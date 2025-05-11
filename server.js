require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Middleware Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.static('public'));

// PeerJS Server Configuration
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true,
  generateClientId: () => uuidv4()
});
app.use('/peerjs', peerServer);

// Socket.IO Server Configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  serveClient: false,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store active connections
const activeUsers = new Map();  // userId -> socketId
const activePeers = new Map();  // userId -> peerId
const activeRooms = new Map();  // roomId -> { users: [userId1, userId2], sockets: [socketId1, socketId2] }

// Helper function to check if user is in a call
function isUserInCall(userId) {
  const socketId = activeUsers.get(userId);
  if (!socketId) return false;
  
  return [...activeRooms.values()].some(room => 
    room.sockets.includes(socketId)
  );
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.emit('registered', userId);
    console.log(`User ${userId} registered`);
  });

  // Register peer ID
  socket.on('register-peer', (peerId) => {
    if (socket.userId) {
      activePeers.set(socket.userId, peerId);
      console.log(`Peer registered: ${socket.userId} -> ${peerId}`);
    }
  });

  // Random call request
  socket.on('requestRandomCall', () => {
    const availableUsers = [...activeUsers.entries()]
      .filter(([id, sid]) => sid !== socket.id && !isUserInCall(id));
    
    if (availableUsers.length === 0) {
      return socket.emit('noUsersAvailable');
    }

    const [targetUserId, targetSocketId] = availableUsers[
      Math.floor(Math.random() * availableUsers.length)
    ];
    const roomId = `room_${uuidv4()}`;
    
    activeRooms.set(roomId, {
      users: [socket.userId, targetUserId],
      sockets: [socket.id, targetSocketId]
    });

    // Notify both users
    io.to(socket.id).emit('randomCallMatched', {
      roomId,
      peerId: targetUserId,
      targetPeerId: activePeers.get(targetUserId)
    });

    io.to(targetSocketId).emit('incomingCall', {
      roomId,
      peerId: socket.userId,
      callerPeerId: activePeers.get(socket.userId)
    });
  });

  // Call acceptance
  socket.on('acceptCall', (roomId) => {
    const room = activeRooms.get(roomId);
    if (!room) return;

    const [callerSocketId] = room.sockets;
    io.to(callerSocketId).emit('callAccepted', {
      roomId,
      peerId: socket.userId,
      targetPeerId: activePeers.get(socket.userId)
    });
  });

  // Call rejection
  socket.on('rejectCall', (roomId) => {
    const room = activeRooms.get(roomId);
    if (!room) return;

    const [callerSocketId] = room.sockets;
    io.to(callerSocketId).emit('callRejected');
    activeRooms.delete(roomId);
  });

  // WebRTC signaling
  socket.on('signal', ({ targetUserId, signal }) => {
    const targetSocketId = activeUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        peerId: socket.userId,
        signal
      });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.userId) {
      activeUsers.delete(socket.userId);
      activePeers.delete(socket.userId);

      // Clean up rooms
      for (const [roomId, room] of activeRooms.entries()) {
        if (room.sockets.includes(socket.id)) {
          room.sockets.forEach(sid => {
            if (sid !== socket.id) {
              io.to(sid).emit('peerDisconnected');
            }
          });
          activeRooms.delete(roomId);
        }
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    users: activeUsers.size,
    peers: activePeers.size,
    rooms: activeRooms.size,
    websockets: true
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/socket.io/`);
  console.log(`PeerJS endpoint: http://localhost:${PORT}/peerjs`);
});
