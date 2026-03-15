// =====================================================================
// ZEUS Chat — app.js — Universal edition v3
// PWA banner universale + fix video iPhone + elimina msg + pulisci chat
// =====================================================================

// ---- SESSIONE ----
function saveSession(user) {
  try { localStorage.setItem("zeus_user", JSON.stringify(user)); } catch(e) {}
}
function loadSession() {
  try { const s = localStorage.getItem("zeus_user"); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem("zeus_user"); } catch(e) {}
}

// ---- SOCKET ----
const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

setInterval(() => { if (socket.connected) socket.emit("ping-client"); }, 20000);
socket.on("pong-server", () => {});

const offlineQueue = [];

socket.on("reconnect", () => {
  if (currentUser) {
    socket.emit("set-user", currentUser);
    if (selectedContactEmail) loadMessageHistory(selectedContactEmail);
    while (offlineQueue.length > 0) socket.emit("private-message", offlineQueue.shift());
    appendSystemMessage("Riconnesso ✅");
  }
});

socket.on("disconnect", () => appendSystemMessage("Connessione persa, riconnessione..."));

// =====================================================================
// DEVICE DETECTION
// =====================================================================
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isAndroid = /Android/.test(navigator.userAgent);

function isRunningAsPWA() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    document.referrer.includes("android-app://");
}

// =====================================================================
// AUDIOCONTEXT iOS
// =====================================================================
let audioCtxUnlocked = false;
let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed')
    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
  return globalAudioCtx;
}

function unlockAudioContext() {
  if (audioCtxUnlocked) return;
  try {
    const ctx = getAudioContext();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    ctx.resume().then(() => { audioCtxUnlocked = true; });
  } catch(e) {}
}

document.addEventListener('touchstart', unlockAudioContext, { passive: true });
document.addEventListener('touchend', unlockAudioContext, { passive: true });
document.addEventListener('click', unlockAudioContext);
document.addEventListener('touchstart', () => {
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
}, { passive: true });

// =====================================================================
// VARIABILI GLOBALI
// =====================================================================
let currentUser = null;
let selectedContactEmail = null;
let onlineUsers = {};
const unreadCounts = {};

let conferenceMode = false;
let conferenceIframe = null;
let isKmeetOn = false;
const KMEET_URL = "https://kmeet.infomaniak.com/tiknhcsuxmdxxnpd";

let mediaRecorder = null, audioChunks = [], isRecording = false;
let supportedAudioMimeType = null, recordingStartTime = null, recordingTimerInterval = null;

let videoRecorder = null, videoChunks = [], isVideoRecording = false, videoPreviewStream = null;
const MAX_VIDEO_SECONDS = 60;
let videoRecordTimeout = null, supportedVideoMimeType = null, videoTimerInterval = null;

let isAudioCallActive = false, isVideoCallActive = false;
let peerConnection = null, localStream = null, remoteAudioElement = null;
let localVideoElement = null, remoteVideoElement = null, videoArea = null;
let currentCallPeerEmail = null, callStartTime = null, callDurationInterval = null, callTimeoutTimer = null;

let ringtoneInterval = null, ringtoneOscRunning = false;
let typingTimeout = null, isTyping = false, typingHideTimeout = null;
let notificationsEnabled = false;

// TURN server — credenziali dinamiche via API Metered
// Quando avrai VPS: cambi solo METERED_API_KEY con le tue credenziali coturn
const METERED_API_KEY = "e154c9491970e12ad7e1f31f9361311cb6b0";
const METERED_API_URL = `https://zeus-call.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`;

// rtcConfig base — usato finché non arrivano le credenziali dinamiche
let rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "turn:global.relay.metered.ca:80",                username: "2ca958c4a5a80a8a1a72df2d", credential: "IOy7p2agrerWI3aQ" },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp",  username: "2ca958c4a5a80a8a1a72df2d", credential: "IOy7p2agrerWI3aQ" },
    { urls: "turn:global.relay.metered.ca:443",               username: "2ca958c4a5a80a8a1a72df2d", credential: "IOy7p2agrerWI3aQ" },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp",username: "2ca958c4a5a80a8a1a72df2d", credential: "IOy7p2agrerWI3aQ" }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceTransportPolicy: "all"
};

// Carica credenziali aggiornate da API Metered all'avvio
async function loadTurnCredentials() {
  try {
    const res = await fetch(METERED_API_URL);
    const iceServers = await res.json();
    if (Array.isArray(iceServers) && iceServers.length > 0) {
      rtcConfig = { ...rtcConfig, iceServers };
      console.log("TURN credenziali caricate:", iceServers.length, "server");
    }
  } catch(e) {
    console.log("TURN API non raggiungibile, uso credenziali statiche.");
  }
}

// =====================================================================
// DOM
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
// PWA INSTALL BANNER — UNIVERSALE
// =====================================================================
let deferredInstallPrompt = null;
let installBanner = null;
const PWA_DISMISS_KEY = "zeus-pwa-v2";
const PWA_DISMISS_DAYS = 3;
try { localStorage.removeItem("zeus-pwa-dismissed"); } catch(e) {}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isRunningAsPWA() && !installBanner) showInstallBanner("native");
});

window.addEventListener("appinstalled", () => dismissInstallBanner(true));

function shouldShowPWABanner() {
  if (isRunningAsPWA()) return false;
  try {
    const ts = localStorage.getItem(PWA_DISMISS_KEY);
    if (!ts) return true;
    const saved = parseInt(ts);
    if (saved > Date.now() + 30 * 86400000) return false;
    return (Date.now() - saved) / 86400000 >= PWA_DISMISS_DAYS;
  } catch(e) { return true; }
}

function showInstallBanner(mode) {
  if (installBanner || !shouldShowPWABanner()) return;

  if (!document.getElementById("zeus-pwa-style")) {
    const s = document.createElement("style");
    s.id = "zeus-pwa-style";
    s.textContent = `
      @keyframes zeusSlideUp {
        from { transform:translateY(100%); opacity:0; }
        to   { transform:translateY(0);    opacity:1; }
      }
      #zeus-install-banner { animation: zeusSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1); }
    `;
    document.head.appendChild(s);
  }

  installBanner = document.createElement("div");
  installBanner.id = "zeus-install-banner";
  installBanner.style.cssText = [
    "position:fixed","bottom:0","left:0","right:0","z-index:9999",
    "background:linear-gradient(160deg,#020617 0%,#0f172a 100%)",
    "border-top:2px solid rgba(37,99,235,0.7)",
    "box-shadow:0 -6px 32px rgba(0,0,0,0.8),0 -1px 0 rgba(37,99,235,0.4)",
    "padding:14px 16px 18px","display:flex","flex-direction:column","gap:10px",
    "font-family:system-ui,-apple-system,sans-serif"
  ].join(";");

  const topRow = document.createElement("div");
  topRow.style.cssText = "display:flex;align-items:center;gap:12px;";

  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = "width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,#1e3a8a,#2563eb);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;box-shadow:0 0 16px rgba(37,99,235,0.5);";
  iconWrap.textContent = "⚡";

  const txtWrap = document.createElement("div");
  txtWrap.style.cssText = "flex:1;min-width:0;";
  const ttl = document.createElement("div");
  ttl.style.cssText = "font-size:15px;font-weight:700;color:#f1f5f9;letter-spacing:0.01em;";
  ttl.textContent = "Installa ZEUS Chat";
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:#94a3b8;margin-top:3px;";
  sub.textContent = mode === "ios"
    ? "Aggiungi alla schermata Home per accesso rapido"
    : "Installa l'app — accesso rapido, funziona offline";
  txtWrap.appendChild(ttl);
  txtWrap.appendChild(sub);

  const xBtn = document.createElement("button");
  xBtn.style.cssText = "width:32px;height:32px;border-radius:50%;background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.2);color:#94a3b8;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1;";
  xBtn.innerHTML = "✕";
  const closeFn = (e) => { if (e) e.preventDefault(); dismissInstallBanner(false); };
  xBtn.addEventListener("click", closeFn);
  xBtn.addEventListener("touchend", closeFn, { passive: false });

  topRow.appendChild(iconWrap);
  topRow.appendChild(txtWrap);
  topRow.appendChild(xBtn);
  installBanner.appendChild(topRow);

  if (mode === "ios") {
    const steps = [
      { num: "1", html: `Tocca <strong style="color:#38bdf8">Condividi</strong> <span style="font-size:16px">⬆️</span> nella barra di Safari` },
      { num: "2", html: `Scegli <strong style="color:#38bdf8">"Aggiungi a schermata Home"</strong> <span style="font-size:15px">➕</span>` }
    ];
    steps.forEach(st => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(37,99,235,0.07);border:1px solid rgba(37,99,235,0.18);border-radius:10px;padding:9px 12px;";
      const num = document.createElement("span");
      num.style.cssText = "width:22px;height:22px;border-radius:50%;background:rgba(37,99,235,0.4);color:#e2e8f0;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
      num.textContent = st.num;
      const txt = document.createElement("span");
      txt.style.cssText = "font-size:12px;color:#cbd5e1;";
      txt.innerHTML = st.html;
      row.appendChild(num); row.appendChild(txt);
      installBanner.appendChild(row);
    });
  } else {
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:10px;margin-top:2px;";

    const installBtn = document.createElement("button");
    installBtn.style.cssText = "flex:1;padding:11px;border:none;border-radius:12px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 0 20px rgba(37,99,235,0.45);letter-spacing:0.02em;";
    installBtn.textContent = "⚡ Installa ora";

    const installFn = async (e) => {
      if (e) e.preventDefault();
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (outcome === "accepted") dismissInstallBanner(true);
      } else {
        dismissInstallBanner(false);
      }
    };
    installBtn.addEventListener("click", installFn);
    installBtn.addEventListener("touchend", installFn, { passive: false });

    const laterBtn = document.createElement("button");
    laterBtn.style.cssText = "padding:11px 18px;border:1px solid rgba(148,163,184,0.25);border-radius:12px;background:transparent;color:#94a3b8;font-size:13px;cursor:pointer;white-space:nowrap;";
    laterBtn.textContent = "Dopo";
    const laterFn = (e) => { if (e) e.preventDefault(); dismissInstallBanner(false); };
    laterBtn.addEventListener("click", laterFn);
    laterBtn.addEventListener("touchend", laterFn, { passive: false });

    btnRow.appendChild(installBtn);
    btnRow.appendChild(laterBtn);
    installBanner.appendChild(btnRow);
  }

  document.body.appendChild(installBanner);
}

