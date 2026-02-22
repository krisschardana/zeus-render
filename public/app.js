const socket = io();
let currentUser = null;
let selectedContactEmail = null;
let onlineUsers = {}; // email -> true/false

// ---- CONFERENZA GLOBALE (SOLO KMEET) ----
let conferenceMode = false;
let conferenceIframe = null;
let isKmeetOn = false;

// URL conferenza kMeet (fisso)
const KMEET_URL =
  "https://kmeet.infomaniak.com/tiknhcsuxmdxxnpd";

// ---- AUDIO / MESSAGGI VOCALI ----
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let supportedAudioMimeType = null;

// ---- STATO CHIAMATA (WEBRTC 1-a-1) ----
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

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// elementi DOM principali
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

const chatHeader = document.getElementById("chat-header");
const chatTitleText = document.getElementById("chat-title-text");
const audioCallBtn = document.getElementById("audio-call-btn");
const videoCallBtn = document.getElementById("video-call-btn");

// video
videoArea = document.getElementById("video-area");
localVideoElement = document.getElementById("localVideo");
remoteVideoElement = document.getElementById("remoteVideo");

// pannello log tecnico
let callLogDiv = document.getElementById("call-log");
if (!callLogDiv) {
  callLogDiv = document.createElement("div");
  callLogDiv.id = "call-log";
  callLogDiv.style.fontSize = "11px";
  callLogDiv.style.color = "#9ca3af";
  callLogDiv.style.maxHeight = "80px";
  callLogDiv.style.overflowY = "auto";
  callLogDiv.style.padding = "4px 8px 0 8px";
  callLogDiv.style.borderTop = "1px solid rgba(15,23,42,0.6)";
  callLogDiv.style.boxSizing = "border-box";

  const composer = document.getElementById("composer");
  if (composer && chatDiv && chatDiv.parentNode) {
    chatDiv.parentNode.insertBefore(callLogDiv, composer);
  }
}

// grafica bottoni audio/video
if (audioCallBtn) {
  audioCallBtn.textContent = "";
}
if (videoCallBtn) {
  videoCallBtn.textContent = "";
}

// ---- VISTA CONFERENZA (PANNELLO SEPARATO) ----
let conferenceView = null;
let conferenceContacts = null;
let conferenceMainArea = null;
let kmeetToggleBtn = null;

