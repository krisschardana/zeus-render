const socket = io();
let currentUser = null;
let selectedContactEmail = null;
let isConference = false;
const onlineUsers = {}; // email -> true/false

// ---- AUDIO / MESSAGGI VOCALI ----
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ---- STATO CHIAMATA (WEBRTC) ----
let isAudioCallActive = false;
let isVideoCallActive = false;
let peerConnection = null;
let localStream = null;
let remoteAudioElement = null;
let localVideoElement = null;
let remoteVideoElement = null;
let videoArea = null;
let currentCallPeerEmail = null; // email del contatto con cui sei in chiamata
let ringtoneAudio = null; // campanella

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" } // STUN pubblico base
  ],
};

// elementi DOM
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

// elementi video
videoArea = document.getElementById("video-area");
localVideoElement = document.getElementById("localVideo");
remoteVideoElement = document.getElementById("remoteVideo");

// ---- NUOVO: pannello log tecnico separato ----
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

  // lo mettiamo subito sopra il composer, sotto l'area chat
  const composer = document.getElementById("composer");
  if (composer && chatDiv && chatDiv.parentNode) {
    chatDiv.parentNode.insertBefore(callLogDiv, composer);
  }
}

// ---- GRAFICA BOTTONI (solo icone, niente testo che cambia) ----
if (audioCallBtn) {
  audioCallBtn.textContent = "";
}
if (videoCallBtn) {
  videoCallBtn.textContent = "";
}

// bottone conferenza
const conferenceBtn = document.createElement("button");
conferenceBtn.id = "conference-toggle";
conferenceBtn.textContent = "";
chatHeader.appendChild(conferenceBtn);

// bottone microfono (messaggi vocali)
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
});

// funzioni vista
function showLogin() {
  if (loginView) loginView.style.display = "flex";
  if (appView) appView.style.display = "none";
}

function showApp() {
  if (loginView) loginView.style.display = "none";
  if (appView) appView.style.display = "block";
  updateChatHeader();
}

// header
function updateChatHeader() {
  if (!chatTitleText) return;

  if (isConference) {
    chatTitleText.textContent = "Conferenza globale";
  } else {
    if (selectedContactEmail) {
      chatTitleText.textContent = `Chat privata/chiamata con: ${selectedContactEmail}`;
    } else {
      chatTitleText.textContent =
        "Seleziona un contatto per iniziare una chat privata (le chiamate in arrivo funzionano anche senza selezione).";
    }
  }
}

// toggle conferenza
conferenceBtn.addEventListener("click", () => {
  isConference = !isConference;
  updateChatHeader();
});

// ---- LOGIN SEMPLICE (senza OTP) ----
loginBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  if (!name || !email) {
    errorDiv.textContent = "Nome ed email sono obbligatori.";
    return;
  }

  errorDiv.textContent = "Accesso in corso...";
  loginBtn.disabled = true;
  loginBtn.textContent = "Accesso in corso...";

  try {
    const res = await fetch("/api/login-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json();

    if (!data.ok) {
      errorDiv.textContent = data.error || "Errore di accesso.";
      return;
    }

    currentUser = data.user;
    socket.emit("set-user", currentUser);
    errorDiv.textContent = "";
    showApp();
    loadUsers();
  } catch (err) {
    console.error("Errore login", err);
    errorDiv.textContent = "Errore di rete durante l'accesso.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Entra";
  }
});

// carica lista utenti con pallino online
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

        // quando scelgo un contatto, pulisco un po' il log tecnico
        clearCallLogIfTooLong();
      });

      contactsList.appendChild(div);
    });

    updateChatHeader();
  } catch (err) {
    console.error("Errore loadUsers", err);
  }
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

// messaggi conferenza (testo)
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

// messaggi privati (testo)
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

// invio testo
sendBtn.addEventListener("click", () => {
  const text = input.value.trim();
  if (!text || !currentUser) return;

  if (isConference) {
    socket.emit("chat-message", text);
  } else {
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
  }

  input.value = "";
});

input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

