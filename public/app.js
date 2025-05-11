// Initialize Socket.IO connection
const socket = io('https://live-git-main-abdelilah1223s-projects.vercel.app');

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

// Initialize user ID from localStorage or generate new one
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
    } catch (error) {
        console.error('Error accessing media devices:', error);
        showToast('Error accessing camera and microphone');
    }
}

// Initialize PeerJS
function initializePeer() {
    peer = new Peer(undefined, {
        host: '/',
        port: '3001'
    });

    peer.on('open', (id) => {
        console.log('PeerJS connected with ID:', id);
    });

    peer.on('error', (error) => {
        console.error('PeerJS error:', error);
        showToast('Connection error occurred');
    });
}

// Start random call
async function startRandomCall() {
    await initializeMedia();
    initializePeer();
    showLoading();
    socket.emit('requestRandomCall');
}

// Start direct call
async function startDirectCall() {
    const targetUserId = document.getElementById('targetUserId').value;
    if (!targetUserId) {
        showToast('Please enter a user ID');
        return;
    }

    await initializeMedia();
    initializePeer();
    showLoading();
    socket.emit('requestDirectCall', targetUserId);
}

// Create group call
async function createGroupCall() {
    await initializeMedia();
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
    await initializeMedia();
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

// Connect to peer
function connectToPeer(peerId) {
    const call = peer.call(peerId, localStream);
    call.on('stream', (remoteStream) => {
        addVideoStream(remoteStream, peerId);
    });
}

// Add video stream
function addVideoStream(stream, peerId) {
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    
    const peerLabel = document.createElement('div');
    peerLabel.className = 'absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded';
    peerLabel.textContent = peerId;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(peerLabel);
    remoteVideos.appendChild(videoContainer);
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
    }
}

// End call
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peer) {
        peer.destroy();
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

// Show/hide call interface
function showCallInterface() {
    mainMenu.classList.add('hidden');
    callInterface.classList.remove('hidden');
}

function hideCallInterface() {
    callInterface.classList.add('hidden');
    mainMenu.classList.remove('hidden');
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
        socket.emit('joinGroupCall', roomId);
    }
});

// Handle peer disconnection
socket.on('peerDisconnected', () => {
    showToast('Peer disconnected');
    endCall();
}); 
