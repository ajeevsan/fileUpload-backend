const crypto = require("crypto");

// Encrypt buffer with passcode
function encrypt(buffer, passcode) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(passcode, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return { iv: iv.toString("hex"), content: encrypted.toString("hex") };
}

// Decrypt buffer with passcode
function decrypt(encryptedData, passcode) {
  const key = crypto.scryptSync(passcode, "salt", 32);
  const iv = Buffer.from(encryptedData.iv, "hex");
  const encryptedText = Buffer.from(encryptedData.content, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted;
}

module.exports = { encrypt, decrypt };