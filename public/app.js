// =====================================================================
// ZEUS Chat — app.js — Universal edition (iOS + Android + Desktop)
// =====================================================================

// ---- SALVATAGGIO SESSIONE — no relogin ----
function saveSession(user) {
  try { localStorage.setItem("zeus_user", JSON.stringify(user)); } catch(e) {}
}
function loadSession() {
  try { const s = localStorage.getItem("zeus_user"); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem("zeus_user"); } catch(e) {}
}

// ---- CONNESSIONE SOCKET ----
const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// ---- HEARTBEAT ----
setInterval(() => {
  if (socket.connected) socket.emit("ping-client");
}, 20000);

socket.on("pong-server", () => {});

// ---- CODA MESSAGGI OFFLINE ----
const offlineQueue = [];

socket.on("reconnect", () => {
  console.log("Riconnesso al server");
  if (currentUser) {
    socket.emit("set-user", currentUser);
    if (selectedContactEmail) loadMessageHistory(selectedContactEmail);
    while (offlineQueue.length > 0) {
      const queued = offlineQueue.shift();
      socket.emit("private-message", queued);
    }
    appendSystemMessage("Riconnesso ✅");
  }
});

socket.on("disconnect", (reason) => {
  console.log("Disconnesso:", reason);
  appendSystemMessage("Connessione persa, riconnessione...");
});

// =====================================================================
// ==== SBLOCCO AUDIOCONTEXT iOS =======================================
// =====================================================================
let audioCtxUnlocked = false;
let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
  return globalAudioCtx;
}

function unlockAudioContext() {
  if (audioCtxUnlocked) return;
  try {
    const ctx = getAudioContext();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().then(() => { audioCtxUnlocked = true; });
  } catch(e) {}
}

// Sblocca su qualsiasi interazione utente
document.addEventListener('touchstart', unlockAudioContext, { passive: true });
document.addEventListener('touchend', unlockAudioContext, { passive: true });
document.addEventListener('click', unlockAudioContext);

// ---- Forza resume AudioContext su ogni tap (iOS) ----
document.addEventListener('touchstart', () => {
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
}, { passive: true });

// =====================================================================
// ==== VARIABILI GLOBALI ==============================================
// =====================================================================
let currentUser = null;
let selectedContactEmail = null;
let onlineUsers = {};

// ---- BADGE ----
const unreadCounts = {};

// ---- CONFERENZA ----
let conferenceMode = false;
let conferenceIframe = null;
let isKmeetOn = false;
const KMEET_URL = "https://kmeet.infomaniak.com/tiknhcsuxmdxxnpd";

// ---- AUDIO VOCALI ----
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let supportedAudioMimeType = null;
let recordingStartTime = null;
let recordingTimerInterval = null;

// ---- VIDEO MESSAGGI ----
let videoRecorder = null;
let videoChunks = [];
let isVideoRecording = false;
let videoPreviewStream = null;
const MAX_VIDEO_SECONDS = 60;
let videoRecordTimeout = null;
let supportedVideoMimeType = null;
let videoTimerInterval = null;

// ---- WEBRTC ----
let isAudioCallActive = false;
let isVideoCallActive = false;
let peerConnection = null;
let localStream = null;
let remoteAudioElement = null;
let localVideoElement = null;
let remoteVideoElement = null;
let videoArea = null;
let currentCallPeerEmail = null;
let callStartTime = null;
let callDurationInterval = null;
let callTimeoutTimer = null;

// ---- SUONERIA ----
let ringtoneInterval = null;
let ringtoneOscRunning = false;

// ---- TYPING ----
let typingTimeout = null;
let isTyping = false;
let typingHideTimeout = null;

// ---- NOTIFICHE ----
let notificationsEnabled = false;

// ---- WEBRTC CONFIG — TURN affidabili ----
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // TURN Metered — affidabile e gratuito
    {
      urls: "turn:a.relay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:a.relay.metered.ca:80?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:a.relay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turns:a.relay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};

// =====================================================================
// ==== DOM ============================================================
// =====================================================================
const loginView = document.getElementById("login");
const appView = document.getElementById("app");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const loginBtn = document.getElementById("login-btn");
const errorDiv = document.getElementById("error");

const contactsList = document.getElementById("contacts-list");
const chatDiv = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");

const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");
const videoNoteBtn = document.getElementById("video-note-btn");

const chatHeader = document.getElementById("chat-header");
const chatTitleText = document.getElementById("chat-title-text");
const chatHeaderAvatar = document.getElementById("chat-header-avatar");
const audioCallBtn = document.getElementById("audio-call-btn");
const videoCallBtn = document.getElementById("video-call-btn");
const chatBackBtn = document.getElementById("chat-back-btn");

const chatPlaceholder = document.getElementById("chat-placeholder");
const chatPanel = document.getElementById("chat-panel");
const typingIndicator = document.getElementById("typing-indicator");

const contactsEl = document.getElementById("contacts");
const chatAreaEl = document.getElementById("chat-area");

videoArea = document.getElementById("video-area");
localVideoElement = document.getElementById("localVideo");
remoteVideoElement = document.getElementById("remoteVideo");

// =====================================================================
// ==== SUONERIA =======================================================
// =====================================================================

function _playRingBeep() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const sequence = [
      { freq: 480, start: 0.0, dur: 0.4 },
      { freq: 620, start: 0.0, dur: 0.4 },
      { freq: 480, start: 0.5, dur: 0.4 },
      { freq: 620, start: 0.5, dur: 0.4 },
    ];
    sequence.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      gain.gain.setValueAtTime(0.4, ctx.currentTime + start + dur - 0.05);
      gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.1);
    });
  } catch(e) {}
}

function startRingtone() {
  stopRingtone();
  ringtoneOscRunning = true;
  _playRingBeep();
  ringtoneInterval = setInterval(() => {
    if (ringtoneOscRunning) _playRingBeep();
  }, 2500);
  vibrate([400, 200, 400, 200, 400, 600]);
}

function stopRingtone() {
  ringtoneOscRunning = false;
  if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
}

// =====================================================================
// ==== SUONI ==========================================================
// =====================================================================

function playSound(type) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "message") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === "sent") {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch(e) {}
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// =====================================================================
// ==== NOTIFICHE ======================================================
// =====================================================================

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") { notificationsEnabled = true; return; }
  if (Notification.permission !== "denied") {
    Notification.requestPermission().then(p => { notificationsEnabled = p === "granted"; });
  }
}

function showBrowserNotification(title, body) {
  if (!notificationsEnabled || document.hasFocus()) return;
  try { new Notification(title, { body, icon: "/icons/icon-192.png" }); } catch(e) {}
}

// =====================================================================
// ==== BADGE MESSAGGI NON LETTI =======================================
// =====================================================================

function incrementUnread(email) {
  if (!email) return;
  if (selectedContactEmail === email && document.hasFocus()) return;
  unreadCounts[email] = (unreadCounts[email] || 0) + 1;
  updateUnreadUI();
}

function clearUnread(email) {
  if (!email) return;
  unreadCounts[email] = 0;
  updateUnreadUI();
}

function updateUnreadUI() {
  document.querySelectorAll(".contact").forEach(c => {
    const email = c.dataset.email;
    let badge = c.querySelector(".unread-badge");
    const count = unreadCounts[email] || 0;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.style.cssText = "background:#2563eb;color:#fff;border-radius:999px;font-size:10px;font-weight:700;padding:1px 6px;min-width:18px;text-align:center;flex-shrink:0;";
        c.appendChild(badge);
      }
      badge.textContent = count > 99 ? "99+" : count;
    } else {
      if (badge) badge.remove();
    }
  });
  const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  document.title = total > 0 ? `(${total}) ZEUS Chat` : "ZEUS Chat";
}

// =====================================================================
// ==== NAVIGAZIONE MOBILE =============================================
// =====================================================================

function openChat(user) {
  selectedContactEmail = user.email;
  chatTitleText.textContent = user.name;
  if (user.avatar) { chatHeaderAvatar.src = user.avatar; chatHeaderAvatar.style.display = "block"; }
  else { chatHeaderAvatar.style.display = "none"; }
  if (chatPlaceholder) chatPlaceholder.style.display = "none";
  if (chatPanel) chatPanel.style.display = "flex";
  document.querySelectorAll(".contact").forEach((c) => {
    c.classList.remove("selected");
    if (c.dataset.email === user.email) c.classList.add("selected");
  });
  if (window.innerWidth <= 640) {
    if (contactsEl) contactsEl.classList.add("hidden-mobile");
    if (chatAreaEl) chatAreaEl.classList.add("visible-mobile");
  }
  clearUnread(user.email);
  loadMessageHistory(user.email);
  if (input) input.focus();
}

function closeChat() {
  selectedContactEmail = null;
  if (chatPanel) chatPanel.style.display = "none";
  if (chatPlaceholder) chatPlaceholder.style.display = "flex";
  document.querySelectorAll(".contact").forEach((c) => c.classList.remove("selected"));
  chatTitleText.textContent = "Chat";
  if (chatHeaderAvatar) chatHeaderAvatar.style.display = "none";
  if (typingIndicator) typingIndicator.textContent = "";
  if (contactsEl) contactsEl.classList.remove("hidden-mobile");
  if (chatAreaEl) chatAreaEl.classList.remove("visible-mobile");
}

