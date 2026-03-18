require('dotenv').config();
const dns = require('dns');
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);
// server_step7.js — ZEUS Chat — Telegram-style universal edition
// AGGIORNATO: P1 no messages.json | P2 MongoDB | P3 Gruppi | P4 Reazioni
//             P5 Upload 2GB | P6 /api/version | P7 Admin

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
const mongoose = require("mongoose"); // P2

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
  maxHttpBufferSize: 2e9  // P5 — era 50e6, ora 2GB
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

// P2 — MongoDB URI da variabile ambiente
const MONGODB_URI = process.env.MONGODB_URI || "";

// P7 — Admin email da variabile ambiente
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

// P6 — Versione app — aggiorna questo valore ad ogni deploy per forzare aggiornamento
const APP_VERSION = "3.0.0";

const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  try {
    fs.mkdirSync(UPLOADS_DIR);
    console.log("Cartella uploads creata:", UPLOADS_DIR);
  } catch (err) {
    console.error("Errore creazione cartella uploads:", err);
  }
}

// =====================================================================
// P2 — MONGODB — SCHEMA UTENTI
// =====================================================================
const UserSchema = new mongoose.Schema({
  name:    { type: String, default: "" },
  email:   { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:   { type: String, default: "" },
  address: { type: String, default: "" },
  avatar:  { type: String, default: "" },
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

// P3 — Schema Gruppi
const GroupSchema = new mongoose.Schema({
  groupId:      { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  creatorEmail: { type: String, required: true, lowercase: true, trim: true },
  members:      [{ type: String, lowercase: true, trim: true }],
}, { timestamps: true });

const Group = mongoose.model("Group", GroupSchema);

// Connessione MongoDB
async function connectMongoDB() {
  if (!MONGODB_URI) {
    console.warn("MONGODB_URI non impostata — MongoDB non connesso.");
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("MongoDB Atlas connesso ✅");
  } catch (err) {
    console.error("Errore connessione MongoDB:", err.message);
  }
}

connectMongoDB();

// =====================================================================
// HELPER
// =====================================================================
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function generateMsgId() {
  return crypto.randomBytes(16).toString("hex");
}

function generateGroupId() {
  return "grp_" + crypto.randomBytes(12).toString("hex");
}

// =====================================================================
// MAPPA SOCKET PER EMAIL
// =====================================================================
const onlineSocketsByEmail = {};
const socketsByEmail = {};
const pendingOtps = {};
const typingTimers = {};

app.use(bodyParser.json({ limit: "100mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

// =====================================================================
// EMAIL
// =====================================================================
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

// =====================================================================
// UPLOAD FILE — P5: limite 2GB
// =====================================================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS_DIR); },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, Date.now() + "-" + safeName);
  },
});

// P5 — era 50MB, ora 2GB
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// =====================================================================
// TROVA FFMPEG
// =====================================================================
const FFMPEG_PATHS = [
  "/usr/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "ffmpeg",
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  process.env.FFMPEG_PATH || ""
].filter(p => p.length > 0);
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

// =====================================================================
// UPLOAD ENDPOINT
// =====================================================================
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Nessun file caricato." });

  const isWebm = req.file.mimetype === "video/webm" ||
    req.file.originalname.toLowerCase().includes(".webm") ||
    (req.file.mimetype && req.file.mimetype.includes("webm"));

  const publicUrl = "/uploads/" + req.file.filename;

  if (isWebm && ffmpegPath) {
    const outputName = req.file.filename.replace(/\.webm$/i, "") + "-conv.mp4";
    const outputPath = path.join(UPLOADS_DIR, outputName);

    const converted = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log("Timeout conversione ffmpeg, uso webm originale");
        resolve(false);
      }, 25000);

      execFile(ffmpegPath, [
        "-i", req.file.path,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", outputPath
      ], { timeout: 25000 }, (err) => {
        clearTimeout(timer);
        if (!err) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
          console.log("Conversione MP4 completata:", outputPath);
          resolve(true);
        } else {
          console.log("Conversione ffmpeg fallita:", err.message);
          resolve(false);
        }
      });
    });

    const finalUrl = converted ? ("/uploads/" + outputName) : publicUrl;
    const finalMime = converted ? "video/mp4" : req.file.mimetype;
    return res.json({
      ok: true,
      url: finalUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: finalMime
    });
  }

  return res.json({
    ok: true,
    url: publicUrl,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype
  });
});

// =====================================================================
// P6 — VERSIONE APP
// =====================================================================
app.get("/api/version", (req, res) => {
  res.json({ version: APP_VERSION });
});