function ensureConferenceView() {
  if (conferenceView) return;

  conferenceView = document.createElement("div");
  conferenceView.id = "conference-view";
  conferenceView.style.display = "none";
  conferenceView.style.flex = "1";
  conferenceView.style.backgroundColor = "#020617";
  conferenceView.style.borderRadius = "8px";
  conferenceView.style.border = "1px solid rgba(148,163,184,0.3)";
  conferenceView.style.margin = "8px";
  conferenceView.style.overflow = "hidden";
  conferenceView.style.flexDirection = "row";

  // colonna sinistra: rubrica conferenza
  const leftCol = document.createElement("div");
  leftCol.style.width = "260px";
  leftCol.style.borderRight = "1px solid rgba(148,163,184,0.3)";
  leftCol.style.display = "flex";
  leftCol.style.flexDirection = "column";
  leftCol.style.backgroundColor = "#020617";

  const leftHeader = document.createElement("div");
  leftHeader.textContent = "Rubrica conferenza ZEUS";
  leftHeader.style.padding = "8px";
  leftHeader.style.fontSize = "13px";
  leftHeader.style.fontWeight = "600";
  leftHeader.style.color = "#e5e7eb";
  leftHeader.style.borderBottom = "1px solid rgba(148,163,184,0.3)";

  conferenceContacts = document.createElement("div");
  conferenceContacts.id = "conference-contacts";
  conferenceContacts.style.flex = "1";
  conferenceContacts.style.overflowY = "auto";
  conferenceContacts.style.padding = "4px 0";

  leftCol.appendChild(leftHeader);
  leftCol.appendChild(conferenceContacts);

  // colonna destra: kMeet + pulsante ON/OFF
  const rightCol = document.createElement("div");
  rightCol.style.flex = "1";
  rightCol.style.display = "flex";
  rightCol.style.flexDirection = "column";
  rightCol.style.backgroundColor = "#020617";

  const topBar = document.createElement("div");
  topBar.style.display = "flex";
  topBar.style.alignItems = "center";
  topBar.style.padding = "8px";
  topBar.style.borderBottom = "1px solid rgba(148,163,184,0.3)";
  topBar.style.backgroundColor = "#020617";
  topBar.style.gap = "8px";

  const confTitle = document.createElement("div");
  confTitle.textContent = "Conferenza globale kMeet";
  confTitle.style.flex = "1";
  confTitle.style.fontSize = "13px";
  confTitle.style.fontWeight = "600";
  confTitle.style.color = "#e5e7eb";

  kmeetToggleBtn = document.createElement("button");
  kmeetToggleBtn.textContent = "kMeet: ON";
  kmeetToggleBtn.title =
    "ON: apre kMeet. OFF: chiude kMeet e torna a ZEUS.";
  kmeetToggleBtn.style.padding = "4px 10px";
  kmeetToggleBtn.style.fontSize = "12px";
  kmeetToggleBtn.style.borderRadius = "999px";
  kmeetToggleBtn.style.border = "none";
  kmeetToggleBtn.style.cursor = "pointer";
  kmeetToggleBtn.style.background =
    "linear-gradient(135deg, #22c55e, #16a34a)";
  kmeetToggleBtn.style.color = "#f9fafb";

  topBar.appendChild(confTitle);
  topBar.appendChild(kmeetToggleBtn);

  conferenceMainArea = document.createElement("div");
  conferenceMainArea.id = "conference-main-area";
  conferenceMainArea.style.flex = "1";
  conferenceMainArea.style.display = "flex";
  conferenceMainArea.style.alignItems = "center";
  conferenceMainArea.style.justifyContent = "center";
  conferenceMainArea.style.backgroundColor = "#020617";

  const placeholder = document.createElement("div");
  placeholder.textContent =
    "Premi il pulsante kMeet: ON per aprire la conferenza ZEUS.\nSeleziona un utente nella rubrica per mandare l'invito.";
  placeholder.style.whiteSpace = "pre-line";
  placeholder.style.fontSize = "13px";
  placeholder.style.color = "#9ca3af";
  placeholder.style.textAlign = "center";
  placeholder.style.maxWidth = "420px";
  placeholder.style.lineHeight = "1.4";

  conferenceMainArea.appendChild(placeholder);

  rightCol.appendChild(topBar);
  rightCol.appendChild(conferenceMainArea);

  conferenceView.appendChild(leftCol);
  conferenceView.appendChild(rightCol);

  if (appView && appView.parentNode) {
    appView.parentNode.insertBefore(conferenceView, appView.nextSibling);
  }

  kmeetToggleBtn.addEventListener("click", () => {
    if (!isKmeetOn) {
      openKmeet();
    } else {
      closeKmeet();
    }
  });
}

function openKmeet() {
  if (!conferenceMainArea) return;
  conferenceMainArea.innerHTML = "";

  conferenceIframe = document.createElement("iframe");
  conferenceIframe.style.border = "none";
  conferenceIframe.style.width = "100%";
  conferenceIframe.style.height = "100%";
  conferenceIframe.allow =
    "camera; microphone; fullscreen; display-capture; autoplay";
  conferenceIframe.src = KMEET_URL;

  conferenceMainArea.appendChild(conferenceIframe);
  isKmeetOn = true;
  if (kmeetToggleBtn) {
    kmeetToggleBtn.textContent = "kMeet: OFF";
    kmeetToggleBtn.style.background =
      "linear-gradient(135deg, #f97316, #ea580c)";
  }
  appendSystemMessage(
    "Conferenza kMeet aperta. Quando premi di nuovo il pulsante, la conferenza si chiude e torni a ZEUS."
  );
}