if (chatBackBtn) chatBackBtn.addEventListener("click", () => closeChat());

window.addEventListener("resize", () => {
  if (window.innerWidth > 640) {
    if (contactsEl) contactsEl.classList.remove("hidden-mobile");
    if (chatAreaEl) chatAreaEl.classList.remove("visible-mobile");
  }
});

// =====================================================================
// ==== STORICO MESSAGGI ===============================================
// =====================================================================

const messagesByContact = {};

function getContactMessages(email) {
  if (!messagesByContact[email]) messagesByContact[email] = [];
  return messagesByContact[email];
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + time;
}

// ---- PLAY AUDIO iOS SAFE ----
function playAudioSafe(audioEl) {
  if (!audioEl) return;
  // Sblocca AudioContext prima
  unlockAudioContext();
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().then(() => {
      audioEl.play().catch(e => console.log("Audio play err:", e));
    });
  } else {
    audioEl.play().catch(e => console.log("Audio play err:", e));
  }
}

// ---- PLAY VIDEO iOS SAFE ----
function playVideoSafe(videoEl) {
  if (!videoEl) return;
  videoEl.muted = false;
  videoEl.playsInline = true;
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("webkit-playsinline", "");
  videoEl.play().catch(() => {
    // Su iOS prova muted prima poi unmute
    videoEl.muted = true;
    videoEl.play().then(() => {
      videoEl.muted = false;
    }).catch(e => console.log("Video play err:", e));
  });
}

function buildMessageElement(fromUser, text, ts, isMe) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("msg", isMe ? "from-me" : "from-other");
  if (!isMe) {
    const senderEl = document.createElement("div");
    senderEl.className = "msg-sender";
    senderEl.textContent = fromUser.name || fromUser.email || "";
    wrapper.appendChild(senderEl);
  }
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const attachMatch = text.match(/📎 allegato:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const videoMatch = text.match(/🎦 video:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const audioMatch = text.match(/🎤 vocale:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const imgMatch = text.match(/🖼 immagine:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);

  if (videoMatch) {
    // ---- VIDEO BOLLA CIRCOLARE — iOS SAFE ----
    const videoBubble = document.createElement("div");
    videoBubble.className = "video-bubble";
    videoBubble.style.cssText = "width:200px;height:200px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:#020617;box-shadow:0 0 0 3px rgba(59,130,246,0.6);position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent;";

    const videoEl = document.createElement("video");
    videoEl.playsInline = true;
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("webkit-playsinline", "");
    videoEl.setAttribute("x-webkit-airplay", "allow");
    videoEl.muted = false;
    videoEl.preload = "metadata";
    videoEl.controls = false;
    videoEl.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";

    // Prova URL originale + conversione mp4
    const urlPath = videoMatch[2];
    const urlMp4 = urlPath.replace(/\.webm$/i, "-conv.mp4");

    // Su iOS usa mp4, altrove webm
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      videoEl.src = urlMp4;
      videoEl.addEventListener("error", () => { videoEl.src = urlPath; });
    } else {
      const src1 = document.createElement("source"); src1.src = urlPath; src1.type = "video/webm";
      const src2 = document.createElement("source"); src2.src = urlMp4; src2.type = "video/mp4";
      videoEl.appendChild(src1);
      videoEl.appendChild(src2);
    }

    // Overlay play
    const playOverlay = document.createElement("div");
    playOverlay.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:54px;height:54px;background:rgba(0,0,0,0.55);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;pointer-events:none;transition:opacity 0.2s;";
    playOverlay.textContent = "▶";

    videoBubble.appendChild(videoEl);
    videoBubble.appendChild(playOverlay);

    // Click/tap handler
    let tapping = false;
    videoBubble.addEventListener("touchstart", () => { tapping = true; }, { passive: true });
    videoBubble.addEventListener("touchend", (e) => {
      if (!tapping) return;
      tapping = false;
      e.preventDefault();
      if (videoEl.paused) {
        playVideoSafe(videoEl);
        playOverlay.style.opacity = "0";
      } else {
        videoEl.pause();
        playOverlay.style.opacity = "1";
      }
    }, { passive: false });
    videoBubble.addEventListener("click", () => {
      if (videoEl.paused) {
        playVideoSafe(videoEl);
        playOverlay.style.opacity = "0";
      } else {
        videoEl.pause();
        playOverlay.style.opacity = "1";
      }
    });
    videoEl.addEventListener("ended", () => {
      playOverlay.style.opacity = "1";
    });
    videoEl.addEventListener("pause", () => {
      playOverlay.style.opacity = "1";
    });

    wrapper.appendChild(videoBubble);

  } else if (audioMatch) {
    // ---- AUDIO BOLLA — iOS SAFE ----
    bubble.style.cssText += "min-width:200px;max-width:280px;";
    const audioRow = document.createElement("div");
    audioRow.style.cssText = "display:flex;align-items:center;gap:8px;";

    const playBtn = document.createElement("button");
    playBtn.style.cssText = "width:40px;height:40px;border-radius:50%;background:#2563eb;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;";
    playBtn.textContent = "▶";

    const audioEl = document.createElement("audio");
    audioEl.src = audioMatch[2];
    audioEl.preload = "metadata";
    audioEl.setAttribute("playsinline", "");

    const waveDiv = document.createElement("div");
    waveDiv.style.cssText = "flex:1;height:28px;display:flex;align-items:center;gap:2px;";
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement("div");
      const h = 4 + Math.random() * 20;
      bar.style.cssText = `width:3px;height:${h}px;background:rgba(148,163,184,0.5);border-radius:2px;flex-shrink:0;`;
      waveDiv.appendChild(bar);
    }

    const durationSpan = document.createElement("span");
    durationSpan.style.cssText = "font-size:11px;color:#9ca3af;white-space:nowrap;min-width:32px;";
    durationSpan.textContent = "0:00";

    audioEl.addEventListener("loadedmetadata", () => {
      if (audioEl.duration && isFinite(audioEl.duration)) {
        const m = Math.floor(audioEl.duration / 60);
        const s = Math.floor(audioEl.duration % 60);
        durationSpan.textContent = `${m}:${s.toString().padStart(2, "0")}`;
      }
    });
    audioEl.addEventListener("timeupdate", () => {
      if (audioEl.duration && isFinite(audioEl.duration)) {
        const m = Math.floor(audioEl.currentTime / 60);
        const s = Math.floor(audioEl.currentTime % 60);
        durationSpan.textContent = `${m}:${s.toString().padStart(2, "0")}`;
      }
    });
    audioEl.addEventListener("ended", () => { playBtn.textContent = "▶"; });

    // Play button — iOS safe con unlock
    playBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      unlockAudioContext();
      if (audioEl.paused) {
        playAudioSafe(audioEl);
        playBtn.textContent = "⏸";
      } else {
        audioEl.pause();
        playBtn.textContent = "▶";
      }
    }, { passive: false });

    playBtn.addEventListener("click", () => {
      unlockAudioContext();
      if (audioEl.paused) {
        playAudioSafe(audioEl);
        playBtn.textContent = "⏸";
      } else {
        audioEl.pause();
        playBtn.textContent = "▶";
      }
    });

    audioRow.appendChild(playBtn);
    audioRow.appendChild(waveDiv);
    audioRow.appendChild(durationSpan);
    bubble.appendChild(audioRow);
    wrapper.appendChild(bubble);

  } else if (imgMatch) {
    const img = document.createElement("img");
    img.src = imgMatch[2];
    img.alt = imgMatch[1];
    img.style.cssText = "max-width:220px;max-height:220px;border-radius:12px;display:block;cursor:pointer;";
    img.addEventListener("click", () => window.open(imgMatch[2], "_blank"));
    bubble.appendChild(img);
    wrapper.appendChild(bubble);

  } else if (attachMatch) {
    const link = document.createElement("a");
    link.href = attachMatch[2];
    link.textContent = "📎 " + attachMatch[1];
    link.target = "_blank";
    link.style.cssText = "color:#38bdf8;text-decoration:underline;";
    bubble.appendChild(link);
    wrapper.appendChild(bubble);

  } else {
    bubble.textContent = text;
    wrapper.appendChild(bubble);
  }

  const timeEl = document.createElement("div");
  timeEl.className = "msg-time";
  timeEl.textContent = formatTime(ts);
  wrapper.appendChild(timeEl);
  return wrapper;
}

async function loadMessageHistory(peerEmail) {
  if (!currentUser || !peerEmail) return;
  if (chatDiv) chatDiv.innerHTML = "";
  try {
    const res = await fetch(`/api/messages?emailA=${encodeURIComponent(currentUser.email)}&emailB=${encodeURIComponent(peerEmail)}&limit=100`);
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return;
    messagesByContact[peerEmail] = [];
    data.messages.forEach((m) => {
      const isMe = m.from === currentUser.email;
      const fromUser = m.fromUser || { email: m.from, name: m.from };
      const el = buildMessageElement(fromUser, m.text, m.ts, isMe);
      messagesByContact[peerEmail].push({ el });
      if (chatDiv) chatDiv.appendChild(el);
    });
    if (chatDiv) chatDiv.scrollTop = chatDiv.scrollHeight;
  } catch(err) { console.error("Errore storico:", err); }
}

