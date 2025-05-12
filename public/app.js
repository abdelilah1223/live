// Enhanced Socket.IO client with WebSocket fixes
let socket;
let sessionId = localStorage.getItem('sessionId');
let heartbeatInterval;

function connectSocket() {
  socket = io('wss://live-production-cf6e.up.railway.app', {
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true,
    timeout: 45000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    forceNew: true,
    path: '/socket.io/',
    secure: true,
    rejectUnauthorized: false,
    withCredentials: true,
    extraHeaders: {
      'X-Requested-With': 'XMLHttpRequest'
    },
    auth: {
      sessionId: sessionId
    }
  });

  socket.on('connect', () => {
    console.log('Connected with transport:', socket.io.engine.transport.name);
    // Store session ID for reconnection
    sessionId = socket.id;
    localStorage.setItem('sessionId', sessionId);
    registerUser();
    
    // Start heartbeat
    startHeartbeat();
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    stopHeartbeat();
    
    // Try polling first, then upgrade to websocket
    if (socket.io.engine.transport.name === 'websocket') {
      console.log('Falling back to polling transport');
      socket.io.opts.transports = ['polling', 'websocket'];
      socket.connect();
    }

    // Clear session if connection fails
    if (error.message.includes('Session ID unknown')) {
      localStorage.removeItem('sessionId');
      sessionId = null;
    }
  });

  socket.on('reconnect_attempt', (attempt) => {
    console.log(`Reconnection attempt ${attempt}`);
    if (attempt > 3) {
      socket.io.opts.transports = ['polling'];
    }
  });

  socket.on('reconnect_failed', () => {
    console.error('Reconnection failed');
    stopHeartbeat();
    localStorage.removeItem('sessionId');
    sessionId = null;
    showToast('Connection to server lost. Please refresh the page.');
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    stopHeartbeat();
    if (reason === 'io server disconnect') {
      // Server initiated disconnect, clear session
      localStorage.removeItem('sessionId');
      sessionId = null;
    }
  });

  socket.on('peerDisconnected', ({ peerId, reason }) => {
    console.log(`Peer ${peerId} disconnected. Reason: ${reason}`);
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
  });
}

function startHeartbeat() {
  stopHeartbeat(); // Clear any existing interval
  heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat');
    }
  }, 15000); // Send heartbeat every 15 seconds
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// DOM Elements
const userIdDisplay = document.getElementById('userIdDisplay');
const userIdElement = document.getElementById('userId');
const mainMenu = document.getElementById('mainMenu');
const callInterface = document.getElementById('callInterface');
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const incomingCallModal = document.getElementById('incomingCallModal');
const callerIdElement = document.getElementById('callerId');
const loadingAnimation = document.getElementById('loadingAnimation');
const targetUserIdInput = document.getElementById('targetUserId');

// State
let peer;
let localStream;
let currentRoomId;
let isMuted = false;
let isVideoEnabled = true;
let myUserId = localStorage.getItem('userId') || `user_${Math.random().toString(36).substr(2, 9)}`;

// Initialize user ID
localStorage.setItem('userId', myUserId);
userIdDisplay.classList.remove('hidden');
userIdElement.textContent = myUserId;

// Initialize PeerJS
function initializePeer() {
  try {
    peer = new Peer({
      host: 'live-production-cf6e.up.railway.app',
      port: 443,
      path: '/peerjs',
      secure: true,
      debug: 3,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      },
      ssl: {
        rejectUnauthorized: false
      }
    });

    peer.on('open', (id) => {
      console.log('PeerJS ID:', id);
      socket.emit('register-peer', id);
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      if (err.type === 'peer-unavailable') {
        showToast('Peer is not available');
      } else {
        setTimeout(initializePeer, 3000);
      }
    });

    peer.on('call', (call) => {
      if (localStream) {
        console.log('Incoming call from:', call.peer);
        call.answer(localStream);
        
        call.on('stream', (remoteStream) => {
          console.log('Received remote stream from:', call.peer);
          addVideoStream(remoteStream, call.peer);
        });

        call.on('close', () => {
          console.log('Call closed with:', call.peer);
          removeVideoStream(call.peer);
        });

        call.on('error', (err) => {
          console.error('Call error:', err);
          removeVideoStream(call.peer);
        });
      }
    });

    peer.on('disconnected', () => {
      console.log('PeerJS disconnected');
      setTimeout(initializePeer, 3000);
    });

    peer.on('close', () => {
      console.log('PeerJS connection closed');
      setTimeout(initializePeer, 3000);
    });

  } catch (err) {
    console.error('PeerJS initialization failed:', err);
    setTimeout(initializePeer, 3000);
  }
}

