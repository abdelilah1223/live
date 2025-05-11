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
let socket;
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

// Initialize Socket.IO connection
function connectSocket() {
  socket = io('https://live-production-cf6e.up.railway.app', {
    path: '/socket.io/',
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 20000,
    upgrade: false
  });

  socket.on('connect', () => {
    console.log('Connected with transport:', socket.io.engine.transport.name);
    registerUser();
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    
    // Fallback to polling after 3 seconds
    setTimeout(() => {
      socket.io.opts.transports = ['polling', 'websocket'];
      socket.io.opts.upgrade = true;
      socket.connect();
    }, 3000);
  });

  socket.on('reconnect_attempt', (attempt) => {
    console.log(`Reconnection attempt ${attempt}`);
  });

  socket.on('reconnect_failed', () => {
    console.error('Reconnection failed');
    showToast('Connection to server lost. Please refresh the page.');
  });
}

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
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
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
      console.log('Incoming call from:', call.peer);
      if (localStream) {
        call.answer(localStream);
        call.on('stream', (remoteStream) => {
          console.log('Received remote stream from:', call.peer);
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

  socket.on('newUserJoined', ({ newPeerId }) => {
    if (peer && newPeerId) {
      connectToPeer(newPeerId);
    }
  });

  socket.on('peerDisconnected', ({ peerId }) => {
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
  });

  socket.on('signal', ({ peerId, signal }) => {
    if (peer && peerId) {
      peer.signal(signal);
    }
  });
}

// Peer Connection
function connectToPeer(peerId) {
  if (!peer || !localStream || !peerId) return;

  console.log('Calling peer:', peerId);
  const call = peer.call(peerId, localStream);
  
  call.on('stream', (remoteStream) => {
    console.log('Received remote stream from call:', peerId);
    addVideoStream(remoteStream, peerId);
  });
  
  call.on('close', () => {
    console.log('Call closed with:', peerId);
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
    socket.emit('joinGroupCall', roomId);
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