function addMessageToContact(email, el) {
  getContactMessages(email).push({ el });
  if (selectedContactEmail === email && chatDiv) {
    chatDiv.appendChild(el);
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }
}

// =====================================================================
// ==== PROFILO UTENTE =================================================
// =====================================================================

const profileBtn = document.getElementById("profile-btn");
const profileModalOverlay = document.getElementById("profile-modal-overlay");
const profileCancelBtn = document.getElementById("profile-cancel-btn");
const profileSaveBtn = document.getElementById("profile-save-btn");
const profileNameInput = document.getElementById("profile-name");
const profileEmailInput = document.getElementById("profile-email");
const profilePhoneInput = document.getElementById("profile-phone");
const profileAddressInput = document.getElementById("profile-address");
const profileAvatarPreview = document.getElementById("profile-avatar-preview");
const profileAvatarUploadBtn = document.getElementById("profile-avatar-upload-btn");
const profileAvatarInput = document.getElementById("profile-avatar-input");
let pendingAvatarBase64 = null;

function openProfileModal() {
  if (!currentUser) return;
  if (profileNameInput) profileNameInput.value = currentUser.name || "";
  if (profileEmailInput) profileEmailInput.value = currentUser.email || "";
  if (profilePhoneInput) profilePhoneInput.value = currentUser.phone || "";
  if (profileAddressInput) profileAddressInput.value = currentUser.address || "";
  pendingAvatarBase64 = null;
  updateProfileAvatarPreview(currentUser.avatar || null);
  if (profileModalOverlay) profileModalOverlay.classList.add("open");
}

function closeProfileModal() {
  if (profileModalOverlay) profileModalOverlay.classList.remove("open");
  pendingAvatarBase64 = null;
}

function updateProfileAvatarPreview(avatarSrc) {
  if (!profileAvatarPreview) return;
  profileAvatarPreview.innerHTML = avatarSrc ? `<img src="${avatarSrc}" alt="Avatar" />` : "👤";
}

if (profileBtn) profileBtn.addEventListener("click", openProfileModal);
if (profileCancelBtn) profileCancelBtn.addEventListener("click", closeProfileModal);
if (profileModalOverlay) profileModalOverlay.addEventListener("click", (e) => { if (e.target === profileModalOverlay) closeProfileModal(); });

if (profileAvatarUploadBtn && profileAvatarInput) {
  profileAvatarUploadBtn.addEventListener("click", () => profileAvatarInput.click());
  profileAvatarInput.addEventListener("change", () => {
    const file = profileAvatarInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => { pendingAvatarBase64 = e.target.result; updateProfileAvatarPreview(pendingAvatarBase64); };
    reader.readAsDataURL(file);
    profileAvatarInput.value = "";
  });
}

if (profileSaveBtn) {
  profileSaveBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const name = (profileNameInput && profileNameInput.value.trim()) || currentUser.name;
    const phone = (profilePhoneInput && profilePhoneInput.value.trim()) || "";
    const address = (profileAddressInput && profileAddressInput.value.trim()) || "";
    const avatar = pendingAvatarBase64 || currentUser.avatar || null;
    try {
      const res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: currentUser.email, name, phone, address, avatar }) });
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) { appendSystemMessage("Errore salvataggio profilo."); return; }
      currentUser = { ...currentUser, name, phone, address, avatar };
      saveSession(currentUser);
      appendSystemMessage("Profilo aggiornato ✅");
      closeProfileModal();
      loadUsers();
    } catch(err) { appendSystemMessage("Errore connessione."); }
  });
}

// =====================================================================
// ==== TYPING =========================================================
// =====================================================================

function sendTypingStart() {
  if (!currentUser || !selectedContactEmail) return;
  if (!isTyping) { isTyping = true; socket.emit("typing-start", { toEmail: selectedContactEmail }); }
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => sendTypingStop(), 3000);
}

function sendTypingStop() {
  if (!isTyping) return;
  isTyping = false;
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
  if (currentUser && selectedContactEmail) socket.emit("typing-stop", { toEmail: selectedContactEmail });
}

if (input) {
  input.addEventListener("input", () => sendTypingStart());
  input.addEventListener("blur", () => sendTypingStop());
}

socket.on("typing-start", ({ from }) => {
  if (!from) return;
  if (selectedContactEmail === from.email) {
    if (typingIndicator) typingIndicator.textContent = `${from.name} sta scrivendo...`;
    if (typingHideTimeout) clearTimeout(typingHideTimeout);
    typingHideTimeout = setTimeout(() => { if (typingIndicator) typingIndicator.textContent = ""; }, 5000);
  }
});

socket.on("typing-stop", ({ from }) => {
  if (!from) return;
  if (selectedContactEmail === from.email) {
    if (typingIndicator) typingIndicator.textContent = "";
    if (typingHideTimeout) { clearTimeout(typingHideTimeout); typingHideTimeout = null; }
  }
});

// =====================================================================
// ==== CONFERENZA =====================================================
// =====================================================================

let conferenceView = null;
let conferenceContacts = null;
let conferenceMainArea = null;
let kmeetToggleBtn = null;

function ensureConferenceView() {
  if (conferenceView) return;
  conferenceView = document.createElement("div");
  conferenceView.id = "conference-view";
  conferenceView.style.cssText = "display:none;flex:1;background-color:#020617;border-radius:8px;border:1px solid rgba(148,163,184,0.3);margin:8px;overflow:hidden;flex-direction:row;";
  const leftCol = document.createElement("div");
  leftCol.style.cssText = "width:260px;border-right:1px solid rgba(148,163,184,0.3);display:flex;flex-direction:column;background-color:#020617;";
  const leftHeader = document.createElement("div");
  leftHeader.textContent = "Rubrica conferenza ZEUS";
  leftHeader.style.cssText = "padding:8px;font-size:13px;font-weight:600;color:#e5e7eb;border-bottom:1px solid rgba(148,163,184,0.3);";
  conferenceContacts = document.createElement("div");
  conferenceContacts.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";
  leftCol.appendChild(leftHeader); leftCol.appendChild(conferenceContacts);
  const rightCol = document.createElement("div");
  rightCol.style.cssText = "flex:1;display:flex;flex-direction:column;background-color:#020617;";
  const topBar = document.createElement("div");
  topBar.style.cssText = "display:flex;align-items:center;padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);gap:8px;";
  const confTitle = document.createElement("div");
  confTitle.textContent = "Conferenza globale kMeet";
  confTitle.style.cssText = "flex:1;font-size:13px;font-weight:600;color:#e5e7eb;";
  kmeetToggleBtn = document.createElement("button");
  kmeetToggleBtn.textContent = "kMeet: ON";
  kmeetToggleBtn.style.cssText = "padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(135deg,#22c55e,#16a34a);color:#f9fafb;";
  topBar.appendChild(confTitle); topBar.appendChild(kmeetToggleBtn);
  conferenceMainArea = document.createElement("div");
  conferenceMainArea.style.cssText = "flex:1;display:flex;align-items:center;justify-content:center;background-color:#020617;";
  const ph = document.createElement("div");
  ph.textContent = "Premi kMeet: ON per aprire la conferenza.";
  ph.style.cssText = "font-size:13px;color:#9ca3af;text-align:center;";
  conferenceMainArea.appendChild(ph);
  rightCol.appendChild(topBar); rightCol.appendChild(conferenceMainArea);
  conferenceView.appendChild(leftCol); conferenceView.appendChild(rightCol);
  if (appView && appView.parentNode) appView.parentNode.insertBefore(conferenceView, appView.nextSibling);
  kmeetToggleBtn.addEventListener("click", () => { if (!isKmeetOn) openKmeet(); else closeKmeet(); });
}

function openKmeet() {
  if (!conferenceMainArea) return;
  conferenceMainArea.innerHTML = "";
  conferenceIframe = document.createElement("iframe");
  conferenceIframe.style.cssText = "border:none;width:100%;height:100%;";
  conferenceIframe.allow = "camera; microphone; fullscreen; display-capture; autoplay";
  conferenceIframe.src = KMEET_URL;
  conferenceMainArea.appendChild(conferenceIframe);
  isKmeetOn = true;
  if (kmeetToggleBtn) { kmeetToggleBtn.textContent = "kMeet: OFF"; kmeetToggleBtn.style.background = "linear-gradient(135deg,#f97316,#ea580c)"; }
  appendSystemMessage("Conferenza kMeet aperta.");
}

function closeKmeet() {
  if (conferenceIframe && conferenceIframe.parentNode) conferenceIframe.parentNode.removeChild(conferenceIframe);
  conferenceIframe = null; isKmeetOn = false;
  if (conferenceMainArea) conferenceMainArea.innerHTML = "";
  if (kmeetToggleBtn) { kmeetToggleBtn.textContent = "kMeet: ON"; kmeetToggleBtn.style.background = "linear-gradient(135deg,#22c55e,#16a34a)"; }
  appendSystemMessage("Conferenza kMeet chiusa.");
  if (conferenceView) conferenceView.style.display = "none";
  if (appView) appView.style.display = "flex";
  conferenceMode = false;
}

function enterConferenceMode() {
  if (conferenceMode) return;
  conferenceMode = true;
  ensureConferenceView();
  rebuildConferenceContacts();
  if (appView) appView.style.display = "none";
  if (conferenceView) conferenceView.style.display = "flex";
}

