require("dotenv").config();
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const cloudinary = require("./utils/cloudinary");
const { encrypt, decrypt } = require("./utils/crypto");
const { PrismaClient } = require('./generated/prisma/client');
const { uploadSingleFile } = require("./middleware/upload");
const cors = require('cors')
const cron = require("node-cron");

const prisma = new PrismaClient();
const app = express()


app.use(cors())
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT  = process.env.PORT || 3000
const HOST = process.env.HOST || "192.168.0.103"

// Upload API (unchanged)
app.post("/upload", (req, res, next) => {
  uploadSingleFile(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const { passcode } = req.body;
      if (!req.file || !passcode) {
        return res.status(400).json({ error: "File and passcode required" });
      }

      // Check if file format is allowed
      if (!isFileFormatAllowed(req.file.originalname)) {
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        return res.status(400).json({ 
          error: `File format ${fileExtension} is not allowed. Allowed formats: ${ALLOWED_FORMATS.join(', ')}` 
        });
      }

      // Encrypt
      const encrypted = encrypt(req.file.buffer, passcode);
      const encryptedFilePath = `tmp_${Date.now()}.enc`;
      fs.writeFileSync(encryptedFilePath, JSON.stringify(encrypted));

      // Upload encrypted to Cloudinary
      const result = await cloudinary.uploader.upload(encryptedFilePath, {
        resource_type: "raw",
      });

      // Save DB record
      const uploadId = uuidv4();
      const expireAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await prisma.fileUpload.create({
        data: {
          upload_id: uploadId,
          url: result.secure_url,
          filename: req.file.originalname,
          expireIn: expireAt,
        },
      });

      fs.unlinkSync(encryptedFilePath);

      return res.json({ downloadUrl: `${uploadId}` });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Upload failed" });
    }
  });
});

// POST endpoint to verify passcode and get download URL
app.post("/download/:id", async (req, res) => {
  try {
    const { passcode } = req.body;
    const { id } = req.params;

    if (!passcode) return res.status(400).json({ error: "Passcode required" });

    const fileRecord = await prisma.fileUpload.findUnique({ where: { upload_id: id } });
    if (!fileRecord) return res.status(404).json({ error: "File not found" });
    if (new Date() > fileRecord.expireIn) return res.status(410).json({ error: "File expired" });

    // Fetch encrypted JSON file from Cloudinary
    const response = await fetch(fileRecord.url);
    const encryptedData = await response.json();

    // Verify passcode by attempting decryption
    try {
      decrypt(encryptedData, passcode);
    } catch {
      return res.status(400).json({ error: "Invalid passcode" });
    }

    // FIXED: Check if request is coming through gateway or directly
    const isFromGateway = req.headers['x-forwarded-host'] || 
                          req.get('host') === '192.168.0.103:4000' ||
                          req.headers.referer?.includes('4000');
    
    // Use gateway URL if coming through gateway, otherwise direct backend URL
    const baseUrl = isFromGateway 
      ? `${req.protocol}://${req.headers['x-forwarded-host'] || '192.168.0.103:4000'}/api`
      : `${req.protocol}://${req.get("host")}`;

    const downloadUrl = `${baseUrl}/file/${id}?passcode=${encodeURIComponent(passcode)}`;

    return res.status(200).json({
      downloadUrl: downloadUrl,
      filename: fileRecord.filename
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Download failed" });
  }
});
app.get("/health", (req, res) => {
  return res.status(200).json({
    message: "Api is fine"
  })
})

// GET endpoint to serve the actual decrypted file
app.get("/file/:id", async (req, res) => {
  try {
    const { passcode } = req.query;
    const { id } = req.params;

    if (!passcode) return res.status(400).json({ error: "Passcode required" });

    const fileRecord = await prisma.fileUpload.findUnique({ where: { upload_id: id } });
    if (!fileRecord) return res.status(404).json({ error: "File not found" });
    if (new Date() > fileRecord.expireIn) return res.status(410).json({ error: "File expired" });

    // Fetch encrypted JSON file from Cloudinary
    const response = await fetch(fileRecord.url);
    const encryptedData = await response.json();

    // Decrypt the file
    let decrypted;
    try {
      decrypted = decrypt(encryptedData, passcode);
    } catch {
      return res.status(400).json({ error: "Invalid passcode" });
    }

    // Get file extension from original filename
    const fileExtension = path.extname(fileRecord.filename);
    
    // Validate file format before serving
    if (!isFileFormatAllowed(fileRecord.filename)) {
      return res.status(400).json({ 
        error: `File format ${fileExtension} is not allowed` 
      });
    }
    
    const mimeType = getMimeType(fileExtension);

    // Set proper headers for file download
    res.setHeader("Content-Disposition", `attachment; filename="${fileRecord.filename}"`);
    res.setHeader("Content-Type", mimeType);
    res.send(decrypted);
    
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "File serving failed" });
  }
});

// Allowed file formats
const ALLOWED_FORMATS = [".jpg", ".jpeg", ".pdf", ".rar", ".txt", ".doc", ".docx"];

// Dynamic MIME type mapping based on allowed formats
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.rar': 'application/x-rar-compressed',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// Helper function to check if file format is allowed
function isFileFormatAllowed(filename) {
  const extension = path.extname(filename).toLowerCase();
  return ALLOWED_FORMATS.includes(extension);
}

// Helper function to get MIME type for allowed formats
function getMimeType(extension) {
  const normalizedExt = extension.toLowerCase();
  
  // Check if extension is in allowed formats
  if (!ALLOWED_FORMATS.includes(normalizedExt)) {
    throw new Error(`File format ${normalizedExt} is not allowed`);
  }
  
  // Return corresponding MIME type
  return MIME_TYPES[normalizedExt] || 'application/octet-stream';
}

// Auto delete expired files every hour (unchanged)
cron.schedule("0 * * * *", async () => {
  const now = new Date();
  const expired = await prisma.fileUpload.findMany({ where: { expireIn: { lt: now } } });

  for (const file of expired) {
    try {
      const publicId = file.url.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      await prisma.fileUpload.delete({ where: { id: file.id } });
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  }
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 Server running at http://0.0.0.0:"+PORT));