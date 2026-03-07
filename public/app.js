// =====================================================================
// ZEUS Chat — app.js
// =====================================================================

// ---- CONNESSIONE SOCKET con riconnessione automatica ----
const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// ---- HEARTBEAT: mantiene connessione viva senza refresh ----
setInterval(() => {
  if (socket.connected) socket.emit("ping-client");
}, 20000);

socket.on("pong-server", () => {});

socket.on("reconnect", () => {
  console.log("Riconnesso al server");
  if (currentUser) {
    socket.emit("set-user", currentUser);
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

document.addEventListener('touchstart', unlockAudioContext, { once: false });
document.addEventListener('click', unlockAudioContext, { once: false });
document.addEventListener('touchend', unlockAudioContext, { once: false });

let currentUser = null;
let selectedContactEmail = null;
let onlineUsers = {};

// ---- CONFERENZA ----
let conferenceMode = false;
let conferenceIframe = null;
let isKmeetOn = false;
const KMEET_URL = "https://kmeet.infomaniak.com/tiknhcsuxmdxxnpd";

// ---- AUDIO / VOCALI ----
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let supportedAudioMimeType = null;

// ---- VIDEO MESSAGGI ----
let videoRecorder = null;
let videoChunks = [];
let isVideoRecording = false;
let videoPreviewStream = null;
const MAX_VIDEO_SECONDS = 30;
let videoRecordTimeout = null;
let supportedVideoMimeType = null;

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

// ---- SUONERIA ----
let ringtoneInterval = null;
let ringtoneOscRunning = false;

// ---- TYPING ----
let typingTimeout = null;
let isTyping = false;
let typingHideTimeout = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ],
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
// ==== SUONERIA UNIVERSALE ============================================
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
// ==== SUONO MESSAGGIO ================================================
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
    }
  } catch(e) {}
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
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
  loadMessageHistory(user.email);
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
  if (videoMatch) {
    bubble.textContent = "🎦 video-messaggio";
    const videoBubble = document.createElement("div");
    videoBubble.className = "video-bubble";
    const videoEl = document.createElement("video");
    videoEl.controls = true; videoEl.playsInline = true;
    videoEl.setAttribute("playsinline", ""); videoEl.setAttribute("webkit-playsinline", "");
    videoEl.preload = "metadata"; videoEl.style.cssText = "width:100%;height:100%;object-fit:cover;";
    const urlWebm = videoMatch[2];
    const urlMp4 = urlWebm.replace(".webm", ".mp4");
    const src1 = document.createElement("source"); src1.src = urlMp4; src1.type = "video/mp4";
    const src2 = document.createElement("source"); src2.src = urlWebm; src2.type = "video/webm";
    videoEl.appendChild(src1); videoEl.appendChild(src2);
    const fallback = document.createElement("a");
    fallback.href = videoMatch[2]; fallback.textContent = "▶ Apri video"; fallback.target = "_blank";
    fallback.style.cssText = "color:#38bdf8;font-size:12px;display:block;margin-top:4px;";
    videoEl.appendChild(fallback);
    videoBubble.appendChild(videoEl);
    wrapper.appendChild(bubble); wrapper.appendChild(videoBubble);
  } else if (attachMatch) {
    const link = document.createElement("a");
    link.href = attachMatch[2]; link.textContent = "📎 " + attachMatch[1]; link.target = "_blank";
    link.style.cssText = "color:#38bdf8;text-decoration:underline;";
    bubble.appendChild(link); wrapper.appendChild(bubble);
  } else {
    bubble.textContent = text; wrapper.appendChild(bubble);
  }
  const timeEl = document.createElement("div");
  timeEl.className = "msg-time"; timeEl.textContent = formatTime(ts);
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

if (input) { input.addEventListener("input", () => sendTypingStart()); input.addEventListener("blur", () => sendTypingStop()); }

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
// ==== MICROFONO ======================================================
// =====================================================================

const micBtn = document.createElement("button");
micBtn.id = "mic-btn";
micBtn.textContent = "🎤";
micBtn.title = "Tieni premuto per vocale";
micBtn.style.cssText = "margin-left:4px;padding:4px 8px;cursor:pointer;background:transparent;border:none;font-size:18px;";

