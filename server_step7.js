// server_step7.js
// ZEUS server: chat + vocali + WebRTC audio/video + EMAIL OTP (con modalità TEST)

// ATTENZIONE: per usare la modalità test OTP su Render
// imposta la variabile di ambiente TEST_MODE = true nel pannello Render.

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer"); // <-- email
const crypto = require("crypto");         // <-- per OTP sicuro

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// porta (locale 8080 oppure porta fornita da Render)
const PORT = process.env.PORT || 8080;

// modalità test OTP (niente invio SMTP reale)
const TEST_MODE = process.env.TEST_MODE === "true";

// utenti in “database” in memoria
// struttura: [{ name, email }]
const users = [];

// mappa email -> socket.id (utente online)
const onlineSocketsByEmail = {};

// mappa email -> dati OTP
// { [email]: { code: '123456', expiresAt: 1234567890, name: '...' } }
const pendingOtps = {};

// middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- CONFIGURAZIONE EMAIL (Nodemailer + Infomaniak) ----
// Mittente: gnosis@ik.me (Infomaniak, SMTP autenticato)
// Server SMTP Infomaniak: mail.infomaniak.com, porta 587, STARTTLS
let transporter = null;

if (!TEST_MODE) {
  transporter = nodemailer.createTransport({
    host: "mail.infomaniak.com",
    port: 587,
    secure: false, // STARTTLS su 587
    auth: {
      user: "gnosis@ik.me",
      pass: "Sugunnu1000", // <-- QUI DEVI METTERE LA PASSWORD ESATTA DELLA CASELLA
    },
  });
  console.log("Modalità EMAIL reale attiva (TEST_MODE = false).");
} else {
  console.log("ATTENZIONE: TEST_MODE = true, OTP NON inviato via email, solo log.");
}

// funzione per creare OTP 6 cifre sicuro
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

// ---- API REST EMAIL + OTP ----

// 1) Richiesta login: genera OTP
//    - in modalità normale: manda email a TE
//    - in TEST_MODE: NON manda email, logga il codice in console
app.post("/api/login-request", async (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  }

  // genera OTP e scadenza (es. 10 minuti)
  const code = generateOtp();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minuti

  pendingOtps[email] = { code, expiresAt, name };

  // se siamo in modalità TEST, non usiamo SMTP
  if (TEST_MODE) {
    console.log("=== OTP TEST MODE ===");
    console.log(`OTP per ${name} <${email}> = ${code}`);
    console.log("Questo codice NON è stato inviato via email (TEST_MODE).");
    return res.json({
      ok: true,
      message: "OTP generato in modalità test. Controlla i log del server.",
    });
  }

  // modalità normale: prepara email inviata a TE (admin)
  const mailOptions = {
    from: "ZEUS APP <gnosis@ik.me>",
    to: "gnosis@ik.me", // puoi cambiarlo se vuoi altri destinatari
    subject: `Nuova richiesta ZEUS - ${name} <${email}>`,
    text:
      `Richiesta di accesso a ZEUS.\n\n` +
      `Nome: ${name}\n` +
      `Email utente: ${email}\n\n` +
      `Codice OTP (da comunicare all'utente): ${code}\n\n` +
      `Il codice scade tra 10 minuti.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email OTP inviata per", email);
    return res.json({ ok: true, message: "OTP generato e inviato." });
  } catch (err) {
    console.error("Errore invio email OTP:", err);
    return res.json({
      ok: false,
      error: "Impossibile inviare email OTP. Controlla configurazione server.",
    });
  }
});

// 2) Verifica OTP: se corretto, registra/ritorna utente (come /api/login prima)
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

// ---- API REST SEMPLICI ORIGINALE (se vuoi, puoi tenerla per debug) ----

// login: registra utente se non esiste, restituisce dati utente
// (NON più usata dal frontend quando avremo l'OTP, ma la lasciamo)
app.post("/api/login", (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  }

  // cerca se esiste già
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

  // messaggio di conferenza (broadcast)
  socket.on("chat-message", (text) => {
    const from = socket.data.user;
    if (!from) return;

    io.emit("chat-message", {
      from,
      text,
      ts: Date.now(),
    });
  });

  // messaggio privato
  socket.on("private-message", ({ toEmail, text }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !text) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    // manda a destinatario
    io.to(targetSocketId).emit("private-message", {
      from,
      text,
      ts: Date.now(),
    });

    // echo anche al mittente (così vede il suo messaggio)
    socket.emit("private-message", {
      from,
      text,
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
      // broadcast a tutti
      io.emit("voice-message", {
        mode: "conference",
        from,
        audio,
        ts: Date.now(),
      });
    } else if (mode === "private" && toEmail) {
      const targetSocketId = onlineSocketsByEmail[toEmail];
      if (!targetSocketId) return;

      // al destinatario
      io.to(targetSocketId).emit("voice-message", {
        mode: "private",
        from,
        audio,
        ts: Date.now(),
      });

      // echo al mittente
      socket.emit("voice-message", {
        mode: "private",
        from,
        audio,
        ts: Date.now(),
      });
    }
  });

  // ---- SEGNALAZIONE WEBRTC (AUDIO + VIDEO) ----
  // Tutto è solo “forward” tra mittente e destinatario

  // offerta di chiamata (audio o video)
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

  // risposta alla chiamata
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

  // ICE candidate
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

  // hangup
  socket.on("call-hangup", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-hangup", {
      from,
    });
  });

  // rifiuto chiamata
  socket.on("call-reject", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;

    const targetSocketId = onlineSocketsByEmail[toEmail];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("call-reject", {
      from,
    });
  });

  // disconnessione
  socket.on("disconnect", () => {
    const user = socket.data.user;
    if (user && user.email) {
      // rimuovi dalla mappa online
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
