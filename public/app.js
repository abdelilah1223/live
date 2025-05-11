// Enhanced Socket.IO client with robust connection handling
let socket;
let reconnectInterval;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectSocket() {
  // Clear any existing reconnect intervals
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }

  socket = io('https://live-production-cf6e.up.railway.app', {
    path: '/socket.io/',
    transports: ['polling', 'websocket'], // Start with polling then upgrade
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    forceNew: true,
    timeout: 20000,
    upgrade: true
  });

  socket.on('connect', () => {
    console.log('Connected with transport:', socket.io.engine.transport.name);
    reconnectAttempts = 0;
    registerUser();
    
    // If connected with polling, try to upgrade to websocket
    if (socket.io.engine.transport.name === 'polling') {
      socket.io.engine.on('upgrade', () => {
        console.log('Upgraded to websocket');
      });
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    reconnectAttempts++;
    
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      showToast('Cannot connect to server. Please check your internet connection and refresh.');
      return;
    }
    
    // Try different transport strategy after several failed attempts
    if (reconnectAttempts > 3) {
      socket.io.opts.transports = ['polling', 'websocket'];
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
      // The server initiated the disconnect
      setTimeout(() => {
        socket.connect();
      }, 1000);
    }
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`Reconnected after ${attemptNumber} attempts`);
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
let activeCalls = new Map(); // Track active calls by peer ID
let connectionAttempts = new Map(); // Track connection attempts to prevent duplicate connections

// Initialize user ID
localStorage.setItem('userId', myUserId);
userIdDisplay.classList.remove('hidden');
userIdElement.textContent = myUserId;

// Initialize PeerJS with better error handling
function initializePeer() {
  if (peer) {
    // Clean up existing peer connection if any
    peer.destroy();
  }

  try {
    peer = new Peer(undefined, {
      host: 'live-production-cf6e.up.railway.app',
      port: 443,
      path: '/peerjs',
      secure: true,
      debug: 1, // Reduced debug level to avoid console spam
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
          {
            urls: 'turn:global.turn.twilio.com:3478?transport=udp',
            username: 'dummy',
            credential: 'dummy'
          }
        ],
        iceCandidatePoolSize: 10,
        sdpSemantics: 'unified-plan'
      }
    });

    peer.on('open', (id) => {
      console.log('PeerJS ID:', id);
      if (socket && socket.connected) {
        socket.emit('register-peer', id);
      }
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      
      if (err.type === 'peer-unavailable') {
        showToast('User is not available or offline');
      } else if (err.type === 'network') {
        showToast('Network error. Retrying connection...');
        setTimeout(initializePeer, 2000);
      } else if (err.type === 'server-error') {
        showToast('Server error. Please try again later.');
      } else if (err.type === 'disconnected') {
        showToast('Connection lost. Reconnecting...');
        setTimeout(initializePeer, 1000);
      }
    });

    peer.on('call', handleIncomingPeerCall);

    peer.on('disconnected', () => {
      console.log('PeerJS disconnected');
      setTimeout(() => {
        if (!peer.destroyed) {
          peer.reconnect();
        }
      }, 1000);
    });

    peer.on('close', () => {
      console.log('PeerJS connection closed');
    });

  } catch (err) {
    console.error('PeerJS initialization failed:', err);
    showToast('Connection error. Retrying in 3 seconds...');
    setTimeout(initializePeer, 3000);
  }
}