function dismissInstallBanner(installed) {
  if (installBanner) {
    installBanner.style.transition = "transform 0.25s ease,opacity 0.25s ease";
    installBanner.style.transform = "translateY(100%)";
    installBanner.style.opacity = "0";
    setTimeout(() => { if (installBanner) { installBanner.remove(); installBanner = null; } }, 280);
  }
  try {
    const futureTs = installed
      ? Date.now() + 365 * 86400000
      : Date.now();
    localStorage.setItem(PWA_DISMISS_KEY, futureTs.toString());
  } catch(e) {}
}

function initPWABanner() {
  if (isRunningAsPWA()) return;
  if (!shouldShowPWABanner()) return;
  if (isIOS) {
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS/.test(navigator.userAgent);
    if (isSafari) setTimeout(() => showInstallBanner("ios"), 1500);
    else setTimeout(() => showInstallBanner("native"), 1500);
  } else {
    setTimeout(() => {
      if (!installBanner) showInstallBanner(deferredInstallPrompt ? "native" : "native");
    }, 1500);
  }
}

// =====================================================================
// SUONERIA
// =====================================================================
function _playRingBeep() {
  try {
    const ctx = getAudioContext();
    [[480,620],[480,620]].forEach(([f1,f2], i) => {
      [f1,f2].forEach(freq => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine";
        osc.connect(gain); gain.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.5;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
        gain.gain.setValueAtTime(0.4, t + 0.35);
        gain.gain.linearRampToValueAtTime(0, t + 0.4);
        osc.start(t); osc.stop(t + 0.45);
      });
    });
  } catch(e) {}
}

function startRingtone() {
  stopRingtone(); ringtoneOscRunning = true; _playRingBeep();
  ringtoneInterval = setInterval(() => { if (ringtoneOscRunning) _playRingBeep(); }, 2500);
  vibrate([400,200,400,200,400,600]);
}
function stopRingtone() {
  ringtoneOscRunning = false;
  if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
}

// =====================================================================
// SUONI & VIBRAZIONE
// =====================================================================
function playSound(type) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "message") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18);
    } else if (type === "sent") {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12);
    }
  } catch(e) {}
}

function vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

// =====================================================================
// NOTIFICHE
// =====================================================================
function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") { notificationsEnabled = true; return; }
  if (Notification.permission !== "denied")
    Notification.requestPermission().then(p => { notificationsEnabled = p === "granted"; });
}

function showBrowserNotification(title, body) {
  if (!notificationsEnabled || document.hasFocus()) return;
  try { new Notification(title, { body, icon: "/icons/icon-192.png" }); } catch(e) {}
}

// =====================================================================
// BADGE NON LETTI
// =====================================================================
function incrementUnread(email) {
  if (!email || (selectedContactEmail === email && document.hasFocus())) return;
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
    } else { if (badge) badge.remove(); }
  });
  const total = Object.values(unreadCounts).reduce((a,b) => a+b, 0);
  document.title = total > 0 ? `(${total}) ZEUS Chat` : "ZEUS Chat";
}

// =====================================================================
// NAVIGAZIONE MOBILE
// =====================================================================
function openChat(user) {
  selectedContactEmail = user.email;
  chatTitleText.textContent = user.name;
  if (user.avatar) { chatHeaderAvatar.src = user.avatar; chatHeaderAvatar.style.display = "block"; }
  else chatHeaderAvatar.style.display = "none";
  if (chatPlaceholder) chatPlaceholder.style.display = "none";
  if (chatPanel) chatPanel.style.display = "flex";
  document.querySelectorAll(".contact").forEach(c => {
    c.classList.toggle("selected", c.dataset.email === user.email);
  });
  if (window.innerWidth <= 640) {
    contactsEl && contactsEl.classList.add("hidden-mobile");
    chatAreaEl && chatAreaEl.classList.add("visible-mobile");
  }
  clearUnread(user.email);
  loadMessageHistory(user.email);
  if (input) input.focus();
}

function closeChat() {
  selectedContactEmail = null;
  if (chatPanel) chatPanel.style.display = "none";
  if (chatPlaceholder) chatPlaceholder.style.display = "flex";
  document.querySelectorAll(".contact").forEach(c => c.classList.remove("selected"));
  chatTitleText.textContent = "Chat";
  if (chatHeaderAvatar) chatHeaderAvatar.style.display = "none";
  if (typingIndicator) typingIndicator.textContent = "";
  contactsEl && contactsEl.classList.remove("hidden-mobile");
  chatAreaEl && chatAreaEl.classList.remove("visible-mobile");
}

if (chatBackBtn) chatBackBtn.addEventListener("click", () => closeChat());
window.addEventListener("resize", () => {
  if (window.innerWidth > 640) {
    contactsEl && contactsEl.classList.remove("hidden-mobile");
    chatAreaEl && chatAreaEl.classList.remove("visible-mobile");
  }
});

// =====================================================================
// STORICO MESSAGGI
// =====================================================================
const messagesByContact = {};
const msgElementById = {};

function getContactMessages(email) {
  if (!messagesByContact[email]) messagesByContact[email] = [];
  return messagesByContact[email];
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : d.toLocaleDateString("it-IT", { day:"2-digit", month:"2-digit" }) + " " + time;
}

function playAudioSafe(audioEl) {
  if (!audioEl) return;
  unlockAudioContext();
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().then(() => audioEl.play().catch(() => {}));
  } else audioEl.play().catch(() => {});
}

function playVideoSafe(videoEl) {
  if (!videoEl) return;
  videoEl.playsInline = true;
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("webkit-playsinline", "");
  videoEl.muted = false;
  const p = videoEl.play();
  if (p) p.catch(() => {
    videoEl.muted = true;
    videoEl.play().then(() => setTimeout(() => { videoEl.muted = false; }, 300)).catch(() => {});
  });
}

// =====================================================================
// MENU CONTESTUALE MESSAGGIO
// =====================================================================
let msgContextMenu = null;

function closeMsgContextMenu() {
  if (msgContextMenu) { msgContextMenu.remove(); msgContextMenu = null; }
}

function showMsgContextMenu(x, y, msgId, wrapper) {
  closeMsgContextMenu();
  msgContextMenu = document.createElement("div");
  msgContextMenu.style.cssText = [
    "position:fixed","z-index:8000",
    `left:${Math.min(x, window.innerWidth - 160)}px`,
    `top:${Math.min(y, window.innerHeight - 80)}px`,
    "background:linear-gradient(135deg,#0f172a,#020617)",
    "border:1px solid rgba(37,99,235,0.35)",
    "border-radius:12px","padding:4px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.7)",
    "min-width:150px","display:flex","flex-direction:column","gap:2px"
  ].join(";");

  const btn = document.createElement("button");
  btn.style.cssText = "display:flex;align-items:center;gap:10px;padding:9px 14px;background:transparent;border:none;color:#f87171;font-size:13px;border-radius:8px;cursor:pointer;width:100%;text-align:left;";
  btn.innerHTML = `<span style="font-size:16px">🗑</span> Elimina messaggio`;
  btn.addEventListener("mouseenter", () => btn.style.background = "rgba(239,68,68,0.12)");
  btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
  btn.addEventListener("click", () => { closeMsgContextMenu(); deleteMessage(msgId, wrapper); });
  btn.addEventListener("touchend", (e) => { e.preventDefault(); closeMsgContextMenu(); deleteMessage(msgId, wrapper); }, { passive: false });

  msgContextMenu.appendChild(btn);
  document.body.appendChild(msgContextMenu);
  setTimeout(() => {
    document.addEventListener("click", closeMsgContextMenu, { once: true });
    document.addEventListener("touchend", closeMsgContextMenu, { once: true });
  }, 50);
}

function deleteMessage(msgId, wrapper) {
  if (!msgId || !selectedContactEmail || !currentUser) return;
  wrapper.style.transition = "opacity 0.25s, transform 0.25s";
  wrapper.style.opacity = "0";
  wrapper.style.transform = "scale(0.95)";
  setTimeout(() => {
    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    delete msgElementById[msgId];
  }, 250);
  socket.emit("delete-message", { toEmail: selectedContactEmail, msgId });
}

socket.on("message-deleted", ({ msgId }) => {
  if (!msgId) return;
  const el = msgElementById[msgId];
  if (el) {
    el.style.transition = "opacity 0.25s,transform 0.25s";
    el.style.opacity = "0";
    el.style.transform = "scale(0.95)";
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); delete msgElementById[msgId]; }, 250);
  }
});

