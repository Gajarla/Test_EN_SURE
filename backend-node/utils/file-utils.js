function getRandomFileName() {
  var timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  var random = ("" + Math.random()).substring(2, 8);
  var random_number = timestamp + random;
  return random_number;
}

function removeExtension(filename) {
  return filename.substring(0, filename.lastIndexOf(".")) || filename;
}

function getExtension(filename) {
  return filename.substring(filename.lastIndexOf("."));
}

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function generateUniqueFileName(fileName, ext) {
  var timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  var random = ("" + Math.random()).substring(2, 8);
  return (
    fileName.substring(0, fileName.lastIndexOf(".")) +
    "_" +
    timestamp +
    "_" +
    random +
    "." +
    (ext ? ext : fileName.substring(fileName.lastIndexOf(".")))
  );
}

module.exports = {
  removeExtension,
  getExtension,
  getRandomFileName,
  arrayBufferToBase64,
  generateUniqueFileName,
};
