document.addEventListener('DOMContentLoaded', () => {
  // العناصر الأساسية
  const mainPage = document.getElementById('mainPage');
  const waitingPage = document.getElementById('waitingPage');
  const callPage = document.getElementById('callPage');
  const videoContainer = document.getElementById('videoContainer');
  
  // الأزرار
  const createGroupBtn = document.getElementById('createGroupBtn');
  const randomCallBtn = document.getElementById('randomCallBtn');
  const privateCallBtn = document.getElementById('privateCallBtn');
  const cancelSearchBtn = document.getElementById('cancelSearchBtn');
  const muteBtn = document.getElementById('muteBtn');
  const videoBtn = document.getElementById('videoBtn');
  const endCallBtn = document.getElementById('endCallBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  
  // المتغيرات العامة
  let localStream;
  let peers = {};
  let currentCallId;
  let currentCallType;
  let userId;
  
  // الاتصال بالسيرفر
  const socket = io({
    query: {
      userId: getOrCreateUserId()
    }
  });
  
  // استقبال معرف المستخدم من السيرفر
  socket.on('userId', (id) => {
    userId = id;
    localStorage.setItem('userId', id);
  });
  
  // تهيئة الأحداث
  initEvents();
  
  // الدوال الأساسية
  function getOrCreateUserId() {
    let id = localStorage.getItem('userId');
    if (!id) {
      id = uuidv4();
      localStorage.setItem('userId', id);
    }
    return id;
  }
  
  function initEvents() {
    createGroupBtn.addEventListener('click', createGroupCall);
    randomCallBtn.addEventListener('click', startRandomCall);
    privateCallBtn.addEventListener('click', startPrivateCall);
    cancelSearchBtn.addEventListener('click', cancelSearch);
    muteBtn.addEventListener('click', toggleAudio);
    videoBtn.addEventListener('click', toggleVideo);
    endCallBtn.addEventListener('click', endCall);
    copyLinkBtn.addEventListener('click', copyCallLink);
    
    // استقبال المكالمات الواردة
    socket.on('incomingCall', handleIncomingCall);
    socket.on('callAccepted', startCallWithUser);
    socket.on('callRejected', handleCallRejected);
    socket.on('userJoined', handleUserJoined);
    socket.on('userLeft', handleUserLeft);
    socket.on('callFull', handleCallFull);
    socket.on('userOffline', handleUserOffline);
  }
  
  async function initMedia(constraints = { video: true, audio: true }) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      addVideoStream(null, localStream, true);
      return true;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      alert('لا يمكن الوصول إلى الكاميرا/الميكروفون. يرجى التحقق من الأذونات.');
      return false;
    }
  }
  
  function addVideoStream(userId, stream, isLocal = false) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.className = isLocal ? 'local-video' : 'remote-video';
    video.dataset.userId = userId || 'local';
    
    if (isLocal) {
      video.muted = true;
    }
    
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.appendChild(video);
    
    if (userId) {
      const userIdLabel = document.createElement('div');
      userIdLabel.className = 'user-id';
      userIdLabel.textContent = userId;
      videoWrapper.appendChild(userIdLabel);
    }
    
    videoContainer.appendChild(videoWrapper);
  }
  
  function removeVideoStream(userId) {
    const videoElement = document.querySelector(`video[data-user-id="${userId}"]`);
    if (videoElement) {
      videoElement.parentElement.remove();
    }
  }
  
  // إدارة المكالمات
  async function createGroupCall() {
    if (await initMedia()) {
      currentCallType = 'group';
      currentCallId = uuidv4();
      
      // تحديث URL بمعلومات المكالمة
      window.history.pushState({}, '', `/?callId=${currentCallId}&type=group`);
      
      socket.emit('createGroupCall', currentCallId);
      showCallPage();
    }
  }
  
  async function startRandomCall() {
    if (await initMedia()) {
      currentCallType = 'random';
      showWaitingPage();
      socket.emit('findRandomMatch', userId);
    }
  }
  
  async function startPrivateCall() {
    const targetId = document.getElementById('targetUserId').value.trim();
    if (!targetId) {
      alert('الرجاء إدخال معرف المستخدم');
      return;
    }
    
    if (await initMedia()) {
      currentCallType = 'private';
      showWaitingPage();
      socket.emit('startPrivateCall', targetId);
    }
  }
  
  function handleIncomingCall(data) {
    if (confirm(`مكالمة واردة من ${data.callerId}. هل تريد قبول المكالمة؟`)) {
      socket.emit('acceptCall', { callerId: data.callerId });
      showWaitingPage('جار الاتصال...');
    } else {
      socket.emit('rejectCall', data.callerId);
    }
  }
  
  function startCallWithUser(targetId) {
    if (!peers[targetId]) {
      peers[targetId] = createPeer(targetId, true);
      showCallPage();
    }
  }
  
  function handleUserJoined(userId) {
    if (!peers[userId]) {
      peers[userId] = createPeer(userId, false);
    }
  }
  
  function createPeer(userId, initiator) {
    const peer = new SimplePeer({
      initiator,
      stream: localStream,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    
    peer.on('signal', signal => {
      socket.emit('relaySignal', { targetId: userId, signal });
    });
    
    peer.on('stream', stream => {
      addVideoStream(userId, stream);
    });
    
    peer.on('close', () => {
      removeVideoStream(userId);
      delete peers[userId];
    });
    
    return peer;
  }
  
  socket.on('relaySignal', ({ senderId, signal }) => {
    if (peers[senderId] && !peers[senderId].destroyed) {
      peers[senderId].signal(signal);
    }
  });
  
  // التحكم في المكالمة
  function toggleAudio() {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteBtn.classList.toggle('active');
        muteBtn.innerHTML = audioTrack.enabled ? 
          '<i class="fas fa-microphone"></i>' : 
          '<i class="fas fa-microphone-slash"></i>';
      }
    }
  }
  
  function toggleVideo() {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        videoBtn.classList.toggle('active');
        videoBtn.innerHTML = videoTrack.enabled ? 
          '<i class="fas fa-video"></i>' : 
          '<i class="fas fa-video-slash"></i>';
      }
    }
  }
  
  function endCall() {
    // إغلاق جميع اتصالات Peer
    Object.keys(peers).forEach(userId => {
      if (peers[userId] && !peers[userId].destroyed) {
        peers[userId].destroy();
      }
    });
    peers = {};
    
    // إيقاف الوسائط المحلية
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    // إعلام السيرفر بإنهاء المكالمة
    if (currentCallId) {
      socket.emit('leaveCall', { callId: currentCallId, callType: currentCallType });
    }
    
    // العودة إلى الصفحة الرئيسية
    showMainPage();
    window.history.pushState({}, '', '/');
  }
  
  function copyCallLink() {
    if (currentCallId && currentCallType === 'group') {
      const callLink = `${window.location.origin}/?callId=${currentCallId}&type=group`;
      navigator.clipboard.writeText(callLink)
        .then(() => alert('تم نسخ رابط المكالمة بنجاح'))
        .catch(() => alert('فشل نسخ الرابط'));
    }
  }
  
  // إدارة الصفحات
  function showMainPage() {
    mainPage.classList.remove('hidden');
    waitingPage.classList.add('hidden');
    callPage.classList.add('hidden');
  }
  
  function showWaitingPage(message = 'جار البحث عن مستخدم...') {
    mainPage.classList.add('hidden');
    waitingPage.classList.remove('hidden');
    callPage.classList.add('hidden');
    
    const waitingMessage = waitingPage.querySelector('p');
    if (waitingMessage) {
      waitingMessage.textContent = message;
    }
  }
  
  function showCallPage() {
    mainPage.classList.add('hidden');
    waitingPage.classList.add('hidden');
    callPage.classList.remove('hidden');
  }
  
  function cancelSearch() {
    socket.emit('cancelSearch');
    showMainPage();
  }
  
  // معالجة الأحداث
  function handleCallRejected(callerId) {
    alert(`المستخدم ${callerId} رفض المكالمة`);
    showMainPage();
  }
  
  function handleUserLeft(userId) {
    removeVideoStream(userId);
    if (peers[userId]) {
      peers[userId].destroy();
      delete peers[userId];
    }
  }
  
  function handleCallFull() {
    alert('المكالمة ممتلئة! الحد الأقصى 4 مشاركين');
    showMainPage();
  }
  
  function handleUserOffline() {
    alert('المستخدم غير متصل حالياً');
    showMainPage();
  }
  
  // معالجة معلمات URL عند التحميل
  function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const callId = urlParams.get('callId');
    const callType = urlParams.get('type');
    
    if (callId && callType === 'group') {
      currentCallId = callId;
      currentCallType = 'group';
      initMedia().then(success => {
        if (success) {
          socket.emit('joinGroupCall', callId);
          showCallPage();
        }
      });
    }
  }
  
  // بدء التطبيق
  checkUrlParams();
});

// دالة إنشاء UUID
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
