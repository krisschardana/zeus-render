// server_step7.js
// ZEUS server: chat + vocali + WebRTC audio/video + EMAIL OTP (standby per Render)

// ATTENZIONE: il codice OTP resta nel file ma NON viene usato per il login.
// Quando avrai una VPS, potrai riattivarlo facilmente.

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer"); // <-- email (non usata ora)
const crypto = require("crypto");         // <-- per OTP sicuro (non usato ora)

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// porta (locale 8080 oppure porta fornita da Render)
const PORT = process.env.PORT || 8080;

// modalità test OTP (niente invio SMTP reale)
// su Render: TEST_MODE può essere "true"/"false", "1"/"0", "yes"/"no"
const rawTestMode = (process.env.TEST_MODE || "").toString().trim().toLowerCase();
const TEST_MODE = rawTestMode === "true" || rawTestMode === "1" || rawTestMode === "yes";

console.log("Valore TEST_MODE (env):", process.env.TEST_MODE);
console.log("Valore TEST_MODE (boolean):", TEST_MODE);

// CONFIG EMAIL da variabili d'ambiente (NO password in chiaro)
// Su Render imposta ad es.:
// SMTP_HOST = mail.infomaniak.com
// SMTP_PORT = 587
// SMTP_USER = gnosis@ik.me
// SMTP_PASS = <la tua password>
// opzionale: SMTP_FROM_NAME = "ZEUS APP"
const SMTP_HOST = process.env.SMTP_HOST || "mail.infomaniak.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "gnosis@ik.me";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "ZEUS APP";

// utenti in “database” in memoria
// struttura: [{ name, email }]
const users = [];

// mappa email -> socket.id (utente online)
const onlineSocketsByEmail = {};

// mappa email -> dati OTP (per futuro uso)
// { [email]: { code: '123456', expiresAt: 1234567890, name: '...' } }
const pendingOtps = {};

// middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- CONFIGURAZIONE EMAIL (Nodemailer + Infomaniak) ----
let transporter = null;

if (!TEST_MODE) {
  if (!SMTP_PASS) {
    console.warn("ATTENZIONE: SMTP_PASS non impostata. L'invio email fallirà.");
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false, // STARTTLS su 587
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  console.log("Modalità EMAIL reale attiva (TEST_MODE = false).");
  console.log(`SMTP host: ${SMTP_HOST}:${SMTP_PORT}, user: ${SMTP_USER}`);
} else {
  console.log("ATTENZIONE: TEST_MODE = true, OTP NON inviato via email, solo log.");
}

// funzione per creare OTP 6 cifre sicuro (per futuro uso)
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

// ---- API REST EMAIL + OTP ----
// *** STANDBY OTP ***
// Ora /api/login-request fa login diretto e NON genera né invia OTP,
// così l'app non viene bloccata da Render/SMTP.

// 1) Richiesta login: LOGIN DIRETTO (OTP in standby)
app.post("/api/login-request", async (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  }

  // LOGIN DIRETTO: cerca o crea utente, senza OTP
  let user = users.find((u) => u.email === email);
  if (!user) {
    user = { name, email };
    users.push(user);
  }

  // se in futuro vorrai riattivare OTP, userai pendingOtps + generateOtp qui.
  return res.json({ ok: true, user });
});

// 2) Verifica OTP (NON usata ora, tenuta pronta per VPS futura)
app.post("/api/login-verify", (req, res) => {
  const { name, email, code } = req.body || {};

  if (!name || !email || !code) {
    return res.json({
      ok: false,
      error: "Nome, email e codice sono obbligatori.",
    });
  }

  const otpData = pendingOtps[email];
  if (!otpData) {
    return res.json({
      ok: false,
      error: "Nessun codice OTP trovato per questa email.",
    });
  }

  if (Date.now() > otpData.expiresAt) {
    delete pendingOtps[email];
    return res.json({
      ok: false,
      error: "Codice OTP scaduto. Richiedi un nuovo codice.",
    });
  }

  if (otpData.code !== code) {
    return res.json({ ok: false, error: "Codice OTP non valido." });
  }

  // OTP corretto: rimuovi pendente
  delete pendingOtps[email];

  // cerca se esiste già
  let user = users.find((u) => u.email === email);
  if (!user) {
    user = { name, email };
    users.push(user);
  }

  return res.json({ ok: true, user });
});

