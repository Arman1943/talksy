// server.js
const runBackup = require("./backup");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* session */
const sessionMiddleware = session({
  secret: "voxly-secret-key-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // secure:true requires HTTPS termination (cloud)
});
app.use(sessionMiddleware);

/* HTTP server */
const server = http.createServer(app);

/* socket.io with shared session */
const io = new Server(server);
io.engine.use(sessionMiddleware);

/* data files */
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, "{}");

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE));
  } catch (e) {
    return {};
  }
}
function saveUsers(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}
function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE));
  } catch (e) {
    return {};
  }
}
function saveMessages(m) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(m, null, 2));
}

/* ---------- AUTH ROUTES ---------- */

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, msg: "Missing fields" });

  const users = loadUsers();
  if (users[username]) return res.json({ ok: false, msg: "User exists" });

  const hash = await bcrypt.hash(password, 10);
  users[username] = { password: hash };
  saveUsers(users);

  req.session.user = username;
  res.json({ ok: true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  if (!users[username]) return res.json({ ok: false, msg: "No user" });

  const match = await bcrypt.compare(password, users[username].password);
  if (!match) return res.json({ ok: false, msg: "Wrong password" });

  req.session.user = username;
  res.json({ ok: true });
});

app.get("/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

/* ---------- MESSAGE REST (optional) ---------- */

app.get("/history/:channel", (req, res) => {
  const channel = req.params.channel;
  const all = loadMessages();
  res.json(all[channel] || []);
});

/* ---------- VOICE ROOMS (presence) ---------- */

let voiceRooms = {}; // { roomName: [{ id, name }] }

function addUserToVoice(room, socket) {
  if (!voiceRooms[room]) voiceRooms[room] = [];
  if (!voiceRooms[room].some(u => u.id === socket.id)) {
    voiceRooms[room].push({ id: socket.id, name: socket.username });
  }
}

function removeUserFromVoice(room, socketId) {
  if (!voiceRooms[room]) return;
  voiceRooms[room] = voiceRooms[room].filter(u => u.id !== socketId);
  if (voiceRooms[room].length === 0) delete voiceRooms[room];
}

function broadcastVoiceMembers(room) {
  const list = voiceRooms[room] || [];
  io.to("voice-" + room).emit("voice-members", list);
  io.emit("sidebar-members", list); // global sidebar (optional)
}

/* ---------- SOCKETS ---------- */

io.on("connection", (socket) => {

  // Access session attached by engine.use
  const sess = socket.request.session;
  if (!sess || !sess.user) {
    socket.disconnect(true);
    return;
  }

  socket.username = sess.user;

  /* TEXT: join channel -> send history */
  socket.on("join", (channel) => {
    socket.join(channel);
    const all = loadMessages();
    socket.emit("history", all[channel] || []);
    io.to(channel).emit("system", `${socket.username} joined ${channel}`);
  });

  socket.on("message", (payload) => {
    // payload: { channel, text }
    if (!payload || !payload.channel || !payload.text) return;

    const msg = {
      user: socket.username,
      text: payload.text,
      time: new Date().toISOString()
    };

    // save
    const all = loadMessages();
    if (!all[payload.channel]) all[payload.channel] = [];
    all[payload.channel].push(msg);
    // keep only last 100 messages per channel to avoid huge files
    if (all[payload.channel].length > 100) {
      all[payload.channel] = all[payload.channel].slice(-100);
    }
    saveMessages(all);

    io.to(payload.channel).emit("message", msg);
  });

  /* VOICE: join / leave */
  socket.on("join-voice", (room) => {
    if (socket.voiceRoom === room) return;

    if (socket.voiceRoom) {
      const old = socket.voiceRoom;
      removeUserFromVoice(old, socket.id);
      broadcastVoiceMembers(old);
      socket.leave("voice-" + old);
    }

    socket.voiceRoom = room;
    socket.join("voice-" + room);

    addUserToVoice(room, socket);

    socket.to("voice-" + room).emit("user-connecting", socket.id);
    broadcastVoiceMembers(room);
    socket.to("voice-" + room).emit("user-joined-voice", socket.id);
  });

  socket.on("leave-voice", () => {
    if (!socket.voiceRoom) return;
    const room = socket.voiceRoom;
    removeUserFromVoice(room, socket.id);
    io.emit("voice-user-left", socket.id);
    broadcastVoiceMembers(room);
    socket.leave("voice-" + room);
    socket.voiceRoom = null;
  });

  /* signaling for WebRTC */
  socket.on("offer", ({ target, sdp }) => {
    io.to(target).emit("offer", { sdp, sender: socket.id });
  });
  socket.on("answer", ({ target, sdp }) => {
    io.to(target).emit("answer", { sdp, sender: socket.id });
  });
  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", { candidate, sender: socket.id });
  });

  /* speaking indicator (from client) */
  socket.on("speaking", (state) => {
    if (!socket.voiceRoom) return;
    socket.to("voice-" + socket.voiceRoom).emit("speaking", { id: socket.id, state });
  });

  /* disconnect cleanup */
  socket.on("disconnect", () => {
    // emit system message (optional)
    // remove from voice rooms
    if (socket.voiceRoom) {
      removeUserFromVoice(socket.voiceRoom, socket.id);
      io.emit("voice-user-left", socket.id);
      broadcastVoiceMembers(socket.voiceRoom);
    }
  });
});

/* ---------- START ---------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
setInterval(() => {
  runBackup().catch(console.error);
}, 5 * 60 * 1000); // every 5 minutes
