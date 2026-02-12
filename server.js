const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");

require("./database");
const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const cors = require("cors");
app.use(cors());
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

/* ---------------- REGISTER ---------------- */
app.post("/register", async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);

    const user = new User({
      username: req.body.username,
      password: hash
    });

    await user.save();
    res.send("OK");

  } catch {
    res.status(400).send("Username exists");
  }
});

/* ---------------- LOGIN ---------------- */
app.post("/login", async (req, res) => {

  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.status(400).send("No user");

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.status(400).send("Wrong password");

  res.send("OK");
});

/* ---------------- SOCKET CHAT ---------------- */

io.on("connection", socket => {

  socket.on("join", async ({ username, channel }) => {

    socket.username = username;
    socket.channel = channel;
    socket.join(channel);

    // send chat history
    const history = await Message.find({ channel }).limit(100);
    socket.emit("history", history);

    io.to(channel).emit("system", `${username} joined`);
  });

  socket.on("message", async msg => {

    const message = new Message({
      channel: socket.channel,
      user: socket.username,
      text: msg,
      time: new Date().toLocaleTimeString()
    });

    await message.save();

    io.to(socket.channel).emit("message", message);

    // confirmation to sender
    socket.emit("message-stored");
  });

  socket.on("disconnect", () => {
    if (socket.username && socket.channel)
      io.to(socket.channel).emit("system", `${socket.username} left`);
  });

});

server.listen(3000, () => console.log("Server running on port 3000"));
