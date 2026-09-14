(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MathLicense = api.publicApi;
  if (typeof globalThis !== "undefined") {
    globalThis.MathLicense = api.publicApi;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  var PRODUCT = "WpsHighSchoolMath";
  var TRIAL_DAYS = 14;
  var LICENSE_VERSION = "HSM2";
  var CONTACT = {
    qq: "982303035",
    wechat: "qzt65631",
    wechatQrUrl: "../assets/wechat-qr.jpg"
  };
  var STORAGE_KEYS = {
    machineId: "hsmath_machine_id_v1",
    trialStarted: "hsmath_trial_started_v1",
    license: "hsmath_license_v1",
    reminderDate: "hsmath_license_reminder_date_v1",
    lastFeatureName: "hsmath_license_last_feature_v1",
    licensePaneId: "hsmath_license_pane_id_v1"
  };
  var PLAN_LABELS = {
    M: "月卡",
    Q: "季卡",
    Y: "年卡",
    P: "永久版"
  };

  function pad(value, size) {
    var text = String(value);
    while (text.length < size) {
      text = "0" + text;
    }
    return text;
  }

  function today() {
    var now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1, 2) + "-" + pad(now.getDate(), 2);
  }

  function dateText(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2);
  }

  function addDays(date, days) {
    var copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function hashText(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  }

  function getStorages() {
    var storages = [];
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        storages.push(localStorage);
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.Application && window.Application.PluginStorage) {
        storages.push(window.Application.PluginStorage);
      }
    } catch (_) {}
    return storages;
  }

  function getItem(key) {
    var storages = getStorages();
    var value = "";
    for (var i = 0; i < storages.length; i += 1) {
      var storage = storages[i];
      if (!storage || !storage.getItem) {
        continue;
      }
      try {
        value = storage.getItem(key) || "";
      } catch (_) {
        value = "";
      }
      if (value) {
        for (var syncIndex = 0; syncIndex < storages.length; syncIndex += 1) {
          if (syncIndex === i || !storages[syncIndex] || !storages[syncIndex].setItem) {
            continue;
          }
          try {
            storages[syncIndex].setItem(key, String(value));
          } catch (_) {}
        }
        return value;
      }
    }
    return "";
  }

  function setItem(key, value) {
    var storages = getStorages();
    for (var i = 0; i < storages.length; i += 1) {
      var storage = storages[i];
      if (!storage || !storage.setItem) {
        continue;
      }
      try {
        storage.setItem(key, String(value));
      } catch (_) {}
    }
  }

  function normalizeLicenseCode(value) {
    return String(value || "").replace(/\s+/g, "");
  }

  function createMachineId() {
    var source = "";
    try { source += navigator.platform || ""; } catch (_) {}
    try { source += "|" + (navigator.language || ""); } catch (_) {}
    try { source += "|" + (navigator.hardwareConcurrency || ""); } catch (_) {}
    try { source += "|" + (navigator.deviceMemory || ""); } catch (_) {}
    try { source += "|" + screen.width + "x" + screen.height + "x" + (screen.colorDepth || ""); } catch (_) {}
    if (!source.replace(/\|/g, "")) {
      source = PRODUCT + "|LOCAL";
    }
    return "HSM" + normalizeCode(hashText(source) + hashText(source + "|2")).slice(0, 10);
  }

  function readInstalledMachineId() {
    try {
      var app = getApplication();
      if (!app || !app.Env || !app.Env.GetAppDataPath || !app.FileSystem || !app.FileSystem.ReadFile) {
        return "";
      }
      var appDataPath = String(app.Env.GetAppDataPath() || "").replace(/[\\\/]+$/, "");
      if (!appDataPath) {
        return "";
      }
      return normalizeCode(app.FileSystem.ReadFile(appDataPath + "\\WpsHighSchoolMath\\machine-id.txt"));
    } catch (_) {
      return "";
    }
  }

  function getMachineId() {
    var installedMachineId = readInstalledMachineId();
    if (/^HSM[A-Z0-9]{10}$/.test(installedMachineId)) {
      setItem(STORAGE_KEYS.machineId, installedMachineId);
      return installedMachineId;
    }
    var machineId = normalizeCode(getItem(STORAGE_KEYS.machineId));
    if (!machineId) {
      machineId = createMachineId();
      setItem(STORAGE_KEYS.machineId, machineId);
    }
    return machineId;
  }

  function getTrialStarted() {
    var started = getItem(STORAGE_KEYS.trialStarted);
    if (!started) {
      started = today();
      setItem(STORAGE_KEYS.trialStarted, started);
    }
    return started;
  }

  function daysBetween(startDate, endDate) {
    var start = new Date(startDate + "T00:00:00");
    var end = new Date(endDate + "T00:00:00");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return 0;
    }
    return Math.floor((end.getTime() - start.getTime()) / 86400000);
  }

  function parseLicenseCode(code) {
    var compact = normalizeLicenseCode(code);
    var match = /^HSM2\.([MQYP])\.([0-9]{8}|PERMANENT)\.(HSM[A-Z0-9]{10})\.([A-Za-z0-9_-]{86})$/.exec(compact);
    if (!match) {
      return null;
    }
    return {
      version: LICENSE_VERSION,
      plan: match[1],
      expires: match[2],
      machineId: match[3],
      signature: match[4]
    };
  }

  function canonicalPayload(plan, expires, machineId) {
    return [LICENSE_VERSION, PRODUCT, plan, expires, machineId].join("|");
  }

  function asciiBytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 255;
    }
    return bytes;
  }

  function decodeBase64(value) {
    var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) {
      normalized += "=";
    }
    var binary = atob(normalized);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function verifierDependencies() {
    var naclApi = null;
    var publicKey = "";
    try {
      if (typeof nacl !== "undefined") {
        naclApi = nacl;
      } else if (typeof window !== "undefined") {
        naclApi = window.nacl;
      }
    } catch (_) {}
    try {
      if (typeof MathLicensePublicKey !== "undefined") {
        publicKey = MathLicensePublicKey;
      } else if (typeof window !== "undefined") {
        publicKey = window.MathLicensePublicKey || "";
      }
    } catch (_) {}
    return {
      available: !!(naclApi && naclApi.sign && naclApi.sign.detached && naclApi.sign.detached.verify && publicKey),
      nacl: naclApi,
      publicKey: publicKey
    };
  }

  function verifyLicenseSignature(parsed) {
    var dependencies = verifierDependencies();
    if (!dependencies.available) {
      return { available: false, valid: false };
    }
    try {
      var message = asciiBytes(canonicalPayload(parsed.plan, parsed.expires, parsed.machineId));
      var signatureBytes = decodeBase64(parsed.signature);
      var publicKeyBytes = decodeBase64(dependencies.publicKey);
      return {
        available: true,
        valid: dependencies.nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes)
      };
    } catch (_) {
      return { available: true, valid: false };
    }
  }

  function isPermanent(expires) {
    return expires === "PERMANENT";
  }

  function expiryToDate(expires) {
    if (!/^[0-9]{8}$/.test(expires)) {
      return null;
    }
    return expires.slice(0, 4) + "-" + expires.slice(4, 6) + "-" + expires.slice(6, 8);
  }

  function isExpired(expires) {
    if (isPermanent(expires)) {
      return false;
    }
    var date = expiryToDate(expires);
    return !date || daysBetween(today(), date) < 0;
  }

  function validateLicenseCode(code) {
    var parsed = parseLicenseCode(code);
    var machineId = getMachineId();
    if (!parsed) {
      return { valid: false, reason: "激活码格式不正确。", machineId: machineId };
    }
    if (parsed.machineId !== machineId) {
      return { valid: false, reason: "激活码与本机机器码不匹配。", machineId: machineId };
    }
    var verification = verifyLicenseSignature(parsed);
    if (!verification.available) {
      return { valid: false, reason: "授权验签组件加载失败，请重新安装插件。", machineId: machineId };
    }
    if (!verification.valid) {
      return { valid: false, reason: "激活码校验失败。", machineId: machineId };
    }
    if (isExpired(parsed.expires)) {
      return { valid: false, reason: "激活码已经过期。", machineId: machineId };
    }
    return { valid: true, license: parsed, machineId: machineId };
  }

  function getSavedLicense() {
    var code = getItem(STORAGE_KEYS.license);
    if (!code) {
      return null;
    }
    var result = validateLicenseCode(code);
    return result.valid ? result.license : null;
  }

  function getTrialStatus() {
    var started = getTrialStarted();
    var startDate = new Date(started + "T00:00:00");
    var expiresDate = dateText(addDays(startDate, TRIAL_DAYS - 1));
    var remainingDays = daysBetween(today(), expiresDate) + 1;
    return {
      started: started,
      active: remainingDays > 0,
      expiresDate: expiresDate,
      remainingDays: Math.max(0, remainingDays)
    };
  }

  function getStatus() {
    var license = getSavedLicense();
    var trial = getTrialStatus();
    if (license) {
      var permanent = isPermanent(license.expires);
      var licenseExpiresDate = permanent ? "" : expiryToDate(license.expires);
      var licensedRemainingDays = permanent ? null : Math.max(0, daysBetween(today(), licenseExpiresDate) + 1);
      return {
        active: true,
        licensed: true,
        trial: false,
        statusLabel: "已激活",
        plan: license.plan,
        planLabel: PLAN_LABELS[license.plan] || license.plan,
        expires: license.expires,
        expiresDate: licenseExpiresDate,
        expiresText: permanent ? "永久有效" : licenseExpiresDate,
        remainingDays: licensedRemainingDays,
        remainingText: permanent ? "永久有效" : "剩余 " + licensedRemainingDays + " 天",
        accessText: "全部功能可用",
        machineId: getMachineId()
      };
    }
    return {
      active: trial.active,
      licensed: false,
      trial: trial.active,
      statusLabel: trial.active ? "试用中" : "已到期",
      planLabel: trial.active ? "14 天全功能试用" : "未激活",
      expiresDate: trial.expiresDate,
      remainingDays: trial.remainingDays,
      expiresText: trial.expiresDate,
      remainingText: trial.active ? "剩余 " + trial.remainingDays + " 天" : "已到期",
      accessText: trial.active ? "全部功能可用" : "WPS 文字仅试卷功能可用，其他功能不可用",
      machineId: getMachineId()
    };
  }

  function getContact() {
    return {
      qq: CONTACT.qq,
      wechat: CONTACT.wechat,
      wechatQrUrl: CONTACT.wechatQrUrl
    };
  }

  function saveLicense(code) {
    var result = validateLicenseCode(code);
    if (!result.valid) {
      return result;
    }
    setItem(STORAGE_KEYS.license, normalizeLicenseCode(code));
    return result;
  }

  function getApplication() {
    try {
      return typeof window !== "undefined" ? window.Application : null;
    } catch (_) {
      return null;
    }
  }

  function getPluginRootUrl() {
    var url = "";
    try {
      url = decodeURI(document.location.toString()).split(/[?#]/)[0];
    } catch (_) {
      return "";
    }
    var uiIndex = url.lastIndexOf("/ui/");
    if (uiIndex >= 0) {
      return url.substring(0, uiIndex);
    }
    return url.substring(0, url.lastIndexOf("/"));
  }

  function resolvePaneOptions(options) {
    options = options || {};
    var app = options.app || getApplication();
    var role = options.role || "";
    if (!role) {
      try { role = window.HSM_ENTRY_HOST || ""; } catch (_) { role = ""; }
    }
    if (role !== "presentation" && role !== "writer") {
      try { role = app && app.ActivePresentation ? "presentation" : "writer"; } catch (_) { role = "writer"; }
    }
    return {
      app: app,
      role: role,
      pluginBaseUrl: options.pluginBaseUrl || getPluginRootUrl(),
      onFailure: typeof options.onFailure === "function" ? options.onFailure : null
    };
  }

  function openActivationPane(featureName, options) {
    setItem(STORAGE_KEYS.lastFeatureName, featureName || "");
    try {
      if (typeof window !== "undefined" && window.MathToolCenter &&
          typeof window.MathToolCenter.showView === "function") {
        return window.MathToolCenter.showView("license");
      }
    } catch (_) {}
    var paneOptions = resolvePaneOptions(options);
    var app = paneOptions.app;
    if (!app || typeof MathTaskPanes === "undefined" || !paneOptions.pluginBaseUrl) {
      return false;
    }

    if (typeof MathTaskPanes.openPackaged !== "function") {
      return false;
    }
    return MathTaskPanes.openPackaged({
      app: app,
      pluginBaseUrl: paneOptions.pluginBaseUrl,
      role: paneOptions.role,
      name: "tool-center",
      view: "license",
      width: 420,
      readyTimeout: 5000,
      legacyKeys: [STORAGE_KEYS.licensePaneId],
      onFailure: paneOptions.onFailure
    });
  }

  function showActivationDialog(featureName, options) {
    openActivationPane(featureName, options);
    return false;
  }

  function openAuthorizationCenter(options) {
    return openActivationPane("", options);
  }

  function requirePaidFeature(featureName, options) {
    var status = getStatus();
    if (status.active) {
      return true;
    }
    showActivationDialog(featureName, options);
    return false;
  }

  function remindIfExpired(options) {
    var status = getStatus();
    var shouldRemind = !status.active ||
      (status.remainingDays !== null && [7, 3, 1].indexOf(status.remainingDays) >= 0);
    if (!shouldRemind) {
      return;
    }
    var currentDate = today();
    if (getItem(STORAGE_KEYS.reminderDate) === currentDate) {
      return;
    }
    if (openActivationPane(status.active ? "授权将在 " + status.remainingDays + " 天后到期" : "", options)) {
      setItem(STORAGE_KEYS.reminderDate, currentDate);
    }
  }

  var publicApi = {
    getMachineId: getMachineId,
    getStatus: getStatus,
    requirePaidFeature: requirePaidFeature,
    remindIfExpired: remindIfExpired,
    showActivationDialog: showActivationDialog,
    openAuthorizationCenter: openAuthorizationCenter,
    getContact: getContact,
    getLastFeatureName: function () { return getItem(STORAGE_KEYS.lastFeatureName); },
    saveLicense: saveLicense,
    validateLicenseCode: validateLicenseCode
  };

  return {
    publicApi: publicApi,
    _private: {
      canonicalPayload: canonicalPayload,
      decodeBase64: decodeBase64,
      normalizeLicenseCode: normalizeLicenseCode,
      parseLicenseCode: parseLicenseCode,
      normalizeCode: normalizeCode,
      verifyLicenseSignature: verifyLicenseSignature
    }
  };
});