socket.on("chat-cleared", () => {
  if (chatDiv) chatDiv.innerHTML = "";
  if (selectedContactEmail) messagesByContact[selectedContactEmail] = [];
  appendSystemMessage("Chat pulita.");
});

// =====================================================================
// BUILD MESSAGGIO
// =====================================================================
function buildMessageElement(fromUser, text, ts, isMe, msgId) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("msg", isMe ? "from-me" : "from-other");
  wrapper.style.position = "relative";
  if (msgId) {
    wrapper.dataset.msgId = msgId;
    msgElementById[msgId] = wrapper;
  }

  if (!isMe) {
    const senderEl = document.createElement("div");
    senderEl.className = "msg-sender";
    senderEl.textContent = fromUser.name || fromUser.email || "";
    wrapper.appendChild(senderEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const attachMatch = text.match(/📎 allegato:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const videoMatch  = text.match(/🎦 video:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const audioMatch  = text.match(/🎤 vocale:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);
  const imgMatch    = text.match(/🖼 immagine:\s*(.+)\s+\((\/uploads\/[^\)]+)\)/);

  if (videoMatch) {
    const videoBubble = document.createElement("div");
    videoBubble.className = "video-bubble";
    videoBubble.style.cssText = "width:200px;height:200px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:#020617;box-shadow:0 0 0 3px rgba(59,130,246,0.6);position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent;";

    const urlPath = videoMatch[2];
    const urlMp4  = urlPath.replace(/\.webm$/i, "-conv.mp4");

    const videoEl = document.createElement("video");
    videoEl.playsInline = true;
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("webkit-playsinline", "");
    videoEl.setAttribute("x-webkit-airplay", "allow");
    videoEl.muted = false;
    videoEl.preload = "metadata";
    videoEl.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";

    if (isIOS) {
      const s1 = document.createElement("source"); s1.src = urlMp4; s1.type = "video/mp4";
      const s2 = document.createElement("source"); s2.src = urlPath; s2.type = "video/webm";
      videoEl.appendChild(s1); videoEl.appendChild(s2);
      videoEl.addEventListener("error", function onErr() {
        if (videoEl.src !== urlPath) { videoEl.src = urlPath; videoEl.load(); }
        else {
          videoEl.controls = true;
          videoEl.style.borderRadius = "12px";
          videoBubble.style.cssText += "border-radius:12px;width:240px;height:auto;";
        }
        videoEl.removeEventListener("error", onErr);
      });
    } else {
      const s1 = document.createElement("source"); s1.src = urlPath; s1.type = "video/webm";
      const s2 = document.createElement("source"); s2.src = urlMp4;  s2.type = "video/mp4";
      videoEl.appendChild(s1); videoEl.appendChild(s2);
    }

    const playOverlay = document.createElement("div");
    playOverlay.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:54px;height:54px;background:rgba(0,0,0,0.55);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;pointer-events:none;transition:opacity 0.2s;";
    playOverlay.textContent = "▶";

    videoBubble.appendChild(videoEl);
    videoBubble.appendChild(playOverlay);

    function toggleVideo() {
      if (videoEl.paused) { playVideoSafe(videoEl); playOverlay.style.opacity = "0"; }
      else { videoEl.pause(); playOverlay.style.opacity = "1"; }
    }

    let touchMoved = false;
    videoBubble.addEventListener("touchstart", () => { touchMoved = false; }, { passive: true });
    videoBubble.addEventListener("touchmove",  () => { touchMoved = true;  }, { passive: true });
    videoBubble.addEventListener("touchend", (e) => {
      if (touchMoved) return;
      e.preventDefault(); unlockAudioContext(); toggleVideo();
    }, { passive: false });
    videoBubble.addEventListener("click", (e) => { e.stopPropagation(); toggleVideo(); });
    videoEl.addEventListener("ended", () => { playOverlay.style.opacity = "1"; });
    videoEl.addEventListener("pause", () => { playOverlay.style.opacity = "1"; });
    videoEl.addEventListener("play",  () => { playOverlay.style.opacity = "0"; });

    wrapper.appendChild(videoBubble);

  } else if (audioMatch) {
    bubble.style.cssText += "min-width:200px;max-width:280px;";
    const audioRow = document.createElement("div");
    audioRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const playBtn = document.createElement("button");
    playBtn.style.cssText = "width:40px;height:40px;border-radius:50%;background:#2563eb;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;";
    playBtn.textContent = "▶";
    const audioEl = document.createElement("audio");
    audioEl.src = audioMatch[2]; audioEl.preload = "metadata"; audioEl.setAttribute("playsinline", "");
    const waveDiv = document.createElement("div");
    waveDiv.style.cssText = "flex:1;height:28px;display:flex;align-items:center;gap:2px;";
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement("div");
      bar.style.cssText = `width:3px;height:${4 + Math.random()*20}px;background:rgba(148,163,184,0.5);border-radius:2px;flex-shrink:0;`;
      waveDiv.appendChild(bar);
    }
    const durSpan = document.createElement("span");
    durSpan.style.cssText = "font-size:11px;color:#9ca3af;white-space:nowrap;min-width:32px;";
    durSpan.textContent = "0:00";
    const fmtDur = (t) => `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}`;
    audioEl.addEventListener("loadedmetadata", () => { if (isFinite(audioEl.duration)) durSpan.textContent = fmtDur(audioEl.duration); });
    audioEl.addEventListener("timeupdate",     () => { if (isFinite(audioEl.duration)) durSpan.textContent = fmtDur(audioEl.currentTime); });
    audioEl.addEventListener("ended", () => { playBtn.textContent = "▶"; });
    const toggleAudio = () => {
      unlockAudioContext();
      if (audioEl.paused) { playAudioSafe(audioEl); playBtn.textContent = "⏸"; }
      else { audioEl.pause(); playBtn.textContent = "▶"; }
    };
    playBtn.addEventListener("touchend", (e) => { e.preventDefault(); toggleAudio(); }, { passive: false });
    playBtn.addEventListener("click", toggleAudio);
    audioRow.appendChild(playBtn); audioRow.appendChild(waveDiv); audioRow.appendChild(durSpan);
    bubble.appendChild(audioRow);
    wrapper.appendChild(bubble);

  } else if (imgMatch) {
    const img = document.createElement("img");
    img.src = imgMatch[2]; img.alt = imgMatch[1];
    img.style.cssText = "max-width:220px;max-height:220px;border-radius:12px;display:block;cursor:pointer;";
    img.addEventListener("click", () => window.open(imgMatch[2], "_blank"));
    bubble.appendChild(img);
    wrapper.appendChild(bubble);

  } else if (attachMatch) {
    const link = document.createElement("a");
    link.href = attachMatch[2]; link.textContent = "📎 " + attachMatch[1];
    link.target = "_blank"; link.style.cssText = "color:#38bdf8;text-decoration:underline;";
    bubble.appendChild(link);
    wrapper.appendChild(bubble);

  } else {
    bubble.textContent = text;
    wrapper.appendChild(bubble);
  }

  const timeRow = document.createElement("div");
  timeRow.className = "msg-time";
  timeRow.style.cssText = "display:flex;align-items:center;gap:6px;" + (isMe ? "justify-content:flex-end;" : "justify-content:flex-start;");
  const timeSpan = document.createElement("span");
  timeSpan.textContent = formatTime(ts);
  timeRow.appendChild(timeSpan);

  const effectiveId = msgId || null;
  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑";
  delBtn.title = "Elimina messaggio";
  delBtn.style.cssText = "display:none;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:999px;padding:0 6px;font-size:11px;cursor:pointer;color:#f87171;line-height:1.6;transition:background 0.15s;flex-shrink:0;";

  wrapper.addEventListener("mouseenter", () => { delBtn.style.display = "inline-block"; });
  wrapper.addEventListener("mouseleave", () => { delBtn.style.display = "none"; });

  let pressTimer = null, hideTimer = null;
  wrapper.addEventListener("touchstart", () => {
    pressTimer = setTimeout(() => {
      vibrate(40);
      delBtn.style.display = "inline-block";
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { delBtn.style.display = "none"; }, 3000);
    }, 500);
  }, { passive: true });
  wrapper.addEventListener("touchmove",  () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
  wrapper.addEventListener("touchend",   () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });

  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (effectiveId) deleteMessage(effectiveId, wrapper);
    else { wrapper.style.transition="opacity 0.25s"; wrapper.style.opacity="0"; setTimeout(()=>{ if(wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); },250); }
  });
  delBtn.addEventListener("touchend", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (effectiveId) deleteMessage(effectiveId, wrapper);
    else { wrapper.style.transition="opacity 0.25s"; wrapper.style.opacity="0"; setTimeout(()=>{ if(wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); },250); }
  }, { passive: false });
  delBtn.addEventListener("mouseenter", () => { delBtn.style.background = "rgba(239,68,68,0.4)"; });
  delBtn.addEventListener("mouseleave", () => { delBtn.style.background = "rgba(239,68,68,0.15)"; });

  if (effectiveId) {
    wrapper.addEventListener("contextmenu", (e) => { e.preventDefault(); showMsgContextMenu(e.clientX, e.clientY, effectiveId, wrapper); });
  }

  timeRow.appendChild(delBtn);
  wrapper.appendChild(timeRow);
  return wrapper;
}