// =====================================================================
// LOGIN — P2: usa MongoDB
// =====================================================================
app.post("/api/login-request", async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  const emailNorm = normalizeEmail(email);
  try {
    let user = await User.findOne({ email: emailNorm });
    if (!user) user = await User.create({ name, email: emailNorm });
    return res.json({ ok: true, user });
  } catch (err) {
    console.error("login-request error:", err);
    return res.json({ ok: false, error: "Errore server." });
  }
});

app.post("/api/login-verify", async (req, res) => {
  const { name, email, code } = req.body || {};
  if (!name || !email || !code) return res.json({ ok: false, error: "Dati mancanti." });
  const emailNorm = normalizeEmail(email);
  const otpData = pendingOtps[emailNorm];
  if (!otpData) return res.json({ ok: false, error: "Nessun OTP trovato." });
  if (Date.now() > otpData.expiresAt) { delete pendingOtps[emailNorm]; return res.json({ ok: false, error: "OTP scaduto." }); }
  if (otpData.code !== code) return res.json({ ok: false, error: "OTP non valido." });
  delete pendingOtps[emailNorm];
  try {
    let user = await User.findOne({ email: emailNorm });
    if (!user) user = await User.create({ name, email: emailNorm });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

app.post("/api/login", async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.json({ ok: false, error: "Nome ed email sono obbligatori." });
  const emailNorm = normalizeEmail(email);
  try {
    let user = await User.findOneAndUpdate(
      { email: emailNorm },
      { $set: { name } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ ok: true, user });
  } catch (err) {
    console.error("login error:", err);
    return res.json({ ok: false, error: "Errore server." });
  }
});

// =====================================================================
// LISTA UTENTI — P2: MongoDB
// =====================================================================
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, { __v: 0 }).lean();
    res.json(users);
  } catch (err) {
    res.json([]);
  }
});

// =====================================================================
// P1 — STORICO MESSAGGI RIMOSSO DAL SERVER
// I messaggi ora si salvano solo sul dispositivo (localStorage nel client)
// Il server fa solo relay — non salva nulla
// Mantenuto solo l'endpoint DELETE per pulire la chat (emette evento socket)
// =====================================================================

// =====================================================================
// ELIMINA SINGOLO MESSAGGIO — ora solo relay socket, niente DB
// =====================================================================
app.delete("/api/messages/single", (req, res) => {
  const { emailA, emailB, msgId } = req.query;
  if (!emailA || !emailB || !msgId) return res.status(400).json({ ok: false, error: "emailA, emailB e msgId obbligatori." });
  // Relay agli utenti — il client rimuove da localStorage
  emitToUser(normalizeEmail(emailA), "message-deleted", { msgId });
  emitToUser(normalizeEmail(emailB), "message-deleted", { msgId });
  return res.json({ ok: true });
});

// =====================================================================
// PULISCI INTERA CHAT — relay socket, niente DB
// =====================================================================
app.delete("/api/messages", (req, res) => {
  const { emailA, emailB } = req.query;
  if (!emailA || !emailB) return res.status(400).json({ ok: false, error: "emailA e emailB obbligatori." });
  emitToUser(normalizeEmail(emailA), "chat-cleared", { byEmail: normalizeEmail(emailA) });
  emitToUser(normalizeEmail(emailB), "chat-cleared", { byEmail: normalizeEmail(emailA) });
  return res.json({ ok: true });
});

