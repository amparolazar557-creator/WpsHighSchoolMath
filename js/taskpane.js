(function (factory) {
  var root = typeof window !== "undefined" ? window :
    (typeof globalThis !== "undefined" ? globalThis : this);
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MathTaskPanes = api;
  if (typeof globalThis !== "undefined") {
    globalThis.MathTaskPanes = api;
  }
})(function (root) {
  var BUILD_VERSION = "__PLUGIN_VERSION__";
  var PAGE_MAP = {
    "tool-center": {
      path: "ui/tool-center.html",
      title: "高中数学工具",
      reuse: true,
      defaultView: "function-plot",
      views: {
        "function-plot": true,
        "license": true
      },
      legacyNames: ["function-plot", "license"]
    },
    "function-plot": {
      path: "ui/function-plot.html",
      title: "函数编辑器"
    },
    "license": {
      path: "ui/license.html",
      title: "授权中心"
    }
  };
  var activePanes = {};
  var operationSequence = 0;

  function version() {
    return BUILD_VERSION.indexOf("__PLUGIN_") === 0 ? "dev" : BUILD_VERSION;
  }

  function safePart(value) {
    return String(value || "pane").replace(/[^A-Za-z0-9_-]/g, "_");
  }

  function storageKey(name, suffix) {
    return "hsmath_taskpane_" + safePart(name) + "_" + safePart(version()) + "_" + suffix;
  }

  function getStorage(app) {
    try {
      return app && app.PluginStorage ? app.PluginStorage : null;
    } catch (_) {
      return null;
    }
  }

  function getItem(storage, key) {
    if (!storage || !storage.getItem) {
      return "";
    }
    try {
      return String(storage.getItem(key) || "");
    } catch (_) {
      return "";
    }
  }

  function setItem(storage, key, value) {
    if (!storage || !storage.setItem) {
      return false;
    }
    try {
      storage.setItem(key, String(value || ""));
      return true;
    } catch (_) {
      return false;
    }
  }

  function locationText() {
    try {
      return String(root.document ? root.document.location : document.location);
    } catch (_) {
      try { return String(document.location); } catch (_) { return ""; }
    }
  }

  function stripQueryAndHash(value) {
    return String(value || "").split(/[?#]/)[0];
  }

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function isSafeFileUrl(value) {
    var text = String(value || "");
    return /^file:\/\/\//i.test(text) &&
      text.indexOf("\\") < 0 &&
      !/(^|\/)\.\.?($|\/)/.test(text) &&
      !/%2e/i.test(text) &&
      text.indexOf("://", 8) < 0;
  }

  function pluginRootUrl() {
    var current = trimTrailingSlash(stripQueryAndHash(locationText()));
    if (!isSafeFileUrl(current)) {
      return "";
    }
    var lower = current.toLowerCase();
    var uiIndex = lower.lastIndexOf("/ui/");
    if (uiIndex >= 0) {
      return current.substring(0, uiIndex);
    }
    var separator = current.lastIndexOf("/");
    return separator > "file:///".length ? current.substring(0, separator) : "";
  }

  function sameFileRoot(left, right) {
    return trimTrailingSlash(stripQueryAndHash(left)).toLowerCase() ===
      trimTrailingSlash(stripQueryAndHash(right)).toLowerCase();
  }

  function versionedPagePath(name) {
    var page = PAGE_MAP[name];
    if (!page) {
      return "";
    }
    if (version() === "dev") {
      return page.path;
    }
    var dot = page.path.lastIndexOf(".");
    return page.path.substring(0, dot) + "-" + version() + page.path.substring(dot);
  }

  function appendQuery(url, values) {
    var parts = [];
    for (var key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(values[key]));
      }
    }
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }

  function queryValues() {
    var url = locationText();
    var question = url.indexOf("?");
    if (question < 0) {
      return {};
    }
    var entries = url.substring(question + 1).split("#")[0].split("&");
    var result = {};
    for (var index = 0; index < entries.length; index += 1) {
      var pair = entries[index].split("=");
      if (!pair[0]) {
        continue;
      }
      try {
        result[decodeURIComponent(pair[0])] = decodeURIComponent(pair.slice(1).join("=") || "");
      } catch (_) {}
    }
    return result;
  }

  function schedule(callback, delay, options) {
    if (options && typeof options.schedule === "function") {
      options.schedule(callback, delay);
      return true;
    }
    if (root && typeof root.setTimeout === "function") {
      root.setTimeout(callback, delay);
      return true;
    }
    if (typeof setTimeout === "function") {
      setTimeout(callback, delay);
      return true;
    }
    return false;
  }

  function randomText() {
    var result = "";
    try {
      if (root.crypto && root.crypto.getRandomValues && typeof Uint8Array !== "undefined") {
        var bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        for (var index = 0; index < bytes.length; index += 1) {
          result += (bytes[index] + 256).toString(16).substring(1);
        }
      }
    } catch (_) {
      result = "";
    }
    if (!result) {
      for (var part = 0; part < 6; part += 1) {
        result += Math.floor(Math.random() * 0x100000000).toString(36);
      }
    }
    return result;
  }

  function makeToken(name, attempt) {
    return safePart(name) + "-" + String(new Date().getTime()) + "-" +
      randomText() + "-" + String(attempt || 0);
  }

  function hidePane(pane) {
    try {
      if (pane) {
        pane.Visible = false;
      }
    } catch (_) {}
  }

  function showPane(pane, width) {
    try { pane.DockPosition = 2; } catch (_) {}
    try {
      if (!pane.Width || pane.Width < 360) {
        pane.Width = width || 420;
      }
    } catch (_) {}
    try {
      pane.Visible = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  function hideSavedPane(app, storage, key) {
    var paneId = getItem(storage, key);
    if (paneId && app && typeof app.GetTaskPane === "function") {
      try { hidePane(app.GetTaskPane(paneId)); } catch (_) {}
    }
    setItem(storage, key, "");
  }

  function allowedView(name, view) {
    var page = PAGE_MAP[name];
    return !!(page && page.views && page.views[String(view || "")]);
  }

  function requestView(app, name, view) {
    var storage = getStorage(app);
    var normalizedName = String(name || "");
    var normalizedView = String(view || "");
    if (!storage || !allowedView(normalizedName, normalizedView)) {
      return "";
    }
    var requestToken = makeToken(normalizedName + "-" + normalizedView, 0);
    setItem(storage, storageKey(normalizedName, "view"), normalizedView);
    setItem(storage, storageKey(normalizedName, "view-request"), requestToken);
    setItem(storage, storageKey(normalizedName, "view-ack"), "");
    return requestToken;
  }

  function getRequestedView(app, name, fallback) {
    var storage = getStorage(app);
    var view = getItem(storage, storageKey(name, "view"));
    if (allowedView(name, view)) {
      return view;
    }
    return allowedView(name, fallback) ? String(fallback) : "";
  }

  function acknowledgeView(app, name) {
    var storage = getStorage(app);
    var requestToken = getItem(storage, storageKey(name, "view-request"));
    if (!storage || !requestToken) {
      return false;
    }
    return setItem(storage, storageKey(name, "view-ack"), requestToken);
  }

  function retirePane(app, storage, host, name) {
    var stateKey = host + ":" + name;
    var state = activePanes[stateKey];
    if (state && state.pane) {
      hidePane(state.pane);
    }
    delete activePanes[stateKey];
    hideSavedPane(app, storage, storageKey(name, "id"));
  }

  function openPackaged(options) {
    options = options || {};
    var app = options.app;
    var name = String(options.name || "");
    var page = PAGE_MAP[name];
    var host = options.role === "presentation" ? "presentation" :
      (options.role === "writer" ? "writer" : "");
    var rootUrl = pluginRootUrl();
    if (!app || typeof app.CreateTaskPane !== "function" || !page || !host || !rootUrl) {
      return false;
    }
    if (options.pluginBaseUrl && !sameFileRoot(options.pluginBaseUrl, rootUrl)) {
      return false;
    }
    if (!isSafeFileUrl(rootUrl)) {
      return false;
    }

    var path = versionedPagePath(name);
    if (!path || /(^|\/)\.\.?($|\/)|\\|:|\?|#/.test(path)) {
      return false;
    }
    var storage = getStorage(app);
    if (!storage) {
      return false;
    }

    var view = String(options.view || page.defaultView || "");
    if (view && !allowedView(name, view)) {
      return false;
    }
    var viewRequest = view ? requestView(app, name, view) : "";
    if (view && !viewRequest) {
      return false;
    }

    var stateKey = host + ":" + name;
    var idKey = storageKey(name, "id");
    var readyKey = storageKey(name, "ready");
    var previous = activePanes[stateKey];

    var legacyNames = page.legacyNames || [];
    for (var legacyNameIndex = 0; legacyNameIndex < legacyNames.length; legacyNameIndex += 1) {
      retirePane(app, storage, host, legacyNames[legacyNameIndex]);
    }

    var legacyKeys = options.legacyKeys || [];
    for (var legacyIndex = 0; legacyIndex < legacyKeys.length; legacyIndex += 1) {
      hideSavedPane(app, storage, legacyKeys[legacyIndex]);
    }
    var reusablePane = null;
    if (page.reuse) {
      if (previous && previous.pane) {
        reusablePane = previous.pane;
      } else {
        var savedPaneId = getItem(storage, idKey);
        if (savedPaneId && typeof app.GetTaskPane === "function") {
          try { reusablePane = app.GetTaskPane(savedPaneId); } catch (_) { reusablePane = null; }
        }
      }
    } else {
      if (previous && previous.pane) {
        hidePane(previous.pane);
      }
      hideSavedPane(app, storage, idKey);
    }
    delete activePanes[stateKey];

    var state = {
      id: ++operationSequence,
      pane: null,
      token: "",
      failureReported: false,
      readyReported: false
    };
    activePanes[stateKey] = state;

    function isCurrent() {
      return activePanes[stateKey] === state;
    }

    function reportFailure(reason) {
      if (!isCurrent() || state.failureReported) {
        return;
      }
      state.failureReported = true;
      hidePane(state.pane);
      setItem(storage, idKey, "");
      if (typeof options.onFailure === "function") {
        options.onFailure(reason || "not-ready");
      }
    }

    function reportReady() {
      if (!isCurrent() || state.readyReported) {
        return;
      }
      state.readyReported = true;
      if (typeof options.onReady === "function") {
        options.onReady();
      }
    }

    function createPane(attempt) {
      if (!isCurrent()) {
        return true;
      }
      var token = makeToken(name, attempt);
      var pageUrl = appendQuery(rootUrl + "/" + path, {
        hsmPane: name,
        hsmToken: token,
        hsmHost: host,
        hsmView: view
      });
      var pane = null;
      setItem(storage, readyKey, "");
      try {
        pane = app.CreateTaskPane(pageUrl, options.title || page.title);
      } catch (_) {
        pane = null;
      }
      if (!pane) {
        if (attempt < 1) {
          return createPane(attempt + 1);
        }
        reportFailure("create-failed");
        return true;
      }

      state.pane = pane;
      state.token = token;
      setItem(storage, idKey, pane.ID || "");
      if (!showPane(pane, options.width || 420)) {
        setItem(storage, idKey, "");
        if (attempt < 1) {
          return createPane(attempt + 1);
        }
        reportFailure("show-failed");
        return true;
      }
      var scheduled = schedule(function () {
        if (!isCurrent() || state.token !== token || state.failureReported) {
          return;
        }
        if (getItem(storage, readyKey) === token) {
          reportReady();
          return;
        }
        hidePane(pane);
        setItem(storage, idKey, "");
        if (attempt < 1) {
          createPane(attempt + 1);
          return;
        }
        reportFailure("not-ready");
      }, options.readyTimeout === undefined ? 5000 : Number(options.readyTimeout), options);
      if (!scheduled) {
        reportFailure("timer-unavailable");
      }
      return true;
    }

    function reusePane(pane) {
      state.pane = pane;
      setItem(storage, idKey, pane.ID || getItem(storage, idKey));
      if (!showPane(pane, options.width || 420)) {
        setItem(storage, idKey, "");
        return createPane(0);
      }
      var scheduled = schedule(function () {
        if (!isCurrent() || state.failureReported) {
          return;
        }
        if (getItem(storage, storageKey(name, "view-ack")) === viewRequest) {
          reportReady();
          return;
        }
        hidePane(pane);
        setItem(storage, idKey, "");
        createPane(0);
      }, options.reuseTimeout === undefined ? 800 : Number(options.reuseTimeout), options);
      if (!scheduled) {
        hidePane(pane);
        setItem(storage, idKey, "");
        return createPane(0);
      }
      return true;
    }

    return reusablePane && viewRequest ? reusePane(reusablePane) : createPane(0);
  }

  function signalReady(expectedName) {
    var values = queryValues();
    var name = String(values.hsmPane || expectedName || "");
    var host = values.hsmHost === "presentation" ? "presentation" :
      (values.hsmHost === "writer" ? "writer" : "");
    var token = String(values.hsmToken || "");
    var current = stripQueryAndHash(locationText());
    var page = PAGE_MAP[name];
    if (!page || !host || !token || !isSafeFileUrl(current)) {
      return false;
    }
    if (expectedName && name !== expectedName) {
      return false;
    }
    var expectedSuffix = "/" + versionedPagePath(name);
    if (current.toLowerCase().lastIndexOf(expectedSuffix.toLowerCase()) !== current.length - expectedSuffix.length) {
      return false;
    }
    var app = null;
    try { app = root.Application || root.wps || null; } catch (_) { app = null; }
    return setItem(getStorage(app), storageKey(name, "ready"), token);
  }

  return {
    openPackaged: openPackaged,
    signalReady: signalReady,
    requestView: requestView,
    getRequestedView: getRequestedView,
    acknowledgeView: acknowledgeView,
    getVersion: version,
    _private: {
      appendQuery: appendQuery,
      queryValues: queryValues,
      storageKey: storageKey,
      pluginRootUrl: pluginRootUrl,
      versionedPagePath: versionedPagePath,
      isSafeFileUrl: isSafeFileUrl,
      sameFileRoot: sameFileRoot,
      makeToken: makeToken,
      allowedView: allowedView,
      activePanes: activePanes,
      pageMap: PAGE_MAP
    }
  };
});