function exitConferenceMode() { if (!conferenceMode) return; conferenceMode = false; closeKmeet(); }

const conferenceBtn = document.createElement("button");
conferenceBtn.id = "conference-toggle";
conferenceBtn.textContent = "Conferenza";
conferenceBtn.style.cssText = "margin-left:8px;padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(135deg,#6366f1,#ec4899);color:#f9fafb;";
if (chatHeader) chatHeader.appendChild(conferenceBtn);
conferenceBtn.addEventListener("click", () => {
  if (!currentUser || !currentUser.email) { appendSystemMessage("Devi fare login prima."); return; }
  if (!conferenceMode) enterConferenceMode(); else exitConferenceMode();
});

// =====================================================================
// ==== MICROFONO — HOLD TO RECORD =====================================
// =====================================================================

const micBtn = document.createElement("button");
micBtn.id = "mic-btn";
micBtn.title = "Tieni premuto per vocale";
micBtn.style.cssText = "width:36px;height:36px;border-radius:50%;background:transparent;border:none;font-size:20px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.1s;touch-action:none;flex-shrink:0;position:relative;-webkit-tap-highlight-color:transparent;";
micBtn.innerHTML = "🎤";

const micTimerOverlay = document.createElement("div");
micTimerOverlay.style.cssText = "display:none;position:absolute;bottom:42px;left:50%;transform:translateX(-50%);background:rgba(37,99,235,0.95);color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;white-space:nowrap;pointer-events:none;z-index:100;";
micTimerOverlay.textContent = "● 0:00  ← scorri per annullare";

let micStartX = 0;
let micCancelled = false;

function initAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // Su iOS preferisce mp4/aac
  const candidates = isIOS
    ? ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", ""]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", ""];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) {
      supportedAudioMimeType = type || null;
      console.log("Audio MIME:", supportedAudioMimeType);
      return;
    }
  }
}

function initVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const candidates = isIOS
    ? ["video/mp4;codecs=h264,aac", "video/mp4", "video/webm", ""]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4", ""];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) {
      supportedVideoMimeType = type || null;
      console.log("Video MIME:", supportedVideoMimeType);
      return;
    }
  }
}

function setMicRecordingUI(recording) {
  if (recording) {
    micBtn.style.background = "radial-gradient(circle,#ef4444,#b91c1c)";
    micBtn.style.transform = "scale(1.2)";
    micBtn.innerHTML = "⏺";
    micTimerOverlay.style.display = "block";
  } else {
    micBtn.style.background = "transparent";
    micBtn.style.transform = "scale(1)";
    micBtn.innerHTML = "🎤";
    micTimerOverlay.style.display = "none";
    if (recordingTimerInterval) { clearInterval(recordingTimerInterval); recordingTimerInterval = null; }
  }
}

function startRecordingTimer() {
  recordingStartTime = Date.now();
  if (recordingTimerInterval) clearInterval(recordingTimerInterval);
  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    micTimerOverlay.textContent = `● ${m}:${s.toString().padStart(2, "0")}  ← scorri per annullare`;
  }, 500);
}

async function startVoiceRecording() {
  if (isRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendSystemMessage("Microfono non supportato su questo browser.");
    return;
  }
  if (!currentUser || !selectedContactEmail) {
    appendSystemMessage("Seleziona un contatto prima.");
    return;
  }
  micCancelled = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let recOptions = {};
    if (supportedAudioMimeType) recOptions = { mimeType: supportedAudioMimeType };
    try { mediaRecorder = new MediaRecorder(stream, recOptions); }
    catch(e) { mediaRecorder = new MediaRecorder(stream); }
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      isRecording = false;
      setMicRecordingUI(false);
      if (micCancelled) { audioChunks = []; appendSystemMessage("Vocale annullato."); return; }
      if (!audioChunks.length) { appendSystemMessage("Nessun audio registrato."); return; }
      const mimeType = supportedAudioMimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type: mimeType });
      audioChunks = [];
      await uploadAndSendVoice(blob, mimeType);
    };
    mediaRecorder.start(250);
    isRecording = true;
    setMicRecordingUI(true);
    startRecordingTimer();
    vibrate(50);
  } catch(err) {
    isRecording = false;
    setMicRecordingUI(false);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      appendSystemMessage("⚠️ Permesso microfono negato. Abilita il microfono nelle impostazioni.");
    } else {
      appendSystemMessage("Errore microfono: " + err.message);
    }
  }
}

function stopVoiceRecording(cancelled) {
  if (!isRecording || !mediaRecorder) return;
  micCancelled = !!cancelled;
  try {
    if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") mediaRecorder.stop();
  } catch(e) {
    isRecording = false;
    setMicRecordingUI(false);
  }
}

async function uploadAndSendVoice(blob, mimeType) {
  if (!blob || !currentUser || !selectedContactEmail) return;
  try {
    appendSystemMessage("Invio vocale...");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const ext = (mimeType.includes("mp4") || mimeType.includes("aac")) ? ".m4a" : mimeType.includes("ogg") ? ".ogg" : ".webm";
    const fileName = `voice-${Date.now()}${ext}`;
    const formData = new FormData();
    formData.append("file", blob, fileName);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok || !data.url) { appendSystemMessage("Errore upload vocale."); return; }
    const msgText = `🎤 vocale: ${fileName} (${data.url})`;
    if (socket.connected) {
      socket.emit("private-message", { toEmail: selectedContactEmail, text: msgText });
    } else {
      offlineQueue.push({ toEmail: selectedContactEmail, text: msgText });
      appendSystemMessage("Vocale in coda (offline).");
    }
  } catch(err) { appendSystemMessage("Errore invio vocale."); }
}

// ---- DOM READY ----
window.addEventListener("DOMContentLoaded", () => {
  const inputBar = document.getElementById("input-bar");
  if (inputBar) {
    inputBar.style.position = "relative";
    inputBar.appendChild(micTimerOverlay);
    inputBar.appendChild(micBtn);
  }
  initAudioMimeType();
  initVideoMimeType();
  requestNotificationPermission();
  checkPWAInstallBanner();

  // Auto-login da sessione salvata
  const savedUser = loadSession();
  if (savedUser && savedUser.email && savedUser.name) {
    window.initZeusApp(savedUser);
  }
});

// ---- MIC TOUCH EVENTS ----
micBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  micStartX = e.touches[0].clientX;
  startVoiceRecording();
}, { passive: false });

micBtn.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!isRecording) return;
  const deltaX = e.touches[0].clientX - micStartX;
  if (deltaX < -80) {
    micTimerOverlay.textContent = "🗑 Rilascia per annullare";
    micTimerOverlay.style.background = "rgba(239,68,68,0.95)";
  } else {
    micTimerOverlay.style.background = "rgba(37,99,235,0.95)";
  }
}, { passive: false });

micBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  if (!isRecording) return;
  const deltaX = e.changedTouches[0].clientX - micStartX;
  stopVoiceRecording(deltaX < -80);
  micTimerOverlay.style.background = "rgba(37,99,235,0.95)";
}, { passive: false });

micBtn.addEventListener("mousedown", () => startVoiceRecording());
micBtn.addEventListener("mouseup", () => stopVoiceRecording(false));
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopVoiceRecording(false); });

// =====================================================================
// ==== VIDEO MESSAGGI =================================================
// =====================================================================

function setVideoNoteButtonState(recording) {
  if (!videoNoteBtn) return;
  if (recording) {
    videoNoteBtn.innerHTML = '<span style="color:#fff;font-size:14px;">⏹</span>';
    videoNoteBtn.style.background = "radial-gradient(circle at 30% 0, #fecaca 0, #dc2626 40%, #7f1d1d 100%)";
    videoNoteBtn.style.boxShadow = "0 0 12px rgba(220,38,38,0.9)";
    videoNoteBtn.disabled = false;
  } else {
    videoNoteBtn.innerHTML = '<span>▶</span>';
    videoNoteBtn.style.background = "radial-gradient(circle at 30% 0, #fecaca 0, #ef4444 40%, #b91c1c 100%)";
    videoNoteBtn.style.boxShadow = "0 0 8px rgba(239,68,68,0.7)";
    videoNoteBtn.disabled = false;
  }
}

let videoCountdownOverlay = null;

function createVideoCountdownOverlay() {
  if (videoCountdownOverlay) return;
  videoCountdownOverlay = document.createElement("div");
  videoCountdownOverlay.style.cssText = "position:absolute;top:8px;right:8px;background:rgba(239,68,68,0.85);color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:2px 8px;pointer-events:none;z-index:10;display:none;";
  const vw = document.getElementById("video-wrapper");
  if (vw) vw.appendChild(videoCountdownOverlay);
}

function startVideoCountdown() {
  createVideoCountdownOverlay();
  let remaining = MAX_VIDEO_SECONDS;
  if (videoCountdownOverlay) { videoCountdownOverlay.style.display = "block"; videoCountdownOverlay.textContent = `● ${remaining}s`; }
  if (videoTimerInterval) clearInterval(videoTimerInterval);
  videoTimerInterval = setInterval(() => {
    remaining--;
    if (videoCountdownOverlay) videoCountdownOverlay.textContent = `● ${remaining}s`;
    if (remaining <= 0) { clearInterval(videoTimerInterval); videoTimerInterval = null; }
  }, 1000);
}

