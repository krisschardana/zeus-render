const socket = io();

// ---- SBLOCCO AUDIOCONTEXT iOS ----
let audioCtxUnlocked = false;
function unlockAudioContext() {
  if (audioCtxUnlocked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().then(() => { audioCtxUnlocked = true; });
  } catch(e) {}
}
document.addEventListener('touchstart', unlockAudioContext, { once: true });
document.addEventListener('click', unlockAudioContext, { once: true });
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
let ringtoneAudio = null;

// ---- TYPING ----
let typingTimeout = null;
let isTyping = false;
let typingHideTimeout = null;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ---- DOM ----
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
// ==== SUONI ==========================================================
// =====================================================================

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
  } catch (e) {}
}

// ---- SQUILLO PERSISTENTE ----
let callingRingtoneInterval = null;
let ringtoneOscActive = false;

function startCallingRingtone() {
  stopCallingRingtone();
  ringtoneOscActive = true;
  _playCallBeep();
  callingRingtoneInterval = setInterval(() => {
    if (ringtoneOscActive) _playCallBeep();
  }, 2200);
}

function stopCallingRingtone() {
  ringtoneOscActive = false;
  if (callingRingtoneInterval) {
    clearInterval(callingRingtoneInterval);
    callingRingtoneInterval = null;
  }
}

function _playCallBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Melodia ZEUS - epica e tecnologica
    // Note: E5, G5, B5, E6, B5, G5, E5 con ritmo deciso
    const notes = [
      { freq: 659.25, start: 0.0,  dur: 0.12 }, // E5
      { freq: 783.99, start: 0.13, dur: 0.12 }, // G5
      { freq: 987.77, start: 0.26, dur: 0.18 }, // B5
      { freq: 1318.5, start: 0.45, dur: 0.25 }, // E6 - nota alta potente
      { freq: 987.77, start: 0.72, dur: 0.12 }, // B5
      { freq: 783.99, start: 0.85, dur: 0.12 }, // G5
      { freq: 659.25, start: 0.98, dur: 0.30 }, // E5 - finale
    ];
    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Aggiungi un po di distorsione per suono sintetizzatore
      osc.type = "square";
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.01);
      gain.gain.setValueAtTime(0.35, ctx.currentTime + start + dur - 0.02);
      gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch (e) {}
}

// vibrazione su mobile
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// =====================================================================
// ==== NAVIGAZIONE MOBILE STILE TELEGRAM ==============================
// =====================================================================

function openChat(user) {
  selectedContactEmail = user.email;
  chatTitleText.textContent = user.name;

  if (user.avatar) {
    chatHeaderAvatar.src = user.avatar;
    chatHeaderAvatar.style.display = "block";
  } else {
    chatHeaderAvatar.style.display = "none";
  }

  if (chatPlaceholder) chatPlaceholder.style.display = "none";
  if (chatPanel) chatPanel.style.display = "flex";

  document.querySelectorAll(".contact").forEach((c) => {
    c.classList.remove("selected");
    if (c.dataset.email === user.email) c.classList.add("selected");
  });

  // Mobile: nascondi sidebar, mostra chat
  if (window.innerWidth <= 640) {
    if (contactsEl) contactsEl.classList.add("hidden-mobile");
    if (chatAreaEl) chatAreaEl.classList.add("visible-mobile");
  }

  // Carica storico messaggi dal server
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

  // Mobile: mostra sidebar, nascondi chat
  if (contactsEl) contactsEl.classList.remove("hidden-mobile");
  if (chatAreaEl) chatAreaEl.classList.remove("visible-mobile");
}

if (chatBackBtn) {
  chatBackBtn.addEventListener("click", () => closeChat());
}

// Gestione resize: se si allarga lo schermo ripristina layout desktop
window.addEventListener("resize", () => {
  if (window.innerWidth > 640) {
    if (contactsEl) contactsEl.classList.remove("hidden-mobile");
    if (chatAreaEl) chatAreaEl.classList.remove("visible-mobile");
  }
});