// Media Functions
async function initializeMedia() {
  try {
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    return true;
  } catch (err) {
    console.error('Media error:', err);
    showToast('Could not access camera/microphone');
    return false;
  }
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
}

// Call Functions
async function startRandomCall() {
  if (await initializeMedia()) {
    initializePeer();
    showLoading();
    socket.emit('requestRandomCall');
  }
}

async function startDirectCall() {
  const targetUserId = targetUserIdInput.value.trim();
  if (!targetUserId) {
    showToast('Please enter a user ID');
    return;
  }

  if (await initializeMedia()) {
    initializePeer();
    showLoading();
    socket.emit('requestDirectCall', targetUserId);
  }
}

async function createGroupCall() {
  if (await initializeMedia()) {
    initializePeer();
    showLoading();
    socket.emit('createGroupCall');
  }
}

async function acceptCall() {
  if (await initializeMedia()) {
    initializePeer();
    hideIncomingCallModal();
    showCallInterface();
    socket.emit('acceptCall', currentRoomId);
  }
}

function rejectCall() {
  socket.emit('rejectCall', currentRoomId);
  hideIncomingCallModal();
  currentRoomId = null;
}

function endCall() {
  stopLocalStream();
  if (peer) {
    peer.destroy();
    peer = null;
  }
  currentRoomId = null;
  hideCallInterface();
  showMainMenu();
  clearRemoteVideos();
}

// Video Stream Management
function addVideoStream(stream, peerId) {
  removeVideoStream(peerId);

  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.id = `video-${peerId}`;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;

  const peerLabel = document.createElement('div');
  peerLabel.className = 'peer-label';
  peerLabel.textContent = peerId;

  videoContainer.appendChild(video);
  videoContainer.appendChild(peerLabel);
  remoteVideos.appendChild(videoContainer);
}

function removeVideoStream(peerId) {
  const existingVideo = document.getElementById(`video-${peerId}`);
  if (existingVideo) {
    existingVideo.remove();
  }
}

function clearRemoteVideos() {
  remoteVideos.innerHTML = '';
}

// UI Functions
function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function showNotification(title, options = {}) {
  if (!("Notification" in window)) {
    console.log("This browser does not support notifications");
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, options);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(title, options);
      }
    });
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Link copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showToast('Failed to copy link');
  });
}

function showLoading() {
  loadingAnimation.classList.remove('hidden');
}

function hideLoading() {
  loadingAnimation.classList.add('hidden');
}

function showMainMenu() {
  mainMenu.classList.remove('hidden');
  callInterface.classList.add('hidden');
}

function hideMainMenu() {
  mainMenu.classList.add('hidden');
}

function showCallInterface() {
  mainMenu.classList.add('hidden');
  callInterface.classList.remove('hidden');
}

function hideCallInterface() {
  callInterface.classList.add('hidden');
}

function showIncomingCallModal() {
  incomingCallModal.classList.remove('hidden');
}

function hideIncomingCallModal() {
  incomingCallModal.classList.add('hidden');
}

function toggleMute() {
  if (localStream) {
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });
    const muteButton = document.querySelector('.fa-microphone');
    muteButton.classList.toggle('fa-microphone-slash');
    showToast(isMuted ? 'Muted' : 'Unmuted');
  }
}

function toggleVideo() {
  if (localStream) {
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => {
      track.enabled = isVideoEnabled;
    });
    const videoButton = document.querySelector('.fa-video');
    videoButton.classList.toggle('fa-video-slash');
    showToast(isVideoEnabled ? 'Video on' : 'Video off');
  }
}

function copyUserId() {
  navigator.clipboard.writeText(myUserId);
  showToast('User ID copied');
}