function stopVideoCountdown() {
  if (videoTimerInterval) { clearInterval(videoTimerInterval); videoTimerInterval = null; }
  if (videoCountdownOverlay) videoCountdownOverlay.style.display = "none";
}

async function startVideoMessageRecording() {
  if (isVideoRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { appendSystemMessage("Camera non supportata."); return; }
  if (!currentUser || !selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 480, max: 640 }, height: { ideal: 480, max: 640 }, facingMode: "user", frameRate: { ideal: 15, max: 30 } },
      audio: true
    });
    videoPreviewStream = stream;
    videoChunks = [];
    if (videoArea) videoArea.style.display = "block";
    if (localVideoElement) { localVideoElement.srcObject = stream; localVideoElement.muted = true; }
    let recorderOptions = supportedVideoMimeType ? { mimeType: supportedVideoMimeType } : {};
    try { videoRecorder = new MediaRecorder(stream, recorderOptions); }
    catch(e) {
      try { videoRecorder = new MediaRecorder(stream); }
      catch(e2) { appendSystemMessage("Registrazione video non supportata."); stream.getTracks().forEach(t => t.stop()); return; }
    }
    videoRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
    videoRecorder.onstop = async () => {
      isVideoRecording = false;
      setVideoNoteButtonState(false);
      stopVideoCountdown();
      if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t => t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
      if (videoChunks.length > 0) {
        const mimeType = videoRecorder.mimeType || supportedVideoMimeType || "video/webm";
        const blob = new Blob(videoChunks, { type: mimeType });
        videoChunks = [];
        await sendVideoMessage(blob, mimeType);
      } else { appendSystemMessage("Nessun dato video."); videoChunks = []; }
    };
    videoRecorder.onerror = () => {
      isVideoRecording = false; setVideoNoteButtonState(false); stopVideoCountdown();
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t => t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
    };
    isVideoRecording = true;
    setVideoNoteButtonState(true);
    videoRecorder.start(500);
    startVideoCountdown();
    appendSystemMessage("● Registrazione avviata (max " + MAX_VIDEO_SECONDS + "s). Premi ⏹ per fermare.");
    videoRecordTimeout = setTimeout(() => {
      if (isVideoRecording && videoRecorder && videoRecorder.state === "recording") {
        appendSystemMessage("Tempo massimo.");
        videoRecorder.stop();
      }
    }, MAX_VIDEO_SECONDS * 1000);
  } catch(err) {
    isVideoRecording = false; setVideoNoteButtonState(false);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      appendSystemMessage("⚠️ Permesso camera negato. Abilita camera e microfono nelle impostazioni.");
    } else { appendSystemMessage("Errore camera: " + err.message); }
  }
}

function stopVideoMessageRecording() {
  if (!isVideoRecording || !videoRecorder) return;
  setVideoNoteButtonState(false); stopVideoCountdown();
  if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
  try {
    if (videoRecorder.state === "recording" || videoRecorder.state === "paused") videoRecorder.stop();
  } catch(e) {
    isVideoRecording = false;
    if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t => t.stop()); videoPreviewStream = null; }
    if (localVideoElement) localVideoElement.srcObject = null;
    if (videoArea) videoArea.style.display = "none";
  }
}

async function sendVideoMessage(blob, mimeType) {
  if (!blob || !currentUser || !selectedContactEmail) return;
  try {
    const isMP4 = mimeType && (mimeType.includes("mp4") || mimeType.includes("h264") || mimeType.includes("avc"));
    const ext = isMP4 ? ".mp4" : ".webm";
    const fileName = `video-message-${Date.now()}${ext}`;
    appendSystemMessage("Invio video...");
    showUploadProgress("Video in caricamento...");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) updateUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      hideUploadProgress();
      try {
        const data = JSON.parse(xhr.responseText);
        if (!data || !data.ok || !data.url) { appendSystemMessage("Errore upload video."); return; }
        const msgText = `🎦 video: ${fileName} (${data.url})`;
        if (socket.connected) {
          socket.emit("private-message", { toEmail: selectedContactEmail, text: msgText });
        } else {
          offlineQueue.push({ toEmail: selectedContactEmail, text: msgText });
        }
        appendSystemMessage("✓ Video inviato.");
      } catch(e) { appendSystemMessage("Errore risposta server."); }
    };
    xhr.onerror = () => { hideUploadProgress(); appendSystemMessage("Errore upload video."); };
    const formData = new FormData();
    formData.append("file", blob, fileName);
    xhr.send(formData);
  } catch(err) { hideUploadProgress(); appendSystemMessage("Errore upload video."); }
}

if (videoNoteBtn) {
  setVideoNoteButtonState(false);
  let videoNoteLastTap = 0;
  function handleVideoNoteAction(e) {
    e.preventDefault(); e.stopPropagation();
    const now = Date.now();
    if (now - videoNoteLastTap < 300) return;
    videoNoteLastTap = now;
    if (!isVideoRecording) startVideoMessageRecording(); else stopVideoMessageRecording();
  }
  videoNoteBtn.addEventListener("touchend", handleVideoNoteAction, { passive: false });
  videoNoteBtn.addEventListener("click", (e) => {
    const now = Date.now();
    if (now - videoNoteLastTap < 300) return;
    videoNoteLastTap = now;
    e.preventDefault();
    if (!isVideoRecording) startVideoMessageRecording(); else stopVideoMessageRecording();
  });
}

// =====================================================================
// ==== PROGRESS BAR UPLOAD ============================================
// =====================================================================

let progressContainer = null;

function showUploadProgress(label) {
  if (!progressContainer) {
    progressContainer = document.createElement("div");
    progressContainer.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(2,6,23,0.95);border:1px solid rgba(37,99,235,0.5);border-radius:12px;padding:8px 16px;min-width:200px;z-index:999;text-align:center;";
    const labelEl = document.createElement("div");
    labelEl.id = "upload-label";
    labelEl.style.cssText = "font-size:12px;color:#e5e7eb;margin-bottom:6px;";
    const bar = document.createElement("div");
    bar.style.cssText = "height:4px;background:rgba(37,99,235,0.2);border-radius:4px;overflow:hidden;";
    const fill = document.createElement("div");
    fill.id = "upload-fill";
    fill.style.cssText = "height:100%;width:0%;background:#2563eb;border-radius:4px;transition:width 0.2s;";
    bar.appendChild(fill);
    progressContainer.appendChild(labelEl);
    progressContainer.appendChild(bar);
    document.body.appendChild(progressContainer);
  }
  const labelEl = document.getElementById("upload-label");
  if (labelEl) labelEl.textContent = label || "Caricamento...";
  progressContainer.style.display = "block";
  updateUploadProgress(0);
}

function updateUploadProgress(pct) {
  const fill = document.getElementById("upload-fill");
  if (fill) fill.style.width = pct + "%";
  const labelEl = document.getElementById("upload-label");
  if (labelEl && pct > 0) labelEl.textContent = `Caricamento ${pct}%`;
}

function hideUploadProgress() {
  if (progressContainer) progressContainer.style.display = "none";
  updateUploadProgress(0);
}

// =====================================================================
// ==== VISTA APP ======================================================
// =====================================================================

function showLogin() { if (loginView) loginView.style.display = "flex"; if (appView) appView.style.display = "none"; }
function showApp() { if (loginView) loginView.style.display = "none"; if (appView) appView.style.display = "flex"; closeChat(); }

// =====================================================================
// ==== RUBRICA ========================================================
// =====================================================================

async function deleteUser(email) {
  if (!email) return;
  const ok = confirm(`Eliminare ${email}?`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { appendSystemMessage(data.error || "Impossibile eliminare."); return; }
    appendSystemMessage(`Utente ${email} eliminato.`);
    if (selectedContactEmail === email) closeChat();
    loadUsers();
  } catch(err) { appendSystemMessage("Errore eliminazione."); }
}

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    contactsList.innerHTML = "";
    users.forEach((u) => {
      const div = document.createElement("div");
      div.className = "contact"; div.dataset.email = u.email;
      if (selectedContactEmail === u.email) div.classList.add("selected");
      const avatarEl = document.createElement("div");
      if (u.avatar) {
        const img = document.createElement("img"); img.src = u.avatar; img.alt = u.name; img.className = "contact-avatar";
        avatarEl.appendChild(img);
      } else {
        avatarEl.className = "contact-avatar-placeholder";
        avatarEl.textContent = (u.name || "?")[0].toUpperCase();
      }
      const infoEl = document.createElement("div"); infoEl.className = "contact-info";
      const nameRow = document.createElement("div"); nameRow.className = "contact-name";
      const statusDot = document.createElement("span"); statusDot.className = "contact-status-dot";
      statusDot.style.backgroundColor = onlineUsers[u.email] ? "#22c55e" : "#6b7280";
      const nameSpan = document.createElement("span"); nameSpan.textContent = u.name;
      nameRow.appendChild(statusDot); nameRow.appendChild(nameSpan);
      const emailSpan = document.createElement("span"); emailSpan.className = "contact-email"; emailSpan.textContent = u.email;
      infoEl.appendChild(nameRow); infoEl.appendChild(emailSpan);
      const deleteBtn = document.createElement("button"); deleteBtn.textContent = "🗑";
      deleteBtn.style.cssText = "font-size:11px;padding:2px 6px;margin-left:4px;border-radius:999px;border:none;cursor:pointer;background:rgba(239,68,68,0.1);color:#f87171;flex-shrink:0;";
      deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteUser(u.email); });
      div.appendChild(avatarEl); div.appendChild(infoEl); div.appendChild(deleteBtn);
      div.addEventListener("click", () => openChat(u));
      contactsList.appendChild(div);
    });
    updateUnreadUI();
    rebuildConferenceContacts();
  } catch(err) { console.error("Errore loadUsers", err); }
}

