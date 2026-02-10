const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();

/* IMPORTANT FOR CLOUD HOSTS */
app.set("trust proxy", 1);

/* PARSE JSON */
app.use(express.json());

/* SESSION */
const sessionMiddleware = session({
    secret: "voxly-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false
    }
});

app.use(sessionMiddleware);

/* STATIC FILES */
app.use(express.static("public"));

/* HTTP SERVER (NO HTTPS HERE) */
const server = http.createServer(app);

/* SOCKET.IO */
const io = new Server(server);
io.engine.use(sessionMiddleware);

/* USER DATABASE */
const USERS_FILE = path.join(__dirname, "data", "users.json");

if (!fs.existsSync("data")) fs.mkdirSync("data");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");

function loadUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* ---------- AUTH ROUTES ---------- */

app.post("/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password)
        return res.json({ ok: false, msg: "Missing fields" });

    const users = loadUsers();

    if (users[username])
        return res.json({ ok: false, msg: "User exists" });

    const hash = await bcrypt.hash(password, 10);

    users[username] = { password: hash };
    saveUsers(users);

    req.session.user = username;

    res.json({ ok: true });
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    const users = loadUsers();

    if (!users[username])
        return res.json({ ok: false, msg: "No user" });

    const match = await bcrypt.compare(password, users[username].password);

    if (!match)
        return res.json({ ok: false, msg: "Wrong password" });

    req.session.user = username;
    res.json({ ok: true });
});

app.get("/me", (req, res) => {
    res.json({ user: req.session.user || null });
});

/* ---------- SOCKET ---------- */

io.on("connection", socket => {

    const session = socket.request.session;

    if (!session || !session.user) {
        socket.disconnect();
        return;
    }

    const username = session.user;

    socket.on("join", channel => {
        socket.join(channel);
    });

    socket.on("message", msg => {
        io.to(msg.channel).emit("message", {
            user: username,
            text: msg.text,
            time: new Date().toLocaleTimeString()
        });
    });
});

/* ---------- START SERVER ---------- */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