function closeKmeet() {
  if (conferenceIframe && conferenceIframe.parentNode) {
    conferenceIframe.parentNode.removeChild(conferenceIframe);
  }
  conferenceIframe = null;
  isKmeetOn = false;

  if (conferenceMainArea) {
    conferenceMainArea.innerHTML = "";
  }

  if (kmeetToggleBtn) {
    kmeetToggleBtn.textContent = "kMeet: ON";
    kmeetToggleBtn.style.background =
      "linear-gradient(135deg, #22c55e, #16a34a)";
  }

  appendSystemMessage("Conferenza kMeet chiusa. Ritorno alla vista ZEUS.");

  if (conferenceView) {
    conferenceView.style.display = "none";
  }
  if (appView) {
    appView.style.display = "flex";
  }
  conferenceMode = false;
}

function enterConferenceMode() {
  if (conferenceMode) return;
  conferenceMode = true;

  ensureConferenceView();
  rebuildConferenceContacts(); // prende dalla rubrica già piena

  if (appView) {
    appView.style.display = "none";
  }
  if (conferenceView) {
    conferenceView.style.display = "flex";
  }

  appendSystemMessage(
    "Modalità conferenza attiva. Usa la rubrica a sinistra e kMeet a destra."
  );
}

function exitConferenceMode() {
  if (!conferenceMode) return;
  conferenceMode = false;
  closeKmeet();
}

// bottone conferenza
const conferenceBtn = document.createElement("button");
conferenceBtn.id = "conference-toggle";
conferenceBtn.textContent = "Conferenza";
conferenceBtn.title = "Attiva o disattiva conferenza globale ZEUS (kMeet)";
conferenceBtn.style.marginLeft = "8px";
conferenceBtn.style.padding = "4px 10px";
conferenceBtn.style.fontSize = "12px";
conferenceBtn.style.borderRadius = "999px";
conferenceBtn.style.border = "none";
conferenceBtn.style.cursor = "pointer";
conferenceBtn.style.background =
  "linear-gradient(135deg, #6366f1, #ec4899)";
conferenceBtn.style.color = "#f9fafb";

if (chatHeader) {
  chatHeader.appendChild(conferenceBtn);
}

conferenceBtn.addEventListener("click", () => {
  if (!currentUser || !currentUser.email) {
    appendSystemMessage(
      "Devi effettuare il login prima di usare la conferenza."
    );
    return;
  }

  if (!conferenceMode) {
    enterConferenceMode();
  } else {
    exitConferenceMode();
  }
});

// ---- bottone microfono ----
const micBtn = document.createElement("button");
micBtn.id = "mic-btn";
micBtn.textContent = "🎤";
micBtn.title = "Tieni premuto per registrare un messaggio vocale";
micBtn.style.marginLeft = "8px";
micBtn.style.padding = "4px 8px";
micBtn.style.cursor = "pointer";

window.addEventListener("DOMContentLoaded", () => {
  const inputBar = document.getElementById("input-bar");
  if (inputBar) {
    inputBar.appendChild(micBtn);
  }
  initAudioMimeType();
});

// ---- scelta formato audio ----
function initAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    appendSystemMessage(
      "Questo browser non supporta la registrazione vocale (MediaRecorder assente)."
    );
    return;
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      supportedAudioMimeType = type;
      appendSystemMessage(
        "Formato messaggi vocali preferito: " + supportedAudioMimeType
      );
      return;
    }
  }

  appendSystemMessage(
    "Nessun formato preferito trovato; uso configurazione predefinita del browser per i messaggi vocali."
  );
}

// ---- vista app ----
function showLogin() {
  if (loginView) loginView.style.display = "flex";
  if (appView) appView.style.display = "none";
}

function showApp() {
  if (loginView) loginView.style.display = "none";
  if (appView) appView.style.display = "flex";
  updateChatHeader();
}

function updateChatHeader() {
  if (!chatTitleText) return;
  if (selectedContactEmail) {
    chatTitleText.textContent = `Chat privata/chiamata con: ${selectedContactEmail}`;
  } else {
    chatTitleText.textContent =
      "Seleziona un contatto per iniziare una chat privata (le chiamate in arrivo funzionano anche senza selezione).";
  }
}