window.addEventListener("DOMContentLoaded", () => {
  const inputBar = document.getElementById("input-bar");
  if (inputBar) inputBar.appendChild(micBtn);
  initAudioMimeType();
  initVideoMimeType();
});

function initAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg","audio/mp4","audio/aac",""];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) { supportedAudioMimeType = type || null; return; }
  }
}

function initVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = ["video/mp4;codecs=h264,aac","video/mp4;codecs=avc1","video/mp4","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm",""];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) { supportedVideoMimeType = type || null; return; }
  }
}

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

async function startVideoMessageRecording() {
  if (isVideoRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { appendSystemMessage("Camera non supportata."); return; }
  if (!currentUser || !selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 480, max: 640 }, height: { ideal: 480, max: 640 }, facingMode: "user", frameRate: { ideal: 15, max: 30 } },
      audio: true
    });
    videoPreviewStream = stream; videoChunks = [];
    if (videoArea) videoArea.style.display = "block";
    if (localVideoElement) { localVideoElement.srcObject = stream; localVideoElement.muted = true; }
    let recorderOptions = supportedVideoMimeType ? { mimeType: supportedVideoMimeType } : {};
    try { videoRecorder = new MediaRecorder(stream, recorderOptions); }
    catch(e) { try { videoRecorder = new MediaRecorder(stream); } catch(e2) { appendSystemMessage("Registrazione video non supportata."); stream.getTracks().forEach(t => t.stop()); return; } }
    videoRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
    videoRecorder.onstop = async () => {
      isVideoRecording = false; setVideoNoteButtonState(false);
      if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t => t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
      if (videoChunks.length > 0) {
        try {
          const mimeType = videoRecorder.mimeType || supportedVideoMimeType || "video/webm";
          const blob = new Blob(videoChunks, { type: mimeType }); videoChunks = [];
          await sendVideoMessage(blob, mimeType);
        } catch(err) { appendSystemMessage("Errore elaborazione video."); }
      } else { appendSystemMessage("Nessun dato video."); videoChunks = []; }
    };
    videoRecorder.onerror = () => {
      isVideoRecording = false; setVideoNoteButtonState(false);
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t => t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
    };
    isVideoRecording = true; setVideoNoteButtonState(true);
    videoRecorder.start(500);
    appendSystemMessage("● Registrazione avviata (max " + MAX_VIDEO_SECONDS + "s). Premi ⏹ per fermare.");
    videoRecordTimeout = setTimeout(() => {
      if (isVideoRecording && videoRecorder && videoRecorder.state === "recording") { appendSystemMessage("Tempo massimo."); videoRecorder.stop(); }
    }, MAX_VIDEO_SECONDS * 1000);
  } catch(err) {
    isVideoRecording = false; setVideoNoteButtonState(false);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      appendSystemMessage("⚠️ Permesso camera negato. Vai in Impostazioni > Safari/Chrome > abilita Camera e Microfono per questo sito.");
    } else { appendSystemMessage("Errore camera: " + err.message); }
  }
}

function stopVideoMessageRecording() {
  if (!isVideoRecording || !videoRecorder) return;
  setVideoNoteButtonState(false);
  if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
  try { if (videoRecorder.state === "recording" || videoRecorder.state === "paused") videoRecorder.stop(); }
  catch(e) {
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
    const formData = new FormData();
    formData.append("file", blob, fileName);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok || !data.url) { appendSystemMessage("Errore upload video."); return; }
    socket.emit("private-message", { toEmail: selectedContactEmail, text: `🎦 video: ${fileName} (${data.url})` });
    appendSystemMessage("✓ Video inviato.");
  } catch(err) { appendSystemMessage("Errore upload video."); }
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
      if (u.avatar) { const img = document.createElement("img"); img.src = u.avatar; img.alt = u.name; img.className = "contact-avatar"; avatarEl.appendChild(img); }
      else { avatarEl.className = "contact-avatar-placeholder"; avatarEl.textContent = (u.name || "?")[0].toUpperCase(); }
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
  const peerEmail = isMe ? (selectedContactEmail || "") : msg.from.email;
  const el = buildMessageElement(msg.from, msg.text, msg.ts, isMe);
  addMessageToContact(peerEmail, el);
  if (!isMe) { playSound("message"); vibrate(100); }
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
    socket.emit("private-message", { toEmail: selectedContactEmail, text });
    input.value = "";
  });
}