// =====================================================================
// ==== STORICO MESSAGGI (locale + server) =============================
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
  const date = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  return `${date} ${time}`;
}

function buildMessageElement(fromUser, text, ts, isMe) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("msg");
  wrapper.classList.add(isMe ? "from-me" : "from-other");

  if (!isMe) {
    const senderEl = document.createElement("div");
    senderEl.className = "msg-sender";
    senderEl.textContent = fromUser.name || fromUser.email || "";
    wrapper.appendChild(senderEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // Controlla se è allegato, video, o testo normale
  const attachMatch = text.match(/📎 allegato:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const videoMatch = text.match(/🎦 video:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);

  if (videoMatch) {
    bubble.textContent = "🎦 video-messaggio";
    const videoBubble = document.createElement("div");
    videoBubble.className = "video-bubble";
    const videoEl = document.createElement("video");
    videoEl.controls = true;
    videoEl.playsInline = true;
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("webkit-playsinline", "");
    videoEl.preload = "metadata";
    // Source multipli per compatibilità universale
    const src1 = document.createElement("source");
    src1.src = videoMatch[2];
    src1.type = videoMatch[2].endsWith(".mp4") ? "video/mp4" : "video/webm";
    videoEl.appendChild(src1);
    // fallback link download
    const fallback = document.createElement("a");
    fallback.href = videoMatch[2];
    fallback.textContent = "▶ Apri video";
    fallback.target = "_blank";
    fallback.style.cssText = "color:#38bdf8;font-size:12px;";
    videoEl.appendChild(fallback);
    videoBubble.appendChild(videoEl);
    wrapper.appendChild(bubble);
    wrapper.appendChild(videoBubble);
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
  } catch (err) {
    console.error("Errore caricamento storico:", err);
  }
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
  if (avatarSrc) {
    profileAvatarPreview.innerHTML = `<img src="${avatarSrc}" alt="Avatar" />`;
  } else {
    profileAvatarPreview.innerHTML = "👤";
  }
}

if (profileBtn) profileBtn.addEventListener("click", openProfileModal);
if (profileCancelBtn) profileCancelBtn.addEventListener("click", closeProfileModal);

if (profileModalOverlay) {
  profileModalOverlay.addEventListener("click", (e) => {
    if (e.target === profileModalOverlay) closeProfileModal();
  });
}

if (profileAvatarUploadBtn && profileAvatarInput) {
  profileAvatarUploadBtn.addEventListener("click", () => profileAvatarInput.click());
  profileAvatarInput.addEventListener("change", () => {
    const file = profileAvatarInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingAvatarBase64 = e.target.result;
      updateProfileAvatarPreview(pendingAvatarBase64);
    };
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
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentUser.email, name, phone, address, avatar }),
      });
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) {
        appendSystemMessage("Errore salvataggio profilo: " + (data && data.error ? data.error : "server error"));
        return;
      }
      currentUser = { ...currentUser, name, phone, address, avatar };
      appendSystemMessage("Profilo aggiornato con successo!");
      closeProfileModal();
      loadUsers();
    } catch (err) {
      appendSystemMessage("Errore di connessione durante il salvataggio del profilo.");
    }
  });
}

// =====================================================================
// ==== TYPING INDICATOR ===============================================
// =====================================================================

function sendTypingStart() {
  if (!currentUser || !selectedContactEmail) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit("typing-start", { toEmail: selectedContactEmail });
  }
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTypingStop();
  }, 3000);
}