// ---- RUBRICA ZEUS ----
async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    contactsList.innerHTML = "";
    selectedContactEmail = null;

    users.forEach((u) => {
      const div = document.createElement("div");
      div.className = "contact";

      const statusDot = document.createElement("span");
      statusDot.style.display = "inline-block";
      statusDot.style.width = "8px";
      statusDot.style.height = "8px";
      statusDot.style.borderRadius = "50%";
      statusDot.style.marginRight = "6px";
      statusDot.style.backgroundColor = onlineUsers[u.email]
        ? "#22c55e"
        : "#6b7280";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = u.name;
      nameSpan.style.fontWeight = "500";
      nameSpan.style.marginRight = "4px";

      const emailSpan = document.createElement("span");
      emailSpan.textContent = `(${u.email})`;
      emailSpan.style.fontSize = "11px";
      emailSpan.style.color = "#9ca3af";

      const textSpan = document.createElement("span");
      textSpan.appendChild(nameSpan);
      textSpan.appendChild(emailSpan);

      div.appendChild(statusDot);
      div.appendChild(textSpan);

      div.addEventListener("click", () => {
        selectedContactEmail = u.email;
        document.querySelectorAll(".contact").forEach((c) => {
          c.classList.remove("selected");
        });
        div.classList.add("selected");
        updateChatHeader();
        clearCallLogIfTooLong();
      });

      contactsList.appendChild(div);
    });

    // la conferenza si basa sempre sulla rubrica già renderizzata
    rebuildConferenceContacts();

    updateChatHeader();
  } catch (err) {
    console.error("Errore loadUsers", err);
  }
}

// ---- RUBRICA CONFERENZA ----
function rebuildConferenceContacts() {
  if (!conferenceContacts) return;

  const contactNodes = Array.from(
    contactsList.querySelectorAll(".contact")
  );

  conferenceContacts.innerHTML = "";

  if (!contactNodes.length) {
    const empty = document.createElement("div");
    empty.textContent = "Nessun utente in rubrica.";
    empty.style.fontSize = "12px";
    empty.style.color = "#9ca3af";
    empty.style.padding = "8px";
    conferenceContacts.appendChild(empty);
    return;
  }

  contactNodes.forEach((c) => {
    const text = c.textContent || "";
    const match = text.match(/^(.*)\(([^)]+)\)\s*$/);
    const name = match ? match[1].trim() : text.trim();
    const email = match ? match[2].trim() : "";

    const div = document.createElement("div");
    div.className = "conference-contact";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "space-between";
    div.style.padding = "6px 10px";
    div.style.cursor = "pointer";
    div.style.fontSize = "12px";

    div.addEventListener("mouseenter", () => {
      div.style.backgroundColor = "rgba(15,23,42,0.9)";
    });
    div.addEventListener("mouseleave", () => {
      div.style.backgroundColor = "transparent";
    });

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";

    const statusDot = document.createElement("span");
    statusDot.style.display = "inline-block";
    statusDot.style.width = "8px";
    statusDot.style.height = "8px";
    statusDot.style.borderRadius = "50%";
    statusDot.style.marginRight = "6px";
    statusDot.style.backgroundColor = onlineUsers[email]
      ? "#22c55e"
      : "#6b7280";

    const label = document.createElement("span");
    label.textContent = `${name} (${email})`;
    label.style.color = "#e5e7eb";

    left.appendChild(statusDot);
    left.appendChild(label);

    const inviteBtn = document.createElement("button");
    inviteBtn.textContent = "Invita";
    inviteBtn.style.fontSize = "11px";
    inviteBtn.style.padding = "2px 8px";
    inviteBtn.style.borderRadius = "999px";
    inviteBtn.style.border = "none";
    inviteBtn.style.cursor = "pointer";
    inviteBtn.style.background = "rgba(56,189,248,0.1)";
    inviteBtn.style.color = "#38bdf8";

    inviteBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      if (!isKmeetOn) {
        appendSystemMessage(
          "Apri prima kMeet (kMeet: ON) per mandare inviti alla conferenza."
        );
        return;
      }
      if (!currentUser) {
        appendSystemMessage("Devi essere loggato per mandare inviti.");
        return;
      }
      if (!email) {
        appendSystemMessage("Email destinatario non valida per kMeet.");
        return;
      }

      socket.emit("kmeet-invite", {
        toEmail: email,
        roomUrl: KMEET_URL,
      });

      appendSystemMessage(
        `Invito conferenza kMeet mandato a ${email}.`
      );
    });

    div.appendChild(left);
    div.appendChild(inviteBtn);

    conferenceContacts.appendChild(div);
  });
}

