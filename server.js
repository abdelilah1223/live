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

// PeerJS Server with correct path
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true,
  generateClientId: () => uuidv4()
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
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false
});

// Trust proxy for Railway
app.set('trust proxy', true);

// Store active connections
const activeUsers = new Map();
const activePeers = new Map();
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.emit('registered', userId);
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
    if (!roomId || !activeRooms.has(roomId)) {
      return socket.emit('invalidRoom');
    }

    const room = activeRooms.get(roomId);
    if (room.includes(socket.id)) {
      return socket.emit('alreadyInRoom');
    }

    room.push(socket.id);
    socket.join(roomId);
    socket.to(roomId).emit('newUserJoined', {
      peerId: socket.userId,
      newPeerId: activePeers.get(socket.userId)
    });
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
        }
      }
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
