"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "probes", "wps-native-capabilities", "src", "shared", "probe.js"), "utf8");
const appData = "C:\\SyntheticAppData";
const root = appData + "\\WpsHighSchoolMath\\native-capability-probe";
const records = root + "\\records";
const fileTests = root + "\\file-tests";
const runPath = root + "\\run-context.json";
const recordPath = records + "\\writer.json";
const overwritePath = fileTests + "\\writer-overwrite.bin";
const exchangePath = fileTests + "\\cross-host.bin";
const runId = "12345678-1234-4123-8123-123456789abc";
const startedAt = new Date(Date.now() - 2000).toISOString();
const prefix = "HSMB64:1:";

function pack(text) { return prefix + Buffer.from(String(text), "utf8").toString("base64"); }
function unpack(text) {
  const value = String(text);
  assert.ok(value.startsWith(prefix), "expected binary storage envelope");
  return Buffer.from(value.slice(prefix.length), "base64").toString("utf8");
}
function createHarness(options = {}) {
  const directories = new Set([appData, appData + "\\WpsHighSchoolMath", root, records, fileTests]);
  const files = new Map();
  const alerts = [];
  const inputQueue = [];
  const calls = { binaryWrite: [], binaryRead: [], stringWrite: [], stringRead: [], legacyWrite: [], legacyRead: [], prompt: 0, globalInput: 0, applicationInput: 0 };
  const run = { schema: "WpsHighSchoolMathNativeCapabilityRunContext", version: 1, runId, startedAt, preparedAt: startedAt };
  files.set(runPath, pack(JSON.stringify(run)));
  const fileSystem = {
    Exists(target) { return directories.has(String(target)) || files.has(String(target)); },
    mkdirSync(target) { directories.add(String(target)); return true; },
    writeAsBinaryString(target, contents) {
      const name = String(target); calls.binaryWrite.push(name);
      if (options.failBinaryWrite) { throw new Error("synthetic binary write failure"); }
      files.set(name, String(contents)); return true;
    },
    readAsBinaryString(target) {
      const name = String(target); calls.binaryRead.push(name);
      if (options.failBinaryRead) { throw new Error("synthetic binary read failure"); }
      if (!files.has(name)) { throw new Error("missing binary file: " + name); }
      return files.get(name);
    },
    writeFileString(target, contents) {
      const name = String(target); calls.stringWrite.push(name);
      if (options.disallowLegacy) { throw new Error("string API must not be used"); }
      files.set(name, String(contents)); return true;
    },
    readFileString(target) {
      const name = String(target); calls.stringRead.push(name);
      if (options.disallowLegacy) { throw new Error("string API must not be used"); }
      if (!files.has(name)) { throw new Error("missing diagnostic file"); }
      return files.get(name);
    },
    WriteFile(target, contents) {
      const name = String(target); calls.legacyWrite.push(name);
      if (options.disallowLegacy) { throw new Error("legacy API must not be used"); }
      files.set(name, String(contents)); return true;
    },
    ReadFile(target) {
      const name = String(target); calls.legacyRead.push(name);
      if (options.disallowLegacy) { throw new Error("legacy API must not be used"); }
      return files.get(name);
    }
  };
  const application = {
    Env: { GetAppDataPath() { return appData; } },
    FileSystem: fileSystem,
    alert(text) { alerts.push(String(text)); }
  };
  if (options.applicationInputBox || options.bothInputBoxes) { application.InputBox = function () { calls.applicationInput += 1; return inputQueue.shift(); }; }
  const context = {
    Application: application, Date, JSON, Math, Number, String, console,
    prompt() { calls.prompt += 1; throw new Error("browser prompt is forbidden"); }
  };
  if (!options.applicationInputBox || options.bothInputBoxes) { context.InputBox = function () { calls.globalInput += 1; return inputQueue.shift(); }; }
  vm.createContext(context);
  vm.runInContext(source, context);
  function readRecord() {
    const raw = files.get(recordPath);
    assert.ok(raw, "host record was not persisted");
    return JSON.parse(String(raw).startsWith(prefix) ? unpack(raw) : raw);
  }
  return { context, files, directories, alerts, calls, inputQueue, readRecord };
}
function completeNativeInput(harness) {
  const { context, inputQueue } = harness;
  const api = context.HsmNativeCapabilityProbeTestApi;
  context.OnAddinLoad({ InvalidateControl() {} });
  context.OnProbeAction({ id: "probe_mark_visible" });

  inputQueue.push("");
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "empty default echo must be observed after OK");
  inputQueue.push(false);
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "cancel must be a successful observation");
  inputQueue.push(api.challengeText);
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "plain paste must pass");
  inputQueue.push("  " + api.challengeText + "  ");
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "whitespace-preserving paste must pass");
  inputQueue.push(api.maxInputVector);
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "33-character maximum vector must pass");
  inputQueue.push("");
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "empty OK result must be observed separately");
  inputQueue.push("HSM-INVALID-PROBE");
  assert.equal(context.OnProbeAction({ id: "probe_open_input" }), true, "invalid vector must preserve synthetic authority");
}
function addPeerMarker(harness) {
  harness.files.set(exchangePath, pack(JSON.stringify({
    schema: "WpsHighSchoolMathNativeProbeExchange", version: 1, runId,
    markers: { presentation: { host: "presentation", runId, marker: "peer", writtenAt: startedAt } }
  })));
}