if (input) { input.addEventListener("keypress", (e) => { if (e.key === "Enter") sendBtn.click(); }); }

// =====================================================================
// ==== ALLEGATI =======================================================
// =====================================================================

if (attachBtn && fileInput) {
  attachBtn.addEventListener("click", () => {
    if (!currentUser) { appendSystemMessage("Fai login prima."); return; }
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
    fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    for (const file of files) {
      try {
        const formData = new FormData(); formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (!data || !data.ok || !data.url) { appendSystemMessage(`Errore upload "${file.name}".`); continue; }
        socket.emit("private-message", { toEmail: selectedContactEmail, text: `📎 allegato: ${file.name} (${data.url})` });
      } catch(err) { appendSystemMessage(`Errore upload "${file.name}".`); }
    }
    fileInput.value = "";
  });
}

// =====================================================================
// ==== WAV ENCODER ====================================================
// =====================================================================

function encodeWAVFromFloat32(float32Array, sampleRate = 44100) {
  const numChannels = 1, numSamples = float32Array.length, bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample, byteRate = sampleRate * blockAlign, dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize), view = new DataView(buffer);
  function writeString(v, offset, string) { for (let i = 0; i < string.length; i++) v.setUint8(offset + i, string.charCodeAt(i)); }
  let offset = 0;
  writeString(view, offset, "RIFF"); offset += 4; view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString(view, offset, "WAVE"); offset += 4; writeString(view, offset, "fmt "); offset += 4;
  view.setUint32(offset, 16, true); offset += 4; view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numChannels, true); offset += 2; view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4; view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2; writeString(view, offset, "data"); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff; view.setInt16(offset, s, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// =====================================================================
// ==== MESSAGGI VOCALI ================================================
// =====================================================================

async function startRecording() {
  if (isRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { appendSystemMessage("Microfono non supportato."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try { mediaRecorder = supportedAudioMimeType ? new MediaRecorder(stream, { mimeType: supportedAudioMimeType }) : new MediaRecorder(stream); }
    catch(e) { mediaRecorder = new MediaRecorder(stream); }
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      if (!audioChunks.length) { appendSystemMessage("Nessun audio."); return; }
      try {
        const blob = new Blob(audioChunks, { type: supportedAudioMimeType || "audio/webm" });
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          sendVoiceMessage(encodeWAVFromFloat32(audioBuffer.getChannelData(0), audioBuffer.sampleRate || 44100));
        } catch(decodeErr) { sendVoiceMessage(blob); }
      } catch(err) { appendSystemMessage("Errore audio."); }
      audioChunks = []; stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start(); isRecording = true; micBtn.textContent = "⏺️";
  } catch(err) { alert("Impossibile accedere al microfono."); }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop(); isRecording = false; micBtn.textContent = "🎤";
}

function sendVoiceMessage(blob) {
  if (!currentUser) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
    socket.emit("voice-message", { mode: "private", toEmail: selectedContactEmail, audio: reader.result });
  };
  reader.readAsDataURL(blob);
}

micBtn.addEventListener("mousedown", () => startRecording());
micBtn.addEventListener("mouseup", () => stopRecording());
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); });

socket.on("voice-message", (msg) => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const div = document.createElement("div"); div.classList.add("msg", isMe ? "from-me" : "from-other");
  if (!isMe) { const s = document.createElement("div"); s.className = "msg-sender"; s.textContent = msg.from.name; div.appendChild(s); }
  const bubble = document.createElement("div"); bubble.className = "msg-bubble"; bubble.textContent = "🎤 messaggio vocale";
  div.appendChild(bubble);
  const audio = document.createElement("audio"); audio.controls = true; audio.src = msg.audio;
  audio.style.cssText = "margin-top:4px;max-width:100%;"; audio.setAttribute("playsinline", ""); audio.preload = "metadata";
  div.appendChild(audio);
  const timeEl = document.createElement("div"); timeEl.className = "msg-time"; timeEl.textContent = formatTime(msg.ts || Date.now());
  div.appendChild(timeEl);
  const peerEmail = isMe ? selectedContactEmail : msg.from.email;
  if (peerEmail) addMessageToContact(peerEmail, div);
  if (!isMe) { playSound("message"); vibrate(100); }
});

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
// ==== WEBRTC =========================================================
// =====================================================================

