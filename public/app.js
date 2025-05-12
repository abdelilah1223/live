// Enhanced Socket.IO client with WebSocket fixes
let socket;

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
    }
  });

  socket.on('connect', () => {
    console.log('Connected with transport:', socket.io.engine.transport.name);
    registerUser();
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    
    // Try polling first, then upgrade to websocket
    if (socket.io.engine.transport.name === 'websocket') {
      console.log('Falling back to polling transport');
      socket.io.opts.transports = ['polling', 'websocket'];
      socket.connect();
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
    showToast('Connection to server lost. Please refresh the page.');
  });
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
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
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
        call.answer(localStream);
        call.on('stream', (remoteStream) => {
          addVideoStream(remoteStream, call.peer);
        });
        call.on('close', () => {
          removeVideoStream(call.peer);
        });
      }
    });

    peer.on('disconnected', () => {
      console.log('PeerJS disconnected');
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
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
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
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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
    showToast(`Group call created! Share: ${joinLink}`);
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
    if (peer && newPeerId) {
      connectToPeer(newPeerId);
    }
  });

  socket.on('peerDisconnected', ({ peerId }) => {
    console.log('Peer disconnected:', peerId);
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
  });

  socket.on('joinedGroupCall', ({ roomId, peers }) => {
    console.log('Joined group call:', roomId, peers);
    hideLoading();
    showCallInterface();
    currentRoomId = roomId;
    
    // Connect to existing peers in the room
    if (peers && peers.length > 0) {
      peers.forEach(peerInfo => {
        if (peerInfo.peerId && peerInfo.peerId !== myUserId) {
          connectToPeer(peerInfo.peerId);
        }
      });
    }
  });
}

// Peer Connection
function connectToPeer(peerId) {
  if (!peer || !localStream || !peerId) return;

  const call = peer.call(peerId, localStream);
  call.on('stream', (remoteStream) => {
    addVideoStream(remoteStream, peerId);
  });
  call.on('close', () => {
    removeVideoStream(peerId);
  });
}

// User registration
function registerUser() {
  socket.emit('register', myUserId);
}

// Initialize on load
window.addEventListener('load', () => {
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
