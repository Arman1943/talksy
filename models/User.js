const mongoose = require("../database");

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});

module.exports = mongoose.model("User", userSchema);
