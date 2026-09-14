function licenseNode(id) {
  return document.getElementById(id);
}

function setLicenseStatus(message, className) {
  var status = licenseNode("status");
  status.textContent = message || "";
  status.className = "status" + (className ? " " + className : "");
}

function setNotice(message, className) {
  var notice = licenseNode("featureNotice");
  notice.textContent = message || "";
  notice.className = "notice" + (className ? " " + className : "");
  notice.hidden = !message;
}

function copyText(text, successMessage) {
  var value = String(text || "");
  if (!value) {
    setLicenseStatus("没有可复制的内容。", "error");
    return;
  }

  function fallbackCopy() {
    var input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_) {
      copied = false;
    }
    document.body.removeChild(input);
    if (copied) {
      setLicenseStatus(successMessage, "success");
    } else {
      setLicenseStatus("复制失败，请选中内容后按 Ctrl+C。", "error");
    }
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        setLicenseStatus(successMessage, "success");
      }).catch(fallbackCopy);
      return;
    }
  } catch (_) {}
  fallbackCopy();
}

function applyPastedActivationCode(text) {
  var code = String(text || "").replace(/^\s+|\s+$/g, "");
  var field = licenseNode("activationCode");
  if (!code) {
    field.focus();
    setLicenseStatus("剪贴板中没有可用的激活码，请按 Ctrl+V 粘贴。", "info");
    return false;
  }
  field.value = code;
  field.focus();
  setLicenseStatus("激活码已粘贴，请核对后点击“立即激活”。", "success");
  return true;
}

function pasteActivationCode() {
  var field = licenseNode("activationCode");
  var clipboardSettled = false;
  var fallbackTimer = null;

  function fallbackPaste() {
    var before = field.value;
    field.focus();
    var pasted = false;
    try {
      pasted = document.execCommand("paste");
    } catch (_) {
      pasted = false;
    }
    if ((pasted || field.value !== before) && field.value) {
      applyPastedActivationCode(field.value);
      return;
    }
    setLicenseStatus("已定位到激活码输入框，请按 Ctrl+V 粘贴。", "info");
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
      var schedule = null;
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        schedule = window.setTimeout;
      } else if (typeof setTimeout === "function") {
        schedule = setTimeout;
      }
      if (schedule) {
        fallbackTimer = schedule(function () {
          if (clipboardSettled) {
            return;
          }
          clipboardSettled = true;
          fallbackPaste();
        }, 600);
      }
      navigator.clipboard.readText().then(function (text) {
        if (clipboardSettled) {
          return;
        }
        clipboardSettled = true;
        if (fallbackTimer && typeof clearTimeout === "function") {
          clearTimeout(fallbackTimer);
        }
        applyPastedActivationCode(text);
      }).catch(function () {
        if (clipboardSettled) {
          return;
        }
        clipboardSettled = true;
        fallbackPaste();
      });
      return;
    }
  } catch (_) {}
  fallbackPaste();
}

function refreshLicenseView() {
  var licenseStatus = window.MathLicense.getStatus();
  var contact = window.MathLicense.getContact();
  var featureName = window.MathLicense.getLastFeatureName();
  var badge = licenseNode("statusBadge");
  var badgeState = licenseStatus.licensed ? "active" : (licenseStatus.trial ? "trial" : "expired");

  badge.textContent = licenseStatus.statusLabel;
  badge.className = "status-badge " + badgeState;
  licenseNode("licenseType").textContent = licenseStatus.planLabel;
  licenseNode("expiryTime").textContent = licenseStatus.expiresText;
  licenseNode("remainingTime").textContent = licenseStatus.remainingText;
  licenseNode("accessScope").textContent = licenseStatus.accessText;
  licenseNode("machineCode").value = licenseStatus.machineId;
  licenseNode("wechatNumber").textContent = contact.wechat;
  licenseNode("qqNumber").textContent = contact.qq;

  if (!licenseStatus.active && featureName) {
    setNotice("“" + featureName + "”需要激活后使用。请复制机器码联系客服，收到激活码后在下方完成激活。", "error");
  } else if (licenseStatus.active && featureName.indexOf("授权将在") === 0) {
    setNotice(featureName + "，可提前联系续费。", "warning");
  } else if (!licenseStatus.active) {
    setNotice("当前授权已到期。试卷工具仍可使用，其他功能需要激活。", "error");
  } else {
    setNotice("", "");
  }
  return licenseStatus;
}

function activateLicense() {
  var field = licenseNode("activationCode");
  var button = licenseNode("activateButton");
  var code = String(field.value || "").replace(/^\s+|\s+$/g, "");
  if (!code) {
    field.focus();
    setLicenseStatus("请先粘贴激活码。", "error");
    return false;
  }

  button.disabled = true;
  var result;
  try {
    result = window.MathLicense.saveLicense(code);
  } catch (_) {
    result = { valid: false, reason: "激活校验出现异常，请核对激活码后重试。" };
  }
  button.disabled = false;
  if (!result.valid) {
    setLicenseStatus(result.reason || "激活失败，请核对激活码。", "error");
    field.focus();
    return false;
  }

  field.value = "";
  var licenseStatus = refreshLicenseView();
  setLicenseStatus("激活成功：" + licenseStatus.planLabel + "，有效期：" + licenseStatus.expiresText + "。", "success");
  return true;
}

function initializeLicensePanel() {
  refreshLicenseView();
  licenseNode("copyMachineCode").addEventListener("click", function () {
    copyText(licenseNode("machineCode").value, "机器码已复制，可直接发送给客服。");
  });
  licenseNode("pasteActivationCode").addEventListener("click", pasteActivationCode);
  licenseNode("copyWechatNumber").addEventListener("click", function () {
    copyText(licenseNode("wechatNumber").textContent, "微信号已复制。");
  });
  licenseNode("copyQqNumber").addEventListener("click", function () {
    copyText(licenseNode("qqNumber").textContent, "QQ 号码已复制。");
  });
  licenseNode("activateButton").addEventListener("click", activateLicense);
  licenseNode("activationCode").addEventListener("keydown", function (event) {
    event = event || window.event;
    if (event && event.ctrlKey && (event.key === "Enter" || event.keyCode === 13)) {
      if (event.preventDefault) {
        event.preventDefault();
      }
      activateLicense();
    }
  });
  if (window.MathTaskPanes && !window.HSM_TASK_PANE_NAME) {
    window.MathTaskPanes.signalReady("license");
  }
}

window.MathLicensePanel = {
  refresh: refreshLicenseView,
  activate: activateLicense,
  paste: pasteActivationCode,
  copyText: copyText
};

window.addEventListener("DOMContentLoaded", initializeLicensePanel);