async function loadMessageHistory(peerEmail) {
  if (!currentUser || !peerEmail) return;
  if (chatDiv) chatDiv.innerHTML = "";
  Object.keys(msgElementById).forEach(k => delete msgElementById[k]);
  try {
    const res = await fetch(`/api/messages?emailA=${encodeURIComponent(currentUser.email)}&emailB=${encodeURIComponent(peerEmail)}&limit=100`);
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return;
    messagesByContact[peerEmail] = [];
    data.messages.forEach(m => {
      const isMe = m.from === currentUser.email;
      const fromUser = m.fromUser || { email: m.from, name: m.from };
      const el = buildMessageElement(fromUser, m.text, m.ts, isMe, m.id);
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
// PULISCI CHAT
// =====================================================================
function clearChatUI() {
  if (!selectedContactEmail || !currentUser) { appendSystemMessage("Seleziona una chat."); return; }
  const peerName = chatTitleText.textContent || selectedContactEmail;
  const ok = confirm(`Vuoi eliminare tutta la chat con ${peerName}?\n\nQuesta azione cancella i messaggi per entrambi.`);
  if (!ok) return;
  fetch(`/api/messages?emailA=${encodeURIComponent(currentUser.email)}&emailB=${encodeURIComponent(selectedContactEmail)}`, {
    method: "DELETE"
  }).then(r => r.json()).then(data => {
    if (data.ok) {
      if (chatDiv) chatDiv.innerHTML = "";
      messagesByContact[selectedContactEmail] = [];
      Object.keys(msgElementById).forEach(k => delete msgElementById[k]);
      appendSystemMessage("✅ Chat eliminata.");
    } else { appendSystemMessage("Errore eliminazione chat."); }
  }).catch(() => appendSystemMessage("Errore connessione."));
}

// =====================================================================
// PROFILO UTENTE
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
function updateProfileAvatarPreview(src) {
  if (!profileAvatarPreview) return;
  profileAvatarPreview.innerHTML = src ? `<img src="${src}" alt="Avatar"/>` : "👤";
}

if (profileBtn) profileBtn.addEventListener("click", openProfileModal);
if (profileCancelBtn) profileCancelBtn.addEventListener("click", closeProfileModal);
if (profileModalOverlay) profileModalOverlay.addEventListener("click", e => { if (e.target === profileModalOverlay) closeProfileModal(); });

if (profileAvatarUploadBtn && profileAvatarInput) {
  profileAvatarUploadBtn.addEventListener("click", () => profileAvatarInput.click());
  profileAvatarInput.addEventListener("change", () => {
    const file = profileAvatarInput.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { pendingAvatarBase64 = e.target.result; updateProfileAvatarPreview(pendingAvatarBase64); };
    reader.readAsDataURL(file);
    profileAvatarInput.value = "";
  });
}

if (profileSaveBtn) {
  profileSaveBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const name = (profileNameInput?.value.trim()) || currentUser.name;
    const phone = profilePhoneInput?.value.trim() || "";
    const address = profileAddressInput?.value.trim() || "";
    const avatar = pendingAvatarBase64 || currentUser.avatar || null;
    try {
      const res = await fetch("/api/profile", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email:currentUser.email, name, phone, address, avatar }) });
      const data = await res.json().catch(() => null);
      if (!data?.ok) { appendSystemMessage("Errore salvataggio profilo."); return; }
      currentUser = { ...currentUser, name, phone, address, avatar };
      saveSession(currentUser);
      appendSystemMessage("Profilo aggiornato ✅");
      closeProfileModal();
      loadUsers();
    } catch(err) { appendSystemMessage("Errore connessione."); }
  });
}

// =====================================================================
// TYPING
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
  input.addEventListener("input", sendTypingStart);
  input.addEventListener("blur",  sendTypingStop);
}

socket.on("typing-start", ({ from }) => {
  if (!from || selectedContactEmail !== from.email) return;
  if (typingIndicator) typingIndicator.textContent = `${from.name} sta scrivendo...`;
  if (typingHideTimeout) clearTimeout(typingHideTimeout);
  typingHideTimeout = setTimeout(() => { if (typingIndicator) typingIndicator.textContent = ""; }, 5000);
});
socket.on("typing-stop", ({ from }) => {
  if (!from || selectedContactEmail !== from.email) return;
  if (typingIndicator) typingIndicator.textContent = "";
  if (typingHideTimeout) { clearTimeout(typingHideTimeout); typingHideTimeout = null; }
});

// =====================================================================
// CONFERENZA
// =====================================================================
let conferenceView = null, conferenceContacts = null, conferenceMainArea = null, kmeetToggleBtn = null;

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
  if (appView?.parentNode) appView.parentNode.insertBefore(conferenceView, appView.nextSibling);
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
  if (conferenceIframe?.parentNode) conferenceIframe.parentNode.removeChild(conferenceIframe);
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
  ensureConferenceView(); rebuildConferenceContacts();
  if (appView) appView.style.display = "none";
  if (conferenceView) conferenceView.style.display = "flex";
}
function exitConferenceMode() { if (!conferenceMode) return; conferenceMode = false; closeKmeet(); }

const conferenceBtn = document.createElement("button");
conferenceBtn.id = "conference-toggle";
conferenceBtn.textContent = "Conferenza";
conferenceBtn.style.cssText = "margin-left:8px;padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(135deg,#6366f1,#ec4899);color:#f9fafb;";
conferenceBtn.addEventListener("click", () => {
  if (!currentUser?.email) { appendSystemMessage("Devi fare login prima."); return; }
  if (!conferenceMode) enterConferenceMode(); else exitConferenceMode();
});

// =====================================================================
// MICROFONO — HOLD TO RECORD
// =====================================================================
const micBtn = document.createElement("button");
micBtn.id = "mic-btn";
micBtn.title = "Tieni premuto per vocale";
micBtn.style.cssText = "width:36px;height:36px;border-radius:50%;background:transparent;border:none;font-size:20px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.1s;touch-action:none;flex-shrink:0;position:relative;-webkit-tap-highlight-color:transparent;";
micBtn.innerHTML = "🎤";

const micTimerOverlay = document.createElement("div");
micTimerOverlay.style.cssText = "display:none;position:absolute;bottom:42px;left:50%;transform:translateX(-50%);background:rgba(37,99,235,0.95);color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;white-space:nowrap;pointer-events:none;z-index:100;";

let micStartX = 0, micCancelled = false;

function initAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = isIOS
    ? ["audio/mp4","audio/aac","audio/webm;codecs=opus","audio/webm",""]
    : ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4",""];
  for (const t of candidates) {
    if (!t || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) {
      supportedAudioMimeType = t || null;
      console.log("Audio MIME:", supportedAudioMimeType); return;
    }
  }
}
function initVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return;
  const candidates = isIOS
    ? ["video/mp4;codecs=h264,aac","video/mp4","video/webm",""]
    : ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4",""];
  for (const t of candidates) {
    if (!t || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) {
      supportedVideoMimeType = t || null;
      console.log("Video MIME:", supportedVideoMimeType); return;
    }
  }
}

function setMicRecordingUI(rec) {
  if (rec) {
    micBtn.style.background = "radial-gradient(circle,#ef4444,#b91c1c)";
    micBtn.style.transform = "scale(1.2)"; micBtn.innerHTML = "⏺";
    micTimerOverlay.style.display = "block";
  } else {
    micBtn.style.background = "transparent"; micBtn.style.transform = "scale(1)";
    micBtn.innerHTML = "🎤"; micTimerOverlay.style.display = "none";
    if (recordingTimerInterval) { clearInterval(recordingTimerInterval); recordingTimerInterval = null; }
  }
}

function startRecordingTimer() {
  recordingStartTime = Date.now();
  if (recordingTimerInterval) clearInterval(recordingTimerInterval);
  recordingTimerInterval = setInterval(() => {
    const e = Math.floor((Date.now()-recordingStartTime)/1000);
    micTimerOverlay.textContent = `● ${Math.floor(e/60)}:${(e%60).toString().padStart(2,"0")}  ← scorri per annullare`;
  }, 500);
}

async function startVoiceRecording() {
  if (isRecording) return;
  if (!navigator.mediaDevices?.getUserMedia) { appendSystemMessage("Microfono non supportato."); return; }
  if (!currentUser || !selectedContactEmail) { appendSystemMessage("Seleziona un contatto prima."); return; }
  micCancelled = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let opts = supportedAudioMimeType ? { mimeType: supportedAudioMimeType } : {};
    try { mediaRecorder = new MediaRecorder(stream, opts); } catch(e) { mediaRecorder = new MediaRecorder(stream); }
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      isRecording = false; setMicRecordingUI(false);
      if (micCancelled) { audioChunks = []; appendSystemMessage("Vocale annullato."); return; }
      if (!audioChunks.length) { appendSystemMessage("Nessun audio registrato."); return; }
      const mimeType = supportedAudioMimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type: mimeType }); audioChunks = [];
      await uploadAndSendVoice(blob, mimeType);
    };
    mediaRecorder.start(250); isRecording = true; setMicRecordingUI(true); startRecordingTimer(); vibrate(50);
  } catch(err) {
    isRecording = false; setMicRecordingUI(false);
    appendSystemMessage(err.name === "NotAllowedError" ? "⚠️ Permesso microfono negato." : "Errore microfono: " + err.message);
  }
}

function stopVoiceRecording(cancelled) {
  if (!isRecording || !mediaRecorder) return;
  micCancelled = !!cancelled;
  try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); }
  catch(e) { isRecording = false; setMicRecordingUI(false); }
}

