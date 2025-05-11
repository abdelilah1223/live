require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.static('public'));

// PeerJS Server
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true
});
app.use('/peerjs', peerServer);

// Socket.IO Server with WebSocket fixes
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
const users = new Map(); // userId -> socketId
const peers = new Map(); // userId -> peerId
const rooms = new Map(); // roomId -> { users: [userId1, userId2], sockets: [socketId1, socketId2] }

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    users.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} registered`);
  });

  // Register peer ID
  socket.on('register-peer', (peerId) => {
    if (socket.userId) {
      peers.set(socket.userId, peerId);
      console.log(`Peer registered: ${socket.userId} -> ${peerId}`);
    }
  });

  // Random call request
  socket.on('requestRandomCall', () => {
    const availableUsers = [...users.entries()]
      .filter(([id, sid]) => sid !== socket.id && !rooms.has(id));
    
    if (availableUsers.length === 0) {
      return socket.emit('noUsersAvailable');
    }

    const [targetUserId, targetSocketId] = availableUsers[
      Math.floor(Math.random() * availableUsers.length)
    ];
    const roomId = `room_${uuidv4()}`;
    
    rooms.set(roomId, {
      users: [socket.userId, targetUserId],
      sockets: [socket.id, targetSocketId]
    });

    io.to(socket.id).emit('randomCallMatched', {
      roomId,
      peerId: targetUserId,
      targetPeerId: peers.get(targetUserId)
    });

    io.to(targetSocketId).emit('incomingCall', {
      roomId,
      peerId: socket.userId,
      callerPeerId: peers.get(socket.userId)
    });
  });

  // Call acceptance
  socket.on('acceptCall', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const [callerSocketId] = room.sockets;
    io.to(callerSocketId).emit('callAccepted', {
      roomId,
      peerId: socket.userId,
      targetPeerId: peers.get(socket.userId)
    });
  });

  // WebRTC signaling
  socket.on('signal', ({ targetUserId, signal }) => {
    const targetSocketId = users.get(targetUserId);
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
      users.delete(socket.userId);
      peers.delete(socket.userId);

      // Clean up rooms
      for (const [roomId, room] of rooms.entries()) {
        if (room.sockets.includes(socket.id)) {
          room.sockets.forEach(sid => {
            if (sid !== socket.id) {
              io.to(sid).emit('peerDisconnected');
            }
          });
          rooms.delete(roomId);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