// presenza
socket.on("user-online", (user) => {
  if (user && user.email) {
    onlineUsers[user.email] = true;
  }
  loadUsers();
});

socket.on("user-offline", (user) => {
  if (user && user.email) {
    onlineUsers[user.email] = false;
  }
  loadUsers();
});

// ---- CHAT TESTO ----
socket.on("chat-message", (msg) => {
  const div = document.createElement("div");
  div.classList.add("msg");
  if (currentUser && msg.from.email === currentUser.email) {
    div.classList.add("from-me");
    div.textContent = `[CONFERENZA] TU: ${msg.text}`;
  } else {
    div.classList.add("from-other");
    div.textContent = `[CONFERENZA] ${msg.from.name}: ${msg.text}`;
  }
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

socket.on("private-message", (msg) => {
  const div = document.createElement("div");
  div.classList.add("msg");
  if (currentUser && msg.from.email === currentUser.email) {
    div.classList.add("from-me");
    div.textContent = `(privato) TU: ${msg.text}`;
  } else {
    div.classList.add("from-other");
    div.textContent = `(privato) ${msg.from.name}: ${msg.text}`;
  }
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

// invito kMeet lato invitato
socket.on("kmeet-invite", ({ from, roomUrl }) => {
  if (!from || !roomUrl) return;

  const ok = confirm(
    `${from.name} ti invita alla conferenza kMeet ZEUS.\nVuoi entrare ora?`
  );
  if (ok) {
    window.open(roomUrl, "_blank");
  }
});

// invio testo: sempre chat privata
sendBtn.addEventListener("click", () => {
  const text = input.value.trim();
  if (!text || !currentUser) return;

  if (!selectedContactEmail) {
    appendSystemMessage(
      "Seleziona un contatto per inviare un messaggio privato."
    );
    input.value = "";
    return;
  }

  socket.emit("private-message", {
    toEmail: selectedContactEmail,
    text,
  });

  input.value = "";
});

input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

// ---- WAV ENCODER ----
function encodeWAVFromFloat32(float32Array, sampleRate = 44100) {
  const numChannels = 1;
  const numSamples = float32Array.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  let offset = 0;

  writeString(view, offset, "RIFF");
  offset += 4;
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString(view, offset, "WAVE");
  offset += 4;

  writeString(view, offset, "fmt ");
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;

  writeString(view, offset, "data");
  offset += 4;
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < numSamples; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ---- MESSAGGI VOCALI ----
async function startRecording() {
  if (isRecording) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendSystemMessage(
      "Questo browser non permette di usare il microfono per i messaggi vocali."
    );
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    try {
      if (supportedAudioMimeType) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: supportedAudioMimeType,
        });
      } else {
        mediaRecorder = new MediaRecorder(stream);
      }
    } catch (e) {
      console.warn("MediaRecorder mimeType non accettato, uso default.", e);
      mediaRecorder = new MediaRecorder(stream);
    }

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onerror = (ev) => {
      console.error("MediaRecorder errore:", ev.error || ev);
      appendSystemMessage("Errore durante la registrazione vocale.");
    };

    mediaRecorder.onstop = async () => {
      if (!audioChunks.length) {
        appendSystemMessage("Nessun audio registrato.");
      } else {
        try {
          const blob = new Blob(audioChunks);
          const arrayBuffer = await blob.arrayBuffer();
          const audioContext = new (window.AudioContext ||
            window.webkitAudioContext)();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          const channelData = audioBuffer.getChannelData(0);
          const wavBlob = encodeWAVFromFloat32(
            channelData,
            audioBuffer.sampleRate || 44100
          );

          sendVoiceMessage(wavBlob);
        } catch (err) {
          console.error("Errore conversione in WAV:", err);
          appendSystemMessage(
            "Errore durante la conversione del messaggio vocale in WAV."
          );
        }
      }
      audioChunks = [];
      stream.getTracks().forEach((t) => t.stop());
    };

    mediaRecorder.start();
    isRecording = true;
    micBtn.textContent = "⏺️";
  } catch (err) {
    console.error("Errore accesso microfono", err);
    alert("Impossibile accedere al microfono.");
  }
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
    const base64data = reader.result;

    if (!selectedContactEmail) {
      appendSystemMessage(
        "Seleziona un contatto per inviare un messaggio vocale privato."
      );
      return;
    }

    socket.emit("voice-message", {
      mode: "private",
      toEmail: selectedContactEmail,
      audio: base64data,
    });
  };
  reader.readAsDataURL(blob);
}