(function codecsAreEs5AndUnicodeSafe() {
  const harness = createHarness();
  const api = harness.context.HsmNativeCapabilityProbeTestApi;
  const text = "ASCII 中文 ✓ 🚀";
  assert.equal(api.decodeStorageText(api.encodeStorageText(text)), text);
  assert.throws(() => api.decodeStorageText("not-an-envelope"), /envelope/);
  const raw12000 = "R".repeat(12000);
  assert.equal(api.decodeStorageText(api.encodeStorageText(raw12000)), raw12000);
  assert.throws(() => api.encodeStorageText(raw12000 + "X"), /raw UTF-8 limit/);
  const physical16384 = "HSMB64:1:" + "A".repeat(16384 - 9);
  assert.throws(() => api.decodeStorageText(physical16384), (error) => !/limit/.test(error.message),
    "exact physical limit must reach decoding instead of the size rejection branch");
  assert.throws(() => api.decodeStorageText(physical16384 + "A"), /before decode/);
  assert.throws(() => api.decodeStorageText("HSMB64:1:%%%="), /Base64/);
  assert.throws(() => api.decodeStorageText("HSMB64:1:\/w=="), /UTF-8/);
})();

(function binaryHardGateAndGlobalInputBoxPassWithoutLegacy() {
  const harness = createHarness({ disallowLegacy: true });
  completeNativeInput(harness);
  addPeerMarker(harness);
  assert.equal(harness.context.OnProbeAction({ id: "probe_run_files" }), true);
  const record = harness.readRecord();
  const current = record.sessions[record.sessions.length - 1];
  assert.equal(record.version, 2);
  assert.equal(record.runId, runId);
  assert.equal(record.startedAt, startedAt);
  assert.equal(current.runId, runId);
  assert.equal(current.addinLoaded, true);
  assert.equal(current.visibleConfirmed, true);
  assert.equal(current.nativeInputMethod, "global.InputBox");
  assert.equal(current.nativeInputBoxCalls, 7);
  assert.equal(current.initialDefaultPresented, true);
  assert.equal(current.defaultEchoReturnType, "string:empty");
  assert.equal(current.inputParameterForm, "(prompt,title,defaultValue)");
  assert.equal(current.inputArgumentCount, 3);
  assert.equal(current.defaultValueLength, 0);
  assert.equal(current.cancelSentinelType, "boolean:false");
  assert.equal(current.cancelDidNotTrySecondEntry, true);
  assert.equal(current.plainPasteObserved, true);
  assert.equal(current.whitespacePasteObserved, true);
  assert.equal(current.maxLengthObserved, true);
  assert.equal(current.maxLegalLength, 33);
  assert.equal(current.emptyInputObserved, true);
  assert.equal(current.emptyReturnType, "string:empty");
  assert.equal(current.emptyReturnLength, 0);
  assert.equal(current.invalidInputObserved, true);
  assert.equal(current.authorityUnchangedAfterInvalid, true);
  assert.equal(current.failureCodePersisted, false);
  assert.equal(current.sensitiveTextPersisted, false);
  assert.equal(current.cancelObserved, true);
  assert.equal(current.cancelPreservedState, true);
  assert.equal(current.fullInputObserved, true);
  assert.equal(current.acceptedChallengeCount, 3);
  assert.equal(current.verifiedRounds, 3);
  assert.equal(record.fileSystem.runId, runId);
  assert.equal(record.fileSystem.startedAt, startedAt);
  assert.equal(record.fileSystem.lastSessionId, current.id);
  assert.equal(record.fileSystem.requiredWriteAsBinaryString, true);
  assert.equal(record.fileSystem.requiredReadAsBinaryString, true);
  assert.equal(record.fileSystem.utf8Base64RoundTrip, true);
  assert.equal(record.fileSystem.overwriteAndTruncate, true);
  assert.equal(record.fileSystem.read1024RoundTrip, true);
  assert.equal(record.fileSystem.read1025RoundTrip, true);
  assert.equal(record.fileSystem.readReturnType1024, "string");
  assert.equal(record.fileSystem.readReturnType1025, "string");
  assert.equal(record.fileSystem.raw12000RoundTrip, true);
  assert.equal(record.fileSystem.raw12001RejectedBeforeWrite, true);
  assert.ok(record.fileSystem.raw12000EnvelopeLength <= 16384);
  assert.equal(record.fileSystem.physicalEnvelope16384RoundTrip, true);
  assert.equal(record.fileSystem.physicalEnvelopeOverLimitRejectedBeforeWrite, true);
  assert.equal(record.fileSystem.physicalEnvelopeOverLimitRejectedAfterRead, true);
  assert.equal(record.fileSystem.invalidPrefixRejected, true);
  assert.equal(record.fileSystem.invalidBase64Rejected, true);
  assert.equal(record.fileSystem.invalidUtf8Rejected, true);
  assert.equal(record.fileSystem.slotRevisionSelection, true);
  assert.equal(record.fileSystem.singleSlotRecovery, true);
  assert.equal(record.fileSystem.corruptSlotRewrite, true);
  assert.equal(record.fileSystem.ownMarkerWritten, true);
  assert.equal(record.fileSystem.peerHostObserved, true);
  assert.equal(record.fileSystem.legacyDiagnosticAttempted, false);
  assert.equal(record.fileSystem.legacyDiagnosticTransport, false);
  assert.equal(harness.calls.stringWrite.length + harness.calls.stringRead.length + harness.calls.legacyWrite.length + harness.calls.legacyRead.length, 0);
  const serializedRecord = JSON.stringify(record);
  assert.equal(serializedRecord.includes(harness.context.HsmNativeCapabilityProbeTestApi.challengeText), false);
  assert.equal(serializedRecord.includes(harness.context.HsmNativeCapabilityProbeTestApi.maxInputVector), false);
  assert.equal(serializedRecord.includes("HSM-INVALID-PROBE"), false);
  assert.equal(harness.calls.prompt, 0);
  assert.ok(harness.calls.binaryWrite.length > 0 && harness.calls.binaryRead.length > 0);
  assert.ok(harness.calls.binaryWrite.every((name) => name.startsWith(appData + "\\")));
  assert.ok(harness.calls.binaryRead.every((name) => name.startsWith(appData + "\\")));
})();