function sendTypingStop() {
  if (!isTyping) return;
  isTyping = false;
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
  if (currentUser && selectedContactEmail) {
    socket.emit("typing-stop", { toEmail: selectedContactEmail });
  }
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
    typingHideTimeout = setTimeout(() => {
      if (typingIndicator) typingIndicator.textContent = "";
    }, 5000);
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
// ==== CONFERENZA (kMeet) =============================================
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
  conferenceContacts.id = "conference-contacts";
  conferenceContacts.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";

  leftCol.appendChild(leftHeader);
  leftCol.appendChild(conferenceContacts);

  const rightCol = document.createElement("div");
  rightCol.style.cssText = "flex:1;display:flex;flex-direction:column;background-color:#020617;";

  const topBar = document.createElement("div");
  topBar.style.cssText = "display:flex;align-items:center;padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);background-color:#020617;gap:8px;";

  const confTitle = document.createElement("div");
  confTitle.textContent = "Conferenza globale kMeet";
  confTitle.style.cssText = "flex:1;font-size:13px;font-weight:600;color:#e5e7eb;";

  kmeetToggleBtn = document.createElement("button");
  kmeetToggleBtn.textContent = "kMeet: ON";
  kmeetToggleBtn.style.cssText = "padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(135deg,#22c55e,#16a34a);color:#f9fafb;";

  topBar.appendChild(confTitle);
  topBar.appendChild(kmeetToggleBtn);

  conferenceMainArea = document.createElement("div");
  conferenceMainArea.style.cssText = "flex:1;display:flex;align-items:center;justify-content:center;background-color:#020617;";

  const placeholder = document.createElement("div");
  placeholder.textContent = "Premi kMeet: ON per aprire la conferenza.";
  placeholder.style.cssText = "font-size:13px;color:#9ca3af;text-align:center;";
  conferenceMainArea.appendChild(placeholder);

  rightCol.appendChild(topBar);
  rightCol.appendChild(conferenceMainArea);
  conferenceView.appendChild(leftCol);
  conferenceView.appendChild(rightCol);

  if (appView && appView.parentNode) {
    appView.parentNode.insertBefore(conferenceView, appView.nextSibling);
  }

  kmeetToggleBtn.addEventListener("click", () => {
    if (!isKmeetOn) { openKmeet(); } else { closeKmeet(); }
  });
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
  if (kmeetToggleBtn) {
    kmeetToggleBtn.textContent = "kMeet: OFF";
    kmeetToggleBtn.style.background = "linear-gradient(135deg,#f97316,#ea580c)";
  }
  appendSystemMessage("Conferenza kMeet aperta.");
}

function closeKmeet() {
  if (conferenceIframe && conferenceIframe.parentNode) conferenceIframe.parentNode.removeChild(conferenceIframe);
  conferenceIframe = null;
  isKmeetOn = false;
  if (conferenceMainArea) conferenceMainArea.innerHTML = "";
  if (kmeetToggleBtn) {
    kmeetToggleBtn.textContent = "kMeet: ON";
    kmeetToggleBtn.style.background = "linear-gradient(135deg,#22c55e,#16a34a)";
  }
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
  appendSystemMessage("Modalità conferenza attiva.");
}

function exitConferenceMode() {
  if (!conferenceMode) return;
  conferenceMode = false;
  closeKmeet();
}

const conferenceBtn = document.createElement("button");
conferenceBtn.id = "conference-toggle";
conferenceBtn.textContent = "Conferenza";
conferenceBtn.style.cssText = "margin-left:8px;padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(135deg,#6366f1,#ec4899);color:#f9fafb;";
if (chatHeader) chatHeader.appendChild(conferenceBtn);

conferenceBtn.addEventListener("click", () => {
  if (!currentUser || !currentUser.email) { appendSystemMessage("Devi effettuare il login prima di usare la conferenza."); return; }
  if (!conferenceMode) { enterConferenceMode(); } else { exitConferenceMode(); }
});

const micBtn = document.createElement("button");
micBtn.id = "mic-btn";
micBtn.textContent = "🎤";
micBtn.title = "Tieni premuto per registrare un messaggio vocale";
micBtn.style.cssText = "margin-left:4px;padding:4px 8px;cursor:pointer;background:transparent;border:none;font-size:18px;";

window.addEventListener("DOMContentLoaded", () => {
  const inputBar = document.getElementById("input-bar");
  if (inputBar) inputBar.appendChild(micBtn);
  initAudioMimeType();
  initVideoMimeType();
});

function initAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
    "audio/aac",
    ""
  ];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) {
      supportedAudioMimeType = type || null;
      return;
    }
  }
}

function initVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    ""
  ];
  for (const type of candidates) {
    if (!type || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type))) {
      supportedVideoMimeType = type || null;
      return;
    }
  }
}

// =====================================================================
// ==== VISTA APP ======================================================
// =====================================================================

function showLogin() {
  if (loginView) loginView.style.display = "flex";
  if (appView) appView.style.display = "none";
}

function showApp() {
  if (loginView) loginView.style.display = "none";
  if (appView) appView.style.display = "flex";
  closeChat();
}

// =====================================================================
// ==== RUBRICA ========================================================
// =====================================================================

async function deleteUser(email) {
  if (!email) return;
  const ok = confirm(`Vuoi davvero eliminare questo utente dalla rubrica?\n${email}`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { appendSystemMessage(data.error || `Impossibile eliminare l'utente ${email}.`); return; }
    appendSystemMessage(`Utente ${email} eliminato dalla rubrica.`);
    if (selectedContactEmail === email) closeChat();
    loadUsers();
  } catch (err) {
    appendSystemMessage("Errore durante l'eliminazione utente.");
  }
}

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    contactsList.innerHTML = "";

    users.forEach((u) => {
      const div = document.createElement("div");
      div.className = "contact";
      div.dataset.email = u.email;
      if (selectedContactEmail === u.email) div.classList.add("selected");

      const avatarEl = document.createElement("div");
      if (u.avatar) {
        const img = document.createElement("img");
        img.src = u.avatar; img.alt = u.name; img.className = "contact-avatar";
        avatarEl.appendChild(img);
      } else {
        avatarEl.className = "contact-avatar-placeholder";
        avatarEl.textContent = (u.name || "?")[0].toUpperCase();
      }

      const infoEl = document.createElement("div");
      infoEl.className = "contact-info";

      const nameRow = document.createElement("div");
      nameRow.className = "contact-name";

      const statusDot = document.createElement("span");
      statusDot.className = "contact-status-dot";
      statusDot.style.backgroundColor = onlineUsers[u.email] ? "#22c55e" : "#6b7280";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = u.name;

      nameRow.appendChild(statusDot);
      nameRow.appendChild(nameSpan);

      const emailSpan = document.createElement("span");
      emailSpan.className = "contact-email";
      emailSpan.textContent = u.email;

      infoEl.appendChild(nameRow);
      infoEl.appendChild(emailSpan);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "🗑";
      deleteBtn.style.cssText = "font-size:11px;padding:2px 6px;margin-left:4px;border-radius:999px;border:none;cursor:pointer;background:rgba(239,68,68,0.1);color:#f87171;flex-shrink:0;";
      deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteUser(u.email); });

      div.appendChild(avatarEl);
      div.appendChild(infoEl);
      div.appendChild(deleteBtn);
      div.addEventListener("click", () => openChat(u));
      contactsList.appendChild(div);
    });

    rebuildConferenceContacts();
  } catch (err) {
    console.error("Errore loadUsers", err);
  }
}

// =====================================================================
// ==== RUBRICA CONFERENZA =============================================
// =====================================================================

