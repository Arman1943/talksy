const mongoose = require("../database");

const messageSchema = new mongoose.Schema({
  channel: String,
  user: String,
  text: String,
  time: String
});

module.exports = mongoose.model("Message", messageSchema);