async function uploadAndSendVoice(blob, mimeType) {
  if (!blob || !currentUser || !selectedContactEmail) return;
  try {
    appendSystemMessage("Invio vocale...");
    const ext = mimeType.includes("mp4")||mimeType.includes("aac") ? ".m4a" : mimeType.includes("ogg") ? ".ogg" : ".webm";
    const fileName = `voice-${Date.now()}${ext}`;
    const fd = new FormData(); fd.append("file", blob, fileName);
    const res = await fetch("/api/upload", { method:"POST", body:fd });
    const data = await res.json().catch(() => null);
    if (!data?.ok || !data.url) { appendSystemMessage("Errore upload vocale."); return; }
    const msgText = `🎤 vocale: ${fileName} (${data.url})`;
    socket.connected ? socket.emit("private-message", { toEmail:selectedContactEmail, text:msgText })
                     : offlineQueue.push({ toEmail:selectedContactEmail, text:msgText });
  } catch(e) { appendSystemMessage("Errore invio vocale."); }
}

window.addEventListener("DOMContentLoaded", () => {
  const inputBar = document.getElementById("input-bar");
  if (inputBar) { inputBar.style.position = "relative"; inputBar.appendChild(micTimerOverlay); inputBar.appendChild(micBtn); }

  const hdr = document.getElementById("chat-header");
  if (hdr) {
    hdr.appendChild(conferenceBtn);
    const clearBtn = document.createElement("button");
    clearBtn.id = "clear-chat-btn";
    clearBtn.title = "Pulisci chat";
    clearBtn.style.cssText = "margin-left:4px;padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);";
    clearBtn.textContent = "🧹 Pulisci";
    clearBtn.addEventListener("click", () => clearChatUI());
    hdr.appendChild(clearBtn);
  }

  initAudioMimeType(); initVideoMimeType(); requestNotificationPermission();
  loadTurnCredentials();
  setTimeout(() => initPWABanner(), 1200);
  const savedUser = loadSession();
  if (savedUser?.email && savedUser?.name) window.initZeusApp(savedUser);
});

micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); micStartX = e.touches[0].clientX; startVoiceRecording(); }, { passive:false });
micBtn.addEventListener("touchmove", (e) => {
  e.preventDefault(); if (!isRecording) return;
  const dx = e.touches[0].clientX - micStartX;
  micTimerOverlay.style.background = dx < -80 ? "rgba(239,68,68,0.95)" : "rgba(37,99,235,0.95)";
  micTimerOverlay.textContent = dx < -80 ? "🗑 Rilascia per annullare" : micTimerOverlay.textContent;
}, { passive:false });
micBtn.addEventListener("touchend", (e) => {
  e.preventDefault(); if (!isRecording) return;
  stopVoiceRecording(e.changedTouches[0].clientX - micStartX < -80);
  micTimerOverlay.style.background = "rgba(37,99,235,0.95)";
}, { passive:false });
micBtn.addEventListener("mousedown", () => startVoiceRecording());
micBtn.addEventListener("mouseup",   () => stopVoiceRecording(false));
micBtn.addEventListener("mouseleave",() => { if (isRecording) stopVoiceRecording(false); });

// =====================================================================
// VIDEO MESSAGGI
// =====================================================================
function setVideoNoteButtonState(rec) {
  if (!videoNoteBtn) return;
  if (rec) {
    videoNoteBtn.innerHTML = '<span style="color:#fff;font-size:14px;">⏹</span>';
    videoNoteBtn.style.background = "radial-gradient(circle at 30% 0,#fecaca 0,#dc2626 40%,#7f1d1d 100%)";
    videoNoteBtn.style.boxShadow = "0 0 12px rgba(220,38,38,0.9)";
  } else {
    videoNoteBtn.innerHTML = '<span>▶</span>';
    videoNoteBtn.style.background = "radial-gradient(circle at 30% 0,#fecaca 0,#ef4444 40%,#b91c1c 100%)";
    videoNoteBtn.style.boxShadow = "0 0 8px rgba(239,68,68,0.7)";
  }
  videoNoteBtn.disabled = false;
}

let videoCountdownOverlay = null;
function createVideoCountdownOverlay() {
  if (videoCountdownOverlay) return;
  videoCountdownOverlay = document.createElement("div");
  videoCountdownOverlay.style.cssText = "position:absolute;top:8px;right:8px;background:rgba(239,68,68,0.85);color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:2px 8px;pointer-events:none;z-index:10;display:none;";
  document.getElementById("video-wrapper")?.appendChild(videoCountdownOverlay);
}
function startVideoCountdown() {
  createVideoCountdownOverlay(); let rem = MAX_VIDEO_SECONDS;
  if (videoCountdownOverlay) { videoCountdownOverlay.style.display = "block"; videoCountdownOverlay.textContent = `● ${rem}s`; }
  if (videoTimerInterval) clearInterval(videoTimerInterval);
  videoTimerInterval = setInterval(() => {
    rem--; if (videoCountdownOverlay) videoCountdownOverlay.textContent = `● ${rem}s`;
    if (rem <= 0) { clearInterval(videoTimerInterval); videoTimerInterval = null; }
  }, 1000);
}
function stopVideoCountdown() {
  if (videoTimerInterval) { clearInterval(videoTimerInterval); videoTimerInterval = null; }
  if (videoCountdownOverlay) videoCountdownOverlay.style.display = "none";
}

async function startVideoMessageRecording() {
  if (isVideoRecording) return;
  if (!navigator.mediaDevices?.getUserMedia) { appendSystemMessage("Camera non supportata."); return; }
  if (!currentUser || !selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{ width:{ideal:480,max:640}, height:{ideal:480,max:640}, facingMode:"user", frameRate:{ideal:15,max:30} },
      audio: true
    });
    videoPreviewStream = stream; videoChunks = [];
    if (videoArea) videoArea.style.display = "block";
    if (localVideoElement) { localVideoElement.srcObject = stream; localVideoElement.muted = true; }
    let opts = supportedVideoMimeType ? { mimeType: supportedVideoMimeType } : {};
    try { videoRecorder = new MediaRecorder(stream, opts); }
    catch(e) { try { videoRecorder = new MediaRecorder(stream); } catch(e2) { appendSystemMessage("Registrazione video non supportata."); stream.getTracks().forEach(t=>t.stop()); return; } }
    videoRecorder.ondataavailable = e => { if (e.data?.size > 0) videoChunks.push(e.data); };
    videoRecorder.onstop = async () => {
      isVideoRecording = false; setVideoNoteButtonState(false); stopVideoCountdown();
      if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t=>t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
      if (videoChunks.length > 0) {
        const mimeType = videoRecorder.mimeType || supportedVideoMimeType || "video/webm";
        const blob = new Blob(videoChunks, { type: mimeType }); videoChunks = [];
        await sendVideoMessage(blob, mimeType);
      } else { appendSystemMessage("Nessun dato video."); }
    };
    videoRecorder.onerror = () => {
      isVideoRecording = false; setVideoNoteButtonState(false); stopVideoCountdown();
      if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t=>t.stop()); videoPreviewStream = null; }
      if (localVideoElement) localVideoElement.srcObject = null;
      if (videoArea) videoArea.style.display = "none";
    };
    isVideoRecording = true; setVideoNoteButtonState(true); videoRecorder.start(500); startVideoCountdown();
    appendSystemMessage("● Registrazione avviata (max " + MAX_VIDEO_SECONDS + "s). Premi ⏹ per fermare.");
    videoRecordTimeout = setTimeout(() => {
      if (isVideoRecording && videoRecorder?.state === "recording") { appendSystemMessage("Tempo massimo."); videoRecorder.stop(); }
    }, MAX_VIDEO_SECONDS * 1000);
  } catch(err) {
    isVideoRecording = false; setVideoNoteButtonState(false);
    appendSystemMessage(err.name === "NotAllowedError" ? "⚠️ Permesso camera negato." : "Errore camera: " + err.message);
  }
}

function stopVideoMessageRecording() {
  if (!isVideoRecording || !videoRecorder) return;
  setVideoNoteButtonState(false); stopVideoCountdown();
  if (videoRecordTimeout) { clearTimeout(videoRecordTimeout); videoRecordTimeout = null; }
  try { if (videoRecorder.state !== "inactive") videoRecorder.stop(); }
  catch(e) {
    isVideoRecording = false;
    if (videoPreviewStream) { videoPreviewStream.getTracks().forEach(t=>t.stop()); videoPreviewStream = null; }
    if (localVideoElement) localVideoElement.srcObject = null;
    if (videoArea) videoArea.style.display = "none";
  }
}

async function sendVideoMessage(blob, mimeType) {
  if (!blob || !currentUser || !selectedContactEmail) return;
  try {
    const isMP4 = mimeType?.includes("mp4") || mimeType?.includes("h264");
    const ext = isMP4 ? ".mp4" : ".webm";
    const fileName = `video-message-${Date.now()}${ext}`;
    appendSystemMessage("Invio video...");
    showUploadProgress("Video in caricamento...");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = e => { if (e.lengthComputable) updateUploadProgress(Math.round(e.loaded/e.total*100)); };
    xhr.onload = () => {
      hideUploadProgress();
      try {
        const data = JSON.parse(xhr.responseText);
        if (!data?.ok || !data.url) { appendSystemMessage("Errore upload video."); return; }
        const msgText = `🎦 video: ${fileName} (${data.url})`;
        socket.connected ? socket.emit("private-message", { toEmail:selectedContactEmail, text:msgText })
                         : offlineQueue.push({ toEmail:selectedContactEmail, text:msgText });
        appendSystemMessage("✓ Video inviato.");
      } catch(e) { appendSystemMessage("Errore risposta server."); }
    };
    xhr.onerror = () => { hideUploadProgress(); appendSystemMessage("Errore upload video."); };
    const fd = new FormData(); fd.append("file", blob, fileName); xhr.send(fd);
  } catch(err) { hideUploadProgress(); appendSystemMessage("Errore upload video."); }
}

