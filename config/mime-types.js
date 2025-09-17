const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.rar': 'application/x-rar-compressed',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function getMimeType(extension) {
  const normalizedExt = extension.toLowerCase();
  return MIME_TYPES[normalizedExt] || 'application/octet-stream';
}

module.exports = { MIME_TYPES, getMimeType };