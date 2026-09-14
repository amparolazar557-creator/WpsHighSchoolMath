const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const issuer = require("../scripts/license-issuer");

const projectRoot = path.join(__dirname, "..");
const cliPath = path.join(projectRoot, "scripts", "license-tool-cli.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-license-tool-test-"));

function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

function writeKeyPair(name) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(tempRoot, `${name}-private.pem`);
  const publicKeyModulePath = path.join(tempRoot, `${name}-public.js`);
  const encoded = rawPublicKey(pair.publicKey).toString("base64");
  fs.writeFileSync(privateKeyPath, pair.privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");
  fs.writeFileSync(publicKeyModulePath, `module.exports = ${JSON.stringify(encoded)};\n`, "utf8");
  return { pair, privateKeyPath, publicKeyModulePath, encoded };
}

function run(command, environment) {
  const result = spawnSync(process.execPath, [cliPath, command], {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    encoding: "utf8"
  });
  let output;
  try {
    output = JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`CLI did not return JSON. stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return { ...result, output };
}

try {
  const primary = writeKeyPair("primary");
  const other = writeKeyPair("other");
  const history = path.join(tempRoot, "history.csv");
  const baseEnvironment = {
    HSM_LICENSE_PRIVATE_KEY: primary.privateKeyPath,
    HSM_LICENSE_PUBLIC_KEY_MODULE: primary.publicKeyModulePath,
    HSM_LICENSE_HISTORY_PATH: history
  };

  const status = run("status", baseEnvironment);
  assert.strictEqual(status.status, 0);
  assert.strictEqual(status.output.ok, true);
  assert.strictEqual(status.output.keyExists, true);
  assert.strictEqual(status.output.keyMatches, true);
  assert.match(status.output.publicKeyFingerprint, /^[A-F0-9]{16}$/);

  const issued = run("issue", {
    ...baseEnvironment,
    HSM_TOOL_MACHINE_ID: "hsm-abc1234567",
    HSM_TOOL_PLAN: "quarter",
    HSM_TOOL_START_DATE: "2026-07-19"
  });
  assert.strictEqual(issued.status, 0);
  assert.strictEqual(issued.output.machineId, "HSMABC1234567");
  assert.strictEqual(issued.output.plan, "Q");
  assert.strictEqual(issued.output.expires, "20261019");

  const parsed = issuer.parseLicenseCode(issued.output.code);
  assert.ok(parsed);
  const verified = crypto.verify(
    null,
    Buffer.from(issuer.canonicalPayload(parsed.plan, parsed.expires, parsed.machineId), "ascii"),
    primary.pair.publicKey,
    Buffer.from(parsed.signature, "base64url")
  );
  assert.strictEqual(verified, true);
  const historyText = fs.readFileSync(history, "utf8");
  assert.match(historyText, /HSMABC1234567/);
  assert.match(historyText, /季卡/);
  assert.match(historyText, /HSM2\.Q\.20261019/);

  const mismatch = run("status", {
    ...baseEnvironment,
    HSM_LICENSE_PRIVATE_KEY: other.privateKeyPath
  });
  assert.strictEqual(mismatch.status, 0);
  assert.strictEqual(mismatch.output.keyMatches, false);

  const rejected = run("issue", {
    ...baseEnvironment,
    HSM_LICENSE_PRIVATE_KEY: other.privateKeyPath,
    HSM_TOOL_MACHINE_ID: "HSMABC1234567",
    HSM_TOOL_PLAN: "month",
    HSM_TOOL_START_DATE: "2026-07-19"
  });
  assert.strictEqual(rejected.status, 1);
  assert.match(rejected.output.error, /不匹配/);

  const invalidMachine = run("issue", {
    ...baseEnvironment,
    HSM_TOOL_MACHINE_ID: "INVALID",
    HSM_TOOL_PLAN: "year",
    HSM_TOOL_START_DATE: "2026-07-19"
  });
  assert.strictEqual(invalidMachine.status, 1);
  assert.match(invalidMachine.output.error, /机器码/);

  console.log("License tool CLI tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
