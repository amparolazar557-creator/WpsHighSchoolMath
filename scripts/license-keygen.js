const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const issuer = require("./license-issuer");

const projectRoot = path.join(__dirname, "..");
const privateKeyPath = issuer.defaultPrivateKeyPath();
const publicKeyModulePath = path.join(projectRoot, "js", "license-public-key.js");

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });

if (!fs.existsSync(privateKeyPath)) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(privateKeyPath, privatePem, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

const publicKey = issuer.publicKeyBase64(privateKeyPath);
const moduleSource = [
  "(function (root) {",
  `  var publicKey = ${JSON.stringify(publicKey)};`,
  "  if (typeof module === \"object\" && module.exports) { module.exports = publicKey; }",
  "  root.MathLicensePublicKey = publicKey;",
  "  if (typeof globalThis !== \"undefined\") { globalThis.MathLicensePublicKey = publicKey; }",
  "})(typeof window !== \"undefined\" ? window : globalThis);",
  ""
].join("\n");
fs.writeFileSync(publicKeyModulePath, moduleSource, "utf8");

const fingerprint = crypto.createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 16).toUpperCase();
console.log(`Private key: ${privateKeyPath}`);
console.log(`Public key module: ${publicKeyModulePath}`);
console.log(`Public key fingerprint: ${fingerprint}`);
console.log("Back up the private key securely. Never include it in an installer or send it to customers.");
