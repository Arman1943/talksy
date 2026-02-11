const mongoose = require("../database");

const userSchema = new mongoose.Schema({
  username: String,
  password: String
});

module.exports = mongoose.model("User", userSchema);