// Socket.IO Event Handlers
function setupSocketEvents() {
  socket.on('incomingCall', ({ roomId, peerId }) => {
    currentRoomId = roomId;
    callerIdElement.textContent = `Incoming call from ${peerId}`;
    showIncomingCallModal();
  });

  socket.on('callAccepted', ({ peerId, targetPeerId }) => {
    hideLoading();
    showCallInterface();
    connectToPeer(targetPeerId);
  });

  socket.on('callRejected', () => {
    hideLoading();
    showToast('Call rejected');
    endCall();
  });

  socket.on('userNotAvailable', () => {
    hideLoading();
    showToast('User not available');
  });

  socket.on('userInCall', () => {
    hideLoading();
    showToast('User is in another call');
  });

  socket.on('noUsersAvailable', () => {
    hideLoading();
    showToast('No users available');
  });

  socket.on('groupCallCreated', ({ roomId }) => {
    currentRoomId = roomId;
    hideLoading();
    showCallInterface();
    const joinLink = `${window.location.origin}?room=${roomId}`;
    
    // Show notification
    showNotification('Group Call Created', {
      body: 'Click to copy the join link',
      icon: '/favicon.ico'
    });

    // Create and show copy link button
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-link-btn';
    copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy Join Link';
    copyButton.onclick = () => copyToClipboard(joinLink);
    
    // Add button to the call interface
    const callControls = document.querySelector('.call-controls');
    if (callControls) {
      callControls.insertBefore(copyButton, callControls.firstChild);
    }

    showToast(`Group call created! Share the link to invite others.`);
  });

  socket.on('invalidRoom', () => {
    hideLoading();
    showToast('Invalid room ID or room no longer exists');
    window.history.replaceState({}, document.title, window.location.pathname);
  });

  socket.on('alreadyInRoom', () => {
    hideLoading();
    showToast('You are already in this room');
  });

  socket.on('newUserJoined', ({ peerId, newPeerId }) => {
    console.log('New user joined:', peerId, newPeerId);
    showNotification('New User Joined', {
      body: `${peerId} has joined the call`,
      icon: '/favicon.ico'
    });
    if (peer && newPeerId) {
      connectToPeer(newPeerId);
    }
  });

  socket.on('joinedGroupCall', ({ roomId, peers }) => {
    console.log('Joined group call:', roomId, peers);
    hideLoading();
    showCallInterface();
    currentRoomId = roomId;
    
    // Show notification
    showNotification('Joined Group Call', {
      body: 'You have joined the group call',
      icon: '/favicon.ico'
    });

    // Create and show copy link button
    const joinLink = `${window.location.origin}?room=${roomId}`;
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-link-btn';
    copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy Join Link';
    copyButton.onclick = () => copyToClipboard(joinLink);
    
    // Add button to the call interface
    const callControls = document.querySelector('.controls');
    if (callControls) {
      callControls.insertBefore(copyButton, callControls.firstChild);
    }
    
    // Connect to existing peers in the room
    if (peers && peers.length > 0) {
      peers.forEach(peerInfo => {
        if (peerInfo.peerId && peerInfo.peerId !== myUserId) {
          connectToPeer(peerInfo.peerId);
        }
      });
    }
  });

  socket.on('peerDisconnected', ({ peerId, reason }) => {
    console.log(`Peer ${peerId} disconnected. Reason: ${reason}`);
    showNotification('User Left', {
      body: `${peerId} has left the call`,
      icon: '/favicon.ico'
    });
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
  });
}

// Peer Connection
function connectToPeer(peerId) {
  if (!peer || !localStream || !peerId) {
    console.error('Cannot connect to peer:', { peer, localStream, peerId });
    return;
  }

  console.log('Connecting to peer:', peerId);
  const call = peer.call(peerId, localStream);
  
  call.on('stream', (remoteStream) => {
    console.log('Received remote stream from:', peerId);
    addVideoStream(remoteStream, peerId);
  });

  call.on('close', () => {
    console.log('Call closed with:', peerId);
    removeVideoStream(peerId);
  });

  call.on('error', (err) => {
    console.error('Call error with peer:', peerId, err);
    removeVideoStream(peerId);
  });
}

// User registration
function registerUser() {
  socket.emit('register', myUserId);
}

// Initialize on load
window.addEventListener('load', () => {
  // Request notification permission
  if ("Notification" in window) {
    Notification.requestPermission();
  }

  connectSocket();
  setupSocketEvents();
  initializePeer();
  
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  if (roomId) {
    showLoading();
    // Initialize media before joining the call
    initializeMedia().then(success => {
      if (success) {
        console.log('Joining group call with room ID:', roomId);
        socket.emit('joinGroupCall', roomId);
      } else {
        hideLoading();
        showToast('Could not access camera/microphone');
      }
    });
  }
});

// Event Listeners
document.getElementById('startRandomCall').addEventListener('click', startRandomCall);
document.getElementById('startDirectCall').addEventListener('click', startDirectCall);
document.getElementById('createGroupCall').addEventListener('click', createGroupCall);
document.getElementById('acceptCall').addEventListener('click', acceptCall);
document.getElementById('rejectCall').addEventListener('click', rejectCall);
document.getElementById('endCall').addEventListener('click', endCall);
document.getElementById('toggleMute').addEventListener('click', toggleMute);
document.getElementById('toggleVideo').addEventListener('click', toggleVideo);
document.getElementById('copyUserId').addEventListener('click', copyUserId);
