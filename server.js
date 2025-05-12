require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Add favicon route to prevent 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

// PeerJS Server Configuration
const peerServer = ExpressPeerServer(server, {
  debug: false,
  path: '/peerjs',
  proxied: true,
  generateClientId: () => uuidv4(),
  aliveTimeout: 60000,
  concurrent_limit: 5000
});

app.use('/peerjs', peerServer);

// Socket.IO Server Configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  serveClient: false,
  pingTimeout: 30000,
  pingInterval: 15000,
  cookie: false,
  allowEIO3: true
});

// Store active connections
const activeConnections = new Map(); // userId -> { socketId, peerId }

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    activeConnections.set(userId, { 
      socketId: socket.id,
      peerId: null
    });
    socket.userId = userId;
    socket.emit('registered', { userId });
    console.log(`User ${userId} registered`);
  });

  // Register peer ID
  socket.on('register-peer', (peerId) => {
    if (socket.userId && activeConnections.has(socket.userId)) {
      const userData = activeConnections.get(socket.userId);
      userData.peerId = peerId;
      activeConnections.set(socket.userId, userData);
      console.log(`Peer registered: ${socket.userId} -> ${peerId}`);
    }
  });

  // Random call request
  socket.on('request-random-call', () => {
    const availableUsers = [...activeConnections.entries()]
      .filter(([userId, data]) => userId !== socket.userId && data.peerId);
    
    if (availableUsers.length === 0) {
      return socket.emit('no-users-available');
    }

    const [targetUserId, targetData] = availableUsers[
      Math.floor(Math.random() * availableUsers.length)
    ];
    const roomId = uuidv4();
    
    // Notify both users
    socket.emit('random-call-matched', { 
      roomId,
      targetUserId,
      targetPeerId: targetData.peerId
    });

    io.to(targetData.socketId).emit('incoming-call', {
      roomId,
      callerUserId: socket.userId,
      callerPeerId: activeConnections.get(socket.userId).peerId
    });
  });

  // Call acceptance
  socket.on('accept-call', ({ roomId, callerUserId }) => {
    const callerData = activeConnections.get(callerUserId);
    if (!callerData) return;

    io.to(callerData.socketId).emit('call-accepted', {
      roomId,
      targetUserId: socket.userId,
      targetPeerId: activeConnections.get(socket.userId).peerId
    });
  });

  // Call rejection
  socket.on('reject-call', ({ roomId, callerUserId }) => {
    const callerData = activeConnections.get(callerUserId);
    if (callerData) {
      io.to(callerData.socketId).emit('call-rejected', { roomId });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.userId) {
      // Notify any connected peers
      activeConnections.forEach((data, userId) => {
        if (data.peerId && userId !== socket.userId) {
          io.to(data.socketId).emit('peer-disconnected', {
            peerId: activeConnections.get(socket.userId)?.peerId
          });
        }
      });
      
      activeConnections.delete(socket.userId);
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Peer server events
peerServer.on('connection', (client) => {
  console.log('PeerJS client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('PeerJS client disconnected:', client.getId());
});

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
