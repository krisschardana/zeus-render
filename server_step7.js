// server_step7.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// CORS per tutte le route
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

const onlineSocketsByEmail = {};
const pendingOtps = {};
const typingTimers = {};

app.use(bodyParser.json({ limit: "10mb" }));
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

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Nessun file caricato." });
  const publicUrl = `/uploads/${req.file.filename}`;
  console.log("File caricato:", req.file.originalname, "->", publicUrl);
  return res.json({ ok: true, url: publicUrl, originalName: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype });
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
  const enriched = msgs.map((m) => {
    const fromUser = users.find((u) => normalizeEmail(u.email) === normalizeEmail(m.from)) || { email: m.from, name: m.from };
    return { ...m, fromUser };
  });
  res.json({ ok: true, messages: enriched });
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

// ---- SOCKET.IO ----
io.on("connection", (socket) => {
  console.log("Utente connesso:", socket.id);

  socket.on("set-user", (user) => {
    if (!user || !user.email) return;
    user.email = normalizeEmail(user.email);
    socket.data.user = user;
    onlineSocketsByEmail[user.email] = socket.id;
    io.emit("user-online", user);
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
    const payload = { from, text, ts: saved.ts };
    const targetSocketId = onlineSocketsByEmail[toEmailNorm];
    if (targetSocketId) io.to(targetSocketId).emit("private-message", payload);
    socket.emit("private-message", payload);
  });

  // ---- TYPING ----
  socket.on("typing-start", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const targetSocketId = onlineSocketsByEmail[toEmailNorm];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("typing-start", { from });
    if (typingTimers[from.email + "__" + toEmailNorm]) clearTimeout(typingTimers[from.email + "__" + toEmailNorm]);
    typingTimers[from.email + "__" + toEmailNorm] = setTimeout(() => {
      io.to(targetSocketId).emit("typing-stop", { from });
    }, 4000);
  });

  socket.on("typing-stop", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const targetSocketId = onlineSocketsByEmail[toEmailNorm];
    if (targetSocketId) io.to(targetSocketId).emit("typing-stop", { from });
    if (typingTimers[from.email + "__" + toEmailNorm]) {
      clearTimeout(typingTimers[from.email + "__" + toEmailNorm]);
      delete typingTimers[from.email + "__" + toEmailNorm];
    }
  });

  socket.on("kmeet-invite", ({ toEmail, roomUrl }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !roomUrl) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("kmeet-invite", { from, roomUrl, ts: Date.now() });
  });

  socket.on("voice-message", (payload) => {
    const from = socket.data.user;
    if (!from) return;
    const { mode, toEmail, audio } = payload || {};
    if (!audio) return;
    if (mode === "conference") {
      io.emit("voice-message", { mode: "conference", from, audio, ts: Date.now() });
    } else if (mode === "private" && toEmail) {
      const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
      if (!targetSocketId) return;
      io.to(targetSocketId).emit("voice-message", { mode: "private", from, audio, ts: Date.now() });
      socket.emit("voice-message", { mode: "private", from, audio, ts: Date.now() });
    }
  });

  socket.on("call-offer", ({ toEmail, offer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !offer) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("call-offer", { from, offer, mode: mode || "audio" });
  });

  socket.on("call-answer", ({ toEmail, answer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !answer) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("call-answer", { from, answer, mode: mode || "audio" });
  });

  socket.on("call-ice-candidate", ({ toEmail, candidate }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !candidate) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("call-ice-candidate", { from, candidate });
  });

  socket.on("call-hangup", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("call-hangup", { from });
  });

  socket.on("call-reject", ({ toEmail }) => {
    const from = socket.data.user;
    if (!from || !toEmail) return;
    const targetSocketId = onlineSocketsByEmail[normalizeEmail(toEmail)];
    if (!targetSocketId) return;
    io.to(targetSocketId).emit("call-reject", { from });
  });

  socket.on("disconnect", () => {
    const user = socket.data.user;
    if (user && user.email) {
      if (onlineSocketsByEmail[user.email] === socket.id) delete onlineSocketsByEmail[user.email];
      io.emit("user-offline", user);
    }
    console.log("Utente disconnesso:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`ZEUS server attivo su http://localhost:${PORT}`);
  if (TEST_MODE) console.log("ZEUS in modalità TEST.");
});