if (videoNoteBtn) {
  setVideoNoteButtonState(false);
  let lastTap = 0;
  const handleVN = (e) => {
    e.preventDefault(); e.stopPropagation();
    const now = Date.now(); if (now - lastTap < 300) return; lastTap = now;
    isVideoRecording ? stopVideoMessageRecording() : startVideoMessageRecording();
  };
  videoNoteBtn.addEventListener("touchend", handleVN, { passive:false });
  videoNoteBtn.addEventListener("click", (e) => {
    const now = Date.now(); if (now - lastTap < 300) return; lastTap = now;
    e.preventDefault(); isVideoRecording ? stopVideoMessageRecording() : startVideoMessageRecording();
  });
}

// =====================================================================
// PROGRESS BAR UPLOAD
// =====================================================================
let progressContainer = null;
function showUploadProgress(label) {
  if (!progressContainer) {
    progressContainer = document.createElement("div");
    progressContainer.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(2,6,23,0.95);border:1px solid rgba(37,99,235,0.5);border-radius:12px;padding:8px 16px;min-width:200px;z-index:999;text-align:center;";
    const lbl = document.createElement("div"); lbl.id = "upload-label"; lbl.style.cssText = "font-size:12px;color:#e5e7eb;margin-bottom:6px;";
    const bar = document.createElement("div"); bar.style.cssText = "height:4px;background:rgba(37,99,235,0.2);border-radius:4px;overflow:hidden;";
    const fill = document.createElement("div"); fill.id = "upload-fill"; fill.style.cssText = "height:100%;width:0%;background:#2563eb;border-radius:4px;transition:width 0.2s;";
    bar.appendChild(fill); progressContainer.appendChild(lbl); progressContainer.appendChild(bar);
    document.body.appendChild(progressContainer);
  }
  const lbl = document.getElementById("upload-label"); if (lbl) lbl.textContent = label || "Caricamento...";
  progressContainer.style.display = "block"; updateUploadProgress(0);
}
function updateUploadProgress(pct) {
  const fill = document.getElementById("upload-fill"); if (fill) fill.style.width = pct + "%";
  const lbl = document.getElementById("upload-label"); if (lbl && pct > 0) lbl.textContent = `Caricamento ${pct}%`;
}
function hideUploadProgress() { if (progressContainer) progressContainer.style.display = "none"; updateUploadProgress(0); }

// =====================================================================
// VISTE
// =====================================================================
function showLogin() { if (loginView) loginView.style.display = "flex"; if (appView) appView.style.display = "none"; }
function showApp()   { if (loginView) loginView.style.display = "none"; if (appView) appView.style.display = "flex"; closeChat(); }

// =====================================================================
// RUBRICA
// =====================================================================
async function deleteUser(email) {
  if (!email || !confirm(`Eliminare ${email}?`)) return;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(email)}`, { method:"DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { appendSystemMessage(data.error || "Impossibile eliminare."); return; }
    appendSystemMessage(`Utente ${email} eliminato.`);
    if (selectedContactEmail === email) closeChat();
    loadUsers();
  } catch(e) { appendSystemMessage("Errore eliminazione."); }
}

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    contactsList.innerHTML = "";
    users.forEach(u => {
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
      const dot = document.createElement("span"); dot.className = "contact-status-dot";
      dot.style.backgroundColor = onlineUsers[u.email] ? "#22c55e" : "#6b7280";
      const nameSpan = document.createElement("span"); nameSpan.textContent = u.name;
      nameRow.appendChild(dot); nameRow.appendChild(nameSpan);
      const emailSpan = document.createElement("span"); emailSpan.className = "contact-email"; emailSpan.textContent = u.email;
      infoEl.appendChild(nameRow); infoEl.appendChild(emailSpan);

      const delBtn = document.createElement("button"); delBtn.textContent = "🗑";
      delBtn.style.cssText = "font-size:11px;padding:2px 6px;margin-left:4px;border-radius:999px;border:none;cursor:pointer;background:rgba(239,68,68,0.1);color:#f87171;flex-shrink:0;";
      delBtn.addEventListener("click", e => { e.stopPropagation(); deleteUser(u.email); });

      div.appendChild(avatarEl); div.appendChild(infoEl); div.appendChild(delBtn);
      div.addEventListener("click", () => openChat(u));
      contactsList.appendChild(div);
    });
    updateUnreadUI(); rebuildConferenceContacts();
  } catch(err) { console.error("Errore loadUsers", err); }
}

function rebuildConferenceContacts() {
  if (!conferenceContacts) return;
  conferenceContacts.innerHTML = "";
  const nodes = Array.from(contactsList.querySelectorAll(".contact"));
  if (!nodes.length) {
    const empty = document.createElement("div"); empty.textContent = "Nessun utente.";
    empty.style.cssText = "font-size:12px;color:#9ca3af;padding:8px;"; conferenceContacts.appendChild(empty); return;
  }
  nodes.forEach(c => {
    const email = c.dataset.email || "";
    const name = c.querySelector(".contact-name span:last-child")?.textContent.trim() || email;
    const div = document.createElement("div");
    div.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:12px;cursor:default;";
    div.addEventListener("mouseenter", () => { div.style.backgroundColor = "rgba(15,23,42,0.9)"; });
    div.addEventListener("mouseleave", () => { div.style.backgroundColor = "transparent"; });
    const left = document.createElement("div"); left.style.cssText = "display:flex;align-items:center;";
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background-color:${onlineUsers[email]?"#22c55e":"#6b7280"};`;
    const label = document.createElement("span"); label.textContent = `${name} (${email})`; label.style.color = "#e5e7eb";
    left.appendChild(dot); left.appendChild(label);
    const invBtn = document.createElement("button"); invBtn.textContent = "Invita";
    invBtn.style.cssText = "font-size:11px;padding:2px 8px;border-radius:999px;border:none;cursor:pointer;background:rgba(56,189,248,0.1);color:#38bdf8;";
    invBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (!isKmeetOn) { appendSystemMessage("Apri prima kMeet."); return; }
      socket.emit("kmeet-invite", { toEmail: email, roomUrl: KMEET_URL });
      appendSystemMessage(`Invito mandato a ${email}.`);
    });
    div.appendChild(left); div.appendChild(invBtn);
    conferenceContacts.appendChild(div);
  });
}

// =====================================================================
// PRESENZA
// =====================================================================
socket.on("user-online",  user => { if (user?.email) onlineUsers[user.email] = true;  loadUsers(); });
socket.on("user-offline", user => { if (user?.email) onlineUsers[user.email] = false; loadUsers(); });

// =====================================================================
// MESSAGGI IN ARRIVO
// =====================================================================
socket.on("chat-message", msg => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const div = document.createElement("div"); div.classList.add("msg", isMe?"from-me":"from-other");
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  bubble.textContent = isMe ? `[CONF] TU: ${msg.text}` : `[CONF] ${msg.from.name}: ${msg.text}`;
  const timeEl = document.createElement("div"); timeEl.className = "msg-time"; timeEl.textContent = formatTime(msg.ts);
  div.appendChild(bubble); div.appendChild(timeEl);
  if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
});

socket.on("private-message", msg => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const peerEmail = isMe ? (selectedContactEmail || "") : msg.from.email;
  const el = buildMessageElement(msg.from, msg.text, msg.ts, isMe, msg.id);
  addMessageToContact(peerEmail, el);
  if (!isMe) {
    playSound("message"); vibrate(100);
    incrementUnread(msg.from.email);
    showBrowserNotification(msg.from.name || msg.from.email, msg.text.length > 60 ? msg.text.slice(0,60)+"..." : msg.text);
  }
});

socket.on("kmeet-invite", ({ from, roomUrl }) => {
  if (!from || !roomUrl) return;
  if (confirm(`${from.name} ti invita alla conferenza kMeet.\nVuoi entrare?`)) window.open(roomUrl, "_blank");
});

// =====================================================================
// INVIO MESSAGGI
// =====================================================================
if (sendBtn) {
  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text || !currentUser) return;
    if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); input.value = ""; return; }
    sendTypingStop();
    socket.connected
      ? socket.emit("private-message", { toEmail:selectedContactEmail, text })
      : offlineQueue.push({ toEmail:selectedContactEmail, text });
    input.value = "";
  });
}
if (input) input.addEventListener("keypress", e => { if (e.key === "Enter") sendBtn.click(); });
if (emailInput) emailInput.addEventListener("keypress", e => { if (e.key === "Enter") loginBtn?.click(); });

// =====================================================================
// ALLEGATI
// =====================================================================
let attachMenu = null;

