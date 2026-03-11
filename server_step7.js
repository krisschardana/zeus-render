// server_step7.js — ZEUS Chat — Telegram-style universal edition
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const { execFile } = require("child_process");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 50e6
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 8080;

const rawTestMode = (process.env.TEST_MODE || "").toString().trim().toLowerCase();
const TEST_MODE = rawTestMode === "true" || rawTestMode === "1" || rawTestMode === "yes";

console.log("Valore TEST_MODE (env):", process.env.TEST_MODE);
console.log("Valore TEST_MODE (boolean):", TEST_MODE);

const SMTP_HOST = process.env.SMTP_HOST || "mail.infomaniak.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "gnosis@ik.me";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "ZEUS APP";

const USERS_DB_PATH = path.join(__dirname, "users.json");
const MESSAGES_DB_PATH = path.join(__dirname, "messages.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  try {
    fs.mkdirSync(UPLOADS_DIR);
    console.log("Cartella uploads creata:", UPLOADS_DIR);
  } catch (err) {
    console.error("Errore creazione cartella uploads:", err);
  }
}

// ---- UTENTI ----
let users = [];

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function loadUsersFromFile() {
  try {
    if (fs.existsSync(USERS_DB_PATH)) {
      const raw = fs.readFileSync(USERS_DB_PATH, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        users = data;
        console.log("Rubrica caricata:", users.length, "utenti.");
      }
    } else {
      console.log("Nessun users.json trovato, rubrica vuota.");
    }
  } catch (err) {
    console.error("Errore lettura users.json:", err);
  }
}

function saveUsersToFile() {
  try {
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2), "utf8");
  } catch (err) {
    console.error("Errore salvataggio users.json:", err);
  }
}

loadUsersFromFile();

// ---- MESSAGGI ----
let messagesDB = {};

function loadMessagesFromFile() {
  try {
    if (fs.existsSync(MESSAGES_DB_PATH)) {
      const raw = fs.readFileSync(MESSAGES_DB_PATH, "utf8");
      messagesDB = JSON.parse(raw) || {};
      let total = 0;
      Object.values(messagesDB).forEach((arr) => { total += arr.length; });
      console.log("Messaggi caricati:", total, "messaggi totali.");
    } else {
      console.log("Nessun messages.json trovato, storico vuoto.");
    }
  } catch (err) {
    console.error("Errore lettura messages.json:", err);
    messagesDB = {};
  }
}

function saveMessagesToFile() {
  try {
    fs.writeFileSync(MESSAGES_DB_PATH, JSON.stringify(messagesDB), "utf8");
  } catch (err) {
    console.error("Errore salvataggio messages.json:", err);
  }
}

function getChatKey(emailA, emailB) {
  return [normalizeEmail(emailA), normalizeEmail(emailB)].sort().join("__");
}

function saveMessage(fromEmail, toEmail, text, type = "private") {
  const key = getChatKey(fromEmail, toEmail);
  if (!messagesDB[key]) messagesDB[key] = [];
  const msg = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    from: normalizeEmail(fromEmail),
    to: normalizeEmail(toEmail),
    text,
    ts: Date.now(),
    type
  };
  messagesDB[key].push(msg);
  if (messagesDB[key].length > 500) messagesDB[key] = messagesDB[key].slice(-500);
  saveMessagesToFile();
  return msg;
}

function getMessages(emailA, emailB, limit = 100) {
  const key = getChatKey(emailA, emailB);
  const msgs = messagesDB[key] || [];
  return msgs.slice(-limit);
}

loadMessagesFromFile();

// ---- MAPPA SOCKET PER EMAIL ----
const onlineSocketsByEmail = {};
const socketsByEmail = {};
const pendingOtps = {};
const typingTimers = {};

app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

// ---- EMAIL ----
let transporter = null;

if (!TEST_MODE) {
  if (!SMTP_PASS) console.warn("ATTENZIONE: SMTP_PASS non impostata.");
  transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log("Modalità EMAIL reale attiva.");
} else {
  console.log("TEST_MODE = true, email non inviate.");
}

function generateOtp() { return crypto.randomInt(100000, 999999).toString(); }

// ---- UPLOAD FILE ----
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS_DIR); },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ---- TROVA FFMPEG ----
const FFMPEG_PATHS = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
let ffmpegPath = null;

