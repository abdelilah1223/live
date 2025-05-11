const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// تخزين المستخدمين والمكالمات
const activeUsers = new Map();
const activeCalls = {
  group: new Map(),
  private: new Map()
};

const MAX_GROUP_PARTICIPANTS = 4;

// مسارات API
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.use(express.static('public'));

// إدارة اتصالات Socket.io
io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId || uuidv4();
  
  activeUsers.set(userId, socket.id);
  socket.emit('userId', userId);

  socket.on('createGroupCall', (callId) => {
    activeCalls.group.set(callId, {
      participants: [userId],
      host: userId
    });
    socket.join(callId);
  });

  socket.on('joinGroupCall', (callId) => {
    if (activeCalls.group.has(callId)) {
      const call = activeCalls.group.get(callId);
      if (call.participants.length >= MAX_GROUP_PARTICIPANTS) {
        socket.emit('callFull');
        return;
      }
      call.participants.push(userId);
      socket.join(callId);
      io.to(callId).emit('userJoined', userId);
    }
  });

  socket.on('startPrivateCall', (targetId) => {
    if (activeUsers.has(targetId)) {
      io.to(activeUsers.get(targetId)).emit('incomingCall', {
        callerId: userId,
        signal: socket.handshake.query.signal
      });
    } else {
      socket.emit('userOffline');
    }
  });

  socket.on('disconnect', () => {
    activeUsers.delete(userId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