function createAttachMenu() {
  if (attachMenu) { closeAttachMenu(); return; }
  attachMenu = document.createElement("div");
  attachMenu.style.cssText = "position:absolute;bottom:60px;left:8px;background:rgba(2,6,23,0.97);border:1px solid rgba(37,99,235,0.4);border-radius:14px;padding:8px;display:flex;flex-direction:column;gap:4px;z-index:200;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,0.5);";
  [
    { icon:"🖼", label:"Foto / Immagine", accept:"image/*" },
    { icon:"🎬", label:"Video",           accept:"video/*" },
    { icon:"📄", label:"Documento",       accept:"*/*"     },
  ].forEach(opt => {
    const btn = document.createElement("button");
    btn.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;background:transparent;border:none;color:#e5e7eb;font-size:13px;border-radius:8px;cursor:pointer;text-align:left;";
    btn.innerHTML = `<span style="font-size:20px">${opt.icon}</span><span>${opt.label}</span>`;
    btn.addEventListener("mouseenter", () => btn.style.background = "rgba(37,99,235,0.15)");
    btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
    btn.addEventListener("click",    () => { closeAttachMenu(); triggerFileUpload(opt.accept); });
    btn.addEventListener("touchend", e => { e.preventDefault(); closeAttachMenu(); triggerFileUpload(opt.accept); }, { passive:false });
    attachMenu.appendChild(btn);
  });
  const composer = document.getElementById("composer");
  if (composer) { composer.style.position = "relative"; composer.appendChild(attachMenu); }
  setTimeout(() => { document.addEventListener("click", closeAttachMenuOnOutside); }, 100);
}
function closeAttachMenuOnOutside(e) { if (attachMenu && !attachMenu.contains(e.target) && e.target !== attachBtn) closeAttachMenu(); }
function closeAttachMenu() { if (attachMenu) { attachMenu.remove(); attachMenu = null; } document.removeEventListener("click", closeAttachMenuOnOutside); }

function triggerFileUpload(accept) {
  if (!currentUser) { appendSystemMessage("Fai login prima."); return; }
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  const tmp = document.createElement("input"); tmp.type = "file"; tmp.accept = accept || "*/*";
  if (!isIOS) tmp.multiple = true; tmp.style.display = "none"; document.body.appendChild(tmp);
  tmp.addEventListener("change", async () => {
    const files = Array.from(tmp.files || []); document.body.removeChild(tmp);
    for (const f of files) await uploadFile(f);
  });
  tmp.click();
}

async function uploadFile(file) {
  if (!file) return;
  if (file.size > 50*1024*1024) { appendSystemMessage(`⚠️ File troppo grande: ${file.name} (max 50MB)`); return; }
  const isImage = file.type.startsWith("image/");
  showUploadProgress(`Invio ${file.name}...`);
  const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/upload");
  xhr.upload.onprogress = e => { if (e.lengthComputable) updateUploadProgress(Math.round(e.loaded/e.total*100)); };
  xhr.onload = () => {
    hideUploadProgress();
    try {
      const data = JSON.parse(xhr.responseText);
      if (!data?.ok || !data.url) { appendSystemMessage(`Errore upload "${file.name}".`); return; }
      const msgText = isImage ? `🖼 immagine: ${file.name} (${data.url})` : `📎 allegato: ${file.name} (${data.url})`;
      socket.connected ? socket.emit("private-message", { toEmail:selectedContactEmail, text:msgText })
                       : offlineQueue.push({ toEmail:selectedContactEmail, text:msgText });
    } catch(e) { appendSystemMessage("Errore risposta server."); }
  };
  xhr.onerror = () => { hideUploadProgress(); appendSystemMessage(`Errore upload "${file.name}".`); };
  const fd = new FormData(); fd.append("file", file); xhr.send(fd);
}

if (attachBtn) {
  attachBtn.addEventListener("click",    e => { e.stopPropagation(); createAttachMenu(); });
  attachBtn.addEventListener("touchend", e => { e.preventDefault(); e.stopPropagation(); createAttachMenu(); }, { passive:false });
}
if (fileInput) {
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    for (const f of files) await uploadFile(f);
    fileInput.value = "";
  });
}

// =====================================================================
// LOG SISTEMA
// =====================================================================
let callLogDiv = document.getElementById("call-log");
if (!callLogDiv) {
  callLogDiv = document.createElement("div"); callLogDiv.id = "call-log";
  callLogDiv.style.cssText = "font-size:11px;color:#9ca3af;max-height:60px;overflow-y:auto;padding:2px 8px 0 8px;border-top:1px solid rgba(15,23,42,0.6);box-sizing:border-box;flex-shrink:0;";
  const composer = document.getElementById("composer");
  if (composer?.parentNode) composer.parentNode.insertBefore(callLogDiv, composer);
}
function appendSystemMessage(text) {
  const div = document.createElement("div"); div.textContent = text;
  if (callLogDiv) { callLogDiv.appendChild(div); callLogDiv.scrollTop = callLogDiv.scrollHeight; while (callLogDiv.children.length > 30) callLogDiv.removeChild(callLogDiv.firstChild); }
  else if (chatDiv) { chatDiv.appendChild(div); chatDiv.scrollTop = chatDiv.scrollHeight; }
}

// =====================================================================
// UI CHIAMATA IN CORSO
// =====================================================================
let callUI = null;
function showCallUI(name, mode) {
  if (callUI) callUI.remove();
  callUI = document.createElement("div");
  callUI.style.cssText = "position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#020617,#0f172a);border-bottom:1px solid rgba(37,99,235,0.5);padding:10px 16px;display:flex;align-items:center;gap:12px;z-index:500;";
  const icon = document.createElement("span"); icon.style.fontSize = "20px"; icon.textContent = mode === "video" ? "🎥" : "📞";
  const info = document.createElement("div"); info.style.flex = "1";
  const nameEl = document.createElement("div"); nameEl.style.cssText = "font-size:13px;font-weight:600;color:#e5e7eb;"; nameEl.textContent = name;
  const timerEl = document.createElement("div"); timerEl.id = "call-timer"; timerEl.style.cssText = "font-size:11px;color:#22c55e;"; timerEl.textContent = "In connessione...";
  info.appendChild(nameEl); info.appendChild(timerEl);
  const hangupBtn = document.createElement("button");
  hangupBtn.style.cssText = "background:#ef4444;border:none;border-radius:999px;color:#fff;padding:6px 14px;font-size:13px;cursor:pointer;";
  hangupBtn.textContent = "🔴 Chiudi";
  const doHangup = () => { if (currentCallPeerEmail) socket.emit("call-hangup", { toEmail:currentCallPeerEmail }); endCall("Chiamata chiusa."); };
  hangupBtn.addEventListener("click", doHangup);
  hangupBtn.addEventListener("touchend", e => { e.preventDefault(); doHangup(); }, { passive:false });
  callUI.appendChild(icon); callUI.appendChild(info); callUI.appendChild(hangupBtn);
  document.body.appendChild(callUI);
}
function startCallTimer() {
  callStartTime = Date.now();
  if (callDurationInterval) clearInterval(callDurationInterval);
  callDurationInterval = setInterval(() => {
    const el = document.getElementById("call-timer"); if (!el) return;
    const e = Math.floor((Date.now()-callStartTime)/1000);
    el.textContent = `${Math.floor(e/60)}:${(e%60).toString().padStart(2,"0")}`;
  }, 1000);
}
function hideCallUI() {
  if (callUI) { callUI.remove(); callUI = null; }
  if (callDurationInterval) { clearInterval(callDurationInterval); callDurationInterval = null; }
}

// =====================================================================
// WEBRTC
// =====================================================================
async function getLocalStreamAudioOnly() {
  try { return await navigator.mediaDevices.getUserMedia({ audio:true }); }
  catch(e) { appendSystemMessage("Impossibile accedere al microfono."); throw e; }
}
async function getLocalStreamAudioVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:"user" } });
    if (localVideoElement) { localVideoElement.srcObject = stream; localVideoElement.muted = true; }
    return stream;
  } catch(e) { appendSystemMessage("Impossibile accedere a microfono/camera."); throw e; }
}

function createPeerConnection() {
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = e => {
    if (e.candidate && currentCallPeerEmail) socket.emit("call-ice-candidate", { toEmail:currentCallPeerEmail, candidate:e.candidate });
  };
  peerConnection.ontrack = e => {
    const stream = e.streams[0]; if (!stream) return;
    if (!remoteAudioElement) {
      remoteAudioElement = document.createElement("audio");
      remoteAudioElement.autoplay = true; remoteAudioElement.setAttribute("playsinline",""); remoteAudioElement.style.display = "none";
      document.body.appendChild(remoteAudioElement);
    }
    remoteAudioElement.srcObject = stream; remoteAudioElement.play().catch(()=>{});
    if (remoteVideoElement) { remoteVideoElement.srcObject = stream; remoteVideoElement.muted = false; remoteVideoElement.play().catch(()=>{}); }
    startCallTimer();
  };
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const st = peerConnection.connectionState;
    appendSystemMessage("WebRTC: " + st);
    if (st === "connected") { const el = document.getElementById("call-timer"); if(el) el.textContent="0:00"; if(callTimeoutTimer){clearTimeout(callTimeoutTimer);callTimeoutTimer=null;} }
    if (st === "failed") endCall("Connessione fallita. Riprova.");
  };
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection?.iceConnectionState === "disconnected") {
      setTimeout(() => { if (peerConnection?.iceConnectionState === "disconnected") endCall("Connessione persa."); }, 5000);
    }
  };
  return peerConnection;
}

function waitForIceGathering(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const t = setTimeout(resolve, 5000);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); resolve(); } });
  });
}