micBtn.addEventListener("mousedown", () => {
  startRecording();
});
micBtn.addEventListener("mouseup", () => {
  stopRecording();
});
micBtn.addEventListener("mouseleave", () => {
  if (isRecording) {
    stopRecording();
  }
});

socket.on("voice-message", (msg) => {
  const div = document.createElement("div");
  div.classList.add("msg");

  if (currentUser && msg.from.email === currentUser.email) {
    div.classList.add("from-me");
  } else {
    div.classList.add("from-other");
  }

  const label = document.createElement("div");
  label.textContent = `(privato) messaggio vocale da ${msg.from.name}`;
  div.appendChild(label);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = msg.audio;

  audio.onerror = () => {
    label.textContent += " (errore audio: formato non supportato dal browser).";
  };

  div.appendChild(audio);

  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

// ---- LOG UTENTE ----
function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.classList.add("msg");
  div.textContent = text;
  if (callLogDiv) {
    callLogDiv.appendChild(div);
    callLogDiv.scrollTop = callLogDiv.scrollHeight;
    clearCallLogIfTooLong();
  } else {
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }
}

function clearCallLogIfTooLong() {
  if (!callLogDiv) return;
  const maxMessages = 50;
  while (callLogDiv.children.length > maxMessages) {
    callLogDiv.removeChild(callLogDiv.firstChild);
  }
}

// =====================================================================
// ==== WEBRTC AUDIO/VIDEO 1-a-1 (SEZIONE AGGIORNATA / RINFORZATA) ====
// =====================================================================

// helper per creare stream locale con controlli extra
async function getLocalStreamAudioOnly() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendSystemMessage(
      "Questo browser non supporta getUserMedia (audio)."
    );
    throw new Error("getUserMedia non supportato");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  } catch (err) {
    console.error("getUserMedia audio fallita:", err);
    appendSystemMessage(
      "Impossibile accedere al microfono per la chiamata (controlla permessi / dispositivo)."
    );
    throw err;
  }
}

async function getLocalStreamAudioVideo() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendSystemMessage(
      "Questo browser non supporta getUserMedia (video)."
    );
    throw new Error("getUserMedia non supportato");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    if (localVideoElement) {
      localVideoElement.srcObject = stream;
    }
    return stream;
  } catch (err) {
    console.error("getUserMedia audio+video fallita:", err);
    appendSystemMessage(
      "Impossibile accedere a microfono/camera per la videochiamata (controlla permessi / dispositivo)."
    );
    throw err;
  }
}

async function startLocalAudio() {
  if (localStream) return localStream;
  localStream = await getLocalStreamAudioOnly();
  return localStream;
}

async function startLocalMediaWithVideo() {
  localStream = await getLocalStreamAudioVideo();
  return localStream;
}

