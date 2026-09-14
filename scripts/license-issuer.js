const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PRODUCT = "WpsHighSchoolMath";
const LICENSE_VERSION = "HSM2";
const PLAN_LABELS = {
  M: "月卡",
  Q: "季卡",
  Y: "年卡",
  P: "永久版"
};

function pad(value, size) {
  return String(value).padStart(size, "0");
}

function dateCode(date) {
  return date.getFullYear() + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2);
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  const day = copy.getDate();
  copy.setDate(1);
  copy.setMonth(copy.getMonth() + months);
  const lastDay = new Date(copy.getFullYear(), copy.getMonth() + 1, 0).getDate();
  copy.setDate(Math.min(day, lastDay));
  return copy;
}

function normalizeMachineId(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizePlan(plan) {
  const value = String(plan || "").toUpperCase();
  if (["MONTH", "MONTHLY", "月", "月卡"].includes(value)) return "M";
  if (["QUARTER", "QUARTERLY", "SEASON", "季", "季卡"].includes(value)) return "Q";
  if (["YEAR", "YEARLY", "ANNUAL", "年", "年卡"].includes(value)) return "Y";
  if (["PERMANENT", "FOREVER", "永久", "永久版"].includes(value)) return "P";
  if (/^[MQYP]$/.test(value)) return value;
  throw new Error(`Unknown license plan: ${plan}`);
}

function planExpiry(plan, issuedAt) {
  let base = issuedAt ? new Date(`${issuedAt}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error("Start date must use yyyy-mm-dd format.");
  }
  if (plan === "P") return "PERMANENT";
  if (plan === "M") return dateCode(addMonths(base, 1));
  if (plan === "Q") return dateCode(addMonths(base, 3));
  if (plan === "Y") return dateCode(addMonths(base, 12));
  throw new Error(`Unknown license plan: ${plan}`);
}

function canonicalPayload(plan, expires, machineId) {
  return [LICENSE_VERSION, PRODUCT, plan, expires, machineId].join("|");
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function parseLicenseCode(code) {
  const compact = String(code || "").replace(/\s+/g, "");
  const match = /^HSM2\.([MQYP])\.([0-9]{8}|PERMANENT)\.(HSM[A-Z0-9]{10})\.([A-Za-z0-9_-]{86})$/.exec(compact);
  if (!match) return null;
  return {
    version: LICENSE_VERSION,
    plan: match[1],
    expires: match[2],
    machineId: match[3],
    signature: match[4]
  };
}

function defaultPrivateKeyPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return process.env.HSM_LICENSE_PRIVATE_KEY || path.join(appData, "WpsHighSchoolMathIssuer", "ed25519-private.pem");
}

function loadPrivateKey(privateKeyOrPath) {
  if (privateKeyOrPath && typeof privateKeyOrPath !== "string") return privateKeyOrPath;
  const privateKeyPath = privateKeyOrPath || defaultPrivateKeyPath();
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`License private key was not found: ${privateKeyPath}\nRun: node scripts\\license-keygen.js`);
  }
  return crypto.createPrivateKey(fs.readFileSync(privateKeyPath, "utf8"));
}

function rawPublicKey(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" });
  if (der.length < 32) throw new Error("Ed25519 public key export is invalid.");
  return der.subarray(der.length - 32);
}

function publicKeyBase64(privateKeyOrPath) {
  return rawPublicKey(loadPrivateKey(privateKeyOrPath)).toString("base64");
}

function createLicenseCode(machineId, plan, issuedAt, privateKeyOrPath) {
  const normalizedMachineId = normalizeMachineId(machineId);
  const normalizedPlan = normalizePlan(plan);
  if (!/^HSM[A-Z0-9]{10}$/.test(normalizedMachineId)) {
    throw new Error("Machine code should look like HSM followed by 10 letters or digits.");
  }
  const expires = planExpiry(normalizedPlan, issuedAt);
  const payload = canonicalPayload(normalizedPlan, expires, normalizedMachineId);
  const signature = crypto.sign(null, Buffer.from(payload, "ascii"), loadPrivateKey(privateKeyOrPath));
  return [LICENSE_VERSION, normalizedPlan, expires, normalizedMachineId, toBase64Url(signature)].join(".");
}

module.exports = {
  PLAN_LABELS,
  LICENSE_VERSION,
  canonicalPayload,
  createLicenseCode,
  defaultPrivateKeyPath,
  normalizeMachineId,
  normalizePlan,
  parseLicenseCode,
  planExpiry,
  publicKeyBase64,
  rawPublicKey,
  toBase64Url
};