function rebuildConferenceContacts() {
  if (!conferenceContacts) return;
  conferenceContacts.innerHTML = "";
  const contactNodes = Array.from(contactsList.querySelectorAll(".contact"));

  if (!contactNodes.length) {
    const empty = document.createElement("div");
    empty.textContent = "Nessun utente in rubrica.";
    empty.style.cssText = "font-size:12px;color:#9ca3af;padding:8px;";
    conferenceContacts.appendChild(empty);
    return;
  }

  contactNodes.forEach((c) => {
    const email = c.dataset.email || "";
    const nameEl = c.querySelector(".contact-name span:last-child");
    const name = nameEl ? nameEl.textContent.trim() : email;

    const div = document.createElement("div");
    div.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;font-size:12px;";
    div.addEventListener("mouseenter", () => { div.style.backgroundColor = "rgba(15,23,42,0.9)"; });
    div.addEventListener("mouseleave", () => { div.style.backgroundColor = "transparent"; });

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;";

    const statusDot = document.createElement("span");
    statusDot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background-color:${onlineUsers[email] ? "#22c55e" : "#6b7280"};`;

    const label = document.createElement("span");
    label.textContent = `${name} (${email})`;
    label.style.color = "#e5e7eb";

    left.appendChild(statusDot);
    left.appendChild(label);

    const inviteBtn = document.createElement("button");
    inviteBtn.textContent = "Invita";
    inviteBtn.style.cssText = "font-size:11px;padding:2px 8px;border-radius:999px;border:none;cursor:pointer;background:rgba(56,189,248,0.1);color:#38bdf8;";
    inviteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isKmeetOn) { appendSystemMessage("Apri prima kMeet."); return; }
      if (!currentUser) { appendSystemMessage("Devi essere loggato."); return; }
      socket.emit("kmeet-invite", { toEmail: email, roomUrl: KMEET_URL });
      appendSystemMessage(`Invito kMeet mandato a ${email}.`);
    });

    div.appendChild(left);
    div.appendChild(inviteBtn);
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
  const div = document.createElement("div");
  div.classList.add("msg");
  const isMe = currentUser && msg.from.email === currentUser.email;
  div.classList.add(isMe ? "from-me" : "from-other");
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = isMe ? `[CONF] TU: ${msg.text}` : `[CONF] ${msg.from.name}: ${msg.text}`;
  const timeEl = document.createElement("div");
  timeEl.className = "msg-time";
  timeEl.textContent = formatTime(msg.ts);
  div.appendChild(bubble);
  div.appendChild(timeEl);
  if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
});

socket.on("private-message", (msg) => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const peerEmail = isMe ? (selectedContactEmail || "") : msg.from.email;

  const el = buildMessageElement(msg.from, msg.text, msg.ts, isMe);
  addMessageToContact(peerEmail, el);

  // Suono e vibrazione solo per messaggi ricevuti
  if (!isMe) {
    playSound("message");
    vibrate(100);
  }
});

socket.on("kmeet-invite", ({ from, roomUrl }) => {
  if (!from || !roomUrl) return;
  const ok = confirm(`${from.name} ti invita alla conferenza kMeet ZEUS.\nVuoi entrare ora?`);
  if (ok) window.open(roomUrl, "_blank");
});

// =====================================================================
// ==== INVIO MESSAGGI =================================================
// =====================================================================

if (sendBtn) {
  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text || !currentUser) return;
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto per inviare un messaggio."); input.value = ""; return; }
    sendTypingStop();
    socket.emit("private-message", { toEmail: selectedContactEmail, text });
    input.value = "";
  });
}

if (input) {
  input.addEventListener("keypress", (e) => { if (e.key === "Enter") sendBtn.click(); });
}

// =====================================================================
// ==== ALLEGATI =======================================================
// =====================================================================

if (attachBtn && fileInput) {
  attachBtn.addEventListener("click", () => {
    if (!currentUser) { appendSystemMessage("Devi effettuare il login per allegare file."); return; }
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto per inviare un allegato."); return; }
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (!data || !data.ok || !data.url) { appendSystemMessage(`Errore upload "${file.name}".`); continue; }
        socket.emit("private-message", { toEmail: selectedContactEmail, text: `📎 allegato: ${file.name} (${data.url})` });
      } catch (err) {
        appendSystemMessage(`Errore upload "${file.name}".`);
      }
    }
    fileInput.value = "";
  });
}

// =====================================================================
// ==== VIDEO MESSAGGI =================================================
// =====================================================================

async function startVideoMessageRecording() {
  if (isVideoRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { appendSystemMessage("Browser non supporta la videocamera."); return; }
  if (!currentUser || !selectedContactEmail) { appendSystemMessage("Seleziona un contatto per inviare un video messaggio."); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" }, audio: true });
    videoPreviewStream = stream;
    videoChunks = [];
    if (videoArea) videoArea.style.display = "block";
    if (localVideoElement) localVideoElement.srcObject = stream;

    try {
      videoRecorder = supportedVideoMimeType ? new MediaRecorder(stream, { mimeType: supportedVideoMimeType }) : new MediaRecorder(stream);
    } catch (e) { videoRecorder = new MediaRecorder(stream); }

    videoRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
    videoRecorder.onstop = async () => {
      if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
      if (videoChunks.length) {
        try { const blob = new Blob(videoChunks, { type: videoRecorder.mimeType }); await sendVideoMessage(blob); }
        catch (err) { appendSystemMessage("Errore elaborazione video messaggio."); }
      }
      videoChunks = [];
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach((t) => t.stop()); videoPreviewStream = null; }
      isVideoRecording = false;
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
      if (videoNoteBtn) { videoNoteBtn.innerHTML = "<span>▶</span>"; videoNoteBtn.disabled = false; }
    };

    isVideoRecording = true;
    videoRecorder.start();
    appendSystemMessage("Registrazione video avviata (max 30s)...");
    if (videoNoteBtn) { videoNoteBtn.textContent = "■"; videoNoteBtn.disabled = false; }

    videoRecordTimeout = setTimeout(() => {
      if (isVideoRecording && videoRecorder && videoRecorder.state === "recording") { appendSystemMessage("Tempo massimo raggiunto."); videoRecorder.stop(); }
    }, MAX_VIDEO_SECONDS * 1000);
  } catch (err) {
    appendSystemMessage("Impossibile accedere a camera/microfono.");
  }
}

async function sendVideoMessage(blob) {
  if (!blob || !currentUser || !selectedContactEmail) return;
  try {
    const formData = new FormData();
    const fileName = `video-message-${Date.now()}.webm`;
    formData.append("file", blob, fileName);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok || !data.url) { appendSystemMessage("Errore upload video messaggio."); return; }
    socket.emit("private-message", { toEmail: selectedContactEmail, text: `🎦 video: ${fileName} (${data.url})` });
    appendSystemMessage("Video messaggio inviato.");
  } catch (err) {
    appendSystemMessage("Errore upload video messaggio.");
  }
}

if (videoNoteBtn) {
  videoNoteBtn.addEventListener("click", () => {
    if (!isVideoRecording) { startVideoMessageRecording(); }
    else if (videoRecorder && videoRecorder.state === "recording") {
      if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
      videoRecorder.stop();
    }
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
  writeString(view, offset, "RIFF"); offset += 4;
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString(view, offset, "WAVE"); offset += 4;
  writeString(view, offset, "fmt "); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  writeString(view, offset, "data"); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// =====================================================================
// ==== MESSAGGI VOCALI ================================================
// =====================================================================

async function startRecording() {
  if (isRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { appendSystemMessage("Browser non supporta il microfono."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try { mediaRecorder = supportedAudioMimeType ? new MediaRecorder(stream, { mimeType: supportedAudioMimeType }) : new MediaRecorder(stream); }
    catch (e) { mediaRecorder = new MediaRecorder(stream); }
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      if (!audioChunks.length) { appendSystemMessage("Nessun audio registrato."); return; }
      try {
        const blob = new Blob(audioChunks, { type: supportedAudioMimeType || "audio/webm" });
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const wavBlob = encodeWAVFromFloat32(audioBuffer.getChannelData(0), audioBuffer.sampleRate || 44100);
          sendVoiceMessage(wavBlob);
        } catch (decodeErr) {
          // Su iOS non riesce a decodificare - manda blob diretto
          sendVoiceMessage(blob);
        }
      } catch (err) { appendSystemMessage("Errore registrazione audio."); }
      audioChunks = [];
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorder.start();
    isRecording = true;
    micBtn.textContent = "⏺️";
  } catch (err) { alert("Impossibile accedere al microfono."); }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  micBtn.textContent = "🎤";
}

function sendVoiceMessage(blob) {
  if (!currentUser) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto per inviare un vocale."); return; }
    socket.emit("voice-message", { mode: "private", toEmail: selectedContactEmail, audio: reader.result });
  };
  reader.readAsDataURL(blob);
}

micBtn.addEventListener("mousedown", () => startRecording());
micBtn.addEventListener("mouseup", () => stopRecording());
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });
// touch per mobile
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); });

socket.on("voice-message", (msg) => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const div = document.createElement("div");
  div.classList.add("msg");
  div.classList.add(isMe ? "from-me" : "from-other");

  if (!isMe) {
    const senderEl = document.createElement("div");
    senderEl.className = "msg-sender";
    senderEl.textContent = msg.from.name;
    div.appendChild(senderEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = "🎤 messaggio vocale";
  div.appendChild(bubble);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = msg.audio;
  audio.style.marginTop = "4px";
  audio.style.maxWidth = "100%";
  audio.setAttribute("playsinline", "");
  audio.preload = "metadata";
  div.appendChild(audio);

  const timeEl = document.createElement("div");
  timeEl.className = "msg-time";
  timeEl.textContent = formatTime(msg.ts || Date.now());
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
  const div = document.createElement("div");
  div.textContent = text;
  if (callLogDiv) { callLogDiv.appendChild(div); callLogDiv.scrollTop = callLogDiv.scrollHeight; while (callLogDiv.children.length > 30) callLogDiv.removeChild(callLogDiv.firstChild); }
  else if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
}

// =====================================================================
// ==== WEBRTC =========================================================
// =====================================================================

async function getLocalStreamAudioOnly() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (err) { appendSystemMessage("Impossibile accedere al microfono."); throw err; }
}

async function getLocalStreamAudioVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    if (localVideoElement) localVideoElement.srcObject = stream;
    return stream;
  } catch (err) { appendSystemMessage("Impossibile accedere a microfono/camera."); throw err; }
}

async function startLocalAudio() { if (localStream) return localStream; localStream = await getLocalStreamAudioOnly(); return localStream; }
async function startLocalMediaWithVideo() { localStream = await getLocalStreamAudioVideo(); return localStream; }

function createPeerConnection() {
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = (e) => { if (e.candidate && currentCallPeerEmail) socket.emit("call-ice-candidate", { toEmail: currentCallPeerEmail, candidate: e.candidate }); };
  peerConnection.ontrack = (e) => {
    const remoteStream = e.streams[0];
    if (!remoteAudioElement) { remoteAudioElement = document.createElement("audio"); remoteAudioElement.autoplay = true; remoteAudioElement.style.display = "none"; document.body.appendChild(remoteAudioElement); }
    remoteAudioElement.srcObject = remoteStream;
    if (remoteVideoElement) remoteVideoElement.srcObject = remoteStream;
  };
  peerConnection.onconnectionstatechange = () => { appendSystemMessage("Stato WebRTC: " + peerConnection.connectionState); };
  return peerConnection;
}

async function endCall(reason = "Chiamata terminata.") {
  stopCallingRingtone();
  if (ringtoneAudio) { ringtoneAudio.pause(); ringtoneAudio.currentTime = 0; }
  isAudioCallActive = false; isVideoCallActive = false; currentCallPeerEmail = null;
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  if (localStream) { try { localStream.getTracks().forEach((t) => t.stop()); } catch {} localStream = null; }
  if (remoteAudioElement) { remoteAudioElement.srcObject = null; remoteAudioElement = null; }
  if (localVideoElement) localVideoElement.srcObject = null;
  if (remoteVideoElement) remoteVideoElement.srcObject = null;
  if (videoArea) videoArea.style.display = "none";
  appendSystemMessage(reason);
}

async function startAudioCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto per la chiamata audio."); return; }
  if (isAudioCallActive || isVideoCallActive) { appendSystemMessage("C'è già una chiamata in corso."); return; }
  try {
    const stream = await startLocalAudio();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    stream.getTracks().forEach((t) => peerConnection.addTrack(t, stream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "audio" });
    isAudioCallActive = true;
    startCallingRingtone();
    appendSystemMessage(`Chiamata audio verso ${currentCallPeerEmail}...`);
  } catch (err) { await endCall("Chiamata audio interrotta per errore."); }
}

async function startVideoCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto per la videochiamata."); return; }
  if (isVideoCallActive || isAudioCallActive) { appendSystemMessage("C'è già una chiamata in corso."); return; }
  try {
    const stream = await startLocalMediaWithVideo();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    stream.getTracks().forEach((t) => peerConnection.addTrack(t, stream));
    if (videoArea) videoArea.style.display = "block";
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call-offer", { toEmail: currentCallPeerEmail, offer: peerConnection.localDescription, mode: "video" });
    isVideoCallActive = true;
    startCallingRingtone();
    appendSystemMessage(`Videochiamata verso ${currentCallPeerEmail}...`);
  } catch (err) { await endCall("Videochiamata interrotta per errore."); }
}

if (audioCallBtn) { audioCallBtn.addEventListener("click", () => { if (!isAudioCallActive && !isVideoCallActive) { startAudioCall(); } else if (currentCallPeerEmail) { socket.emit("call-hangup", { toEmail: currentCallPeerEmail }); endCall("Chiamata chiusa da te."); } }); }
if (videoCallBtn) { videoCallBtn.addEventListener("click", () => { if (!isVideoCallActive && !isAudioCallActive) { startVideoCall(); } else if (currentCallPeerEmail) { socket.emit("call-hangup", { toEmail: currentCallPeerEmail }); endCall("Chiamata chiusa da te."); } }); }

socket.on("call-offer", async ({ from, offer, mode }) => {
  if (!from || !from.email || !offer) return;
  if (isAudioCallActive || isVideoCallActive) { socket.emit("call-reject", { toEmail: from.email }); return; }
  selectedContactEmail = from.email; currentCallPeerEmail = from.email;
  try {
    // Vibrazione persistente per iOS
    let vibInterval = setInterval(() => { if (navigator.vibrate) navigator.vibrate([300, 200]); }, 1000);
    startCallingRingtone();

    const isVideo = mode === "video";
    stopCallingRingtone();
    const accept = confirm(`Chiamata ${isVideo ? "video" : "audio"} in arrivo da ${from.name}.\nVuoi rispondere?`);
    if (!accept) { socket.emit("call-reject", { toEmail: from.email }); return; }
    const stream = isVideo ? await startLocalMediaWithVideo() : await startLocalAudio();
    createPeerConnection();
    stream.getTracks().forEach((t) => peerConnection.addTrack(t, stream));
    if (isVideo && videoArea) videoArea.style.display = "block";
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("call-answer", { toEmail: from.email, answer: peerConnection.localDescription, mode });
    isAudioCallActive = !isVideo; isVideoCallActive = isVideo;
    appendSystemMessage(`${isVideo ? "Videochiamata" : "Chiamata audio"} con ${from.email} attiva.`);
  } catch (err) { await endCall("Chiamata interrotta per errore."); }
});

socket.on("call-answer", async ({ from, answer, mode }) => {
  stopCallingRingtone();
  try { if (!peerConnection) return; await peerConnection.setRemoteDescription(answer); appendSystemMessage(`${from?.email} ha risposto (${mode}).`); }
  catch (err) { appendSystemMessage("Errore risposta chiamata."); }
});

socket.on("call-ice-candidate", async ({ candidate }) => { try { if (peerConnection) await peerConnection.addIceCandidate(candidate); } catch (err) {} });
socket.on("call-hangup", async ({ from }) => { await endCall(`Chiamata terminata da ${from?.email || "remote"}.`); });
socket.on("call-reject", ({ from }) => { endCall(`Chiamata rifiutata da ${from?.email || "remote"}.`); });

// =====================================================================
// ==== BOOTSTRAP ======================================================
// =====================================================================

window.initZeusApp = function (user) {
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
    } catch (err) { if (errorDiv) errorDiv.textContent = "Errore di connessione."; }
  });
}

showLogin();