function createPeerConnection(targetEmail) {
  if (peerConnection) {
    // in caso sia rimasto qualcosa aperto, chiudiamo prima
    try {
      peerConnection.close();
    } catch {}
    peerConnection = null;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentCallPeerEmail) {
      socket.emit("call-ice-candidate", {
        toEmail: currentCallPeerEmail,
        candidate: event.candidate,
      });
    }
  };

  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0];

    if (!remoteAudioElement) {
      remoteAudioElement = document.createElement("audio");
      remoteAudioElement.autoplay = true;
      remoteAudioElement.controls = true;
      appendSystemMessage("Audio remoto connesso.");
    }
    remoteAudioElement.srcObject = remoteStream;

    if (remoteVideoElement) {
      remoteVideoElement.srcObject = remoteStream;
    }
  };

  peerConnection.onconnectionstatechange = () => {
    appendSystemMessage(
      `Stato connessione WebRTC: ${peerConnection.connectionState}`
    );
    if (peerConnection.connectionState === "failed") {
      appendSystemMessage(
        "Connessione WebRTC fallita (es. NAT/Firewall/STUN)."
      );
    }
  };

  return peerConnection;
}

async function endCall(reason = "Chiamata terminata.") {
  isAudioCallActive = false;
  isVideoCallActive = false;
  currentCallPeerEmail = null;

  if (peerConnection) {
    try {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    } catch (e) {
      console.warn("Errore chiusura peerConnection:", e);
    }
    peerConnection = null;
  }

  if (localStream) {
    try {
      localStream.getTracks().forEach((t) => t.stop());
    } catch {}
    localStream = null;
  }

  if (remoteAudioElement) {
    remoteAudioElement.srcObject = null;
    remoteAudioElement = null;
  }

  if (localVideoElement) {
    localVideoElement.srcObject = null;
  }
  if (remoteVideoElement) {
    remoteVideoElement.srcObject = null;
  }
  if (videoArea) {
    videoArea.style.display = "none";
  }

  appendSystemMessage(reason);
}

// chiamata audio
async function startAudioCall() {
  if (!selectedContactEmail) {
    appendSystemMessage("Seleziona un contatto per iniziare una chiamata audio.");
    return;
  }

  if (isAudioCallActive || isVideoCallActive) {
    appendSystemMessage("C'è già una chiamata in corso.");
    return;
  }

  try {
    const stream = await startLocalAudio();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection(currentCallPeerEmail);

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("call-offer", {
      toEmail: currentCallPeerEmail,
      offer: peerConnection.localDescription,
      mode: "audio",
    });

    isAudioCallActive = true;
    appendSystemMessage(
      `Chiamata audio verso ${currentCallPeerEmail} in corso...`
    );
  } catch (err) {
    console.error("Errore avvio chiamata audio", err);
    appendSystemMessage("Errore durante l'avvio della chiamata audio.");
    await endCall("Chiamata audio interrotta per errore.");
  }
}

if (audioCallBtn) {
  audioCallBtn.addEventListener("click", () => {
    if (!isAudioCallActive && !isVideoCallActive) {
      startAudioCall();
    } else {
      if (currentCallPeerEmail) {
        socket.emit("call-hangup", {
          toEmail: currentCallPeerEmail,
        });
      }
      endCall("Chiamata chiusa da te.");
    }
  });
}

