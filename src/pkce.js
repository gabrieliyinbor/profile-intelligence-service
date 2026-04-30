const crypto = require("crypto");

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(codeVerifier) {
  return base64UrlEncode(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
}

function generateState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
};