// Media Functions with better error handling
async function initializeMedia(withVideo = true) {
  stopLocalStream(); // Stop any existing streams first
  
  try {
    const constraints = {
      video: withVideo ? {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      } : false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true; // Mute local video to prevent feedback
      
      // Make sure video is actually playing
      localVideo.play().catch(err => {
        console.warn('Local video autoplay failed:', err);
        showToast('Tap to enable your camera');
      });
    }
    
    return true;
  } catch (err) {
    console.error('Media error:', err);
    
    if (err.name === 'NotAllowedError') {
      showToast('Please allow access to camera and microphone');
    } else if (err.name === 'NotFoundError') {
      showToast('Camera or microphone not found');
      // Try audio only if video fails
      if (withVideo) {
        return initializeMedia(false);
      }
    } else {
      showToast('Could not access media devices');
    }
    
    return false;
  }
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
    localStream = null;
    if (localVideo) {
      localVideo.srcObject = null;
    }
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

  if (targetUserId === myUserId) {
    showToast('Cannot call yourself');
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
  // Close all active calls
  activeCalls.forEach(call => {
    if (call && typeof call.close === 'function') {
      call.close();
    }
  });
  
  activeCalls.clear();
  connectionAttempts.clear();
  
  // Clean up resources
  stopLocalStream();
  if (peer && !peer.destroyed) {
    peer.destroy();
    peer = null;
  }
  
  currentRoomId = null;
  hideCallInterface();
  showMainMenu();
  clearRemoteVideos();
  
  socket.emit('leaveCall', currentRoomId);
}

// Enhanced Video Stream Management
function handleIncomingPeerCall(call) {
  console.log(`Incoming peer call from ${call.peer}`);
  
  // Store the call object
  activeCalls.set(call.peer, call);
  
  // Answer the call with our local stream
  if (localStream) {
    call.answer(localStream);
    
    call.on('stream', (remoteStream) => {
      console.log(`Received stream from ${call.peer}`);
      addVideoStream(remoteStream, call.peer);
    });
    
    call.on('close', () => {
      console.log(`Call with ${call.peer} closed`);
      removeVideoStream(call.peer);
      activeCalls.delete(call.peer);
    });
    
    call.on('error', (err) => {
      console.error(`Call error with ${call.peer}:`, err);
      removeVideoStream(call.peer);
      activeCalls.delete(call.peer);
    });
  } else {
    console.error('Cannot answer call without local stream');
    call.close();
  }
}

function connectToPeer(peerId) {
  if (!peer || !localStream || !peerId) {
    console.error('Missing requirements to connect:', {
      hasPeer: !!peer,
      hasLocalStream: !!localStream,
      peerId
    });
    return;
  }
  
  // Prevent duplicate connections
  if (connectionAttempts.has(peerId)) {
    console.log(`Already trying to connect to ${peerId}`);
    return;
  }
  
  // Set connection attempt flag
  connectionAttempts.set(peerId, true);
  console.log(`Calling peer: ${peerId}`);
  
  try {
    const call = peer.call(peerId, localStream);
    
    if (!call) {
      console.error(`Failed to create call object for ${peerId}`);
      connectionAttempts.delete(peerId);
      return;
    }
    
    // Store the call object
    activeCalls.set(peerId, call);
    
    call.on('stream', (remoteStream) => {
      console.log(`Received stream from ${peerId}`);
      addVideoStream(remoteStream, peerId);
    });
    
    call.on('close', () => {
      console.log(`Call with ${peerId} closed`);
      removeVideoStream(peerId);
      activeCalls.delete(peerId);
      connectionAttempts.delete(peerId);
    });
    
    call.on('error', (err) => {
      console.error(`Call error with ${peerId}:`, err);
      showToast(`Connection error with peer ${peerId}`);
      removeVideoStream(peerId);
      activeCalls.delete(peerId);
      connectionAttempts.delete(peerId);
    });
    
    // Set timeout to clear connection attempt flag
    setTimeout(() => {
      connectionAttempts.delete(peerId);
    }, 30000);
    
  } catch (err) {
    console.error(`Error connecting to peer ${peerId}:`, err);
    connectionAttempts.delete(peerId);
  }
}

function addVideoStream(stream, peerId) {
  // Don't add if stream doesn't exist
  if (!stream) {
    console.error(`No stream provided for ${peerId}`);
    return;
  }
  
  // First remove any existing video for this peer
  removeVideoStream(peerId);

  // Create container for this video
  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.id = `video-${peerId}`;

  // Create video element
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  
  // Handle autoplay issues
  video.play().catch(err => {
    console.warn(`Autoplay failed for peer ${peerId}:`, err);
    
    // Create play button overlay
    const playButton = document.createElement('button');
    playButton.textContent = 'Click to play';
    playButton.className = 'play-button';
    playButton.onclick = () => {
      video.play();
      playButton.remove();
    };
    videoContainer.appendChild(playButton);
  });

  // Create label for the peer
  const peerLabel = document.createElement('div');
  peerLabel.className = 'peer-label';
  peerLabel.textContent = peerId;

  // Assemble the video container
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
    if (muteButton) {
      muteButton.classList.toggle('fa-microphone-slash');
    }
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
    if (videoButton) {
      videoButton.classList.toggle('fa-video-slash');
    }
    showToast(isVideoEnabled ? 'Video on' : 'Video off');
  }
}

function copyUserId() {
  navigator.clipboard.writeText(myUserId);
  showToast('User ID copied');
}