// videochiamata
async function startVideoCall() {
  if (!selectedContactEmail) {
    appendSystemMessage("Seleziona un contatto per iniziare una videochiamata.");
    return;
  }

  if (isVideoCallActive || isAudioCallActive) {
    appendSystemMessage("C'è già una chiamata in corso.");
    return;
  }

  try {
    const stream = await startLocalMediaWithVideo();
    currentCallPeerEmail = selectedContactEmail;
    createPeerConnection(currentCallPeerEmail);

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    if (videoArea) {
      videoArea.style.display = "block";
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("call-offer", {
      toEmail: currentCallPeerEmail,
      offer: peerConnection.localDescription,
      mode: "video",
    });

    isVideoCallActive = true;
    appendSystemMessage(
      `Videochiamata verso ${currentCallPeerEmail} in corso...`
    );
  } catch (err) {
    console.error("Errore avvio videochiamata", err);
    appendSystemMessage("Errore durante l'avvio della videochiamata.");
    await endCall("Videochiamata interrotta per errore.");
  }
}

if (videoCallBtn) {
  videoCallBtn.addEventListener("click", () => {
    if (!isVideoCallActive && !isAudioCallActive) {
      startVideoCall();
    } else {
      if (currentCallPeerEmail) {
        socket.emit("call-hangup", {
          toEmail: currentCallPeerEmail,
        });
      }
      endCall("Chiamata (audio/video) chiusa da te.");
    }
  });
}

// ---- SEGNALAZIONE CHIAMATE ----
socket.on("call-offer", async ({ from, offer, mode }) => {
  if (!from || !from.email || !offer) {
    appendSystemMessage("Offerta di chiamata non valida.");
    return;
  }

  // se c'è già una chiamata attiva, rifiutiamo
  if (isAudioCallActive || isVideoCallActive) {
    socket.emit("call-reject", { toEmail: from.email });
    appendSystemMessage(
      `Chiamata in arrivo da ${from.email} rifiutata (altra chiamata in corso).`
    );
    return;
  }

  selectedContactEmail = from.email;
  currentCallPeerEmail = from.email;
  updateChatHeader();

  try {
    if (!ringtoneAudio) {
      ringtoneAudio = new Audio("/ringtone.mp3");
      ringtoneAudio.loop = true;
    }
    await ringtoneAudio.play();
  } catch (e) {
    console.warn(
      "Impossibile riprodurre squillo (auto-play bloccato dal browser)."
    );
  }

  const isVideo = mode === "video";
  const label = isVideo ? "video" : "audio";

  const accept = confirm(
    `Chiamata ${label} in arrivo da ${from.name} (${from.email}).\n` +
      `Puoi rispondere direttamente, non serve selezionare un contatto. Vuoi rispondere?`
  );

  if (ringtoneAudio) {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
  }

  if (!accept) {
    socket.emit("call-reject", { toEmail: from.email });
    return;
  }

  try {
    let stream;
    if (isVideo) {
      stream = await startLocalMediaWithVideo();
    } else {
      stream = await startLocalAudio();
    }

    createPeerConnection(currentCallPeerEmail);

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    if (isVideo && videoArea) {
      videoArea.style.display = "block";
    }

    // attenzione: prima setRemoteDescription(offer), poi createAnswer
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("call-answer", {
      toEmail: from.email,
      answer: peerConnection.localDescription,
      mode,
    });

    isAudioCallActive = !isVideo;
    isVideoCallActive = isVideo;

    if (isVideo) {
      appendSystemMessage(`Videochiamata con ${from.email} attiva.`);
    } else {
      appendSystemMessage(`Chiamata audio con ${from.email} attiva.`);
    }
  } catch (err) {
    console.error("Errore risposta chiamata", err);
    appendSystemMessage("Errore durante la risposta alla chiamata.");
    await endCall("Chiamata interrotta per errore nella risposta.");
  }
});

socket.on("call-answer", async ({ from, answer, mode }) => {
  if (!peerConnection || !answer) return;
  try {
    await peerConnection.setRemoteDescription(answer);

    if (mode === "video") {
      isVideoCallActive = true;
      if (videoArea) videoArea.style.display = "block";
      appendSystemMessage(`Videochiamata con ${from.email} connessa.`);
    } else {
      isAudioCallActive = true;
      appendSystemMessage(`Chiamata audio con ${from.email} connessa.`);
    }
  } catch (err) {
    console.error("Errore setRemoteDescription(answer)", err);
    appendSystemMessage(
      "Errore nel completare la connessione della chiamata."
    );
    await endCall("Chiamata interrotta per errore di connessione.");
  }
});

socket.on("call-ice-candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.error("Errore addIceCandidate", err);
    appendSystemMessage("Errore nella gestione dei candidati ICE.");
  }
});

socket.on("call-hangup", ({ from }) => {
  endCall(`Chiamata chiusa da ${from?.email || "remote"}.`);
});

socket.on("call-reject", ({ from }) => {
  endCall(`Chiamata rifiutata da ${from?.email || "remote"}.`);
});

// ---- BOOTSTRAP DOPO LOGIN ----
window.initZeusApp = function (user) {
  currentUser = user || null;
  if (!currentUser || !currentUser.email) {
    appendSystemMessage("Utente non valido dopo il login.");
    return;
  }

  showApp();

  socket.emit("set-user", currentUser);
  loadUsers();
};