async function endCall(reason = "Chiamata terminata.") {
  stopRingtone(); hideCallUI();
  if (callTimeoutTimer) { clearTimeout(callTimeoutTimer); callTimeoutTimer = null; }
  isAudioCallActive = false; isVideoCallActive = false; currentCallPeerEmail = null;
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  if (localStream) { try { localStream.getTracks().forEach(t=>t.stop()); } catch {} localStream = null; }
  if (remoteAudioElement) { try { remoteAudioElement.srcObject=null; remoteAudioElement.remove(); } catch {} remoteAudioElement = null; }
  if (localVideoElement) localVideoElement.srcObject = null;
  if (remoteVideoElement) remoteVideoElement.srcObject = null;
  if (videoArea) videoArea.style.display = "none";
  appendSystemMessage(reason);
}

async function startAudioCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  if (isAudioCallActive || isVideoCallActive) { appendSystemMessage("Chiamata già in corso."); return; }
  try {
    localStream = await getLocalStreamAudioOnly();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    const offer = await peerConnection.createOffer({ offerToReceiveAudio:true });
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-offer", { toEmail:currentCallPeerEmail, offer:peerConnection.localDescription, mode:"audio" });
    isAudioCallActive = true; startRingtone();
    showCallUI(chatTitleText.textContent || currentCallPeerEmail, "audio");
    appendSystemMessage(`📞 Chiamata verso ${currentCallPeerEmail}...`);
    callTimeoutTimer = setTimeout(() => {
      if (isAudioCallActive && peerConnection?.connectionState !== "connected") { socket.emit("call-hangup",{toEmail:currentCallPeerEmail}); endCall("⏱ Nessuna risposta."); }
    }, 30000);
  } catch(e) { await endCall("Chiamata interrotta: " + e.message); }
}

async function startVideoCall() {
  if (!selectedContactEmail) { appendSystemMessage("Seleziona un contatto."); return; }
  if (isVideoCallActive || isAudioCallActive) { appendSystemMessage("Chiamata già in corso."); return; }
  try {
    localStream = await getLocalStreamAudioVideo();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection();
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    if (videoArea) videoArea.style.display = "block";
    const offer = await peerConnection.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-offer", { toEmail:currentCallPeerEmail, offer:peerConnection.localDescription, mode:"video" });
    isVideoCallActive = true; startRingtone();
    showCallUI(chatTitleText.textContent || currentCallPeerEmail, "video");
    appendSystemMessage(`🎥 Videochiamata verso ${currentCallPeerEmail}...`);
    callTimeoutTimer = setTimeout(() => {
      if (isVideoCallActive && peerConnection?.connectionState !== "connected") { socket.emit("call-hangup",{toEmail:currentCallPeerEmail}); endCall("⏱ Nessuna risposta."); }
    }, 30000);
  } catch(e) { await endCall("Videochiamata interrotta: " + e.message); }
}

if (audioCallBtn) audioCallBtn.addEventListener("click", () => {
  if (!isAudioCallActive && !isVideoCallActive) startAudioCall();
  else if (currentCallPeerEmail) { socket.emit("call-hangup",{toEmail:currentCallPeerEmail}); endCall("Chiamata chiusa."); }
});
if (videoCallBtn) videoCallBtn.addEventListener("click", () => {
  if (!isVideoCallActive && !isAudioCallActive) startVideoCall();
  else if (currentCallPeerEmail) { socket.emit("call-hangup",{toEmail:currentCallPeerEmail}); endCall("Chiamata chiusa."); }
});

// =====================================================================
// RICEZIONE CHIAMATA
// =====================================================================
socket.on("call-offer", async ({ from, offer, mode }) => {
  if (!from?.email || !offer) return;
  if (isAudioCallActive || isVideoCallActive) { socket.emit("call-reject",{toEmail:from.email}); return; }
  currentCallPeerEmail = from.email;
  const isVideo = mode === "video";
  unlockAudioContext(); startRingtone();
  const accept = confirm(`📞 Chiamata ${isVideo?"🎥 VIDEO":"AUDIO"} da ${from.name}!\n\nOK = Rispondi   Annulla = Rifiuta`);
  stopRingtone();
  if (!accept) { socket.emit("call-reject",{toEmail:from.email}); currentCallPeerEmail = null; return; }
  try {
    const stream = isVideo ? await getLocalStreamAudioVideo() : await getLocalStreamAudioOnly();
    localStream = stream;
    createPeerConnection();
    stream.getTracks().forEach(t => peerConnection.addTrack(t, stream));
    if (isVideo && videoArea) videoArea.style.display = "block";
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGathering(peerConnection);
    socket.emit("call-answer",{toEmail:from.email, answer:peerConnection.localDescription, mode});
    isAudioCallActive = !isVideo; isVideoCallActive = isVideo;
    selectedContactEmail = from.email;
    showCallUI(from.name || from.email, mode);
    appendSystemMessage(`✅ ${isVideo?"Videochiamata":"Chiamata"} con ${from.email} attiva.`);
  } catch(e) { await endCall("Chiamata interrotta: " + e.message); }
});

socket.on("call-answer", async ({ from, answer }) => {
  stopRingtone(); if(callTimeoutTimer){clearTimeout(callTimeoutTimer);callTimeoutTimer=null;}
  try { if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); appendSystemMessage(`✅ ${from?.email} ha risposto.`); }
  catch(e) { appendSystemMessage("Errore risposta chiamata."); }
});
socket.on("call-ice-candidate", async ({ candidate }) => {
  try { if (peerConnection && candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});
socket.on("call-hangup", async ({ from }) => { await endCall(`📵 Terminata da ${from?.email||"remoto"}.`); });
socket.on("call-reject", ({ from }) => {
  stopRingtone(); if(callTimeoutTimer){clearTimeout(callTimeoutTimer);callTimeoutTimer=null;}
  endCall(`❌ Rifiutata da ${from?.email||"remoto"}.`);
});

// =====================================================================
// VOCALI RICEZIONE
// =====================================================================
socket.on("voice-message", msg => {
  const isMe = currentUser && msg.from.email === currentUser.email;
  const div = document.createElement("div"); div.classList.add("msg", isMe?"from-me":"from-other");
  if (!isMe) { const s = document.createElement("div"); s.className = "msg-sender"; s.textContent = msg.from.name; div.appendChild(s); }
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  bubble.style.cssText = "min-width:200px;max-width:280px;";
  const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;";
  const playBtn = document.createElement("button");
  playBtn.style.cssText = "width:40px;height:40px;border-radius:50%;background:#2563eb;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  playBtn.textContent = "▶";
  const audioEl = document.createElement("audio"); audioEl.src = msg.audio; audioEl.preload = "metadata"; audioEl.setAttribute("playsinline","");
  const wave = document.createElement("div"); wave.style.cssText = "flex:1;height:28px;display:flex;align-items:center;gap:2px;";
  for (let i=0;i<20;i++) { const b=document.createElement("div"); b.style.cssText=`width:3px;height:${4+Math.random()*20}px;background:rgba(148,163,184,0.5);border-radius:2px;flex-shrink:0;`; wave.appendChild(b); }
  const dur = document.createElement("span"); dur.style.cssText = "font-size:11px;color:#9ca3af;white-space:nowrap;min-width:32px;"; dur.textContent = "0:00";
  const fmtD = t => `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}`;
  audioEl.addEventListener("loadedmetadata", () => { if(isFinite(audioEl.duration)) dur.textContent=fmtD(audioEl.duration); });
  audioEl.addEventListener("timeupdate",     () => { if(isFinite(audioEl.duration)) dur.textContent=fmtD(audioEl.currentTime); });
  audioEl.addEventListener("ended", () => { playBtn.textContent="▶"; });
  const toggle = () => { unlockAudioContext(); if(audioEl.paused){playAudioSafe(audioEl);playBtn.textContent="⏸";}else{audioEl.pause();playBtn.textContent="▶";} };
  playBtn.addEventListener("touchend", e => { e.preventDefault(); toggle(); }, { passive:false });
  playBtn.addEventListener("click", toggle);
  row.appendChild(playBtn); row.appendChild(wave); row.appendChild(dur);
  bubble.appendChild(row); div.appendChild(bubble);
  const timeEl = document.createElement("div"); timeEl.className = "msg-time"; timeEl.textContent = formatTime(msg.ts||Date.now()); div.appendChild(timeEl);
  const peer = isMe ? selectedContactEmail : msg.from.email;
  if (peer) addMessageToContact(peer, div);
  if (!isMe) { playSound("message"); vibrate(100); incrementUnread(msg.from.email); }
});

// =====================================================================
// BOOTSTRAP
// =====================================================================
window.initZeusApp = function(user) {
  currentUser = user || null;
  if (!currentUser?.email) { appendSystemMessage("Utente non valido."); return; }
  saveSession(currentUser);
  showApp();
  socket.emit("set-user", currentUser);
  loadUsers();
  requestNotificationPermission();
};

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const name = nameInput?.value.trim() || "";
    const email = emailInput?.value.trim() || "";
    if (!name || !email) { if (errorDiv) errorDiv.textContent = "Inserisci nome ed email."; return; }
    try {
      if (errorDiv) errorDiv.textContent = "";
      const res = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,email}) });
      const data = await res.json().catch(()=>null);
      if (!res.ok || !data?.ok || !data.user) { if (errorDiv) errorDiv.textContent = data?.error || "Login fallito."; return; }
      window.initZeusApp(data.user);
    } catch(e) { if (errorDiv) errorDiv.textContent = "Errore di connessione."; }
  });
}

showLogin();