// Enhanced Socket.IO Event Handlers
function setupSocketEvents() {
  socket.on('incomingCall', ({ roomId, peerId, callerPeerId }) => {
    console.log(`Incoming call from ${peerId} (Peer ID: ${callerPeerId}) in room ${roomId}`);
    currentRoomId = roomId;
    callerIdElement.textContent = `Incoming call from ${peerId}`;
    showIncomingCallModal();
  });

  socket.on('callAccepted', ({ roomId, peerId, targetPeerId }) => {
    console.log(`Call accepted by ${peerId} (Peer ID: ${targetPeerId}) in room ${roomId}`);
    hideLoading();
    showCallInterface();
    if (targetPeerId) {
      connectToPeer(targetPeerId);
    }
  });

  socket.on('callRejected', () => {
    hideLoading();
    showToast('Call rejected');
    endCall();
  });

  socket.on('userNotAvailable', () => {
    hideLoading();
    showToast('User not available');
    endCall();
  });

  socket.on('userInCall', () => {
    hideLoading();
    showToast('User is in another call');
    endCall();
  });

  socket.on('noUsersAvailable', () => {
    hideLoading();
    showToast('No users available');
    endCall();
  });

  socket.on('groupCallCreated', ({ roomId }) => {
    console.log(`Group call created with room ID: ${roomId}`);
    currentRoomId = roomId;
    hideLoading();
    showCallInterface();
    const joinLink = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(joinLink)
      .then(() => showToast('Join link copied to clipboard!'))
      .catch(() => showToast(`Share this link: ${joinLink}`));
  });

  socket.on('newUserJoined', ({ peerId, newPeerId }) => {
    console.log(`New user joined: ${peerId} (Peer ID: ${newPeerId})`);
    showToast(`${peerId} joined the call`);
    
    if (peer && newPeerId) {
      connectToPeer(newPeerId);
    }
  });

  socket.on('peerDisconnected', ({ peerId }) => {
    console.log(`Peer disconnected: ${peerId}`);
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
    activeCalls.delete(peerId);
  });
  
  socket.on('invalidRoom', () => {
    hideLoading();
    showToast('Invalid room ID');
    showMainMenu();
  });
  
  socket.on('alreadyInRoom', () => {
    hideLoading();
    showToast('Already in this room');
    showCallInterface();
  });
  
  // New event to handle room joining
  socket.on('joinedRoom', ({ roomId, peers }) => {
    currentRoomId = roomId;
    hideLoading();
    showCallInterface();
    
    // Connect to existing peers in the room
    if (peers && Array.isArray(peers)) {
      peers.forEach(peerInfo => {
        connectToPeer(peerInfo.peerId);
      });
    }
  });
}

// User registration
function registerUser() {
  if (socket && socket.connected) {
    socket.emit('register', myUserId);
  }
}

// Connection and error handling check
function checkConnection() {
  if (!socket || !socket.connected) {
    console.log('Reconnecting to server...');
    connectSocket();
  }
  
  if (peer && peer.disconnected && !peer.destroyed) {
    console.log('Reconnecting peer...');
    peer.reconnect();
  }
}

// Initialize on load with improved error handling
window.addEventListener('load', () => {
  try {
    connectSocket();
    setupSocketEvents();
    
    // Periodically check connection status
    setInterval(checkConnection, 30000);
    
    // Check for group call room ID in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
      // Initialize media and join room
      initializeMedia().then(success => {
        if (success) {
          initializePeer();
          showLoading();
          socket.emit('joinGroupCall', roomId);
        } else {
          showToast('Failed to access camera/microphone. Please check permissions.');
        }
      });
    }
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('Failed to initialize application. Please refresh the page.');
  }
});

// Event Listeners with error handling
document.getElementById('startRandomCall').addEventListener('click', startRandomCall);
document.getElementById('startDirectCall').addEventListener('click', startDirectCall);
document.getElementById('createGroupCall').addEventListener('click', createGroupCall);
document.getElementById('acceptCall').addEventListener('click', acceptCall);
document.getElementById('rejectCall').addEventListener('click', rejectCall);
document.getElementById('endCall').addEventListener('click', endCall);
document.getElementById('toggleMute').addEventListener('click', toggleMute);
document.getElementById('toggleVideo').addEventListener('click', toggleVideo);
document.getElementById('copyUserId').addEventListener('click', copyUserId);

// Add global click handler to enable autoplay on iOS/Safari
document.addEventListener('click', () => {
  if (localVideo && localVideo.paused && localStream) {
    localVideo.play().catch(err => console.warn('Failed to play local video:', err));
  }
}, { once: true });

// Handle page visibility changes to manage resources
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // User switched tabs or minimized browser
    // Don't disconnect but possibly mute to save bandwidth
  } else {
    // User returned to the tab
    checkConnection();
  }
});
