(function () {
  function queryValue(name) {
    var text = String(document.location.search || "").replace(/^\?/, "").split("&");
    for (var index = 0; index < text.length; index += 1) {
      var pair = text[index].split("=");
      if (decodeURIComponent(pair[0] || "") === name) {
        return decodeURIComponent(pair.slice(1).join("=") || "");
      }
    }
    return "";
  }

  function storageKey(host, suffix) {
    return "hsm_packaged_taskpane_probe_" + host + "_" + suffix;
  }

  function writeReady() {
    var host = queryValue("hsmHost") === "presentation" ? "presentation" : "writer";
    var token = queryValue("hsmToken");
    var app = null;
    try { app = window.Application || window.wps || null; } catch (_) { app = null; }
    var storage = null;
    try { storage = app && app.PluginStorage ? app.PluginStorage : null; } catch (_) { storage = null; }
    var capabilities = {
      application: !!app,
      pluginStorage: !!(storage && storage.setItem),
      localFile: /^file:\/\//i.test(String(document.location))
    };
    document.getElementById("details").textContent = JSON.stringify({ host: host, capabilities: capabilities });
    if (!token || !capabilities.application || !capabilities.pluginStorage || !capabilities.localFile) {
      document.getElementById("badge").textContent = "握手失败";
      document.getElementById("message").textContent = "本地页面已显示，但所需的 WPS 页面通信能力不完整。";
      return false;
    }
    try {
      storage.setItem(storageKey(host, "capabilities"), JSON.stringify(capabilities));
      storage.setItem(storageKey(host, "ready"), token);
    } catch (_) {
      document.getElementById("badge").textContent = "写入失败";
      document.getElementById("message").textContent = "页面无法写入 PluginStorage ready token。";
      return false;
    }
    document.getElementById("badge").textContent = "握手成功";
    document.getElementById("message").textContent = "页面来自插件安装目录，没有本机 HTTP 服务、端口或外部辅助程序。";
    return true;
  }

  document.getElementById("retry").addEventListener("click", writeReady);
  writeReady();
})();
