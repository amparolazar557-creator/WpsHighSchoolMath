(function (global) {
  "use strict";
  var HOST = global.HSM_NATIVE_PROBE_HOST === "presentation" ? "presentation" : "writer";
  var PEER = HOST === "writer" ? "presentation" : "writer";
  var RECORD_SCHEMA = "WpsHighSchoolMathNativeCapabilityHostRecord";
  var RUN_SCHEMA = "WpsHighSchoolMathNativeCapabilityRunContext";
  var SLOT_SCHEMA = "WpsHighSchoolMathNativeProbeSlot";
  var EXCHANGE_SCHEMA = "WpsHighSchoolMathNativeProbeExchange";
  var PREFIX = "HSMB64:1:";
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var INITIAL = "";
  var MAX_INPUT_LENGTH = 33;
  var MAX_INPUT_VECTOR = "HSMPPERMANENTHSMABCDEFGHIJABCDEFG";
  var MAX_RAW_BYTES = 12000;
  var MAX_ENVELOPE_BYTES = 16384;
  var CHALLENGE = "HSM-PROBE-\u4E2D\u6587-1234567890";
  var ribbonUI = null;
  var state = null;
  var session = null;
  var legacyAttempted = false;
  var legacyUsed = false;
  var legacyApi = "";
  var NATIVE_X_MODULE = "hsmmathnativeprobe";
  var NATIVE_X_AUDIT = "nativex-result.txt";
  var NATIVE_COM_PROG_ID = "WpsHsm.NativeDialogProbe";
  var nativeDialog = {
    attempted: false, loaded: false, status: "not-run", bridgeVersion: "", processId: 0,
    processName: "", resultLength: -1, sensitiveBufferCleared: false, lastError: ""
  };

  function now() { return new Date().toISOString(); }
  function message(error) { return String(error && error.message ? error.message : error); }
  function app() { return global.Application || null; }
  function fsObject() { var value = app(); return value && value.FileSystem ? value.FileSystem : null; }
  function notify(text) {
    var value = app();
    try {
      if (value && typeof value.alert === "function") { value.alert(String(text)); return; }
    } catch (_) {}
    try { if (typeof global.alert === "function") { global.alert(String(text)); } } catch (_) {}
  }
  function appData() {
    var value = app();
    if (!value || !value.Env || typeof value.Env.GetAppDataPath !== "function") {
      throw new Error("Env.GetAppDataPath unavailable");
    }
    var path = String(value.Env.GetAppDataPath() || "").replace(/[\\\/]+$/, "");
    if (!path) { throw new Error("Env.GetAppDataPath returned an empty path"); }
    return path;
  }
  function join(left, right) {
    return String(left).replace(/[\\\/]+$/, "") + "\\" + String(right).replace(/^[\\\/]+/, "");
  }
  function parseNativeXAudit(text) {
    var values = {}, lines = String(text || "").split(/\r?\n/), i, at;
    for (i = 0; i < lines.length; i += 1) {
      at = lines[i].indexOf("=");
      if (at > 0) { values[lines[i].substring(0, at)] = lines[i].substring(at + 1); }
    }
    if (values.schema !== "HSMNATIVEX1") { throw new Error("NativeX did not replace the launch sentinel"); }
    values.status = Number(values.status);
    values.pid = Number(values.pid);
    values.resultLength = Number(values.resultLength);
    values.process = String(values.process || "").toLowerCase().replace(/\.exe$/, "");
    values.sensitiveBufferCleared = values.sensitiveBufferCleared === "true";
    return values;
  }
  function launchNativeXModule() {
    var value = app(), auditPath = join(paths(true).root, NATIVE_X_AUDIT), activationError = null, raw;
    if (!value || typeof value.CreateObject !== "function") {
      throw new Error("WPS Application.CreateObject is unavailable");
    }
    rawBinaryWrite(auditPath, "pending=" + now() + "\n", false);
    try { value.CreateObject(NATIVE_X_MODULE); }
    catch (error) { activationError = error; }
    raw = rawBinaryRead(auditPath, false, null, "");
    try { return parseNativeXAudit(raw); }
    catch (auditError) {
      throw new Error("NativeX activation produced no valid in-process audit" +
        (activationError ? ": " + message(activationError) : ": " + message(auditError)));
    }
  }
  function launchNativeComDialog() {
    var value = app(), addin, bridge, status, resultLength, clearedLength, lastError = "";
    var bridgeApi = "", oaAssistError = "";
    if (!value) {
      throw new Error("WPS Application is unavailable");
    }
    if (value.OAAssist && typeof value.OAAssist.CoCreateInstance === "function") {
      try {
        bridge = value.OAAssist.CoCreateInstance(NATIVE_COM_PROG_ID);
        if (bridge) { bridgeApi = "OAAssist.CoCreateInstance"; }
      } catch (error) {
        oaAssistError = message(error);
      }
    }
    if (!bridge && (!value.COMAddIns || typeof value.COMAddIns.Item !== "function")) {
      throw new Error("WPS native COM creation is unavailable" +
        (oaAssistError ? "; OAAssist: " + oaAssistError : ""));
    }
    if (!bridge) {
      try { addin = value.COMAddIns.Item(NATIVE_COM_PROG_ID); }
      catch (error) { throw new Error("COMAddIns.Item failed: " + message(error) +
        (oaAssistError ? "; OAAssist: " + oaAssistError : "")); }
      if (!addin) { throw new Error("COM add-in was not found: " + NATIVE_COM_PROG_ID); }
      try {
        if (!addin.Connect) { addin.Connect = true; }
      } catch (error) {
        throw new Error("COM add-in connection failed: " + message(error));
      }
      try { bridge = addin.Object; }
      catch (error) { throw new Error("COMAddIn.Object read failed: " + message(error)); }
      if (!bridge) {
        throw new Error("COMAddIn.Object is empty after Connect=true" +
          (oaAssistError ? "; OAAssist: " + oaAssistError : ""));
      }
      bridgeApi = "Application.COMAddIns.Object";
    }
    try {
      status = Number(bridge.ShowInputDialog(
        "\u9AD8\u4E2D\u6570\u5B66\u539F\u751F\u80FD\u529B\u63A2\u9488",
        "\u539F\u751F COM DLL \u5DF2\u5728\u5F53\u524D WPS \u8FDB\u7A0B\u5185\u8FD0\u884C\u3002\u8BF7\u8F93\u5165\u9A8C\u6536\u6587\u672C\uFF1A",
        "HSM-COM-\u4E2D\u6587-1234567890",
        4096));
      resultLength = Number(bridge.GetLastResultLength());
      bridge.ClearResult();
      clearedLength = Number(bridge.GetLastResultLength());
      try { lastError = String(bridge.GetLastError() || ""); } catch (_) {}
      return {
        status: status,
        pid: Number(bridge.GetProcessId()),
        process: String(bridge.GetProcessName() || "").toLowerCase().replace(/\.exe$/, ""),
        resultLength: resultLength,
        sensitiveBufferCleared: clearedLength === 0,
        bridgeVersion: String(bridge.GetBridgeVersion() || ""),
        bridgeApi: bridgeApi,
        lastError: lastError
      };
    } catch (error) {
      try { bridge.ClearResult(); } catch (_) {}
      throw new Error("native COM dialog call failed via " + bridgeApi + ": " + message(error) +
        (oaAssistError ? "; OAAssist activation: " + oaAssistError : "") +
        (lastError ? "; " + lastError : ""));
    }
  }
  function parseNativeComChannelResponse(text, nonce) {
    var values = {}, lines = String(text || "").split(/\r?\n/), i, at;
    for (i = 0; i < lines.length; i += 1) {
      at = lines[i].indexOf("=");
      if (at > 0) { values[lines[i].substring(0, at)] = lines[i].substring(at + 1); }
    }
    if (values.schema !== "HSMCOM1" || values.nonce !== nonce || values.end !== "1") { return null; }
    values.status = Number(values.status);
    values.pid = Number(values.pid);
    values.resultLength = Number(values.resultLength);
    values.process = String(values.process || "").toLowerCase().replace(/\.exe$/, "");
    values.sensitiveBufferCleared = values.sensitiveBufferCleared === "true";
    values.bridgeVersion = String(values.bridgeVersion || "");
    values.lastError = String(values.error || "");
    return values;
  }
  function ensureNativeComAddinConnected() {
    var value = app(), addin, bridge;
    if (!value || !value.COMAddIns || typeof value.COMAddIns.Item !== "function") {
      throw new Error("WPS Application.COMAddIns is unavailable");
    }
    try {
      if (typeof value.COMAddIns.Update === "function") { value.COMAddIns.Update(); }
    } catch (_) {}
    try { addin = value.COMAddIns.Item(NATIVE_COM_PROG_ID); }
    catch (error) { throw new Error("COMAddIns.Item failed: " + message(error)); }
    if (!addin) { throw new Error("COM add-in was not found: " + NATIVE_COM_PROG_ID); }
    try {
      addin.Connect = false;
      if (typeof value.COMAddIns.Update === "function") { value.COMAddIns.Update(); }
      addin.Connect = true;
      if (!addin.Connect) { throw new Error("Connect remained false"); }
    } catch (error) {
      throw new Error("COM add-in connection failed: " + message(error));
    }
    try { bridge = addin.Object; }
    catch (error) { throw new Error("COMAddIn.Object read failed: " + message(error)); }
    if (!bridge) { throw new Error("COMAddIn.Object is empty after Connect=true"); }
    return true;
  }
  function launchNativeCommandDialog(callback) {
    var p = paths(true), processName = HOST === "writer" ? "wps" : "wpp";
    var nonce = "hsm-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0x1000000).toString(36);
    var requestPath = join(p.root, "command-" + processName + ".txt");
    var responsePath = join(p.root, "response-" + processName + ".txt");
    var request = "schema=HSMCOM1\nnonce=" + nonce + "\naction=probe-input\nhost=" + processName + "\nend=1\n";
    var started = Date.now();
    if (typeof global.setTimeout !== "function") {
      throw new Error("WPS JavaScript timer API is unavailable");
    }
    ensureNativeComAddinConnected();
    rawBinaryWrite(requestPath, request, false);
    function pollResponse() {
      var response, audit;
      try {
        response = rawBinaryRead(responsePath, false, null, "");
        audit = parseNativeComChannelResponse(response, nonce);
        if (audit) { callback(null, audit); return; }
      } catch (_) {}
      if (Date.now() - started >= 30000) {
        callback(new Error("native COM file channel timed out"), null);
        return;
      }
      global.setTimeout(pollResponse, 100);
    }
    global.setTimeout(pollResponse, 100);
    return nonce;
  }
  function exists(path) {
    var fs = fsObject();
    if (!fs) { return false; }
    if (typeof fs.Exists === "function") { return !!fs.Exists(path); }
    if (typeof fs.existsSync === "function") { return !!fs.existsSync(path); }
    return false;
  }
  function mkdir(path) {
    var fs = fsObject();
    var result;
    if (!fs) { throw new Error("FileSystem unavailable"); }
    if (exists(path)) { return true; }
    if (typeof fs.mkdirSync === "function") { result = fs.mkdirSync(path); }
    else if (typeof fs.Mkdir === "function") { result = fs.Mkdir(path); }
    else { throw new Error("directory creation API unavailable"); }
    if (result === false || !exists(path)) { throw new Error("directory was not created: " + path); }
    return true;
  }
  function paths(create) {
    var root = join(appData(), "WpsHighSchoolMath");
    var probe = join(root, "native-capability-probe");
    var records = join(probe, "records");
    var files = join(probe, "file-tests");
    if (create) { mkdir(root); mkdir(probe); mkdir(records); mkdir(files); }
    return { root: probe, records: records, files: files, run: join(probe, "run-context.json") };
  }

  function utf8Encode(text) {
    var s = String(text), out = [], i, c, n, p;
    for (i = 0; i < s.length; i += 1) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        n = s.charCodeAt(i + 1);
        if (!(n >= 0xDC00 && n <= 0xDFFF)) { throw new Error("invalid UTF-16 high surrogate"); }
        p = 0x10000 + ((c - 0xD800) << 10) + n - 0xDC00;
        out.push(0xF0 | (p >>> 18), 0x80 | ((p >>> 12) & 63), 0x80 | ((p >>> 6) & 63), 0x80 | (p & 63));
        i += 1;
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        throw new Error("invalid UTF-16 low surrogate");
      } else if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xC0 | (c >>> 6), 0x80 | (c & 63)); }
      else { out.push(0xE0 | (c >>> 12), 0x80 | ((c >>> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  function utf8Decode(bytes) {
    var s = "", i = 0, a, b, c, d, p;
    function cont(v) { return typeof v === "number" && (v & 0xC0) === 0x80; }
    while (i < bytes.length) {
      a = bytes[i];
      if (a < 0x80) { s += String.fromCharCode(a); i += 1; }
      else if (a >= 0xC2 && a <= 0xDF) {
        b = bytes[i + 1];
        if (!cont(b)) { throw new Error("invalid UTF-8 sequence"); }
        s += String.fromCharCode(((a & 31) << 6) | (b & 63)); i += 2;
      } else if (a >= 0xE0 && a <= 0xEF) {
        b = bytes[i + 1]; c = bytes[i + 2];
        if (!cont(b) || !cont(c) || (a === 0xE0 && b < 0xA0) || (a === 0xED && b >= 0xA0)) {
          throw new Error("invalid UTF-8 sequence");
        }
        s += String.fromCharCode(((a & 15) << 12) | ((b & 63) << 6) | (c & 63)); i += 3;
      } else if (a >= 0xF0 && a <= 0xF4) {
        b = bytes[i + 1]; c = bytes[i + 2]; d = bytes[i + 3];
        if (!cont(b) || !cont(c) || !cont(d) || (a === 0xF0 && b < 0x90) || (a === 0xF4 && b >= 0x90)) {
          throw new Error("invalid UTF-8 sequence");
        }
        p = (((a & 7) << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63)) - 0x10000;
        s += String.fromCharCode(0xD800 + (p >>> 10), 0xDC00 + (p & 1023)); i += 4;
      } else { throw new Error("invalid UTF-8 leading byte"); }
    }
    return s;
  }
  function b64Encode(bytes) {
    var s = "", i, a, b, c;
    for (i = 0; i < bytes.length; i += 3) {
      a = bytes[i]; b = i + 1 < bytes.length ? bytes[i + 1] : 0; c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      s += B64.charAt(a >>> 2) + B64.charAt(((a & 3) << 4) | (b >>> 4));
      s += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >>> 6)) : "=";
      s += i + 2 < bytes.length ? B64.charAt(c & 63) : "=";
    }
    return s;
  }
  function b64Decode(text) {
    var s = String(text), out = [], i, a, b, c, d;
    if (s.length % 4 !== 0 || !/^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/.test(s)) {
      throw new Error("malformed Base64 payload");
    }
    for (i = 0; i < s.length; i += 4) {
      a = B64.indexOf(s.charAt(i)); b = B64.indexOf(s.charAt(i + 1));
      c = s.charAt(i + 2) === "=" ? 0 : B64.indexOf(s.charAt(i + 2));
      d = s.charAt(i + 3) === "=" ? 0 : B64.indexOf(s.charAt(i + 3));
      out.push((a << 2) | (b >>> 4));
      if (s.charAt(i + 2) !== "=") { out.push(((b & 15) << 4) | (c >>> 2)); }
      if (s.charAt(i + 3) !== "=") { out.push(((c & 3) << 6) | d); }
    }
    return out;
  }
  function pack(text) {
    var bytes = utf8Encode(String(text));
    var envelope;
    if (bytes.length > MAX_RAW_BYTES) { throw new Error("raw UTF-8 limit exceeded"); }
    envelope = PREFIX + b64Encode(bytes);
    if (envelope.length > MAX_ENVELOPE_BYTES) { throw new Error("ASCII envelope limit exceeded"); }
    return envelope;
  }
  function unpack(binary) {
    var value = String(binary);
    var bytes;
    if (value.length > MAX_ENVELOPE_BYTES) { throw new Error("ASCII envelope limit exceeded before decode"); }
    if (value.substring(0, PREFIX.length) !== PREFIX) { throw new Error("invalid binary storage envelope"); }
    bytes = b64Decode(value.substring(PREFIX.length));
    if (bytes.length > MAX_RAW_BYTES) { throw new Error("raw UTF-8 limit exceeded after decode"); }
    return utf8Decode(bytes);
  }
  function rawBinaryWrite(path, binary, enforceLimit) {
    var fs = fsObject(), result, value = String(binary);
    if (enforceLimit && value.length > MAX_ENVELOPE_BYTES) { throw new Error("ASCII envelope limit exceeded before write"); }
    if (!fs || typeof fs.writeAsBinaryString !== "function") { throw new Error(apiError("writeAsBinaryString", path, "API unavailable")); }
    try { result = fs.writeAsBinaryString(path, value); }
    catch (error) { throw new Error(apiError("writeAsBinaryString", path, message(error))); }
    if (result === false) { throw new Error(apiError("writeAsBinaryString", path, "API returned false")); }
    return typeof result;
  }
  function rawBinaryRead(path, enforceLimit, result, typeField) {
    var fs = fsObject(), value;
    if (!fs || typeof fs.readAsBinaryString !== "function") { throw new Error(apiError("readAsBinaryString", path, "API unavailable")); }
    try { value = fs.readAsBinaryString(path); }
    catch (error) { throw new Error(apiError("readAsBinaryString", path, message(error))); }
    if (result && typeField) { result[typeField] = typeof value; }
    if (typeof value !== "string") { throw new Error(apiError("readAsBinaryString", path, "non-string return type " + typeof value)); }
    if (enforceLimit && value.length > MAX_ENVELOPE_BYTES) { throw new Error("ASCII envelope limit exceeded before decode"); }
    return value;
  }
  function apiError(name, path, detail) { return name + " failed for full AppData path \"" + path + "\": " + detail; }
  function writeBinary(path, text) {
    rawBinaryWrite(path, pack(text), true);
  }
  function readBinary(path) {
    return unpack(rawBinaryRead(path, true, null, ""));
  }
  function writeRequired(path, text, result) {
    try { writeBinary(path, text); result.requiredWriteAsBinaryString = true; }
    catch (error) { result.requiredWriteAsBinaryString = false; throw error; }
  }
  function readRequired(path, result) {
    try { var value = readBinary(path); result.requiredReadAsBinaryString = true; return value; }
    catch (error) { result.requiredReadAsBinaryString = false; throw error; }
  }
  function legacyRead(path) {
    var fs = fsObject(), first = null;
    legacyAttempted = true;
    if (fs && typeof fs.readFileString === "function") {
      try { legacyUsed = true; legacyApi = "readFileString"; return String(fs.readFileString(path)); }
      catch (error) { first = error; legacyUsed = false; legacyApi = ""; }
    }
    if (fs && typeof fs.ReadFile === "function") {
      legacyUsed = true; legacyApi = "ReadFile"; return String(fs.ReadFile(path));
    }
    throw first || new Error("legacy diagnostic read unavailable");
  }
  function diagnosticRead(path) {
    try { return readBinary(path); }
    catch (binaryError) { try { return legacyRead(path); } catch (_) { throw binaryError; } }
  }

  function emptyFile(run) {
    return {
      runId: run ? run.runId : "", startedAt: run ? run.startedAt : "", ranAt: "", lastSessionId: "",
      appDataPathAvailable: false, directoryCreated: false,
      requiredWriteAsBinaryString: false, requiredReadAsBinaryString: false,
      utf8Base64RoundTrip: false, overwriteAndTruncate: false,
      read1024RoundTrip: false, read1025RoundTrip: false, readReturnType1024: "", readReturnType1025: "",
      raw12000RoundTrip: false, raw12001RejectedBeforeWrite: false, raw12000EnvelopeLength: 0,
      physicalEnvelope16384RoundTrip: false, physicalEnvelopeOverLimitRejectedBeforeWrite: false,
      physicalEnvelopeOverLimitRejectedAfterRead: false, invalidPrefixRejected: false,
      invalidBase64Rejected: false, invalidUtf8Rejected: false,
      slotRevisionSelection: false, singleSlotRecovery: false, corruptSlotRewrite: false,
      ownMarkerWritten: false, peerHostObserved: false,
      legacyDiagnosticAttempted: false, legacyDiagnosticTransport: false,
      legacyDiagnosticApi: "", legacyDiagnosticTransportError: "", lastError: ""
    };
  }
  function fresh(run) {
    return {
      schema: RECORD_SCHEMA, version: 2, host: HOST,
      runId: run ? run.runId : "", startedAt: run ? run.startedAt : "", updatedAt: now(), sessions: [],
      ribbon: { loaded: false, totalInputBoxCalls: 0, totalVerifiedRounds: 0, lastNativeInputMethod: "", lastError: "" },
      fileSystem: emptyFile(run)
    };
  }
  function validRun(run) {
    return run && run.schema === RUN_SCHEMA && run.version === 1 &&
      typeof run.runId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run.runId) &&
      typeof run.startedAt === "string" && !isNaN(new Date(run.startedAt).getTime());
  }
  function loadRun() {
    var run = JSON.parse(diagnosticRead(paths(false).run));
    if (!validRun(run)) { throw new Error("prepared run context is invalid"); }
    return run;
  }
  function normalize(value, run) {
    if (!value || value.schema !== RECORD_SCHEMA || value.version !== 2 || value.host !== HOST ||
        value.runId !== run.runId || value.startedAt !== run.startedAt || !value.ribbon || !value.fileSystem ||
        !(Array.isArray ? Array.isArray(value.sessions) : value.sessions instanceof Array)) {
      return fresh(run);
    }
    return value;
  }
  function recordPath() { return join(paths(false).records, HOST + ".json"); }
  function loadRecord(run) {
    var path = recordPath();
    return exists(path) ? normalize(JSON.parse(diagnosticRead(path)), run) : fresh(run);
  }
  function currentSession() {
    if (session) { return session; }
    session = {
      id: HOST + "-" + (state.runId || "unbound") + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000),
      runId: state.runId, loadedAt: now(), addinLoaded: true, visibleConfirmed: false,
      nativeInputBoxCalls: 0, nativeInputMethod: "", initialDefaultPresented: false,
      inputParameterForm: "", inputArgumentCount: 0, defaultValueLength: -1,
      expectedCase: "defaultEcho", lastReturnType: "", lastReturnLength: -1,
      defaultEchoReturnType: "", emptyReturnType: "", emptyReturnLength: -1,
      lastExpectedHashMatched: false, cancelSentinelType: "",
      globalInputAttempted: false, applicationInputAttempted: false,
      cancelObserved: false, cancelPreservedState: false, cancelDidNotTrySecondEntry: false,
      fullInputObserved: false, acceptedChallengeCount: 0,
      plainPasteObserved: false, whitespacePasteObserved: false,
      maxLengthObserved: false, maxLegalLength: MAX_INPUT_LENGTH,
      emptyInputObserved: false, invalidInputObserved: false, verifiedRounds: 0,
      syntheticAuthorityRevision: 7, syntheticAuthorityStrength: "paid", syntheticFeedbackRevision: 0,
      authorityUnchangedAfterInvalid: false, failureCodePersisted: false, sensitiveTextPersisted: false
    };
    state.sessions.push(session);
    if (state.sessions.length > 20) { state.sessions = state.sessions.slice(state.sessions.length - 20); }
    return session;
  }
  function setLegacyFields() {
    state.fileSystem.legacyDiagnosticAttempted = legacyAttempted;
    state.fileSystem.legacyDiagnosticTransport = legacyUsed;
    state.fileSystem.legacyDiagnosticApi = legacyApi;
  }
  function persistBinary() {
    var path = recordPath(), text;
    paths(true);
    state.updatedAt = now(); setLegacyFields(); text = JSON.stringify(state, null, 2);
    writeBinary(path, text);
    if (readBinary(path) !== text) { throw new Error("binary record read-back mismatch"); }
    return true;
  }
  function persistLegacy(strictError) {
    var fs = fsObject(), path = recordPath(), text, result, first = null;
    legacyAttempted = true;
    if (!state.fileSystem.lastError) { state.fileSystem.lastError = message(strictError); }
    function content(api) {
      legacyUsed = true; legacyApi = api; setLegacyFields();
      state.fileSystem.legacyDiagnosticTransportError = ""; state.updatedAt = now();
      return JSON.stringify(state, null, 2);
    }
    if (fs && typeof fs.writeFileString === "function" && typeof fs.readFileString === "function") {
      try {
        text = content("writeFileString/readFileString"); result = fs.writeFileString(path, text);
        if (result === false || String(fs.readFileString(path)) !== text) { throw new Error("string diagnostic mismatch"); }
        return true;
      } catch (error) { first = error; legacyUsed = false; legacyApi = ""; }
    }
    if (fs && typeof fs.WriteFile === "function" && typeof fs.ReadFile === "function") {
      try {
        text = content("WriteFile/ReadFile"); result = fs.WriteFile(path, text);
        if (result === false || String(fs.ReadFile(path)) !== text) { throw new Error("legacy diagnostic mismatch"); }
        return true;
      } catch (error2) {
        legacyUsed = false; legacyApi = ""; setLegacyFields();
        state.fileSystem.legacyDiagnosticTransportError = message(error2) + (first ? " | " + message(first) : "");
        return false;
      }
    }
    setLegacyFields();
    state.fileSystem.legacyDiagnosticTransportError = first ? message(first) : "legacy diagnostic write unavailable";
    return false;
  }
  function persist(allowLegacy) {
    try { return persistBinary(); }
    catch (error) {
      if (!state.fileSystem.lastError) { state.fileSystem.lastError = message(error); }
      if (allowLegacy) { persistLegacy(error); }
      return false;
    }
  }

  function checksum(text) {
    var h = 2166136261, s = String(text), i;
    for (i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16).toUpperCase();
  }
  function slotText(revision, marker) {
    var v = { schema: SLOT_SCHEMA, version: 1, revision: revision, host: HOST, marker: marker };
    v.checksum = checksum([v.schema, v.version, v.revision, v.host, v.marker].join("\u001F"));
    return JSON.stringify(v);
  }
  function parseSlot(text) {
    try {
      var v = JSON.parse(String(text));
      var expected = checksum([v.schema, v.version, v.revision, v.host, v.marker].join("\u001F"));
      return v.schema === SLOT_SCHEMA && v.version === 1 && typeof v.revision === "number" &&
        v.revision >= 0 && v.checksum === expected ? v : null;
    } catch (_) { return null; }
  }
  function selectSlot(aText, bText) {
    var a = parseSlot(aText), b = parseSlot(bText);
    if (!a) { return b; } if (!b) { return a; } return a.revision >= b.revision ? a : b;
  }
  function readJson(path, result) {
    if (!exists(path)) { return null; }
    try { return JSON.parse(readRequired(path, result)); }
    catch (error) { if (message(error).indexOf("JSON") >= 0) { return null; } throw error; }
  }
  function runFiles() {
    var r = state.fileSystem, p, longText, shortText, aPath, bPath, marker, chosen, xPath, exchange, readBack;
    var boundaryText, boundaryPath, rawLimitText, rawEnvelope, exactEnvelope, overEnvelope, invalidPath;
    var stored, passed;
    r.runId = state.runId; r.startedAt = state.startedAt; r.ranAt = now(); r.lastSessionId = currentSession().id;
    r.appDataPathAvailable = false; r.directoryCreated = false;
    r.requiredWriteAsBinaryString = false; r.requiredReadAsBinaryString = false;
    r.utf8Base64RoundTrip = false; r.overwriteAndTruncate = false;
    r.read1024RoundTrip = false; r.read1025RoundTrip = false; r.readReturnType1024 = ""; r.readReturnType1025 = "";
    r.raw12000RoundTrip = false; r.raw12001RejectedBeforeWrite = false; r.raw12000EnvelopeLength = 0;
    r.physicalEnvelope16384RoundTrip = false; r.physicalEnvelopeOverLimitRejectedBeforeWrite = false;
    r.physicalEnvelopeOverLimitRejectedAfterRead = false; r.invalidPrefixRejected = false;
    r.invalidBase64Rejected = false; r.invalidUtf8Rejected = false;
    r.slotRevisionSelection = false; r.singleSlotRecovery = false; r.corruptSlotRewrite = false;
    r.ownMarkerWritten = false; r.peerHostObserved = false; r.lastError = ""; setLegacyFields();
    try {
      if (!state.runId || !state.startedAt) { throw new Error("probe is not bound to PrepareRun"); }
      r.appDataPathAvailable = !!appData(); p = paths(true); r.directoryCreated = exists(p.files);
      longText = "HSM UTF-8/Base64 \u4E2D\u6587 \u2713 \uD83D\uDE80 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      shortText = "HSM-\u4E2D\u6587-\u2713";
      var overwrite = join(p.files, HOST + "-overwrite.bin");
      writeRequired(overwrite, longText, r); r.utf8Base64RoundTrip = readRequired(overwrite, r) === longText;
      writeRequired(overwrite, shortText, r); r.overwriteAndTruncate = readRequired(overwrite, r) === shortText;
      boundaryText = new Array(1025).join("A");
      boundaryPath = join(p.files, HOST + "-read-1024.bin");
      rawBinaryWrite(boundaryPath, boundaryText, true);
      r.read1024RoundTrip = rawBinaryRead(boundaryPath, true, r, "readReturnType1024") === boundaryText;

      boundaryText = new Array(1026).join("B");
      boundaryPath = join(p.files, HOST + "-read-1025.bin");
      rawBinaryWrite(boundaryPath, boundaryText, true);
      r.read1025RoundTrip = rawBinaryRead(boundaryPath, true, r, "readReturnType1025") === boundaryText;

      rawLimitText = new Array(MAX_RAW_BYTES + 1).join("R");
      rawEnvelope = pack(rawLimitText);
      r.raw12000EnvelopeLength = rawEnvelope.length;
      boundaryPath = join(p.files, HOST + "-raw-12000.bin");
      rawBinaryWrite(boundaryPath, rawEnvelope, true);
      r.raw12000RoundTrip = unpack(rawBinaryRead(boundaryPath, true, null, "")) === rawLimitText;
      try { pack(rawLimitText + "X"); }
      catch (rawLimitError) { r.raw12001RejectedBeforeWrite = message(rawLimitError).indexOf("raw UTF-8 limit") >= 0; }

      exactEnvelope = PREFIX + new Array(MAX_ENVELOPE_BYTES - PREFIX.length + 1).join("A");
      boundaryPath = join(p.files, HOST + "-physical-envelope-16384.bin");
      rawBinaryWrite(boundaryPath, exactEnvelope, true);
      r.physicalEnvelope16384RoundTrip = rawBinaryRead(boundaryPath, true, null, "") === exactEnvelope;
      overEnvelope = exactEnvelope + "A";
      try { rawBinaryWrite(join(p.files, HOST + "-over-limit-write.bin"), overEnvelope, true); }
      catch (writeLimitError) {
        r.physicalEnvelopeOverLimitRejectedBeforeWrite = message(writeLimitError).indexOf("before write") >= 0;
      }
      boundaryPath = join(p.files, HOST + "-over-limit-read-fixture.bin");
      rawBinaryWrite(boundaryPath, overEnvelope, false);
      try { rawBinaryRead(boundaryPath, true, null, ""); }
      catch (readLimitError) {
        r.physicalEnvelopeOverLimitRejectedAfterRead = message(readLimitError).indexOf("before decode") >= 0;
      }

      invalidPath = join(p.files, HOST + "-invalid-prefix.bin");
      rawBinaryWrite(invalidPath, "INVALID", true);
      try { unpack(rawBinaryRead(invalidPath, true, null, "")); }
      catch (prefixError) { r.invalidPrefixRejected = message(prefixError).indexOf("envelope") >= 0; }
      invalidPath = join(p.files, HOST + "-invalid-base64.bin");
      rawBinaryWrite(invalidPath, PREFIX + "%%%=", true);
      try { unpack(rawBinaryRead(invalidPath, true, null, "")); }
      catch (base64Error) { r.invalidBase64Rejected = message(base64Error).indexOf("Base64") >= 0; }
      invalidPath = join(p.files, HOST + "-invalid-utf8.bin");
      rawBinaryWrite(invalidPath, PREFIX + "/w==", true);
      try { unpack(rawBinaryRead(invalidPath, true, null, "")); }
      catch (utf8Error) { r.invalidUtf8Rejected = message(utf8Error).indexOf("UTF-8") >= 0; }

      aPath = join(p.files, HOST + "-slot-a.bin"); bPath = join(p.files, HOST + "-slot-b.bin");
      marker = HOST + "-" + state.runId + "-" + new Date().getTime();
      writeRequired(aPath, slotText(1, marker + "-A"), r); writeRequired(bPath, slotText(2, marker + "-B"), r);
      chosen = selectSlot(readRequired(aPath, r), readRequired(bPath, r)); r.slotRevisionSelection = !!chosen && chosen.revision === 2;
      writeRequired(bPath, "{BROKEN-SLOT", r);
      chosen = selectSlot(readRequired(aPath, r), readRequired(bPath, r)); r.singleSlotRecovery = !!chosen && chosen.revision === 1;
      writeRequired(bPath, slotText(3, marker + "-B-REPAIRED"), r);
      chosen = selectSlot(readRequired(aPath, r), readRequired(bPath, r)); r.corruptSlotRewrite = !!chosen && chosen.revision === 3;
      xPath = join(p.files, "cross-host.bin"); exchange = readJson(xPath, r);
      if (!exchange || exchange.schema !== EXCHANGE_SCHEMA || exchange.version !== 1 ||
          exchange.runId !== state.runId || !exchange.markers) {
        exchange = { schema: EXCHANGE_SCHEMA, version: 1, runId: state.runId, markers: {} };
      }
      r.peerHostObserved = !!(exchange.markers[PEER] && exchange.markers[PEER].runId === state.runId);
      exchange.markers[HOST] = { host: HOST, runId: state.runId, marker: marker, writtenAt: now() };
      writeRequired(xPath, JSON.stringify(exchange, null, 2), r); readBack = readJson(xPath, r);
      r.ownMarkerWritten = !!(readBack && readBack.runId === state.runId && readBack.markers &&
        readBack.markers[HOST] && readBack.markers[HOST].marker === marker);
    } catch (error) { r.lastError = message(error); }
    setLegacyFields(); stored = persist(true); setLegacyFields();
    passed = stored && !r.legacyDiagnosticAttempted && !r.legacyDiagnosticTransport &&
      r.appDataPathAvailable && r.directoryCreated && r.requiredWriteAsBinaryString &&
      r.requiredReadAsBinaryString && r.utf8Base64RoundTrip && r.overwriteAndTruncate &&
      r.read1024RoundTrip && r.read1025RoundTrip && r.readReturnType1024 === "string" && r.readReturnType1025 === "string" &&
      r.raw12000RoundTrip && r.raw12001RejectedBeforeWrite && r.raw12000EnvelopeLength <= MAX_ENVELOPE_BYTES &&
      r.physicalEnvelope16384RoundTrip && r.physicalEnvelopeOverLimitRejectedBeforeWrite &&
      r.physicalEnvelopeOverLimitRejectedAfterRead && r.invalidPrefixRejected && r.invalidBase64Rejected && r.invalidUtf8Rejected &&
      r.slotRevisionSelection && r.singleSlotRecovery && r.corruptSlotRewrite && r.ownMarkerWritten;
    refresh();
    notify(passed ? (r.peerHostObserved ? "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\u4E0E\u8DE8\u5BBF\u4E3B\u63A2\u9488\u901A\u8FC7\u3002" :
      "\u672C\u5BBF\u4E3B\u901A\u8FC7\uFF1B\u8BF7\u8FD0\u884C\u53E6\u4E00\u5BBF\u4E3B\u540E\u518D\u590D\u6D4B\u3002") :
      "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\u63A2\u9488\u5931\u8D25\uFF1A" + (r.lastError || r.legacyDiagnosticTransportError || "\u8BF7\u67E5\u770B\u8BB0\u5F55\u3002"));
    return passed;
  }

  function nativeInput(promptText, title, defaultValue) {
    var first = null, value, valueApp;
    var trace = {
      globalAttempted: false, applicationAttempted: false,
      parameterForm: "(prompt,title,defaultValue)", argumentCount: 3
    };
    if (typeof global.InputBox === "function") {
      trace.globalAttempted = true;
      try {
        value = global.InputBox(promptText, title, defaultValue);
        return { method: "global.InputBox", value: value, trace: trace };
      } catch (error) { first = error; }
    }
    valueApp = app();
    if (valueApp && typeof valueApp.InputBox === "function") {
      trace.applicationAttempted = true;
      try {
        value = valueApp.InputBox(promptText, title, defaultValue);
        return { method: "Application.InputBox", value: value, trace: trace };
      } catch (error2) {
        throw new Error("Application.InputBox capability call failed" +
          (first ? " after global.InputBox capability call failed" : ""));
      }
    }
    throw new Error("WPS native InputBox unavailable" + (first ? " after global capability failure" : ""));
  }
  function cancelled(value) { return value === false || value === undefined || value === null || value === ""; }
  function returnType(value) {
    if (value === false) { return "boolean:false"; }
    if (value === undefined) { return "undefined"; }
    if (value === null) { return "null"; }
    if (value === "") { return "string:empty"; }
    return typeof value;
  }
  function expectedCase(s) {
    if (!s.initialDefaultPresented) { return "defaultEcho"; }
    if (!s.cancelObserved) { return "cancel"; }
    if (!s.plainPasteObserved) { return "plainPaste"; }
    if (!s.whitespacePasteObserved) { return "whitespacePaste"; }
    if (!s.maxLengthObserved) { return "maxLength33"; }
    if (!s.emptyInputObserved) { return "emptyInput"; }
    if (!s.invalidInputObserved) { return "invalidInput"; }
    return "complete";
  }
  function promptForCase(name) {
    if (name === "defaultEcho") { return "\u672C\u8F6E\u4E0D\u8981\u7F16\u8F91\uFF0C\u76F4\u63A5\u70B9\u51FB\u786E\u5B9A\uFF0C\u9A8C\u8BC1\u9ED8\u8BA4\u503C\u4E3A\u7A7A\u3002"; }
    if (name === "cancel") { return "\u672C\u8F6E\u8BF7\u70B9\u51FB\u53D6\u6D88\uFF0C\u4E0D\u8981\u8F93\u5165\u5185\u5BB9\u3002"; }
    if (name === "plainPaste") { return "\u8BF7\u666E\u901A\u7C98\u8D34\u5E76\u539F\u6837\u786E\u8BA4\uFF1A\n" + CHALLENGE; }
    if (name === "whitespacePaste") { return "\u8BF7\u5728\u4E0B\u5217\u6587\u672C\u524D\u540E\u5404\u4FDD\u75592\u4E2A\u7A7A\u683C\u5E76\u786E\u8BA4\uFF1A\n  " + CHALLENGE + "  "; }
    if (name === "maxLength33") { return "\u8BF7\u7C98\u8D3433\u5B57\u7B26\u6700\u5927\u5408\u6CD5\u957F\u5EA6\u5411\u91CF\uFF1A\n" + MAX_INPUT_VECTOR; }
    if (name === "emptyInput") { return "\u8BF7\u4FDD\u6301\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u7136\u540E\u70B9\u51FB\u786E\u5B9A\u3002"; }
    if (name === "invalidInput") { return "\u8BF7\u7C98\u8D34\u65E0\u6548\u5411\u91CF\uFF0C\u9A8C\u8BC1\u4E0D\u8986\u76D6\u539F\u72B6\u6001\uFF1A\nHSM-INVALID-PROBE"; }
    return "\u8F93\u5165\u8FB9\u754C\u63A2\u9488\u5DF2\u5B8C\u6210\u3002";
  }
  function authorityDigest(s) {
    return checksum([s.syntheticAuthorityRevision, s.syntheticAuthorityStrength, s.syntheticFeedbackRevision].join("|"));
  }
  function inputRound() {
    var s = currentSession(), caseName = expectedCase(s), beforeRounds = s.verifiedRounds;
    var beforeAccepted = s.acceptedChallengeCount, beforeAuthority = authorityDigest(s);
    var outcome, value, expected = null, matched = false;
    s.expectedCase = caseName;
    if (caseName === "complete") { notify("\u539F\u751F\u8F93\u5165\u8FB9\u754C\u63A2\u94887\u9879\u5DF2\u5B8C\u6210\u3002"); return true; }
    try {
      outcome = nativeInput(promptForCase(caseName), "\u9AD8\u4E2D\u6570\u5B66\u5DE5\u5177\uFF0D\u539F\u751F\u8F93\u5165\u63A2\u9488", INITIAL);
      s.nativeInputBoxCalls += 1;
      s.nativeInputMethod = outcome.method;
      s.inputParameterForm = outcome.trace.parameterForm;
      s.inputArgumentCount = outcome.trace.argumentCount;
      s.defaultValueLength = INITIAL.length;
      s.globalInputAttempted = s.globalInputAttempted || outcome.trace.globalAttempted;
      s.applicationInputAttempted = s.applicationInputAttempted || outcome.trace.applicationAttempted;
      s.lastReturnType = returnType(outcome.value);
      s.lastReturnLength = typeof outcome.value === "string" ? outcome.value.length : 0;
      state.ribbon.totalInputBoxCalls += 1;
      state.ribbon.lastNativeInputMethod = outcome.method;
      state.ribbon.lastError = "";
    } catch (error) {
      state.ribbon.lastError = message(error); persist(true); refresh();
      notify("\u539F\u751F\u8F93\u5165\u6846\u80FD\u529B\u8C03\u7528\u5931\u8D25\u3002"); return false;
    }

    if (cancelled(outcome.value)) {
      if (caseName === "defaultEcho" && outcome.value === "") {
        s.initialDefaultPresented = true;
        s.defaultEchoReturnType = "string:empty";
        s.lastExpectedHashMatched = true;
      } else if (caseName === "cancel") {
        s.cancelSentinelType = returnType(outcome.value);
        s.cancelObserved = true;
        s.cancelPreservedState = s.verifiedRounds === beforeRounds &&
          s.acceptedChallengeCount === beforeAccepted && authorityDigest(s) === beforeAuthority;
        s.cancelDidNotTrySecondEntry = outcome.method !== "global.InputBox" || !outcome.trace.applicationAttempted;
        s.lastExpectedHashMatched = true;
      } else if (caseName === "emptyInput" && outcome.value === "") {
        s.emptyInputObserved = true;
        s.emptyReturnType = "string:empty";
        s.emptyReturnLength = 0;
        s.lastExpectedHashMatched = true;
      } else {
        s.lastExpectedHashMatched = false;
      }
      persist(true); refresh();
      notify("\u672C\u8F6E\u7A7A\u503C\u6216\u53D6\u6D88\u54E8\u5175\u5DF2\u6309\u4EBA\u5DE5\u52A8\u4F5C\u8BB0\u5F55\uFF0CAPI\u672C\u8EAB\u4E0D\u505A\u8FC7\u5EA6\u533A\u5206\u3002");
      return true;
    }

    value = String(outcome.value);
    if (caseName === "plainPaste") { expected = CHALLENGE; }
    else if (caseName === "whitespacePaste") { expected = "  " + CHALLENGE + "  "; }
    else if (caseName === "maxLength33") { expected = MAX_INPUT_VECTOR; }
    else if (caseName === "invalidInput") { expected = "HSM-INVALID-PROBE"; }
    matched = expected !== null && value.length === expected.length && checksum(value) === checksum(expected);
    s.lastExpectedHashMatched = matched;
    if (!matched) {
      state.ribbon.lastError = "\u672C\u8F6E\u8FD4\u56DE\u7684\u957F\u5EA6\u6216\u54C8\u5E0C\u4E0D\u5339\u914D\u3002";
      persist(true); refresh(); notify(state.ribbon.lastError); return false;
    }
    if (caseName === "plainPaste") { s.plainPasteObserved = true; s.fullInputObserved = true; }
    else if (caseName === "whitespacePaste") { s.whitespacePasteObserved = true; }
    else if (caseName === "maxLength33") { s.maxLengthObserved = value.length === MAX_INPUT_LENGTH; }
    else if (caseName === "invalidInput") {
      s.invalidInputObserved = true;
      s.authorityUnchangedAfterInvalid = authorityDigest(s) === beforeAuthority;
      s.failureCodePersisted = false;
      persist(true); refresh();
      notify("\u65E0\u6548\u5411\u91CF\u5DF2\u9A8C\u8BC1\u4E0D\u6539\u53D8\u539F\u72B6\u6001\uFF0C\u4E0D\u6301\u4E45\u5316\u5931\u8D25\u5185\u5BB9\u3002");
      return true;
    }
    s.acceptedChallengeCount += 1; s.verifiedRounds += 1;
    state.ribbon.totalVerifiedRounds += 1; persist(true); refresh();
    notify("\u672C\u8F6E\u957F\u5EA6\u4E0E\u54C8\u5E0C\u9A8C\u8BC1\u901A\u8FC7\uFF1A" + s.verifiedRounds + "/3");
    return true;
  }

  function runNativeDialog() {
    nativeDialog = {
      attempted: true, loaded: false, status: "running", bridgeVersion: "", processId: 0,
      processName: "", resultLength: -1, sensitiveBufferCleared: false, lastError: ""
    };
    refresh();
    try {
      launchNativeCommandDialog(function (error, audit) {
        try {
          if (error) { throw error; }
          if (!audit) { throw new Error("native COM file channel returned no audit"); }
          nativeDialog.loaded = true;
          nativeDialog.bridgeVersion = audit.bridgeVersion;
          nativeDialog.processId = audit.pid;
          nativeDialog.processName = audit.process;
          if ((HOST === "writer" && nativeDialog.processName !== "wps") ||
              (HOST === "presentation" && nativeDialog.processName !== "wpp")) {
            throw new Error("native COM DLL is not running inside the expected WPS host: " + nativeDialog.processName);
          }
          nativeDialog.resultLength = audit.resultLength;
          if (audit.status === 1) { nativeDialog.status = "confirmed"; }
          else if (audit.status === 0) { nativeDialog.status = "cancelled"; }
          else { throw new Error("native dialog returned error status " + audit.status +
            (audit.lastError ? ": " + audit.lastError : "")); }
          nativeDialog.sensitiveBufferCleared = audit.sensitiveBufferCleared;
          if (!nativeDialog.sensitiveBufferCleared) { throw new Error("native sensitive result buffer was not cleared"); }
          refresh();
          notify("方案一进程内对话框" + (nativeDialog.status === "confirmed" ? "确认" : "取消") +
            "成功。COM DLL PID=" + nativeDialog.processId + "，返回长度=" + nativeDialog.resultLength + "，敏感缓冲区已清空。");
        } catch (callbackError) {
          nativeDialog.status = "failed";
          nativeDialog.lastError = message(callbackError);
          refresh();
          notify("方案一进程内对话框失败：" + nativeDialog.lastError);
        }
      });
      return true;
    } catch (error) {
      nativeDialog.status = "failed";
      nativeDialog.lastError = message(error);
      refresh();
      notify("方案一进程内对话框失败：" + nativeDialog.lastError);
      return false;
    }
  }

  function invalidate(id) {
    var value;
    try {
      if (ribbonUI && typeof ribbonUI.InvalidateControl === "function") { ribbonUI.InvalidateControl(id); return; }
      value = app();
      if (value && value.ribbonUI && typeof value.ribbonUI.InvalidateControl === "function") { value.ribbonUI.InvalidateControl(id); }
    } catch (_) {}
  }
  function refresh() {
    invalidate("probe_native_dialog_status");
    invalidate("probe_ribbon_status");
    invalidate("probe_file_status");
  }
  function nativeDialogStatus() {
    if (!nativeDialog.attempted) { return "进程内原生对话框：尚未运行"; }
    if (nativeDialog.status === "failed") { return "进程内原生对话框：失败"; }
    if (nativeDialog.status === "running") { return "进程内原生对话框：等待原生窗口"; }
    return "进程内原生对话框：" + (nativeDialog.status === "confirmed" ? "确认通过" : "取消通过") +
      "；PID " + nativeDialog.processId + "；缓冲清零 " + (nativeDialog.sensitiveBufferCleared ? "通过" : "失败");
  }
  function ribbonStatus() {
    var s = currentSession();
    return "\u539F\u751F\u8F93\u5165\uFF1A" + (s.nativeInputMethod || "\u5C1A\u672A\u8C03\u7528") +
      "\uFF1B\u53D6\u6D88 " + (s.cancelObserved && s.cancelPreservedState ? "\u901A\u8FC7" : "\u5F85\u9A8C\u8BC1") +
      "\uFF1B\u6311\u6218 " + s.verifiedRounds + "/3";
  }
  function fileStatus() {
    var r = state.fileSystem;
    if (!r.ranAt) { return "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\uFF1A\u5C1A\u672A\u8FD0\u884C"; }
    var ok = !r.legacyDiagnosticAttempted && !r.legacyDiagnosticTransport && r.appDataPathAvailable &&
      r.directoryCreated && r.requiredWriteAsBinaryString && r.requiredReadAsBinaryString &&
      r.utf8Base64RoundTrip && r.overwriteAndTruncate &&
      r.read1024RoundTrip && r.read1025RoundTrip && r.readReturnType1024 === "string" && r.readReturnType1025 === "string" &&
      r.raw12000RoundTrip && r.raw12001RejectedBeforeWrite && r.raw12000EnvelopeLength <= MAX_ENVELOPE_BYTES &&
      r.physicalEnvelope16384RoundTrip && r.physicalEnvelopeOverLimitRejectedBeforeWrite &&
      r.physicalEnvelopeOverLimitRejectedAfterRead && r.invalidPrefixRejected && r.invalidBase64Rejected && r.invalidUtf8Rejected &&
      r.slotRevisionSelection &&
      r.singleSlotRecovery && r.corruptSlotRewrite && r.ownMarkerWritten;
    return ok ? (r.peerHostObserved ? "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\uFF1A\u8DE8\u5BBF\u4E3B\u901A\u8FC7" :
      "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\uFF1A\u672C\u5BBF\u4E3B\u901A\u8FC7\uFF0C\u5F85\u5BF9\u7AEF") :
      "\u4E8C\u8FDB\u5236\u5171\u4EAB\u6587\u4EF6\uFF1A\u5931\u8D25";
  }

  global.OnAddinLoad = function (ui) {
    var run;
    ribbonUI = ui || null; session = null; legacyAttempted = false; legacyUsed = false; legacyApi = "";
    try { run = loadRun(); state = loadRecord(run); }
    catch (error) { state = fresh(null); state.ribbon.lastError = message(error); }
    legacyAttempted = legacyAttempted || !!state.fileSystem.legacyDiagnosticAttempted;
    legacyUsed = legacyUsed || !!state.fileSystem.legacyDiagnosticTransport;
    legacyApi = legacyApi || String(state.fileSystem.legacyDiagnosticApi || "");
    state.ribbon.loaded = true; setLegacyFields(); currentSession(); persist(true); return true;
  };
  global.GetProbeInstructionLabel = function () { return "\u5148\u53D6\u6D881\u6B21\uFF0C\u518D\u5B8C\u6574\u8F93\u51653\u6B21\uFF1A" + CHALLENGE; };
  global.GetProbeNativeDialogStatus = function () { return nativeDialogStatus(); };
  global.GetProbeRibbonStatus = function () { return ribbonStatus(); };
  global.GetProbeFileStatus = function () { return fileStatus(); };
  global.GetCompatStatusLabel = function () { return "\u72B6\u6001\uFF1A\u517C\u5BB9\u8BCA\u65AD\u6A21\u5F0F\uFF0C\u4E0D\u53C2\u4E0E\u65B9\u6848\u7532\u786C\u95E8\u7981"; };
  global.GetCompatMachineCodeLabel = function () { return "\u673A\u5668\u7801\uFF1A\u9694\u79BB\u63A2\u9488\u4E0D\u8BFB\u6B63\u5F0F\u6388\u6743\u6570\u636E"; };
  global.GetCompatQqLabel = function () { return "QQ\uFF1A982303035"; };
  global.GetCompatWechatLabel = function () { return "\u5FAE\u4FE1\u53F7\uFF1Aqzt65631"; };
  global.OnProbeAction = function (control) {
    var id = control && (control.Id || control.id) ? String(control.Id || control.id) : "";
    if (id === "probe_mark_visible") { currentSession().visibleConfirmed = true; persist(true); refresh(); notify("Ribbon Tab \u5DF2\u8BB0\u5F55\u4E3A\u53EF\u89C1\u3002"); return true; }
    if (id === "probe_open_native_dialog") { return runNativeDialog(); }
    if (id === "probe_open_input") { return inputRound(); }
    if (id === "probe_run_files") { return runFiles(); }
    if (id === "probe_show_summary") { notify(ribbonStatus() + "\n" + fileStatus()); return true; }
    return false;
  };
  global.HsmNativeCapabilityProbeTestApi = {
    checksum: checksum, slotPayload: slotText, parseSlot: parseSlot, selectSlot: selectSlot,
    challengeText: CHALLENGE, initialText: INITIAL, maxInputVector: MAX_INPUT_VECTOR, maxInputLength: MAX_INPUT_LENGTH,
    maxRawBytes: MAX_RAW_BYTES, maxEnvelopeBytes: MAX_ENVELOPE_BYTES,
    encodeStorageText: pack, decodeStorageText: unpack,
    runSchema: RUN_SCHEMA, recordVersion: 2,
    nativeXModule: NATIVE_X_MODULE,
    nativeDialogStatus: function () { return nativeDialog; }
  };
})(typeof window !== "undefined" ? window : this);