function findFfmpeg() {
  return new Promise((resolve) => {
    let checked = 0;
    if (FFMPEG_PATHS.length === 0) { resolve(null); return; }
    FFMPEG_PATHS.forEach(p => {
      execFile(p, ["-version"], { timeout: 5000 }, (err) => {
        checked++;
        if (!err && !ffmpegPath) { ffmpegPath = p; console.log("ffmpeg trovato:", p); }
        if (checked === FFMPEG_PATHS.length && !ffmpegPath) {
          console.log("ffmpeg non trovato sul sistema.");
          resolve(null);
        } else if (ffmpegPath) resolve(ffmpegPath);
      });
    });
  });
}

findFfmpeg();

// ---- CONVERSIONE ASINCRONA WEBM -> MP4 ----
function convertWebmToMp4Async(inputPath, outputPath) {
  if (!ffmpegPath) {
    console.log("Conversione saltata: ffmpeg non disponibile");
    return;
  }
  execFile(ffmpegPath, [
    "-i", inputPath,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-y", outputPath
  ], { timeout: 120000 }, (err) => {
    if (err) {
      console.log("Conversione ffmpeg fallita:", err.message);
      return;
    }
    try { fs.unlinkSync(inputPath); } catch(e) {}
    console.log("Conversione MP4 completata:", outputPath);
  });
}

// ---- UPLOAD ENDPOINT ----
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Nessun file caricato." });

  const isWebm = req.file.mimetype === "video/webm" ||
    req.file.originalname.toLowerCase().includes(".webm") ||
    (req.file.mimetype && req.file.mimetype.includes("webm"));

  const publicUrl = "/uploads/" + req.file.filename;

  if (isWebm && ffmpegPath) {
    const outputName = req.file.filename.replace(/\.webm$/i, "") + "-conv.mp4";
    const outputPath = path.join(UPLOADS_DIR, outputName);
    convertWebmToMp4Async(req.file.path, outputPath);
    console.log("File WebM ricevuto, risposta immediata:", publicUrl);
    return res.json({
      ok: true,
      url: publicUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  }

  console.log("File caricato:", req.file.originalname, "->", publicUrl);
  return res.json({
    ok: true,
    url: publicUrl,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype
  });
});

// ---- LOGIN ----
app.post("/api/login-request", async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  const emailNorm = normalizeEmail(email);
  let user = users.find((u) => normalizeEmail(u.email) === emailNorm);
  if (!user) { user = { name, email: emailNorm }; users.push(user); saveUsersToFile(); }
  return res.json({ ok: true, user });
});

app.post("/api/login-verify", (req, res) => {
  const { name, email, code } = req.body || {};
  if (!name || !email || !code) return res.json({ ok: false, error: "Dati mancanti." });
  const emailNorm = normalizeEmail(email);
  const otpData = pendingOtps[emailNorm];
  if (!otpData) return res.json({ ok: false, error: "Nessun OTP trovato." });
  if (Date.now() > otpData.expiresAt) { delete pendingOtps[emailNorm]; return res.json({ ok: false, error: "OTP scaduto." }); }
  if (otpData.code !== code) return res.json({ ok: false, error: "OTP non valido." });
  delete pendingOtps[emailNorm];
  let user = users.find((u) => normalizeEmail(u.email) === emailNorm);
  if (!user) { user = { name, email: emailNorm }; users.push(user); saveUsersToFile(); }
  return res.json({ ok: true, user });
});

app.post("/api/login", (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  const emailNorm = normalizeEmail(email);
  let user = users.find((u) => normalizeEmail(u.email) === emailNorm);
  if (!user) { user = { name, email: emailNorm }; users.push(user); saveUsersToFile(); }
  else { user.email = emailNorm; }
  return res.json({ ok: true, user });
});

// ---- LISTA UTENTI ----
app.get("/api/users", (req, res) => { res.json(users); });

// ---- STORICO MESSAGGI ----
app.get("/api/messages", (req, res) => {
  const { emailA, emailB, limit } = req.query;
  if (!emailA || !emailB) return res.status(400).json({ ok: false, error: "emailA e emailB obbligatori." });
  const msgs = getMessages(emailA, emailB, parseInt(limit || "100", 10));
  let changed = false;
  const enriched = msgs.map((m) => {
    // Genera id al volo per messaggi vecchi che ne sono privi
    if (!m.id) {
      m.id = crypto.randomBytes(16).toString("hex");
      changed = true;
    }
    const fromUser = users.find((u) => normalizeEmail(u.email) === normalizeEmail(m.from)) || { email: m.from, name: m.from };
    return { ...m, fromUser };
  });
  // Salva solo se abbiamo aggiunto id mancanti
  if (changed) saveMessagesToFile();
  res.json({ ok: true, messages: enriched });
});