// =====================================================================
// PROFILO UTENTE — P2: MongoDB
// =====================================================================
app.post("/api/profile", async (req, res) => {
  const { email, name, phone, address, avatar } = req.body || {};
  if (!email) return res.json({ ok: false, error: "Email obbligatoria." });
  const emailNorm = normalizeEmail(email);
  try {
    const update = {};
    if (name)                        update.name = name;
    if (typeof phone !== "undefined")   update.phone = phone;
    if (typeof address !== "undefined") update.address = address;
    if (typeof avatar !== "undefined")  update.avatar = avatar;
    const user = await User.findOneAndUpdate(
      { email: emailNorm },
      { $set: update },
      { new: true }
    );
    if (!user) return res.json({ ok: false, error: "Utente non trovato." });
    console.log("Profilo aggiornato per:", emailNorm);
    return res.json({ ok: true, user });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// =====================================================================
// ELIMINA UTENTE — P2: MongoDB
// =====================================================================
app.delete("/api/users/:email", async (req, res) => {
  const emailParam = normalizeEmail(req.params.email || "");
  if (!emailParam) return res.status(400).json({ ok: false, error: "Email mancante." });
  try {
    const result = await User.deleteOne({ email: emailParam });
    if (result.deletedCount === 0) return res.json({ ok: false, error: "Utente non trovato." });
    console.log("Utente rimosso:", emailParam);
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// =====================================================================
// P3 — GRUPPI — Endpoints REST
// =====================================================================

// Crea gruppo
app.post("/api/groups/create", async (req, res) => {
  const { name, creatorEmail, members } = req.body || {};
  if (!name || !creatorEmail || !Array.isArray(members) || members.length < 1) {
    return res.json({ ok: false, error: "name, creatorEmail e members[] obbligatori." });
  }
  const creatorNorm = normalizeEmail(creatorEmail);
  const membersNorm = members.map(normalizeEmail);
  // Assicura che il creatore sia nei membri
  if (!membersNorm.includes(creatorNorm)) membersNorm.push(creatorNorm);
  const groupId = generateGroupId();
  try {
    const group = await Group.create({ groupId, name, creatorEmail: creatorNorm, members: membersNorm });
    console.log("Gruppo creato:", groupId, name, "membri:", membersNorm);
    // Notifica tutti i membri
    membersNorm.forEach(memberEmail => {
      emitToUser(memberEmail, "group-created", { group: group.toObject() });
    });
    // P7 — notifica admin
    if (ADMIN_EMAIL) {
      emitToUser(ADMIN_EMAIL, "admin-group-created", {
        group: group.toObject(),
        ts: Date.now()
      });
    }
    return res.json({ ok: true, group });
  } catch (err) {
    console.error("Errore crea gruppo:", err);
    return res.json({ ok: false, error: "Errore creazione gruppo." });
  }
});

// Lista gruppi per utente
app.get("/api/groups", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ ok: false, error: "Email obbligatoria." });
  const emailNorm = normalizeEmail(email);
  try {
    const groups = await Group.find({ members: emailNorm }).lean();
    return res.json({ ok: true, groups });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// Tutti i gruppi (per admin)
app.get("/api/groups/all", async (req, res) => {
  const { adminEmail } = req.query;
  if (!ADMIN_EMAIL || normalizeEmail(adminEmail) !== ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: "Non autorizzato." });
  }
  try {
    const groups = await Group.find({}).lean();
    return res.json({ ok: true, groups });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// =====================================================================
// P7 — ADMIN — Endpoints
// =====================================================================

// Stats
app.get("/api/admin/stats", async (req, res) => {
  const { adminEmail } = req.query;
  if (!ADMIN_EMAIL || normalizeEmail(adminEmail) !== ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: "Non autorizzato." });
  }
  try {
    const totalUsers  = await User.countDocuments();
    const totalGroups = await Group.countDocuments();
    const onlineCount = Object.keys(onlineSocketsByEmail).length;
    return res.json({ ok: true, totalUsers, totalGroups, onlineCount });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// Broadcast a tutti gli utenti
app.post("/api/admin/broadcast", async (req, res) => {
  const { adminEmail, text } = req.body || {};
  if (!ADMIN_EMAIL || normalizeEmail(adminEmail) !== ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: "Non autorizzato." });
  }
  if (!text) return res.json({ ok: false, error: "Testo obbligatorio." });
  const adminUser = { email: ADMIN_EMAIL, name: "⚡ ZEUS Admin" };
  const payload = {
    id: generateMsgId(),
    from: adminUser,
    text,
    ts: Date.now(),
    isAdmin: true
  };
  io.emit("admin-broadcast", payload);
  console.log("Admin broadcast:", text);
  return res.json({ ok: true });
});

// Messaggio a gruppo specifico
app.post("/api/admin/message-group", async (req, res) => {
  const { adminEmail, groupId, text } = req.body || {};
  if (!ADMIN_EMAIL || normalizeEmail(adminEmail) !== ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: "Non autorizzato." });
  }
  if (!groupId || !text) return res.json({ ok: false, error: "groupId e text obbligatori." });
  try {
    const group = await Group.findOne({ groupId }).lean();
    if (!group) return res.json({ ok: false, error: "Gruppo non trovato." });
    const adminUser = { email: ADMIN_EMAIL, name: "⚡ ZEUS Admin" };
    const payload = {
      id: generateMsgId(),
      from: adminUser,
      text,
      groupId,
      ts: Date.now(),
      isAdmin: true
    };
    group.members.forEach(memberEmail => {
      emitToUser(memberEmail, "group-message", payload);
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ ok: false, error: "Errore server." });
  }
});

// =====================================================================
// HELPER: invia evento a tutti i socket di un utente
// =====================================================================
function emitToUser(email, event, data) {
  const emailNorm = normalizeEmail(email);
  const sockets = socketsByEmail[emailNorm];
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach((socketId) => {
    io.to(socketId).emit(event, data);
  });
  return true;
}

// =====================================================================
// SOCKET.IO
// =====================================================================
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

  // P1 — private-message: solo relay, non salva nulla sul server
  socket.on("private-message", ({ toEmail, text }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !text) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const msgId = generateMsgId();
    const payload = { id: msgId, from, text, ts: Date.now() };
    emitToUser(toEmailNorm, "private-message", payload);
    emitToUser(from.email, "private-message", payload);
  });

  socket.on("delete-message", ({ toEmail, msgId }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !msgId) return;
    const toEmailNorm = normalizeEmail(toEmail);
    emitToUser(toEmailNorm, "message-deleted", { msgId });
    emitToUser(from.email, "message-deleted", { msgId });
  });

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

  // P4 — Reazioni messaggi: relay a entrambi gli utenti
  socket.on("message-reaction", ({ toEmail, msgId, emoji }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !msgId || !emoji) return;
    const toEmailNorm = normalizeEmail(toEmail);
    const payload = { msgId, emoji, fromEmail: from.email, ts: Date.now() };
    emitToUser(toEmailNorm, "message-reaction", payload);
    emitToUser(from.email, "message-reaction", payload);
  });

  // P3 — Gruppi: group-message relay a tutti i membri
  socket.on("group-message", async ({ groupId, text }) => {
    const from = socket.data.user;
    if (!from || !groupId || !text) return;
    try {
      const group = await Group.findOne({ groupId }).lean();
      if (!group) return;
      if (!group.members.includes(from.email)) return; // sicurezza
      const msgId = generateMsgId();
      const payload = { id: msgId, from, text, groupId, ts: Date.now() };
      group.members.forEach(memberEmail => {
        emitToUser(memberEmail, "group-message", payload);
      });
    } catch (err) {
      console.error("group-message error:", err);
    }
  });

  // P3 — Vocali nel gruppo
  socket.on("group-voice", async ({ groupId, audio }) => {
    const from = socket.data.user;
    if (!from || !groupId || !audio) return;
    try {
      const group = await Group.findOne({ groupId }).lean();
      if (!group) return;
      if (!group.members.includes(from.email)) return;
      const payload = { from, audio, groupId, ts: Date.now() };
      group.members.forEach(memberEmail => {
        emitToUser(memberEmail, "group-voice", payload);
      });
    } catch (err) {
      console.error("group-voice error:", err);
    }
  });

  // P3 — Allegati nel gruppo
  socket.on("group-file", async ({ groupId, text }) => {
    const from = socket.data.user;
    if (!from || !groupId || !text) return;
    try {
      const group = await Group.findOne({ groupId }).lean();
      if (!group) return;
      if (!group.members.includes(from.email)) return;
      const msgId = generateMsgId();
      const payload = { id: msgId, from, text, groupId, ts: Date.now() };
      group.members.forEach(memberEmail => {
        emitToUser(memberEmail, "group-message", payload);
      });
    } catch (err) {
      console.error("group-file error:", err);
    }
  });

  // P3 — Typing nel gruppo
  socket.on("group-typing-start", async ({ groupId }) => {
    const from = socket.data.user;
    if (!from || !groupId) return;
    try {
      const group = await Group.findOne({ groupId }).lean();
      if (!group) return;
      group.members.forEach(memberEmail => {
        if (memberEmail !== from.email) emitToUser(memberEmail, "group-typing-start", { from, groupId });
      });
    } catch {}
  });

  socket.on("group-typing-stop", async ({ groupId }) => {
    const from = socket.data.user;
    if (!from || !groupId) return;
    try {
      const group = await Group.findOne({ groupId }).lean();
      if (!group) return;
      group.members.forEach(memberEmail => {
        if (memberEmail !== from.email) emitToUser(memberEmail, "group-typing-stop", { from, groupId });
      });
    } catch {}
  });

  // WebRTC — invariato
  socket.on("call-offer", ({ toEmail, offer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !offer) return;
    emitToUser(normalizeEmail(toEmail), "call-offer", { from, offer, mode: mode || "audio" });
  });

  socket.on("call-answer", ({ toEmail, answer, mode }) => {
    const from = socket.data.user;
    if (!from || !toEmail || !answer) return;
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