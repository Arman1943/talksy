const fs = require("fs");
const crypto = require("crypto");
const { google } = require("googleapis");

const KEY = crypto.createHash("sha256")
  .update("CHANGE_THIS_TO_A_SECRET_PASSWORD")
  .digest();

/* ENCRYPT FILE */
function encryptFile(input, output) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, iv);

  const inputData = fs.readFileSync(input);
  const encrypted = Buffer.concat([
    iv,
    cipher.update(inputData),
    cipher.final()
  ]);

  fs.writeFileSync(output, encrypted);
}

/* GOOGLE DRIVE AUTH */
async function upload(filePath) {

  const auth = new google.auth.GoogleAuth({
    keyFile: "drivekey.json",
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });

  const drive = google.drive({ version: "v3", auth });

  const response = await drive.files.create({
    requestBody: {
      name: "talksy_backup.enc",
      mimeType: "application/octet-stream"
    },
    media: {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath)
    }
  });

  console.log("Backup uploaded:", response.data.id);
}

/* MAIN BACKUP */
async function runBackup() {

  encryptFile("data/users.json", "users.enc");
  encryptFile("data/messages.json", "messages.enc");

  // combine into one file
  const combined = Buffer.concat([
    fs.readFileSync("users.enc"),
    fs.readFileSync("messages.enc")
  ]);

  fs.writeFileSync("talksy_backup.enc", combined);

  await upload("talksy_backup.enc");
}

module.exports = runBackup;
