const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..");
const panelSource = fs.readFileSync(path.join(projectRoot, "ui", "license-ui.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(projectRoot, "ui", "license.html"), "utf8");
const panelEntry = fs.readFileSync(path.join(projectRoot, "ui", "license-entry.js"), "utf8");

const requiredIds = [
  "statusBadge",
  "featureNotice",
  "licenseType",
  "expiryTime",
  "remainingTime",
  "accessScope",
  "machineCode",
  "copyMachineCode",
  "activationCode",
  "pasteActivationCode",
  "activateButton",
  "status",
  "wechatQr",
  "wechatNumber",
  "copyWechatNumber",
  "qqNumber",
  "copyQqNumber"
];

for (const id of requiredIds) {
  assert(panelEntry.includes(`id="${id}"`), `license panel is missing #${id}`);
}
assert(panelHtml.includes("license-entry.js"));
assert(panelEntry.includes('id="wechatQr" class="wechat-qr" src="../assets/wechat-qr.jpg"'));
assert(panelEntry.includes('class="license-disclosure activation-disclosure"'));
assert(panelEntry.includes('class="license-disclosure contact-disclosure"'));
assert.equal((panelEntry.match(/class="disclosure-arrow"/g) || []).length, 2);
assert.equal((panelEntry.match(/class="disclosure-chevron"/g) || []).length, 2);
assert(panelEntry.includes('月卡 / 季卡 / 年卡 / 永久版</small><span class="disclosure-arrow"'));
assert(panelEntry.includes('微信 / QQ 联系方式</small><span class="disclosure-arrow"'));
assert(!/<details[^>]*\sopen(?:\s|=|>)/.test(panelEntry));

class ElementStub {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.hidden = false;
    this.src = "";
    this.disabled = false;
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.focusCount = 0;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) {
      listener.call(this, event);
    }
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  select() {
    this.ownerDocument.selectedElement = this;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function createDocument(ids) {
  const document = {
    activeElement: null,
    selectedElement: null,
    copiedValues: [],
    commandCalls: [],
    elements: {},
    body: {
      children: [],
      appendChild(element) {
        this.children.push(element);
      },
      removeChild(element) {
        const index = this.children.indexOf(element);
        if (index >= 0) {
          this.children.splice(index, 1);
        }
      }
    },
    getElementById(id) {
      return this.elements[id] || null;
    },
    createElement(tagName) {
      return new ElementStub(tagName, this);
    },
    execCommand(command) {
      this.commandCalls.push(command);
      if (command === "copy" && this.selectedElement) {
        this.copiedValues.push(this.selectedElement.value);
        return true;
      }
      return false;
    }
  };

  for (const id of ids) {
    document.elements[id] = new ElementStub("div", document);
  }
  document.elements.featureNotice.hidden = true;
  return document;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

(async function run() {
  const machineCode = "HSMABC1234567";
  const wechatNumber = "qzt65631";
  const qqNumber = "982303035";
  const qrUrl = "../assets/wechat-qr.jpg";
  const validCode = "HSM-PERMANENT-VALID";
  const document = createDocument(requiredIds);
  const readyCalls = [];
  const savedCodes = [];
  const windowListeners = {};
  let featureName = "绘制函数";
  let currentStatus = {
    active: false,
    licensed: false,
    trial: false,
    statusLabel: "已到期",
    planLabel: "未激活",
    expiresText: "2026-07-01",
    remainingText: "已到期",
    accessText: "WPS 文字仅试卷功能可用，其他功能不可用",
    machineId: machineCode
  };

  const mathLicense = {
    getStatus() {
      return currentStatus;
    },
    getContact() {
      return { qq: qqNumber, wechat: wechatNumber, wechatQrUrl: qrUrl };
    },
    getLastFeatureName() {
      return featureName;
    },
    saveLicense(code) {
      savedCodes.push(code);
      if (code !== validCode) {
        return { valid: false, reason: "激活码格式不正确。" };
      }
      currentStatus = {
        active: true,
        licensed: true,
        trial: false,
        statusLabel: "已激活",
        planLabel: "永久版",
        expiresText: "永久有效",
        remainingText: "永久有效",
        accessText: "全部功能可用",
        machineId: machineCode
      };
      return { valid: true, license: { plan: "P", expires: "PERMANENT" } };
    }
  };

  const navigator = {
    clipboard: {
      readText() {
        return Promise.resolve(`  ${validCode}\n`);
      }
    }
  };
  const window = {
    MathLicense: mathLicense,
    MathTaskPanes: {
      signalReady(name) {
        readyCalls.push(name);
        return true;
      }
    },
    addEventListener(type, listener) {
      windowListeners[type] = listener;
    }
  };
  const context = {
    window,
    document,
    navigator,
    console,
    alert() {
      throw new Error("license panel must not use alert");
    },
    prompt() {
      throw new Error("license panel must not use prompt");
    },
    InputBox() {
      throw new Error("license panel must not use InputBox");
    }
  };

  vm.createContext(context);
  vm.runInContext(panelSource, context);
  assert.equal(typeof windowListeners.DOMContentLoaded, "function");
  windowListeners.DOMContentLoaded();

  assert.equal(document.elements.statusBadge.textContent, "已到期");
  assert.equal(document.elements.statusBadge.className, "status-badge expired");
  assert.equal(document.elements.licenseType.textContent, "未激活");
  assert.equal(document.elements.expiryTime.textContent, "2026-07-01");
  assert.equal(document.elements.remainingTime.textContent, "已到期");
  assert.equal(document.elements.accessScope.textContent, currentStatus.accessText);
  assert.equal(document.elements.machineCode.value, machineCode);
  assert.equal(document.elements.wechatNumber.textContent, wechatNumber);
  assert.equal(document.elements.qqNumber.textContent, qqNumber);
  assert.equal(document.elements.featureNotice.hidden, false);
  assert(document.elements.featureNotice.textContent.includes("绘制函数"));
  assert.deepStrictEqual(readyCalls, ["license"]);

  document.elements.copyMachineCode.dispatch("click");
  assert(document.commandCalls.includes("copy"));
  assert.equal(document.copiedValues[0], machineCode);
  assert.equal(document.elements.status.className, "status success");
  assert(document.elements.status.textContent.includes("机器码已复制"));

  document.elements.pasteActivationCode.dispatch("click");
  await flushPromises();
  assert.equal(document.elements.activationCode.value, validCode);
  assert.equal(document.activeElement, document.elements.activationCode);
  assert(document.elements.status.textContent.includes("激活码已粘贴"));

  document.elements.activationCode.value = "INVALID-CODE";
  const focusCountBeforeInvalid = document.elements.activationCode.focusCount;
  document.elements.activateButton.dispatch("click");
  assert.equal(savedCodes[0], "INVALID-CODE");
  assert.equal(document.elements.activationCode.value, "INVALID-CODE");
  assert.equal(document.elements.activateButton.disabled, false);
  assert.equal(document.elements.status.className, "status error");
  assert.equal(document.elements.status.textContent, "激活码格式不正确。");
  assert(document.elements.activationCode.focusCount > focusCountBeforeInvalid);

  document.elements.activationCode.value = validCode;
  document.elements.activateButton.dispatch("click");
  assert.equal(savedCodes[1], validCode);
  assert.equal(document.elements.activationCode.value, "");
  assert.equal(document.elements.statusBadge.textContent, "已激活");
  assert.equal(document.elements.statusBadge.className, "status-badge active");
  assert.equal(document.elements.licenseType.textContent, "永久版");
  assert.equal(document.elements.expiryTime.textContent, "永久有效");
  assert.equal(document.elements.remainingTime.textContent, "永久有效");
  assert.equal(document.elements.accessScope.textContent, "全部功能可用");
  assert.equal(document.elements.featureNotice.hidden, true);
  assert.equal(document.elements.status.className, "status success");
  assert(document.elements.status.textContent.includes("激活成功：永久版"));

  document.elements.copyWechatNumber.dispatch("click");
  assert.equal(document.copiedValues[1], wechatNumber);
  assert(document.elements.status.textContent.includes("微信号已复制"));

  document.elements.copyQqNumber.dispatch("click");
  assert.equal(document.copiedValues[2], qqNumber);
  assert(document.elements.status.textContent.includes("QQ 号码已复制"));

  let hangingClipboardFallback = null;
  window.setTimeout = (callback, delay) => {
    assert.equal(delay, 600);
    hangingClipboardFallback = callback;
    return 99;
  };
  navigator.clipboard.readText = () => new Promise(() => {});
  document.elements.activationCode.value = "";
  const focusCountBeforeClipboardTimeout = document.elements.activationCode.focusCount;
  document.elements.pasteActivationCode.dispatch("click");
  assert.equal(typeof hangingClipboardFallback, "function");
  hangingClipboardFallback();
  assert(document.elements.activationCode.focusCount > focusCountBeforeClipboardTimeout);
  assert.equal(document.elements.status.className, "status info");
  assert(document.elements.status.textContent.includes("Ctrl+V"));

  featureName = "";
  window.MathLicensePanel.refresh();
  assert.equal(document.elements.featureNotice.hidden, true);

  console.log("license panel DOM and clipboard interaction tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