function rebuildConferenceContacts() {
  if (!conferenceContacts) return;
  conferenceContacts.innerHTML = "";
  const contactNodes = Array.from(contactsList.querySelectorAll(".contact"));
  if (!contactNodes.length) {
    const empty = document.createElement("div"); empty.textContent = "Nessun utente.";
    empty.style.cssText = "font-size:12px;color:#9ca3af;padding:8px;"; conferenceContacts.appendChild(empty); return;
  }
  contactNodes.forEach((c) => {
    const email = c.dataset.email || "";
    const nameEl = c.querySelector(".contact-name span:last-child");
    const name = nameEl ? nameEl.textContent.trim() : email;
    const div = document.createElement("div");
    div.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:12px;";
    div.addEventListener("mouseenter", () => { div.style.backgroundColor = "rgba(15,23,42,0.9)"; });
    div.addEventListener("mouseleave", () => { div.style.backgroundColor = "transparent"; });
    const left = document.createElement("div"); left.style.cssText = "display:flex;align-items:center;";
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background-color:${onlineUsers[email] ? "#22c55e" : "#6b7280"};`;
    const label = document.createElement("span"); label.textContent = `${name} (${email})`; label.style.color = "#e5e7eb";
    left.appendChild(dot); left.appendChild(label);
    const inviteBtn = document.createElement("button"); inviteBtn.textContent = "Invita";
    inviteBtn.style.cssText = "font-size:11px;padding:2px 8px;border-radius:999px;border:none;cursor:pointer;background:rgba(56,189,248,0.1);color:#38bdf8;";
    inviteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isKmeetOn) { appendSystemMessage("Apri prima kMeet."); return; }
      socket.emit("kmeet-invite", { toEmail: email, roomUrl: KMEET_URL });
      appendSystemMessage(`Invito mandato a ${email}.`);
    });
    div.appendChild(left); div.appendChild(inviteBtn);
    conferenceContacts.appendChild(div);
  });
}

// =====================================================================
// ==== PRESENZA =======================================================
// =====================================================================

socket.on("user-online", (user) => { if (user && user.email) onlineUsers[user.email] = true; loadUsers(); });
socket.on("user-offline", (user) => { if (user && user.email) onlineUsers[user.email] = false; loadUsers(); });

// =====================================================================
// ==== MESSAGGI =======================================================
// =====================================================================

socket.on("chat-message", (msg) => {
  const div = document.createElement("div"); div.classList.add("msg");
  const isMe = currentUser && msg.from.email === currentUser.email;
  div.classList.add(isMe ? "from-me" : "from-other");
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  bubble.textContent = isMe ? `[CONF] TU: ${msg.text}` : `[CONF] ${msg.from.name}: ${msg.text}`;
  const timeEl = document.createElement("div"); timeEl.className = "msg-time"; timeEl.textContent = formatTime(msg.ts);
  div.appendChild(bubble); div.appendChild(timeEl);
  if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
});

socket.on("private-message", (msg) => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const peerEmail = isMe ? (selectedContactEmail || msg.to || "") : msg.from.email;
  const el = buildMessageElement(msg.from, msg.text, msg.ts, isMe);
  addMessageToContact(peerEmail, el);
  if (!isMe) {
    playSound("message");
    vibrate(100);
    incrementUnread(msg.from.email);
    showBrowserNotification(msg.from.name || msg.from.email, msg.text.length > 60 ? msg.text.substring(0, 60) + "..." : msg.text);
  }
});

socket.on("kmeet-invite", ({ from, roomUrl }) => {
  if (!from || !roomUrl) return;
  const ok = confirm(`${from.name} ti invita alla conferenza kMeet.\nVuoi entrare?`);
  if (ok) window.open(roomUrl, "_blank");
});

// =====================================================================
// ==== INVIO MESSAGGI =================================================
// =====================================================================

if (sendBtn) {
  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text || !currentUser) return;
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); input.value = ""; return; }
    sendTypingStop();
    if (socket.connected) {
      socket.emit("private-message", { toEmail: selectedContactEmail, text });
    } else {
      offlineQueue.push({ toEmail: selectedContactEmail, text });
      appendSystemMessage("Messaggio in coda (offline).");
    }
    input.value = "";
  });
}

if (input) { input.addEventListener("keypress", (e) => { if (e.key === "Enter") sendBtn.click(); }); }
if (emailInput) { emailInput.addEventListener("keypress", (e) => { if (e.key === "Enter") loginBtn && loginBtn.click(); }); }

// =====================================================================
// ==== ALLEGATI =======================================================
// =====================================================================

let attachMenu = null;

function createAttachMenu() {
  if (attachMenu) { closeAttachMenu(); return; }
  attachMenu = document.createElement("div");
  attachMenu.style.cssText = "position:absolute;bottom:60px;left:8px;background:rgba(2,6,23,0.97);border:1px solid rgba(37,99,235,0.4);border-radius:14px;padding:8px;display:flex;flex-direction:column;gap:4px;z-index:200;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,0.5);";
  const options = [
    { icon: "🖼", label: "Foto / Immagine", accept: "image/*" },
    { icon: "🎬", label: "Video", accept: "video/*" },
    { icon: "📄", label: "Documento", accept: "*/*" },
  ];
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;background:transparent;border:none;color:#e5e7eb;font-size:13px;border-radius:8px;cursor:pointer;text-align:left;";
    btn.innerHTML = `<span style="font-size:20px">${opt.icon}</span><span>${opt.label}</span>`;
    btn.addEventListener("mouseenter", () => btn.style.background = "rgba(37,99,235,0.15)");
    btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
    btn.addEventListener("click", () => { closeAttachMenu(); triggerFileUpload(opt.accept); });
    btn.addEventListener("touchend", (e) => { e.preventDefault(); closeAttachMenu(); triggerFileUpload(opt.accept); }, { passive: false });
    attachMenu.appendChild(btn);
  });
  const composer = document.getElementById("composer");
  if (composer) { composer.style.position = "relative"; composer.appendChild(attachMenu); }
  setTimeout(() => { document.addEventListener("click", closeAttachMenuOnOutside); }, 100);
}

function closeAttachMenuOnOutside(e) {
  if (attachMenu && !attachMenu.contains(e.target) && e.target !== attachBtn) closeAttachMenu();
}

function closeAttachMenu() {
  if (attachMenu) { attachMenu.remove(); attachMenu = null; }
  document.removeEventListener("click", closeAttachMenuOnOutside);
}

function triggerFileUpload(accept) {
  if (!currentUser) { appendSystemMessage("Fai login prima."); return; }
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  const tempInput = document.createElement("input");
  tempInput.type = "file";
  tempInput.accept = accept || "*/*";
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIOS) tempInput.multiple = true;
  tempInput.style.display = "none";
  document.body.appendChild(tempInput);
  tempInput.addEventListener("change", async () => {
    const files = Array.from(tempInput.files || []);
    document.body.removeChild(tempInput);
    for (const file of files) { await uploadFile(file); }
  });
  tempInput.click();
}

async function uploadFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { appendSystemMessage(`⚠️ File troppo grande: ${file.name} (max 50MB)`); return; }
  try {
    const isImage = file.type.startsWith("image/");
    showUploadProgress(`Invio ${file.name}...`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) updateUploadProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      hideUploadProgress();
      try {
        const data = JSON.parse(xhr.responseText);
        if (!data || !data.ok || !data.url) { appendSystemMessage(`Errore upload "${file.name}".`); return; }
        const msgText = isImage ? `🖼 immagine: ${file.name} (${data.url})` : `📎 allegato: ${file.name} (${data.url})`;
        if (socket.connected) {
          socket.emit("private-message", { toEmail: selectedContactEmail, text: msgText });
        } else {
          offlineQueue.push({ toEmail: selectedContactEmail, text: msgText });
        }
      } catch(e) { appendSystemMessage("Errore risposta server."); }
    };
    xhr.onerror = () => { hideUploadProgress(); appendSystemMessage(`Errore upload "${file.name}".`); };
    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  } catch(err) { hideUploadProgress(); appendSystemMessage(`Errore upload "${file.name}".`); }
}

if (attachBtn) {
  attachBtn.addEventListener("click", (e) => { e.stopPropagation(); createAttachMenu(); });
  attachBtn.addEventListener("touchend", (e) => { e.preventDefault(); e.stopPropagation(); createAttachMenu(); }, { passive: false });
}

if (fileInput) {
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    for (const file of files) { await uploadFile(file); }
    fileInput.value = "";
  });
}

// =====================================================================
// ==== LOG SISTEMA ====================================================
// =====================================================================

let callLogDiv = document.getElementById("call-log");
if (!callLogDiv) {
  callLogDiv = document.createElement("div");
  callLogDiv.id = "call-log";
  callLogDiv.style.cssText = "font-size:11px;color:#9ca3af;max-height:60px;overflow-y:auto;padding:2px 8px 0 8px;border-top:1px solid rgba(15,23,42,0.6);box-sizing:border-box;flex-shrink:0;";
  const composer = document.getElementById("composer");
  if (composer && composer.parentNode) composer.parentNode.insertBefore(callLogDiv, composer);
}

function appendSystemMessage(text) {
  const div = document.createElement("div"); div.textContent = text;
  if (callLogDiv) { callLogDiv.appendChild(div); callLogDiv.scrollTop = callLogDiv.scrollHeight; while (callLogDiv.children.length > 30) callLogDiv.removeChild(callLogDiv.firstChild); }
  else if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
}

// =====================================================================
// ==== UI CHIAMATA IN CORSO ===========================================
// =====================================================================

let callUI = null;

function showCallUI(name, mode) {
  if (callUI) callUI.remove();
  callUI = document.createElement("div");
  callUI.style.cssText = "position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#020617,#0f172a);border-bottom:1px solid rgba(37,99,235,0.5);padding:10px 16px;display:flex;align-items:center;gap:12px;z-index:500;";
  const icon = document.createElement("span"); icon.style.cssText = "font-size:20px;"; icon.textContent = mode === "video" ? "🎥" : "📞";
  const info = document.createElement("div"); info.style.cssText = "flex:1;";
  const nameEl = document.createElement("div"); nameEl.style.cssText = "font-size:13px;font-weight:600;color:#e5e7eb;"; nameEl.textContent = name;
  const timerEl = document.createElement("div"); timerEl.id = "call-timer"; timerEl.style.cssText = "font-size:11px;color:#22c55e;"; timerEl.textContent = "In connessione...";
  info.appendChild(nameEl); info.appendChild(timerEl);
  const hangupBtn = document.createElement("button");
  hangupBtn.style.cssText = "background:#ef4444;border:none;border-radius:999px;color:#fff;padding:6px 14px;font-size:13px;cursor:pointer;";
  hangupBtn.textContent = "🔴 Chiudi";
  hangupBtn.addEventListener("click", () => {
    if (currentCallPeerEmail) socket.emit("call-hangup", { toEmail: currentCallPeerEmail });
    endCall("Chiamata chiusa.");
  });
  hangupBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (currentCallPeerEmail) socket.emit("call-hangup", { toEmail: currentCallPeerEmail });
    endCall("Chiamata chiusa.");
  }, { passive: false });
  callUI.appendChild(icon); callUI.appendChild(info); callUI.appendChild(hangupBtn);
  document.body.appendChild(callUI);
}

function startCallTimer() {
  callStartTime = Date.now();
  if (callDurationInterval) clearInterval(callDurationInterval);
  callDurationInterval = setInterval(() => {
    const timerEl = document.getElementById("call-timer");
    if (!timerEl) return;
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 1000);
}

function hideCallUI() {
  if (callUI) { callUI.remove(); callUI = null; }
  if (callDurationInterval) { clearInterval(callDurationInterval); callDurationInterval = null; }
}

// =====================================================================
// ==== WEBRTC =========================================================
// =====================================================================

async function getLocalStreamAudioOnly() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(err) { appendSystemMessage("Impossibile accedere al microfono."); throw err; }
}

async function getLocalStreamAudioVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
    if (localVideoElement) { localVideoElement.srcObject = stream; localVideoElement.muted = true; }
    return stream;
  } catch(err) { appendSystemMessage("Impossibile accedere a microfono/camera."); throw err; }
}

async function startLocalAudio() { if (localStream) return localStream; localStream = await getLocalStreamAudioOnly(); return localStream; }
async function startLocalMediaWithVideo() { localStream = await getLocalStreamAudioVideo(); return localStream; }

function createPeerConnection() {
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (e) => {
    if (e.candidate && currentCallPeerEmail) {
      socket.emit("call-ice-candidate", { toEmail: currentCallPeerEmail, candidate: e.candidate });
    }
  };

  peerConnection.ontrack = (e) => {
    const remoteStream = e.streams[0];
    if (!remoteStream) return;
    // Audio remoto
    if (!remoteAudioElement) {
      remoteAudioElement = document.createElement("audio");
      remoteAudioElement.autoplay = true;
      remoteAudioElement.setAttribute("playsinline", "");
      remoteAudioElement.style.display = "none";
      document.body.appendChild(remoteAudioElement);
    }
    remoteAudioElement.srcObject = remoteStream;
    // Su iOS devi fare play() esplicitamente
    remoteAudioElement.play().catch(() => {});

    if (remoteVideoElement) {
      remoteVideoElement.srcObject = remoteStream;
      remoteVideoElement.setAttribute("playsinline", "");
      remoteVideoElement.muted = false;
      remoteVideoElement.play().catch(() => {});
    }
    startCallTimer();
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const state = peerConnection.connectionState;
    appendSystemMessage("WebRTC: " + state);
    if (state === "connected") {
      const timerEl = document.getElementById("call-timer");
      if (timerEl) timerEl.textContent = "0:00";
      if (callTimeoutTimer) { clearTimeout(callTimeoutTimer); callTimeoutTimer = null; }
    }
    if (state === "failed") {
      endCall("Connessione fallita. Riprova.");
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    const state = peerConnection.iceConnectionState;
    if (state === "disconnected") {
      // Aspetta 5s prima di dichiarare fallimento
      setTimeout(() => {
        if (peerConnection && peerConnection.iceConnectionState === "disconnected") {
          endCall("Connessione persa.");
        }
      }, 5000);
    }
  };

  return peerConnection;
}

// Aspetta ICE gathering — timeout 5s su mobile
function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const timeout = setTimeout(() => resolve(), 5000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); }
    });
  });
}

async function endCall(reason = "Chiamata terminata.") {
  stopRingtone();
  hideCallUI();
  if (callTimeoutTimer) { clearTimeout(callTimeoutTimer); callTimeoutTimer = null; }
  isAudioCallActive = false; isVideoCallActive = false; currentCallPeerEmail = null;
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch {} localStream = null; }
  if (remoteAudioElement) { try { remoteAudioElement.srcObject = null; remoteAudioElement.remove(); } catch {} remoteAudioElement = null; }
  if (localVideoElement) localVideoElement.srcObject = null;
  if (remoteVideoElement) remoteVideoElement.srcObject = null;
  if (videoArea) videoArea.style.display = "none";
  appendSystemMessage(reason);
}

async function startAudioCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  if (isAudioCallActive || isVideoCallActive) { appendSystemMessage("Chiamata già in corso."); return; }
  try {
    const stream = await startLocalAudio();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    stream.getTracks().forEach(t => peerConnection.addTrack(t, stream));
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "audio" });
    isAudioCallActive = true;
    startRingtone();
    const peerName = chatTitleText.textContent || currentCallPeerEmail;
    showCallUI(peerName, "audio");
    appendSystemMessage(`📞 Chiamata verso ${currentCallPeerEmail}...`);
    callTimeoutTimer = setTimeout(() => {
      if (isAudioCallActive && peerConnection && peerConnection.connectionState !== "connected") {
        socket.emit("call-hangup", { toEmail: currentCallPeerEmail });
        endCall("⏱ Nessuna risposta.");
      }
    }, 30000);
  } catch(err) { await endCall("Chiamata interrotta: " + err.message); }
}

async function startVideoCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  if (isVideoCallActive || isAudioCallActive) { appendSystemMessage("Chiamata già in corso."); return; }
  try {
    const stream = await startLocalMediaWithVideo();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    stream.getTracks().forEach(t => peerConnection.addTrack(t, stream));
    if (videoArea) videoArea.style.display = "block";
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "video" });
    isVideoCallActive = true;
    startRingtone();
    const peerName = chatTitleText.textContent || currentCallPeerEmail;
    showCallUI(peerName, "video");
    appendSystemMessage(`🎥 Videochiamata verso ${currentCallPeerEmail}...`);
    callTimeoutTimer = setTimeout(() => {
      if (isVideoCallActive && peerConnection && peerConnection.connectionState !== "connected") {
        socket.emit("call-hangup", { toEmail: currentCallPeerEmail });
        endCall("⏱ Nessuna risposta.");
      }
    }, 30000);
  } catch(err) { await endCall("Videochiamata interrotta: " + err.message); }
}

if (audioCallBtn) {
  audioCallBtn.addEventListener("click", () => {
    if (!isAudioCallActive && !isVideoCallActive) startAudioCall();
    else if (currentCallPeerEmail) { socket.emit("call-hangup", { toEmail: currentCallPeerEmail }); endCall("Chiamata chiusa."); }
  });
}

if (videoCallBtn) {
  videoCallBtn.addEventListener("click", () => {
    if (!isVideoCallActive && !isAudioCallActive) startVideoCall();
    else if (currentCallPeerEmail) { socket.emit("call-hangup", { toEmail: currentCallPeerEmail }); endCall("Chiamata chiusa."); }
  });
}

// =====================================================================
// ==== RICEZIONE CHIAMATA =============================================
// =====================================================================

socket.on("call-offer", async ({ from, offer, mode }) => {
  if (!from || !from.email || !offer) return;
  if (isAudioCallActive || isVideoCallActive) { socket.emit("call-reject", { toEmail: from.email }); return; }
  currentCallPeerEmail = from.email;
  const isVideo = mode === "video";
  unlockAudioContext();
  startRingtone();
  const accept = confirm(`📞 Chiamata ${isVideo ? "🎥 VIDEO" : "AUDIO"} da ${from.name}!\n\nOK = Rispondi   Annulla = Rifiuta`);
  stopRingtone();
  if (!accept) { socket.emit("call-reject", { toEmail: from.email }); currentCallPeerEmail = null; return; }
  try {
    const stream = isVideo ? await startLocalMediaWithVideo() : await startLocalAudio();
    createPeerConnection();
    stream.getTracks().forEach(t => peerConnection.addTrack(t, stream));
    if (isVideo && videoArea) videoArea.style.display = "block";
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-answer", { toEmail: from.email, answer: peerConnection.localDescription, mode });
    isAudioCallActive = !isVideo; isVideoCallActive = isVideo;
    selectedContactEmail = from.email;
    showCallUI(from.name || from.email, mode);
    appendSystemMessage(`✅ ${isVideo ? "Videochiamata" : "Chiamata"} con ${from.email} attiva.`);
  } catch(err) { await endCall("Chiamata interrotta: " + err.message); }
});

socket.on("call-answer", async ({ from, answer }) => {
  stopRingtone();
  if (callTimeoutTimer) { clearTimeout(callTimeoutTimer); callTimeoutTimer = null; }
  try {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    appendSystemMessage(`✅ ${from?.email} ha risposto.`);
  } catch(err) { appendSystemMessage("Errore risposta chiamata: " + err.message); }
});

socket.on("call-ice-candidate", async ({ candidate }) => {
  try {
    if (peerConnection && candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch(err) {}
});

socket.on("call-hangup", async ({ from }) => { await endCall(`📵 Chiamata terminata da ${from?.email || "remoto"}.`); });
socket.on("call-reject", ({ from }) => {
  stopRingtone();
  if (callTimeoutTimer) { clearTimeout(callTimeoutTimer); callTimeoutTimer = null; }
  endCall(`❌ Rifiutata da ${from?.email || "remoto"}.`);
});

// =====================================================================
// ==== VOCALI RICEZIONE ===============================================
// =====================================================================

socket.on("voice-message", (msg) => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const div = document.createElement("div");
  div.classList.add("msg", isMe ? "from-me" : "from-other");
  if (!isMe) {
    const s = document.createElement("div"); s.className = "msg-sender"; s.textContent = msg.from.name;
    div.appendChild(s);
  }
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  bubble.style.cssText = "min-width:200px;max-width:280px;";
  const audioRow = document.createElement("div");
  audioRow.style.cssText = "display:flex;align-items:center;gap:8px;";
  const playBtn = document.createElement("button");
  playBtn.style.cssText = "width:40px;height:40px;border-radius:50%;background:#2563eb;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;";
  playBtn.textContent = "▶";
  const audioEl = document.createElement("audio");
  audioEl.src = msg.audio;
  audioEl.preload = "metadata";
  audioEl.setAttribute("playsinline", "");
  const waveDiv = document.createElement("div");
  waveDiv.style.cssText = "flex:1;height:28px;display:flex;align-items:center;gap:2px;";
  for (let i = 0; i < 20; i++) {
    const bar = document.createElement("div");
    const h = 4 + Math.random() * 20;
    bar.style.cssText = `width:3px;height:${h}px;background:rgba(148,163,184,0.5);border-radius:2px;flex-shrink:0;`;
    waveDiv.appendChild(bar);
  }
  const durationSpan = document.createElement("span");
  durationSpan.style.cssText = "font-size:11px;color:#9ca3af;white-space:nowrap;min-width:32px;";
  durationSpan.textContent = "0:00";
  audioEl.addEventListener("loadedmetadata", () => {
    if (audioEl.duration && isFinite(audioEl.duration)) {
      const m = Math.floor(audioEl.duration / 60);
      const s = Math.floor(audioEl.duration % 60);
      durationSpan.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    }
  });
  audioEl.addEventListener("timeupdate", () => {
    if (audioEl.duration && isFinite(audioEl.duration)) {
      const m = Math.floor(audioEl.currentTime / 60);
      const s = Math.floor(audioEl.currentTime % 60);
      durationSpan.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    }
  });
  audioEl.addEventListener("ended", () => { playBtn.textContent = "▶"; });
  playBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    unlockAudioContext();
    if (audioEl.paused) { playAudioSafe(audioEl); playBtn.textContent = "⏸"; }
    else { audioEl.pause(); playBtn.textContent = "▶"; }
  }, { passive: false });
  playBtn.addEventListener("click", () => {
    unlockAudioContext();
    if (audioEl.paused) { playAudioSafe(audioEl); playBtn.textContent = "⏸"; }
    else { audioEl.pause(); playBtn.textContent = "▶"; }
  });
  audioRow.appendChild(playBtn); audioRow.appendChild(waveDiv); audioRow.appendChild(durationSpan);
  bubble.appendChild(audioRow);
  div.appendChild(bubble);
  const timeEl = document.createElement("div"); timeEl.className = "msg-time"; timeEl.textContent = formatTime(msg.ts || Date.now());
  div.appendChild(timeEl);
  const peerEmail = isMe ? selectedContactEmail : msg.from.email;
  if (peerEmail) addMessageToContact(peerEmail, div);
  if (!isMe) { playSound("message"); vibrate(100); incrementUnread(msg.from.email); }
});

// =====================================================================
// ==== PWA BANNER =====================================================
// =====================================================================

let deferredInstallPrompt = null;
let installBanner = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

function checkPWAInstallBanner() {
  if (window.matchMedia("(display-mode: standalone)").matches) return;
  if (window.navigator.standalone === true) return;
  try {
    const lastShown = localStorage.getItem("zeus-banner-dismissed");
    if (lastShown && Date.now() - parseInt(lastShown) < 7 * 24 * 60 * 60 * 1000) return;
  } catch(e) {}
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) setTimeout(() => showIOSInstallBanner(), 3000);
}

function showInstallBanner() {
  if (installBanner) return;
  try {
    const lastShown = localStorage.getItem("zeus-banner-dismissed");
    if (lastShown && Date.now() - parseInt(lastShown) < 7 * 24 * 60 * 60 * 1000) return;
  } catch(e) {}
  installBanner = document.createElement("div");
  installBanner.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#020617,#0f172a);border-top:1px solid rgba(37,99,235,0.5);padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:1000;box-shadow:0 -4px 20px rgba(0,0,0,0.5);";
  installBanner.innerHTML = `<span style="font-size:28px">⚡</span><div style="flex:1"><div style="font-size:13px;font-weight:600;color:#e5e7eb">Installa ZEUS Chat</div><div style="font-size:11px;color:#9ca3af">Accesso rapido, funziona offline</div></div><button id="install-yes" style="background:#2563eb;border:none;border-radius:999px;color:#fff;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;">Installa</button><button id="install-no" style="background:transparent;border:1px solid rgba(148,163,184,0.3);border-radius:999px;color:#9ca3af;padding:7px 12px;font-size:13px;cursor:pointer;">✕</button>`;
  document.body.appendChild(installBanner);
  document.getElementById("install-yes").addEventListener("click", async () => {
    if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt = null; }
    dismissInstallBanner();
  });
  document.getElementById("install-no").addEventListener("click", () => dismissInstallBanner());
}

function showIOSInstallBanner() {
  if (installBanner) return;
  installBanner = document.createElement("div");
  installBanner.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#020617,#0f172a);border-top:1px solid rgba(37,99,235,0.5);padding:12px 16px;z-index:1000;box-shadow:0 -4px 20px rgba(0,0,0,0.5);";
  installBanner.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="font-size:24px">⚡</span><div style="flex:1;font-size:13px;font-weight:600;color:#e5e7eb">Installa ZEUS su iPhone</div><button id="install-no" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 4px;">✕</button></div><div style="font-size:12px;color:#9ca3af;display:flex;align-items:center;gap:6px;"><span>Tocca</span><span style="font-size:18px">⬆️</span><span>poi <strong style="color:#e5e7eb">"Aggiungi a schermata Home"</strong></span></div>`;
  document.body.appendChild(installBanner);
  document.getElementById("install-no").addEventListener("click", () => dismissInstallBanner());
}

function dismissInstallBanner() {
  if (installBanner) { installBanner.remove(); installBanner = null; }
  try { localStorage.setItem("zeus-banner-dismissed", Date.now().toString()); } catch(e) {}
}

// =====================================================================
// ==== BOOTSTRAP ======================================================
// =====================================================================

window.initZeusApp = function(user) {
  currentUser = user || null;
  if (!currentUser || !currentUser.email) { appendSystemMessage("Utente non valido."); return; }
  saveSession(currentUser);
  showApp();
  socket.emit("set-user", currentUser);
  loadUsers();
  requestNotificationPermission();
};

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const name = (nameInput && nameInput.value || "").trim();
    const email = (emailInput && emailInput.value || "").trim();
    if (!name || !email) { if (errorDiv) errorDiv.textContent = "Inserisci nome ed email."; return; }
    try {
      if (errorDiv) errorDiv.textContent = "";
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok || !data.user) { if (errorDiv) errorDiv.textContent = (data && data.error) || "Login fallito."; return; }
      window.initZeusApp(data.user);
    } catch(err) { if (errorDiv) errorDiv.textContent = "Errore di connessione."; }
  });
}

showLogin();