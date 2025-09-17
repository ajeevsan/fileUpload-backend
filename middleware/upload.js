const mime = require("mime-types");
const path = require("path");
const multer = require("multer");

const allowed_format = [".jpg", ".jpeg", ".pdf", ".rar", ".txt", ".doc", ".docx"];
const allowedMimes = allowed_format.map(e => mime.lookup(e)).filter(Boolean);

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const normalizedMime = file.mimetype.toLowerCase();

    if (allowed_format.includes(ext) && allowedMimes.includes(normalizedMime)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowed_format.join(", ")}`));
    }
  },
});

const uploadSingleFile = upload.single("file");

module.exports = { uploadSingleFile, allowed_format };