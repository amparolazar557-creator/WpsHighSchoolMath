const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..");
const licenseModule = require(path.join(projectRoot, "js", "license.js"));
const issuer = require(path.join(projectRoot, "scripts", "license-issuer.js"));
const licenseSource = fs.readFileSync(path.join(projectRoot, "js", "license.js"), "utf8");
const naclSource = fs.readFileSync(path.join(projectRoot, "js", "vendor", "tweetnacl-fast.min.js"), "utf8");
const publicKeyModuleSource = fs.readFileSync(path.join(projectRoot, "js", "license-public-key.js"), "utf8");
const installerSource = fs.readFileSync(path.join(projectRoot, "scripts", "offline-install.ps1"), "utf8");

assert(!/\balert\s*\(/.test(licenseSource), "authorization flow must not use alert");
assert(!/\bprompt\s*\(/.test(licenseSource), "authorization flow must not use prompt");
assert(!licenseSource.includes("InputBox"), "authorization flow must not use InputBox");
assert(licenseSource.includes("MathTaskPanes.openPackaged"));
assert(licenseSource.includes("nacl.sign.detached.verify"));
assert(!licenseSource.includes("WPS-HIGH-SCHOOL-MATH-LOCAL-LICENSE-2026"));
assert(!licenseSource.includes("createLicenseCode"), "the customer plugin must not contain issuing code");
assert(publicKeyModuleSource.includes("MathLicensePublicKey"));

assert(!installerSource.includes("$installedLicensePath"));
assert(!installerSource.includes("__INSTALL_MACHINE_ID__"));
assert(installerSource.includes("Update-AuthorizationCache"));
assert(installerSource.includes("authaddin.json"));
assert(installerSource.includes('remove stale approvals so WPS can create'));
assert(!installerSource.includes('Set-ObjectPropertyValue -Object $record -Name "enable" -Value $true'));
assert(!installerSource.includes('Set-ObjectPropertyValue -Object $record -Name "isload" -Value $true'));
assert(installerSource.includes("Get-Process -Name \"wps\", \"wpp\""));
assert(installerSource.includes("Test-WpsProcessHasUserWindow"), "installer must distinguish visible WPS documents from startup processes");
assert(installerSource.includes("MainWindowHandle"), "visible WPS windows must block an atomic upgrade");
assert(installerSource.includes('Stop-WpsBackgroundHosts -Processes $wpsProcesses'), "headless WPS startup processes must be stopped before installation");

function createStorage(values = {}) {
  return {
    values,
    getItem(key) {
      return this.values[key] || "";
    },
    setItem(key, value) {
      this.values[key] = String(value);
    }
  };
}

const testKeyPair = crypto.generateKeyPairSync("ed25519");
const testPublicKey = issuer.rawPublicKey(testKeyPair.privateKey).toString("base64");

function createLicenseContext(options = {}) {
  const pluginStorage = createStorage(options.pluginValues || {});
  const local = options.localStorage || createStorage();
  const app = options.app || {
    PluginStorage: pluginStorage,
    Env: {
      GetAppDataPath() {
        return "C:\\Users\\Test\\AppData\\Roaming";
      }
    },
    FileSystem: {
      ReadFile(filePath) {
        if (filePath.endsWith("\\WpsHighSchoolMath\\machine-id.txt")) {
          return options.installedMachineId || "";
        }
        return "";
      }
    }
  };
  if (!app.PluginStorage) app.PluginStorage = pluginStorage;
  const context = {
    window: {
      Application: app,
      MathLicensePublicKey: options.publicKey || testPublicKey,
      setTimeout() {}
    },
    localStorage: local,
    MathLicensePublicKey: options.publicKey || testPublicKey,
    navigator: {
      platform: "Win32",
      language: "zh-CN",
      hardwareConcurrency: 8,
      deviceMemory: 8
    },
    screen: {
      width: 1920,
      height: 1080,
      colorDepth: 24
    },
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    Uint8Array,
    console
  };
  context.self = context.window;
  if (options.mathTaskPanes) {
    context.MathTaskPanes = options.mathTaskPanes;
    context.window.MathTaskPanes = options.mathTaskPanes;
  }
  if (options.document) context.document = options.document;
  vm.createContext(context);
  vm.runInContext(naclSource, context);
  vm.runInContext(licenseSource, context);
  return { context, pluginStorage, localStorage: local, app };
}

const machineCode = "HSMABC1234567";
const monthlyCode = issuer.createLicenseCode(machineCode, "month", "2026-07-19", testKeyPair.privateKey);
const quarterlyCode = issuer.createLicenseCode(machineCode, "quarter", "2026-07-19", testKeyPair.privateKey);
const yearlyCode = issuer.createLicenseCode(machineCode, "year", "2026-07-19", testKeyPair.privateKey);
const permanentCode = issuer.createLicenseCode(machineCode, "permanent", "2026-07-19", testKeyPair.privateKey);

assert.equal(licenseModule._private.parseLicenseCode(monthlyCode).plan, "M");
assert.equal(licenseModule._private.parseLicenseCode(quarterlyCode).plan, "Q");
assert.equal(licenseModule._private.parseLicenseCode(yearlyCode).plan, "Y");
assert.equal(licenseModule._private.parseLicenseCode(permanentCode).plan, "P");
assert.equal(licenseModule._private.parseLicenseCode(monthlyCode).expires, "20260819");
assert.equal(licenseModule._private.parseLicenseCode(quarterlyCode).expires, "20261019");
assert.equal(licenseModule._private.parseLicenseCode(yearlyCode).expires, "20270719");
assert.equal(licenseModule._private.parseLicenseCode(permanentCode).expires, "PERMANENT");
assert(monthlyCode.startsWith("HSM2.M.20260819."));

{
  const instance = createLicenseContext({
    pluginValues: {
      hsmath_machine_id_v1: machineCode,
      hsmath_trial_started_v1: "2026-01-01"
    }
  });
  const api = instance.context.MathLicense;
  assert.equal(api.getMachineId(), machineCode);
  assert.equal(api.getStatus().active, false);
  assert.equal(api.getStatus().statusLabel, "已到期");
  assert(api.getStatus().accessText.includes("仅试卷功能可用"));
  assert.equal(api.getContact().wechatQrUrl, "../assets/wechat-qr.jpg");
  assert.equal(api.getContact().wechat, "qzt65631");
  assert.equal(api.requirePaidFeature("test"), false);
  assert.equal(api.saveLicense(permanentCode).valid, true);
  assert.equal(api.getStatus().plan, "P");
  assert.equal(api.getStatus().expiresText, "永久有效");
  assert.equal(api.requirePaidFeature("test"), true);

  const tamperedPlan = permanentCode.replace("HSM2.P.", "HSM2.Y.");
  assert.equal(api.validateLicenseCode(tamperedPlan).valid, false);
  assert.equal(api.validateLicenseCode(tamperedPlan).reason, "激活码校验失败。");

  const otherMachineCode = issuer.createLicenseCode("HSMZZZ9999999", "permanent", "2026-07-19", testKeyPair.privateKey);
  assert.equal(api.validateLicenseCode(otherMachineCode).valid, false);
  assert.equal(api.validateLicenseCode(otherMachineCode).reason, "激活码与本机机器码不匹配。");

  const forgedKeyPair = crypto.generateKeyPairSync("ed25519");
  const forgedCode = issuer.createLicenseCode(machineCode, "permanent", "2026-07-19", forgedKeyPair.privateKey);
  assert.equal(api.validateLicenseCode(forgedCode).valid, false);
  assert.equal(api.validateLicenseCode(forgedCode).reason, "激活码校验失败。");
}

{
  const unavailable = createLicenseContext({
    pluginValues: { hsmath_machine_id_v1: machineCode, hsmath_trial_started_v1: "2026-01-01" },
    publicKey: ""
  });
  delete unavailable.context.MathLicensePublicKey;
  delete unavailable.context.window.MathLicensePublicKey;
  const result = unavailable.context.MathLicense.validateLicenseCode(permanentCode);
  assert.equal(result.valid, false);
  assert(result.reason.includes("验签组件"));
}

{
  const calls = [];
  const paneApi = {
    openPackaged(options) {
      calls.push(options);
      return true;
    }
  };
  const app = {
    PluginStorage: createStorage({
      hsmath_machine_id_v1: machineCode,
      hsmath_trial_started_v1: "2026-01-01"
    }),
    CreateTaskPane() {}
  };
  const instance = createLicenseContext({
    app,
    mathTaskPanes: paneApi,
    document: { location: { toString: () => "file:///C:/plugin/index.html" } }
  });
  const options = { app, pluginBaseUrl: "file:///C:/plugin", role: "writer" };
  assert.equal(instance.context.MathLicense.openAuthorizationCenter(options), true);
  assert.equal(instance.context.MathLicense.requirePaidFeature("绘制函数", options), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].role, "writer");
  assert.equal(calls[0].name, "tool-center");
  assert.equal(calls[0].view, "license");
  assert.equal(instance.context.MathLicense.getLastFeatureName(), "绘制函数");
}

{
  const installedMachineId = "HSMFIXED12345";
  const sharedLocalStorage = createStorage();
  const installedPermanentCode = issuer.createLicenseCode(installedMachineId, "permanent", "2026-07-19", testKeyPair.privateKey);
  const firstDocument = createLicenseContext({ installedMachineId, localStorage: sharedLocalStorage });

  assert.equal(firstDocument.context.MathLicense.getMachineId(), installedMachineId);
  assert.equal(firstDocument.context.MathLicense.saveLicense(installedPermanentCode).valid, true);
  assert.equal(firstDocument.context.MathLicense.getStatus().licensed, true);
  assert.equal(firstDocument.pluginStorage.values.hsmath_license_v1, installedPermanentCode);
  assert.equal(sharedLocalStorage.values.hsmath_license_v1, installedPermanentCode);

  const secondDocument = createLicenseContext({ installedMachineId, localStorage: sharedLocalStorage });
  assert.equal(secondDocument.context.MathLicense.getMachineId(), installedMachineId);
  assert.equal(secondDocument.context.MathLicense.getStatus().licensed, true);
  assert.equal(secondDocument.context.MathLicense.getStatus().plan, "P");
  assert.equal(secondDocument.pluginStorage.values.hsmath_license_v1, installedPermanentCode);
}

{
  const firstDocument = createLicenseContext();
  const secondDocument = createLicenseContext();
  assert.equal(firstDocument.context.MathLicense.getMachineId(), secondDocument.context.MathLicense.getMachineId());
}

{
  const installedMachineId = "HSMTRIAL12345";
  const sharedLocalStorage = createStorage();
  const firstDocument = createLicenseContext({ installedMachineId, localStorage: sharedLocalStorage });
  const firstExpiry = firstDocument.context.MathLicense.getStatus().expiresDate;
  assert(sharedLocalStorage.values.hsmath_trial_started_v1);

  const secondDocument = createLicenseContext({ installedMachineId, localStorage: sharedLocalStorage });
  assert.equal(secondDocument.context.MathLicense.getStatus().expiresDate, firstExpiry);
  assert.equal(secondDocument.pluginStorage.values.hsmath_trial_started_v1, sharedLocalStorage.values.hsmath_trial_started_v1);
}

console.log("Ed25519 offline license tests passed");