// ---- API REST SEMPLICI ORIGINALE (debug) ----
app.post("/api/login", (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  }

  let user = users.find((u) => u.email === email);
  if (!user) {
    user = { name, email };
    users.push(user);
  }

  return res.json({ ok: true, user });
});

// lista utenti
app.get("/api/users", (req, res) => {
  res.json(users);
});

// ---- SOCKET.IO ----
io.on("connection", (socket) => {
  console.log("Utente connesso:", socket.id);

  // memorizza l'utente associato a questo socket
  socket.on("set-user", (user) => {
    if (!user || !user.email) return;
    socket.data.user = user;
    onlineSocketsByEmail[user.email] = socket.id;

    // notifica a tutti che questo utente è online
    io.emit("user-online", user);
  });

  // ---- CHAT TESTO ----
  socket.on("chat-message", (text) => {
    const from = socket.data.user;
    if (!from) return;

    io.emit("chat-message", {
      from,
      text,
      ts: Date.now(),
    });
  });

  socket.on("private-message", ({ toEmail, text }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !text) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("private-message", {
      from,
      text,
      ts: Date.now(),
    });

    socket.emit("private-message", {
      from,
      text,
      ts: Date.now(),
    });
  });

  // ---- INVITI KMEET (CONFERENZA) ----
  socket.on("kmeet-invite", ({ toEmail, roomUrl }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !roomUrl) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("kmeet-invite", {
      from,
      roomUrl,
      ts: Date.now(),
    });
  });

  // ---- MESSAGGI VOCALI ----
  socket.on("voice-message", (payload) => {
    const from = socket.data.user;
    if (!from) return;

    const { mode, toEmail, audio } = payload || {};
    if (!audio) return;

    if (mode === "conference") {
      io.emit("voice-message", {
        mode: "conference",
        from,
        audio,
        ts: Date.now(),
      });
    } else if (mode === "private" && toEmail) {
      const targetSocketId = onlineSocketsByEmail[toEmail];
      if (!targetSocketId) return;

      io.to(targetSocketId).emit("voice-message", {
        mode: "private",
        from,
        audio,
        ts: Date.now(),
      });

      socket.emit("voice-message", {
        mode: "private",
        from,
        audio,
        ts: Date.now(),
      });
    }
  });

  // ---- SEGNALAZIONE WEBRTC (AUDIO + VIDEO) ----
  socket.on("call-offer", ({ toEmail, offer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !offer) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-offer", {
      from,
      offer,
      mode: mode || "audio",
    });
  });

  socket.on("call-answer", ({ toEmail, answer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !answer) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-answer", {
      from,
      answer,
      mode: mode || "audio",
    });
  });

  socket.on("call-ice-candidate", ({ toEmail, candidate }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !candidate) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-ice-candidate", {
      from,
      candidate,
    });
  });

  socket.on("call-hangup", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-hangup", {
      from,
    });
  });

  socket.on("call-reject", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-reject", {
      from,
    });
  });

  socket.on("disconnect", () => {
    const user = socket.data.user;
    if (user && user.email) {
      const currentId = onlineSocketsByEmail[user.email];
      if (currentId === socket.id) {
        delete onlineSocketsByEmail[user.email];
      }
      io.emit("user-offline", user);
    }
    console.log("Utente disconnesso:", socket.id);
  });
});

// avvio server
server.listen(PORT, () => {
  console.log(`ZEUS server attivo su http://localhost:${PORT}`);
  if (TEST_MODE) {
    console.log("ZEUS in modalità TEST OTP (email non inviate).");
  }
});
