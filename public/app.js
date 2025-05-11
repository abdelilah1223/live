// Initialize Socket.IO connection
const socket = io('https://live-production-cf6e.up.railway.app', {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000
});

// Add connection event handlers
socket.on('connect', () => {
    console.log('Socket.IO connected successfully');
});

socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error);
    setTimeout(() => {
        if (!socket.connected) {
            socket.connect();
        }
    }, 3000);
});

socket.on('disconnect', (reason) => {
    console.log('Socket.IO disconnected:', reason);
    if (reason === 'io server disconnect') {
        socket.connect();
    }
});

// Setup reconnection logic
function setupSocketReconnect() {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    
    socket.on('reconnect_attempt', () => {
        reconnectAttempts++;
        if (reconnectAttempts > maxReconnectAttempts) {
            showToast('Unable to connect to server. Please refresh the page.');
        }
    });
    
    socket.on('reconnect', () => {
        reconnectAttempts = 0;
        showToast('Reconnected to server');
        if (myUserId) {
            socket.emit('register', myUserId);
        }
    });
}
setupSocketReconnect();

// Initialize PeerJS
let peer = null;
let localStream = null;
let currentRoomId = null;
let isMuted = false;
let isVideoEnabled = true;

// DOM Elements
const userIdDisplay = document.getElementById('userIdDisplay');
const userId = document.getElementById('userId');
const mainMenu = document.getElementById('mainMenu');
const callInterface = document.getElementById('callInterface');
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const incomingCallModal = document.getElementById('incomingCallModal');
const callerId = document.getElementById('callerId');
const loadingAnimation = document.getElementById('loadingAnimation');

// Initialize user ID
let myUserId = localStorage.getItem('userId');
if (!myUserId) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', myUserId);
}

// Display user ID
userIdDisplay.classList.remove('hidden');
userId.textContent = myUserId;

// Register with server
socket.emit('register', myUserId);

// Initialize media stream
async function initializeMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        localVideo.srcObject = localStream;
        return true;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        showToast('Error accessing camera and microphone: ' + error.message);
        return false;
    }
}

