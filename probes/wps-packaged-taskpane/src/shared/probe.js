var HSM_PACKAGED_PROBE_HOST = window.HSM_PACKAGED_TASKPANE_HOST === "presentation" ? "presentation" : "writer";
var HSM_PACKAGED_PROBE_STATUS = "尚未运行";
var HSM_PACKAGED_PROBE_RIBBON = null;
var HSM_PACKAGED_PROBE_PANE = null;
var HSM_PACKAGED_PROBE_TOKEN = "";
var HSM_PACKAGED_PROBE_DEADLINE = 0;

function HsmPackagedProbeStorageKey(suffix) {
  return "hsm_packaged_taskpane_probe_" + HSM_PACKAGED_PROBE_HOST + "_" + suffix;
}

function HsmPackagedProbeStorage() {
  try {
    return window.Application && window.Application.PluginStorage ? window.Application.PluginStorage : null;
  } catch (_) {
    return null;
  }
}

function HsmPackagedProbeSetStatus(value) {
  HSM_PACKAGED_PROBE_STATUS = String(value || "未知状态");
  try {
    if (HSM_PACKAGED_PROBE_RIBBON && HSM_PACKAGED_PROBE_RIBBON.InvalidateControl) {
      HSM_PACKAGED_PROBE_RIBBON.InvalidateControl("probe_packaged_status");
    }
  } catch (_) {}
}

function HsmPackagedProbeBaseUrl() {
  var value = "";
  try { value = decodeURI(String(document.location)); } catch (_) { value = String(document.location || ""); }
  value = value.split(/[?#]/)[0];
  return value.substring(0, value.lastIndexOf("/"));
}

function HsmPackagedProbeToken() {
  return HSM_PACKAGED_PROBE_HOST + "-" + new Date().getTime() + "-" +
    Math.floor(Math.random() * 0x100000000).toString(36) + "-" +
    Math.floor(Math.random() * 0x100000000).toString(36);
}

function HsmPackagedProbeReadReady() {
  var storage = HsmPackagedProbeStorage();
  if (!storage || !storage.getItem) {
    HsmPackagedProbeSetStatus("失败：PluginStorage 不可用");
    return false;
  }
  var ready = "";
  var capabilities = "";
  try {
    ready = String(storage.getItem(HsmPackagedProbeStorageKey("ready")) || "");
    capabilities = String(storage.getItem(HsmPackagedProbeStorageKey("capabilities")) || "");
  } catch (_) {
    HsmPackagedProbeSetStatus("失败：无法读取握手状态");
    return false;
  }
  if (ready === HSM_PACKAGED_PROBE_TOKEN && capabilities.indexOf('"application":true') >= 0 &&
      capabilities.indexOf('"pluginStorage":true') >= 0) {
    HsmPackagedProbeSetStatus("通过：包内页面已就绪，WPS API 可访问");
    return true;
  }
  if (new Date().getTime() >= HSM_PACKAGED_PROBE_DEADLINE && HSM_PACKAGED_PROBE_TOKEN) {
    HsmPackagedProbeSetStatus("失败：包内页面未完成 ready 握手");
    return false;
  }
  HsmPackagedProbeSetStatus("等待包内页面 ready 握手");
  return false;
}

function HsmPackagedProbePoll() {
  if (HsmPackagedProbeReadReady()) {
    return;
  }
  if (new Date().getTime() < HSM_PACKAGED_PROBE_DEADLINE && typeof window.setTimeout === "function") {
    window.setTimeout(HsmPackagedProbePoll, 100);
  }
}

function HsmPackagedProbeOpen() {
  var app = window.Application;
  var storage = HsmPackagedProbeStorage();
  var baseUrl = HsmPackagedProbeBaseUrl();
  if (!app || typeof app.CreateTaskPane !== "function") {
    HsmPackagedProbeSetStatus("失败：CreateTaskPane 不可用");
    return false;
  }
  if (!/^file:\/\//i.test(baseUrl)) {
    HsmPackagedProbeSetStatus("失败：加载项根目录不是 file URL");
    return false;
  }
  if (!storage || !storage.setItem) {
    HsmPackagedProbeSetStatus("失败：PluginStorage 不可用");
    return false;
  }
  HSM_PACKAGED_PROBE_TOKEN = HsmPackagedProbeToken();
  HSM_PACKAGED_PROBE_DEADLINE = new Date().getTime() + 5000;
  try {
    storage.setItem(HsmPackagedProbeStorageKey("ready"), "");
    storage.setItem(HsmPackagedProbeStorageKey("capabilities"), "");
  } catch (_) {
    HsmPackagedProbeSetStatus("失败：无法初始化握手状态");
    return false;
  }
  if (HSM_PACKAGED_PROBE_PANE) {
    try { HSM_PACKAGED_PROBE_PANE.Visible = false; } catch (_) {}
    HSM_PACKAGED_PROBE_PANE = null;
  }
  var url = baseUrl + "/pane.html?hsmHost=" + encodeURIComponent(HSM_PACKAGED_PROBE_HOST) +
    "&hsmToken=" + encodeURIComponent(HSM_PACKAGED_PROBE_TOKEN);
  try {
    HSM_PACKAGED_PROBE_PANE = app.CreateTaskPane(url, "包内静态页面探针");
  } catch (error) {
    HSM_PACKAGED_PROBE_PANE = null;
  }
  if (!HSM_PACKAGED_PROBE_PANE) {
    HsmPackagedProbeSetStatus("失败：WPS 拒绝本地任务窗格 URL");
    return false;
  }
  try { HSM_PACKAGED_PROBE_PANE.DockPosition = 2; } catch (_) {}
  try { HSM_PACKAGED_PROBE_PANE.Width = 420; } catch (_) {}
  try { HSM_PACKAGED_PROBE_PANE.Visible = true; } catch (_) {}
  HsmPackagedProbeSetStatus("等待包内页面 ready 握手");
  HsmPackagedProbePoll();
  return true;
}

function OnAddinLoad(ribbonUI) {
  HSM_PACKAGED_PROBE_RIBBON = ribbonUI;
  HsmPackagedProbeSetStatus("尚未运行");
  return true;
}

function OnProbeAction(control) {
  if (control && control.Id === "probe_refresh_packaged_status") {
    HsmPackagedProbeReadReady();
    return true;
  }
  return HsmPackagedProbeOpen();
}

function GetProbeStatus() {
  return HSM_PACKAGED_PROBE_STATUS;
}
