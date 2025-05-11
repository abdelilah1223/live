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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.static('public'));

// PeerJS Server configuration with explicit options
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true,
  allow_discovery: true, // Allow peer discovery
  pingInterval: 5000,
  pingTimeout: 10000,
  generateClientId: () => uuidv4(),
  ssl: {}
});
app.use('/peerjs', peerServer);

// Socket.IO Server with improved connection handling
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  },
  path: '/socket.io/',
  transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
  allowUpgrades: true,
  serveClient: true,
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8, // Increased buffer size
  cookie: false
});

// Trust proxy for Railway and other hosting services
app.set('trust proxy', true);

// Store active connections with enhanced tracking
const activeUsers = new Map(); // userId -> socketId
const activePeers = new Map(); // userId -> peerId
const activeRooms = new Map(); // roomId -> [socketIds]
const userRooms = new Map();   // userId -> roomId
const userConnections = new Map(); // userId -> Set of connected peerIds

// Logging middleware
io.use((socket, next) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  console.log(`New connection from ${clientIp} with transport ${socket.handshake.transportName}`);
  next();
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    if (!userId) {
      return socket.emit('error', { message: 'Invalid user ID' });
    }
    
    // Store user mapping
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
    socket.emit('registered', userId);
  });

  // Register peer ID
  socket.on('register-peer', (peerId) => {
    if (!peerId || !socket.userId) {
      return socket.emit('error', { message: 'Missing peer ID or user ID' });
    }
    
    activePeers.set(socket.userId, peerId);
    console.log(`User ${socket.userId} registered peer ID ${peerId}`);
  });

  // Random call request
  socket.on('requestRandomCall', () => {
    if (!socket.userId) {
      return socket.emit('error', { message: 'Not registered' });
    }
    
    // Check if user is already in a call
    if (isUserInCall(socket.userId)) {
      return socket.emit('error', { message: 'You are already in a call' });
    }
    
    // Find available users not in calls
    const availableUsers = [...activeUsers.entries()]
      .filter(([id, sid]) => 
        id !== socket.userId && // Not the caller
        sid !== socket.id && // Not the caller's socket
        !isUserInCall(id) && // Not in a call
        activePeers.has(id) // Has a registered peer ID
      );
    
    if (availableUsers.length === 0) {
      return socket.emit('noUsersAvailable');
    }

    // Select a random user
    const [targetUserId, targetSocketId] = availableUsers[
      Math.floor(Math.random() * availableUsers.length)
    ];
    
    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id, targetSocketId]);
    userRooms.set(socket.userId, roomId);
    userRooms.set(targetUserId, roomId);

    console.log(`Random call matched: ${socket.userId} -> ${targetUserId} in room ${roomId}`);

    // Send call information to caller
    socket.emit('randomCallMatched', {
      roomId,
      peerId: targetUserId,
      targetPeerId: activePeers.get(targetUserId)
    });

    // Send incoming call notification to target
    io.to(targetSocketId).emit('incomingCall', {
      roomId,
      peerId: socket.userId,
      callerPeerId: activePeers.get(socket.userId)
    });
  });

  // Direct call request
  socket.on('requestDirectCall', (targetUserId) => {
    if (!socket.userId) {
      return socket.emit('error', { message: 'Not registered' });
    }
    
    // Check if user is already in a call
    if (isUserInCall(socket.userId)) {
      return socket.emit('error', { message: 'You are already in a call' });
    }
    
    const targetSocketId = activeUsers.get(targetUserId);
    
    if (!targetSocketId) {
      return socket.emit('userNotAvailable');
    }

    if (isUserInCall(targetUserId)) {
      return socket.emit('userInCall');
    }

    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id, targetSocketId]);
    userRooms.set(socket.userId, roomId);
    userRooms.set(targetUserId, roomId);

    console.log(`Direct call: ${socket.userId} -> ${targetUserId} in room ${roomId}`);

    io.to(targetSocketId).emit('incomingCall', {
      roomId,
      peerId: socket.userId,
      callerPeerId: activePeers.get(socket.userId)
    });
  });

  // Call acceptance
  socket.on('acceptCall', (roomId) => {
    if (!roomId || !activeRooms.has(roomId)) {
      return socket.emit('error', { message: 'Invalid room ID' });
    }
    
    const room = activeRooms.get(roomId);
    if (!room.includes(socket.id)) {
      return socket.emit('error', { message: 'Not in this room' });
    }

    const callerSocketId = room.find(id => id !== socket.id);
    if (!callerSocketId) {
      return socket.emit('error', { message: 'Caller not found' });
    }
    
    const callerUser = getKeyByValue(activeUsers, callerSocketId);
    
    console.log(`Call accepted: ${socket.userId} accepted call from ${callerUser} in room ${roomId}`);

    io.to(callerSocketId).emit('callAccepted', {
      roomId,
      peerId: socket.userId,
      targetPeerId: activePeers.get(socket.userId)
    });
  });

  // Call rejection
  socket.on('rejectCall', (roomId) => {
    if (!roomId || !activeRooms.has(roomId)) {
      return socket.emit('error', { message: 'Invalid room ID' });
    }
    
    const room = activeRooms.get(roomId);
    if (!room.includes(socket.id)) {
      return socket.emit('error', { message: 'Not in this room' });
    }

    const callerSocketId = room.find(id => id !== socket.id);
    if (callerSocketId) {
      io.to(callerSocketId).emit('callRejected');
    }
    
    // Clean up room data
    room.forEach(sid => {
      const userId = getKeyByValue(activeUsers, sid);
      if (userId) {
        userRooms.delete(userId);
      }
    });
    
    activeRooms.delete(roomId);
    console.log(`Call rejected: Room ${roomId} deleted`);
  });
  
  // Group call creation
  socket.on('createGroupCall', () => {
    if (!socket.userId) {
      return socket.emit('error', { message: 'Not registered' });
    }
    
    // End any existing call the user might be in
    leaveExistingCall(socket);
    
    const roomId = uuidv4();
    activeRooms.set(roomId, [socket.id]);
    userRooms.set(socket.userId, roomId);
    
    socket.join(roomId);
    socket.emit('groupCallCreated', { roomId });
    
    console.log(`Group call created by ${socket.userId}: Room ${roomId}`);
  });

  // Group call join
  socket.on('joinGroupCall', (roomId) => {
    if (!socket.userId) {
      return socket.emit('error', { message: 'Not registered' });
    }
    
    if (!roomId || !activeRooms.has(roomId)) {
      return socket.emit('invalidRoom');
    }
    
    // End any existing call the user might be in
    leaveExistingCall(socket);
    
    const room = activeRooms.get(roomId);
    if (room.includes(socket.id)) {
      return socket.emit('alreadyInRoom');
    }
    
    // Add user to room
    room.push(socket.id);
    userRooms.set(socket.userId, roomId);
    socket.join(roomId);
    
    // Get list of peers in the room to connect to
    const peersInRoom = [];
    room.forEach(sid => {
      if (sid !== socket.id) {
        const userId = getKeyByValue(activeUsers, sid);
        if (userId && activePeers.has(userId)) {
          peersInRoom.push({
            userId: userId,
            peerId: activePeers.get(userId)
          });
        }
      }
    });
    
    // Notify the joining user about existing peers
    socket.emit('joinedRoom', {
      roomId,
      peers: peersInRoom
    });
    
    // Notify others about the new user
    socket.to(roomId).emit('newUserJoined', {
      peerId: socket.userId,
      newPeerId: activePeers.get(socket.userId)
    });
    
    console.log(`${socket.userId} joined group call: Room ${roomId}`);
  });
  
  // Leave call
  socket.on('leaveCall', (roomId) => {
    leaveRoom(socket, roomId);
  });

  // Signaling
  socket.on('signal', ({ targetPeerId, signal }) => {
    // Find user ID for this peer ID
    const targetUserId = getKeyByValue(activePeers, targetPeerId);
    if (!targetUserId) {
      return console.log(`Target peer ID ${targetPeerId} not found`);
    }
    
    const targetSocketId = activeUsers.get(targetUserId);
    if (!targetSocketId) {
      return console.log(`Socket for user ${targetUserId} not found`);
    }
    
    io.to(targetSocketId).emit('signal', {
      peerId: socket.userId,
      signal
    });
  });