// ---- ELIMINA SINGOLO MESSAGGIO ----
app.delete("/api/messages/single", (req, res) => {
  const { emailA, emailB, msgId } = req.query;
  if (!emailA || !emailB || !msgId) return res.status(400).json({ ok: false, error: "emailA, emailB e msgId obbligatori." });
  const key = getChatKey(emailA, emailB);
  if (!messagesDB[key]) return res.json({ ok: false, error: "Chat non trovata." });
  const before = messagesDB[key].length;
  messagesDB[key] = messagesDB[key].filter(m => m.id !== msgId);
  if (messagesDB[key].length === before) return res.json({ ok: false, error: "Messaggio non trovato." });
  saveMessagesToFile();
  console.log("Messaggio eliminato:", msgId, "da chat", key);
  return res.json({ ok: true });
});

// ---- PULISCI INTERA CHAT ----
app.delete("/api/messages", (req, res) => {
  const { emailA, emailB } = req.query;
  if (!emailA || !emailB) return res.status(400).json({ ok: false, error: "emailA e emailB obbligatori." });
  const key = getChatKey(emailA, emailB);
  messagesDB[key] = [];
  saveMessagesToFile();
  console.log("Chat pulita:", key);
  // Notifica entrambi gli utenti via socket
  emitToUser(normalizeEmail(emailA), "chat-cleared", { byEmail: normalizeEmail(emailA) });
  emitToUser(normalizeEmail(emailB), "chat-cleared", { byEmail: normalizeEmail(emailA) });
  return res.json({ ok: true });
});

// ---- PROFILO UTENTE ----
app.post("/api/profile", (req, res) => {
  const { email, name, phone, address, avatar } = req.body || {};
  if (!email) return res.json({ ok: false, error: "Email obbligatoria." });
  const emailNorm = normalizeEmail(email);
  const userIndex = users.findIndex((u) => normalizeEmail(u.email) === emailNorm);
  if (userIndex === -1) return res.json({ ok: false, error: "Utente non trovato." });
  if (name) users[userIndex].name = name;
  if (typeof phone !== "undefined") users[userIndex].phone = phone;
  if (typeof address !== "undefined") users[userIndex].address = address;
  if (typeof avatar !== "undefined") users[userIndex].avatar = avatar;
  saveUsersToFile();
  console.log("Profilo aggiornato per:", emailNorm);
  return res.json({ ok: true, user: users[userIndex] });
});

// ---- ELIMINA UTENTE ----
app.delete("/api/users/:email", (req, res) => {
  const emailParam = normalizeEmail(req.params.email || "");
  if (!emailParam) return res.status(400).json({ ok: false, error: "Email mancante." });
  const before = users.length;
  users = users.filter((u) => normalizeEmail(u.email) !== emailParam);
  if (users.length === before) return res.json({ ok: false, error: "Utente non trovato." });
  saveUsersToFile();
  console.log("Utente rimosso:", emailParam);
  return res.json({ ok: true });
});

// ---- HELPER: invia evento a tutti i socket di un utente ----
function emitToUser(email, event, data) {
  const emailNorm = normalizeEmail(email);
  const sockets = socketsByEmail[emailNorm];
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach((socketId) => {
    io.to(socketId).emit(event, data);
  });
  return true;
}