async function getLocalStreamAudioOnly() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(err) { appendSystemMessage("Impossibile accedere al microfono."); throw err; }
}

async function getLocalStreamAudioVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    if (localVideoElement) localVideoElement.srcObject = stream;
    return stream;
  } catch(err) { appendSystemMessage("Impossibile accedere a microfono/camera."); throw err; }
}

async function startLocalAudio() { if (localStream) return localStream; localStream = await getLocalStreamAudioOnly(); return localStream; }
async function startLocalMediaWithVideo() { localStream = await getLocalStreamAudioVideo(); return localStream; }

function createPeerConnection() {
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = (e) => { if (e.candidate && currentCallPeerEmail) socket.emit("call-ice-candidate", { toEmail: currentCallPeerEmail, candidate: e.candidate }); };
  peerConnection.ontrack = (e) => {
    const remoteStream = e.streams[0];
    if (!remoteAudioElement) {
      remoteAudioElement = document.createElement("audio");
      remoteAudioElement.autoplay = true; remoteAudioElement.setAttribute("playsinline", ""); remoteAudioElement.style.display = "none";
      document.body.appendChild(remoteAudioElement);
    }
    remoteAudioElement.srcObject = remoteStream;
    if (remoteVideoElement) remoteVideoElement.srcObject = remoteStream;
  };
  peerConnection.onconnectionstatechange = () => { appendSystemMessage("WebRTC: " + peerConnection.connectionState); };
  return peerConnection;
}

async function endCall(reason = "Chiamata terminata.") {
  stopRingtone();
  isAudioCallActive = false; isVideoCallActive = false; currentCallPeerEmail = null;
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch {} localStream = null; }
  if (remoteAudioElement) { remoteAudioElement.srcObject = null; remoteAudioElement = null; }
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
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "audio" });
    isAudioCallActive = true;
    startRingtone();
    appendSystemMessage(`📞 Chiamata verso ${currentCallPeerEmail}...`);
  } catch(err) { await endCall("Chiamata interrotta."); }
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
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "video" });
    isVideoCallActive = true;
    startRingtone();
    appendSystemMessage(`🎥 Videochiamata verso ${currentCallPeerEmail}...`);
  } catch(err) { await endCall("Videochiamata interrotta."); }
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
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("call-answer", { toEmail: from.email, answer: peerConnection.localDescription, mode });
    isAudioCallActive = !isVideo; isVideoCallActive = isVideo;
    selectedContactEmail = from.email;
    appendSystemMessage(`✅ ${isVideo ? "Videochiamata" : "Chiamata"} con ${from.email} attiva.`);
  } catch(err) { await endCall("Chiamata interrotta per errore."); }
});

socket.on("call-answer", async ({ from, answer, mode }) => {
  stopRingtone();
  try { if (!peerConnection) return; await peerConnection.setRemoteDescription(answer); appendSystemMessage(`✅ ${from?.email} ha risposto.`); }
  catch(err) { appendSystemMessage("Errore risposta chiamata."); }
});

socket.on("call-ice-candidate", async ({ candidate }) => { try { if (peerConnection) await peerConnection.addIceCandidate(candidate); } catch(err) {} });
socket.on("call-hangup", async ({ from }) => { await endCall(`📵 Chiamata terminata da ${from?.email || "remoto"}.`); });
socket.on("call-reject", ({ from }) => { stopRingtone(); endCall(`❌ Rifiutata da ${from?.email || "remoto"}.`); });

// =====================================================================
// ==== BOOTSTRAP ======================================================
// =====================================================================

window.initZeusApp = function(user) {
  currentUser = user || null;
  if (!currentUser || !currentUser.email) { appendSystemMessage("Utente non valido."); return; }
  showApp();
  socket.emit("set-user", currentUser);
  loadUsers();
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