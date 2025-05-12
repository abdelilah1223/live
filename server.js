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
  origin: ['https://live-production-cf6e.up.railway.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'X-Forwarded-Proto'
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Add security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Access-Control-Allow-Origin', 'https://live-production-cf6e.up.railway.app');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

app.use(express.static('public'));

// PeerJS Server with correct path
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true,
  generateClientId: () => uuidv4(),
  ssl: {
    key: process.env.SSL_KEY,
    cert: process.env.SSL_CERT
  }
});
app.use('/peerjs', peerServer);

// Socket.IO Server with WebSocket fixes
const io = new Server(server, {
  cors: {
    origin: ['https://live-production-cf6e.up.railway.app', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Forwarded-For',
      'X-Forwarded-Host',
      'X-Forwarded-Proto'
    ]
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  serveClient: false,
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: {
    name: 'io',
    path: '/',
    httpOnly: true,
    sameSite: 'lax'
  },
  allowUpgrades: true,
  maxHttpBufferSize: 1e8,
  connectTimeout: 45000,
  upgradeTimeout: 30000,
  perMessageDeflate: {
    threshold: 2048
  },
  httpCompression: {
    threshold: 2048
  }
});

// Add session recovery middleware
io.use((socket, next) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (sessionId) {
    // Try to recover session
    const userId = [...activeUsers.entries()]
      .find(([_, sid]) => sid === sessionId)?.[0];
    if (userId) {
      socket.userId = userId;
      socket.sessionId = sessionId;
    }
  }
  next();
});

// Store active connections with timestamps
const activeUsers = new Map();
const activePeers = new Map();
const activeRooms = new Map();
const connectionTimestamps = new Map();

// Add connection monitoring
function monitorConnections() {
  const now = Date.now();
  const timeout = 30000; // 30 seconds

  for (const [userId, socketId] of activeUsers.entries()) {
    const timestamp = connectionTimestamps.get(socketId);
    if (timestamp && (now - timestamp) > timeout) {
      console.log(`Connection timeout for user ${userId}`);
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }
  }
}

// Run connection monitoring every 10 seconds
setInterval(monitorConnections, 10000);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  connectionTimestamps.set(socket.id, Date.now());

  // Register user
  socket.on('register', (userId) => {
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    connectionTimestamps.set(socket.id, Date.now());
    socket.emit('registered', userId);
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  // Heartbeat mechanism
  socket.on('heartbeat', () => {
    connectionTimestamps.set(socket.id, Date.now());
  });

  // Register peer ID
  socket.on('register-peer', (peerId) => {
    if (socket.userId) {
      activePeers.set(socket.userId, peerId);
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
    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id, targetSocketId]);

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

  // Direct call request
  socket.on('requestDirectCall', (targetUserId) => {
    const targetSocketId = activeUsers.get(targetUserId);
    
    if (!targetSocketId) {
      return socket.emit('userNotAvailable');
    }

    if (isUserInCall(targetUserId)) {
      return socket.emit('userInCall');
    }

    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id, targetSocketId]);

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

    const [callerSocketId] = room;
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

    const [callerSocketId] = room;
    io.to(callerSocketId).emit('callRejected');
    activeRooms.delete(roomId);
  });

  // Group call creation
  socket.on('createGroupCall', () => {
    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id]);
    socket.join(roomId);
    socket.emit('groupCallCreated', { roomId });
  });

  // Group call join
  socket.on('joinGroupCall', (roomId) => {
    console.log('Join group call request:', roomId, 'from user:', socket.userId);
    
    if (!roomId || !activeRooms.has(roomId)) {
      console.log('Invalid room:', roomId);
      return socket.emit('invalidRoom');
    }

    const room = activeRooms.get(roomId);
    if (room.includes(socket.id)) {
      console.log('User already in room:', socket.userId);
      return socket.emit('alreadyInRoom');
    }

    // Add user to room
    room.push(socket.id);
    socket.join(roomId);
    
    // Get list of existing peers in the room
    const peers = room
      .filter(socketId => socketId !== socket.id)
      .map(socketId => {
        const userId = [...activeUsers.entries()]
          .find(([_, sid]) => sid === socketId)?.[0];
        return {
          peerId: userId,
          socketId: socketId
        };
      })
      .filter(peer => peer.peerId);

    // Notify the joining user about existing peers
    socket.emit('joinedGroupCall', {
      roomId,
      peers
    });

    // Notify other users in the room about the new user
    socket.to(roomId).emit('newUserJoined', {
      peerId: socket.userId,
      newPeerId: activePeers.get(socket.userId)
    });

    console.log('User joined room:', socket.userId, 'Room:', roomId, 'Peers:', peers);
  });

  // Signaling
  socket.on('signal', ({ targetPeerId, signal }) => {
    const targetSocketId = activeUsers.get(targetPeerId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        peerId: socket.userId,
        signal
      });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    
    if (socket.userId) {
      activeUsers.delete(socket.userId);
      activePeers.delete(socket.userId);
      connectionTimestamps.delete(socket.id);

      // Clean up rooms
      for (const [roomId, users] of activeRooms.entries()) {
        if (users.includes(socket.id)) {
          users.forEach(userSocketId => {
            if (userSocketId !== socket.id) {
              io.to(userSocketId).emit('peerDisconnected', {
                peerId: socket.userId,
                reason: reason
              });
            }
          });
          activeRooms.delete(roomId);
        }
      }
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    if (socket.userId) {
      activeUsers.delete(socket.userId);
      activePeers.delete(socket.userId);
    }
  });
});

function isUserInCall(userId) {
  const socketId = activeUsers.get(userId);
  if (!socketId) return false;
  
  return [...activeRooms.values()].some(users => users.includes(socketId));
}

// Health check
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
  console.log(`WebSocket endpoint: /socket.io/`);
  console.log(`PeerJS endpoint: /peerjs`);
});