(function globalCancelNeverOpensApplicationFallback() {
  const harness = createHarness({ bothInputBoxes: true, disallowLegacy: true });
  harness.context.OnAddinLoad({ InvalidateControl() {} });
  harness.inputQueue.push("");
  harness.context.OnProbeAction({ id: "probe_open_input" });
  harness.inputQueue.push(false);
  harness.context.OnProbeAction({ id: "probe_open_input" });
  const current = harness.readRecord().sessions.slice(-1)[0];
  assert.equal(current.cancelSentinelType, "boolean:false");
  assert.equal(current.cancelDidNotTrySecondEntry, true);
  assert.equal(harness.calls.globalInput, 2);
  assert.equal(harness.calls.applicationInput, 0, "cancel must not trigger the second native entry");
})();

(function applicationInputBoxFallbackPassesAndDoesNotUseBrowserPrompt() {
  const harness = createHarness({ applicationInputBox: true, disallowLegacy: true });
  completeNativeInput(harness);
  const current = harness.readRecord().sessions.slice(-1)[0];
  assert.equal(current.nativeInputMethod, "Application.InputBox");
  assert.equal(current.cancelPreservedState, true);
  assert.equal(current.globalInputAttempted, false);
  assert.equal(current.applicationInputAttempted, true);
  assert.equal(harness.calls.prompt, 0);
})();
(function failedBinaryWriteCanOnlyUseOldApisForFailureEvidence() {
  const harness = createHarness({ failBinaryWrite: true });
  completeNativeInput(harness);
  assert.equal(harness.context.OnProbeAction({ id: "probe_run_files" }), false,
    "diagnostic transport must not turn a binary failure into a pass");
  const record = harness.readRecord();
  assert.equal(record.fileSystem.requiredWriteAsBinaryString, false);
  assert.equal(record.fileSystem.requiredReadAsBinaryString, false);
  assert.equal(record.fileSystem.utf8Base64RoundTrip, false);
  assert.equal(record.fileSystem.legacyDiagnosticAttempted, true);
  assert.equal(record.fileSystem.legacyDiagnosticTransport, true);
  assert.equal(record.fileSystem.legacyDiagnosticApi, "writeFileString/readFileString");
  assert.equal(record.fileSystem.lastError,
    "writeAsBinaryString failed for full AppData path \"" + overwritePath + "\": synthetic binary write failure");
  assert.ok(harness.calls.stringWrite.length > 0 && harness.calls.stringRead.length > 0);
  assert.ok(harness.calls.stringWrite.every((name) => name === recordPath));
  assert.ok(harness.calls.stringRead.every((name) => name === recordPath));
  assert.equal(harness.alerts.some((text) => text.includes("跨宿主探针通过")), false);
})();

(function wrongDefaultEchoCannotClaimInitialPresentation() {
  const harness = createHarness({ disallowLegacy: true });
  harness.context.OnAddinLoad({ InvalidateControl() {} });
  harness.inputQueue.push("wrong");
  assert.equal(harness.context.OnProbeAction({ id: "probe_open_input" }), false);
  let current = harness.readRecord().sessions.slice(-1)[0];
  assert.equal(current.initialDefaultPresented, false,
    "the default must not be marked presented until the exact unedited empty echo returns");
  harness.inputQueue.push("");
  assert.equal(harness.context.OnProbeAction({ id: "probe_open_input" }), true);
  harness.inputQueue.push(false);
  assert.equal(harness.context.OnProbeAction({ id: "probe_open_input" }), true);
  current = harness.readRecord().sessions.slice(-1)[0];
  assert.equal(current.initialDefaultPresented, true);
  assert.equal(current.verifiedRounds, 0);
  assert.equal(current.acceptedChallengeCount, 0);
  assert.equal(current.cancelObserved, true);
  assert.equal(current.cancelPreservedState, true);
})();
console.log("WPS scheme-A native capability probe logic tests passed");