// ---- SOCKET.IO ----
io.on("connection", (socket) => {
  console.log("Utente connesso:", socket.id);

  socket.on("ping-client", () => {
    socket.emit("pong-server", { ts: Date.now() });
  });

  socket.on("set-user", (user) => {
    if (!user || !user.email) return;
    user.email = normalizeEmail(user.email);
    socket.data.user = user;
    onlineSocketsByEmail[user.email] = socket.id;
    if (!socketsByEmail[user.email]) socketsByEmail[user.email] = new Set();
    socketsByEmail[user.email].add(socket.id);
    io.emit("user-online", user);
    console.log("Utente online:", user.email, "socket:", socket.id);
  });

  socket.on("chat-message", (text) => {
    const from = socket.data.user;
    if (!from) return;
    io.emit("chat-message", { from, text, ts: Date.now() });
  });

  socket.on("private-message", ({ toEmail, text }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !text) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const saved = saveMessage(from.email, toEmailNorm, text, "private");
    const payload = { id: saved.id, from, text, ts: saved.ts };
    emitToUser(toEmailNorm, "private-message", payload);
    emitToUser(from.email, "private-message", payload);
  });

  // ---- ELIMINA MESSAGGIO VIA SOCKET ----
  socket.on("delete-message", ({ toEmail, msgId }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !msgId) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const key = getChatKey(from.email, toEmailNorm);
    if (messagesDB[key]) {
      messagesDB[key] = messagesDB[key].filter(m => m.id !== msgId);
      saveMessagesToFile();
    }
    // Notifica entrambi
    emitToUser(toEmailNorm, "message-deleted", { msgId });
    emitToUser(from.email, "message-deleted", { msgId });
  });

  // ---- TYPING ----
  socket.on("typing-start", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const toEmailNorm = normalizeEmail(toEmail);
    emitToUser(toEmailNorm, "typing-start", { from });
    const key = from.email + "__" + toEmailNorm;
    if (typingTimers[key]) clearTimeout(typingTimers[key]);
    typingTimers[key] = setTimeout(() => {
      emitToUser(toEmailNorm, "typing-stop", { from });
    }, 4000);
  });

  socket.on("typing-stop", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const toEmailNorm = normalizeEmail(toEmail);
    emitToUser(toEmailNorm, "typing-stop", { from });
    const key = from.email + "__" + toEmailNorm;
    if (typingTimers[key]) { clearTimeout(typingTimers[key]); delete typingTimers[key]; }
  });

  socket.on("kmeet-invite", ({ toEmail, roomUrl }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !roomUrl) return;
    emitToUser(normalizeEmail(toEmail), "kmeet-invite", { from, roomUrl, ts: Date.now() });
  });

  // ---- VOICE MESSAGE ----
  socket.on("voice-message", (payload) => {
    const from = socket.data.user;
    if (!from) return;
    const { mode, toEmail, audio } = payload || {};
    if (!audio) return;
    if (mode === "conference") {
      io.emit("voice-message", { mode: "conference", from, audio, ts: Date.now() });
    } else if (mode === "private" && toEmail) {
      const toEmailNorm = normalizeEmail(toEmail);
      const data = { mode: "private", from, audio, ts: Date.now() };
      emitToUser(toEmailNorm, "voice-message", data);
      emitToUser(from.email, "voice-message", data);
    }
  });

  // ---- WEBRTC ----
  socket.on("call-offer", ({ toEmail, offer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !offer) return;
    console.log("call-offer da", from.email, "a", toEmail, "mode:", mode);
    emitToUser(normalizeEmail(toEmail), "call-offer", { from, offer, mode: mode || "audio" });
  });

  socket.on("call-answer", ({ toEmail, answer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !answer) return;
    console.log("call-answer da", from.email, "a", toEmail);
    emitToUser(normalizeEmail(toEmail), "call-answer", { from, answer, mode: mode || "audio" });
  });

  socket.on("call-ice-candidate", ({ toEmail, candidate }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !candidate) return;
    emitToUser(normalizeEmail(toEmail), "call-ice-candidate", { from, candidate });
  });

  socket.on("call-hangup", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    emitToUser(normalizeEmail(toEmail), "call-hangup", { from });
  });

  socket.on("call-reject", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    emitToUser(normalizeEmail(toEmail), "call-reject", { from });
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", (reason) => {
    const user = socket.data.user;
    console.log("Disconnesso:", socket.id, "motivo:", reason);
    if (user && user.email) {
      if (socketsByEmail[user.email]) socketsByEmail[user.email].delete(socket.id);
      if (!socketsByEmail[user.email] || socketsByEmail[user.email].size === 0) {
        delete onlineSocketsByEmail[user.email];
        delete socketsByEmail[user.email];
        io.emit("user-offline", user);
        console.log("Utente offline:", user.email);
      } else {
        const remaining = [...socketsByEmail[user.email]];
        onlineSocketsByEmail[user.email] = remaining[remaining.length - 1];
        console.log("Utente ancora online su altro socket:", user.email);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`ZEUS server attivo su http://localhost:${PORT}`);
  if (TEST_MODE) console.log("ZEUS in modalità TEST.");
});