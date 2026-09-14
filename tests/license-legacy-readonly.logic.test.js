const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextDecoder } = require("util");

const projectRoot = path.join(__dirname, "..");
const fixtureRoot = path.join(__dirname, "fixtures", "license-legacy-0.3.3");
const readonlyPath = path.join(projectRoot, "migration", "0.3.4", "js", "license-legacy-readonly.js");
const snapshotPath = path.join(fixtureRoot, "license-0.3.3.js");
const fixturePath = path.join(fixtureRoot, "payload-fixture.json");
const vectorsPath = path.join(fixtureRoot, "golden-vectors.json");

function readUtf8Strict(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert(!text.includes("\uFFFD"), `${filePath} contains a UTF-8 replacement character`);
  return { bytes, text };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixedDateClass(dateText) {
  const NativeDate = Date;
  const fixedTimestamp = new NativeDate(`${dateText}T12:00:00`).getTime();
  return class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTimestamp]));
    }

    static now() {
      return fixedTimestamp;
    }
  };
}

function loadPublishedLicense(source, machineId, evaluationDate) {
  const storage = {
    values: Object.create(null),
    getItem(key) {
      return this.values[key] || "";
    },
    setItem(key, value) {
      this.values[key] = String(value);
    }
  };
  const context = {
    console,
    Date: fixedDateClass(evaluationDate),
    module: { exports: {} },
    exports: {},
    localStorage: storage,
    navigator: {},
    screen: {},
    setTimeout,
    clearTimeout
  };
  context.window = {
    Application: {
      Env: { GetAppDataPath: () => "C:\\SyntheticAppData" },
      FileSystem: { ReadFile: () => machineId },
      PluginStorage: storage
    }
  };
  vm.runInNewContext(source, context, { filename: "license-0.3.3.js" });
  return context.module.exports;
}

const fixture = JSON.parse(readUtf8Strict(fixturePath).text);
const golden = JSON.parse(readUtf8Strict(vectorsPath).text);
const readonlySource = readUtf8Strict(readonlyPath);
const snapshotSource = readUtf8Strict(snapshotPath);
const readonly = require(readonlyPath);

assert.strictEqual(fixture.sourceVersion, "0.3.3");
assert.strictEqual(fixture.purpose, "migration-tests-only");
assert.strictEqual(fixture.buildIsolation.mustNeverEnterCurrentPayload, true);
assert.strictEqual(golden.purpose, "synthetic-test-vectors-only");
assert.strictEqual(golden.machineId, "HSMTEST000001");
assert.strictEqual(golden.foreignMachineId, "HSMOTHER00001");
assert.strictEqual(golden.vectors.length, 8);
assert(golden.notice.includes("synthetic test data"));

const forbiddenRuntimeTokens = [
  "localStorage",
  "PluginStorage",
  "setItem(",
  "CreateTaskPane",
  "MathTaskPanes",
  "ShellExecute",
  "OAAssist",
  "XMLHttpRequest",
  "WebSocket",
  "localhost",
  "127.0.0.1",
  "window.Application",
  "document."
];
for (const token of forbiddenRuntimeTokens) {
  assert(!readonlySource.text.includes(token), `read-only legacy module must not contain ${token}`);
}

assert.strictEqual(readonly.sourceVersion, "0.3.3");
assert.strictEqual(Object.isFrozen(readonly), true);

const releaseLicensePaths = [
  path.join(projectRoot, "release", "WpsHighSchoolMath-0.3.3-offline", "payload", "WpsHighSchoolMath_0.3.3", "js", "license.js"),
  path.join(projectRoot, "release", "WpsHighSchoolMath-0.3.3-offline", "payload", "WpsHighSchoolMathPpt_0.3.3", "js", "license.js")
];
for (const releasePath of releaseLicensePaths) {
  if (!fs.existsSync(releasePath)) {
    continue;
  }
  const published = readUtf8Strict(releasePath);
  assert.strictEqual(sha256(published.bytes), fixture.licenseSourcePublishedSha256);
  assert.strictEqual(published.text.replace(/\r\n/g, "\n"), snapshotSource.text.replace(/\r\n/g, "\n"));
}

const legacy = loadPublishedLicense(snapshotSource.text, golden.machineId, golden.evaluationDate);
for (const vector of golden.vectors) {
  const publishedResult = jsonClone(legacy.publicApi.validateLicenseCode(vector.code));
  const readonlyResult = jsonClone(
    readonly.validateLicenseCode(vector.code, golden.machineId, golden.evaluationDate)
  );
  assert.deepStrictEqual(publishedResult, vector.expected, `${vector.id}: published 0.3.3 result changed`);
  assert.deepStrictEqual(readonlyResult, vector.expected, `${vector.id}: read-only compatibility result changed`);
  assert.deepStrictEqual(readonlyResult, publishedResult, `${vector.id}: G0 compatibility mismatch`);
}

const parsedMonthly = readonly.parseLicenseCode(golden.vectors[0].code);
const parsedYearly = readonly.parseLicenseCode(golden.vectors[2].code);
const parsedPermanent = readonly.parseLicenseCode(golden.vectors[3].code);
assert.strictEqual(readonly.compareLicenseStrength(parsedPermanent, parsedYearly), 1);
assert.strictEqual(readonly.compareLicenseStrength(parsedYearly, parsedMonthly), 1);
assert.strictEqual(readonly.compareLicenseStrength(parsedMonthly, parsedMonthly), 0);
assert.strictEqual(readonly.compareLicenseStrength(null, parsedMonthly), -1);

console.log("license legacy read-only G0 tests passed (8 synthetic vectors, UTF-8, release parity)");