// Initialize PeerJS
function initializePeer() {
    try {
               peer = new Peer(`peer_${myUserId}`, {
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
            console.log('PeerJS connected with ID:', id);
            // Register the peer ID with your Socket.IO server
            socket.emit('register-peer', id);
        });

        peer.on('error', (error) => {
            console.error('PeerJS error:', error);
            if (error.type === 'peer-unavailable') {
                showToast('Peer is not available');
            } else if (error.type === 'unavailable-id') {
                setTimeout(initializePeer, 3000);
            } else {
                showToast('Connection error occurred');
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
            showToast('Connection lost. Reconnecting...');
            setTimeout(initializePeer, 3000);
        });

    } catch (error) {
        console.error('PeerJS initialization failed:', error);
        showToast('Connection error. Retrying...');
        setTimeout(initializePeer, 3000);
    }
}

// Start random call
async function startRandomCall() {
    const mediaSuccess = await initializeMedia();
    if (!mediaSuccess) return;
    
    initializePeer();
    showLoading();
    socket.emit('requestRandomCall');
}

// Start direct call
async function startDirectCall() {
    const targetUserId = document.getElementById('targetUserId').value.trim();
    if (!targetUserId) {
        showToast('Please enter a user ID');
        return;
    }

    const mediaSuccess = await initializeMedia();
    if (!mediaSuccess) return;
    
    initializePeer();
    showLoading();
    socket.emit('requestDirectCall', targetUserId);
}

// Create group call
async function createGroupCall() {
    const mediaSuccess = await initializeMedia();
    if (!mediaSuccess) return;
    
    initializePeer();
    showLoading();
    socket.emit('createGroupCall');
}

// Handle incoming call
socket.on('incomingCall', ({ roomId, peerId }) => {
    currentRoomId = roomId;
    callerId.textContent = `Incoming call from: ${peerId}`;
    incomingCallModal.classList.remove('hidden');
});

// Accept call
async function acceptCall() {
    const mediaSuccess = await initializeMedia();
    if (!mediaSuccess) {
        rejectCall();
        return;
    }
    
    initializePeer();
    incomingCallModal.classList.add('hidden');
    showCallInterface();
    socket.emit('acceptCall', currentRoomId);
}

// Reject call
function rejectCall() {
    socket.emit('rejectCall', currentRoomId);
    incomingCallModal.classList.add('hidden');
    currentRoomId = null;
}

// Handle call accepted
socket.on('callAccepted', ({ roomId, peerId }) => {
    if (roomId !== currentRoomId) return;
    hideLoading();
    showCallInterface();
    connectToPeer(peerId);
});

// Handle call rejected
socket.on('callRejected', () => {
    hideLoading();
    showToast('Call was rejected');
    endCall();
});

// Handle user not available
socket.on('userNotAvailable', () => {
    hideLoading();
    showToast('User is not available');
});

// Handle user in call
socket.on('userInCall', () => {
    hideLoading();
    showToast('User is in another call');
});

// Handle no users available
socket.on('noUsersAvailable', () => {
    hideLoading();
    showToast('No users available for random call');
});

// Handle group call created
socket.on('groupCallCreated', ({ roomId }) => {
    currentRoomId = roomId;
    hideLoading();
    showCallInterface();
    const joinLink = `${window.location.origin}?room=${roomId}&type=group`;
    showToast('Group call created! Share this link: ' + joinLink);
});

// Handle new user joined group call
socket.on('newUserJoined', ({ peerId }) => {
    if (peer && peerId !== myUserId) {
        connectToPeer(peerId);
    }
});

// Connect to peer
function connectToPeer(peerId) {
    if (!peer || !localStream) return;
    
    const call = peer.call(peerId, localStream);
    call.on('stream', (remoteStream) => {
        addVideoStream(remoteStream, peerId);
    });
    call.on('close', () => {
        removeVideoStream(peerId);
    });
}

// Add video stream
function addVideoStream(stream, peerId) {
    // Remove existing stream if any
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

// Remove video stream
function removeVideoStream(peerId) {
    const existingVideo = document.getElementById(`video-${peerId}`);
    if (existingVideo) {
        existingVideo.remove();
    }
}

// Toggle mute
function toggleMute() {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        const muteButton = document.querySelector('.fa-microphone');
        muteButton.classList.toggle('fa-microphone-slash');
        showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted');
    }
}

// Toggle video
function toggleVideo() {
    if (localStream) {
        isVideoEnabled = !isVideoEnabled;
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isVideoEnabled;
        });
        const videoButton = document.querySelector('.fa-video');
        videoButton.classList.toggle('fa-video-slash');
        showToast(isVideoEnabled ? 'Video enabled' : 'Video disabled');
    }
}

// End call
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    currentRoomId = null;
    hideCallInterface();
    showMainMenu();
    remoteVideos.innerHTML = '';
}

// Copy user ID
function copyUserId() {
    navigator.clipboard.writeText(myUserId);
    showToast('User ID copied to clipboard');
}

// Show/hide loading animation
function showLoading() {
    loadingAnimation.classList.remove('hidden');
}

function hideLoading() {
    loadingAnimation.classList.add('hidden');
}

// Show/hide main menu
function showMainMenu() {
    mainMenu.classList.remove('hidden');
    callInterface.classList.add('hidden');
}

function hideMainMenu() {
    mainMenu.classList.add('hidden');
}

// Show/hide call interface
function showCallInterface() {
    mainMenu.classList.add('hidden');
    callInterface.classList.remove('hidden');
}

function hideCallInterface() {
    callInterface.classList.add('hidden');
}

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Handle URL parameters for joining calls
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const callType = urlParams.get('type');
    
    if (roomId && callType === 'group') {
        showLoading();
        socket.emit('joinGroupCall', roomId);
    }
});

// Handle peer disconnection
socket.on('peerDisconnected', ({ peerId }) => {
    showToast(`${peerId} disconnected`);
    removeVideoStream(peerId);
});
