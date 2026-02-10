const fs = require("fs");
const crypto = require("crypto");
const { google } = require("googleapis");

/* ---------------- ENCRYPTION KEY ---------------- */
/* CHANGE THIS TO A LONG SECRET PASSWORD */
const KEY = crypto.createHash("sha256")
  .update("TALKSY_SUPER_SECRET_BACKUP_PASSWORD_12345")
  .digest();

/* ---------------- ENCRYPT FUNCTION ---------------- */
function encryptFile(input, output) {
  if (!fs.existsSync(input)) return;

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

/* ---------------- GOOGLE DRIVE AUTH ---------------- */
async function getDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "drivekey.json",
    scopes: ["https://www.googleapis.com/auth/drive"]
  });

  return google.drive({ version: "v3", auth });
}

/* ---------------- DELETE OLD BACKUP ---------------- */
async function deleteOldBackup(drive, folderId) {

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='talksy_backup.enc' and trashed=false`,
    fields: "files(id, name)"
  });

  if (res.data.files.length > 0) {
    const fileId = res.data.files[0].id;
    await drive.files.delete({ fileId });
    console.log("Old backup removed");
  }
}

/* ---------------- UPLOAD BACKUP ---------------- */
async function upload(filePath) {

  const drive = await getDrive();

  const FOLDER_ID = "1ne5pHbtMOex3Y33FTM6R_OhM1x4Y3RJl";

  // remove previous backup so Drive doesn't fill
  await deleteOldBackup(drive, FOLDER_ID);

  const response = await drive.files.create({
    requestBody: {
      name: "talksy_backup.enc",
      parents: [FOLDER_ID]
    },
    media: {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath)
    },
    fields: "id"
  });

  console.log("Backup uploaded to Google Drive:", response.data.id);
}

/* ---------------- MAIN BACKUP PROCESS ---------------- */
async function runBackup() {

  try {

    if (!fs.existsSync("data")) return;

    // encrypt each file
    encryptFile("data/users.json", "users.enc");
    encryptFile("data/messages.json", "messages.enc");

    // combine both encrypted files
    const parts = [];

    if (fs.existsSync("users.enc"))
      parts.push(fs.readFileSync("users.enc"));

    if (fs.existsSync("messages.enc"))
      parts.push(fs.readFileSync("messages.enc"));

    if (parts.length === 0) return;

    const combined = Buffer.concat(parts);
    fs.writeFileSync("talksy_backup.enc", combined);

    // upload
    await upload("talksy_backup.enc");

  } catch (err) {
    console.error("Backup failed:", err);
  }
}

module.exports = runBackup;