// ---- GESTIONE MESSAGGI VOCALI (CLIENT) ----
async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      sendVoiceMessage(blob);
      audioChunks = [];
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

    if (isConference) {
      socket.emit("voice-message", {
        mode: "conference",
        audio: base64data,
      });
    } else {
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
    }
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

// ricezione messaggi vocali
socket.on("voice-message", (msg) => {
  const div = document.createElement("div");
  div.classList.add("msg");

  if (currentUser && msg.from.email === currentUser.email) {
    div.classList.add("from-me");
  } else {
    div.classList.add("from-other");
  }

  const label = document.createElement("div");
  label.textContent =
    msg.mode === "conference"
      ? `[CONFERENZA] messaggio vocale da ${msg.from.name}`
      : `(privato) messaggio vocale da ${msg.from.name}`;
  div.appendChild(label);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = msg.audio;
  div.appendChild(audio);

  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

// ---- FUNZIONI UTILI ----
function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.classList.add("msg");
  div.textContent = text;
  // MESSAGGIO TECNICO NEL PANNELLO LOG, NON IN MEZZO ALLA CHAT
  if (callLogDiv) {
    callLogDiv.appendChild(div);
    callLogDiv.scrollTop = callLogDiv.scrollHeight;
    clearCallLogIfTooLong();
  } else {
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }
}

// limita il log per non farlo crescere all'infinito
function clearCallLogIfTooLong() {
  if (!callLogDiv) return;
  const maxMessages = 50;
  while (callLogDiv.children.length > maxMessages) {
    callLogDiv.removeChild(callLogDiv.firstChild);
  }
}

// ---- WEBRTC: AUDIO E VIDEO ----
async function startLocalAudio() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return localStream;
}

async function startLocalMediaWithVideo() {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });
  if (localVideoElement) {
    localVideoElement.srcObject = localStream;
  }
  return localStream;
}

function createPeerConnection(targetEmail) {
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("call-ice-candidate", {
        toEmail: targetEmail,
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

  return peerConnection;
}

// ---- CHIAMATA AUDIO ----
async function startAudioCall() {
  if (!selectedContactEmail) {
    appendSystemMessage("Seleziona un contatto per iniziare una chiamata audio.");
    return;
  }
  if (isConference) {
    appendSystemMessage(
      "Per ora la chiamata audio è solo 1-a-1, non conferenza."
    );
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
      offer,
      mode: "audio",
    });

    isAudioCallActive = true;
    appendSystemMessage(
      `Chiamata audio verso ${currentCallPeerEmail} in corso...`
    );
  } catch (err) {
    console.error("Errore avvio chiamata audio", err);
    appendSystemMessage("Errore durante l'avvio della chiamata audio.");
  }
}

async function endCall(reason = "Chiamata terminata.") {
  isAudioCallActive = false;
  isVideoCallActive = false;
  currentCallPeerEmail = null;

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
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

// ---- VIDEOCHIAMATA ----
async function startVideoCall() {
  if (!selectedContactEmail) {
    appendSystemMessage("Seleziona un contatto per iniziare una videochiamata.");
    return;
  }
  if (isConference) {
    appendSystemMessage(
      "Per ora la videochiamata è solo 1-a-1, non conferenza."
    );
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
      offer,
      mode: "video",
    });

    isVideoCallActive = true;
    appendSystemMessage(
      `Videochiamata verso ${currentCallPeerEmail} in corso...`
    );
  } catch (err) {
    console.error("Errore avvio videochiamata", err);
    appendSystemMessage("Errore durante l'avvio della videochiamata.");
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

// ---- SEGNALAZIONE: OFFER/ANSWER/ICE ----
socket.on("call-offer", async ({ from, offer, mode }) => {
  if (!from || !from.email || !offer) {
    appendSystemMessage("Offerta di chiamata non valida.");
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

    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("call-answer", {
      toEmail: from.email,
      answer,
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
  }
});

socket.on("call-ice-candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.error("Errore addIceCandidate", err);
  }
});

socket.on("call-hangup", ({ from }) => {
  endCall(`Chiamata chiusa da ${from?.email || "remote"}.`);
});

socket.on("call-reject", ({ from }) => {
  endCall(`Chiamata rifiutata da ${from?.email || "remote"}.`);
});

// avvio
showLogin();
