const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "js", "taskpane.js"), "utf8");
const writerMain = fs.readFileSync(path.join(projectRoot, "main.js"), "utf8");
const pptMain = fs.readFileSync(path.join(projectRoot, "ppt", "main.js"), "utf8");
const writerRibbon = fs.readFileSync(path.join(projectRoot, "js", "ribbon.js"), "utf8");
const pptRibbon = fs.readFileSync(path.join(projectRoot, "js", "ribbon-ppt.js"), "utf8");

assert(writerMain.indexOf("js/taskpane.js") < writerMain.indexOf("js/license.js"));
assert(pptMain.indexOf("js/taskpane.js") < pptMain.indexOf("js/license.js"));
assert(writerMain.indexOf("js/vendor/tweetnacl-fast.min.js") < writerMain.indexOf("js/license.js"));
assert(writerMain.indexOf("js/license-public-key.js") < writerMain.indexOf("js/license.js"));
assert(pptMain.indexOf("js/vendor/tweetnacl-fast.min.js") < pptMain.indexOf("js/license.js"));
assert(pptMain.indexOf("js/license-public-key.js") < pptMain.indexOf("js/license.js"));
assert(writerRibbon.includes("openPackaged"));
assert(pptRibbon.includes("openPackaged"));
for (const forbidden of [
  "openLocalEditor",
  "ShellExecute",
  "OAAssist",
  "XMLHttpRequest",
  "WpsHighSchoolMathEditorHost",
  "127.0.0.1",
  "localhost"
]) {
  assert(!source.includes(forbidden), `taskpane manager still contains forbidden runtime text: ${forbidden}`);
}

function createContext(url = "file:///C:/plugin/index.html", buildVersion = "dev") {
  const values = {};
  const calls = [];
  const timers = [];
  const panes = {};
  let nextPane = 1;
  const app = {
    PluginStorage: {
      getItem(key) {
        return values[key] || "";
      },
      setItem(key, value) {
        values[key] = String(value);
      }
    },
    CreateTaskPane(paneUrl, title) {
      calls.push(["CreateTaskPane", paneUrl, title]);
      const pane = { ID: `pane-${nextPane++}`, Visible: false, Width: 0, DockPosition: 0 };
      panes[pane.ID] = pane;
      return pane;
    },
    GetTaskPane(id) {
      return panes[id] || null;
    }
  };
  const window = {
    Application: app,
    document: { location: { toString: () => url } },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    }
  };
  const context = { window, document: window.document, console };
  vm.createContext(context);
  vm.runInContext(source.replace("__PLUGIN_VERSION__", buildVersion), context);
  return { context, app, values, calls, timers, panes, window };
}

function queryValue(url, key) {
  const match = new RegExp(`[?&]${key}=([^&#]+)`).exec(url);
  return match ? decodeURIComponent(match[1]) : "";
}

{
  const { context } = createContext("file:///C:/plugin/index.html", "0.4.0");
  assert.equal(context.MathTaskPanes._private.versionedPagePath("tool-center"), "ui/tool-center-0.4.0.html");
  assert.equal(context.MathTaskPanes._private.versionedPagePath("function-plot"), "ui/function-plot-0.4.0.html");
  assert.equal(context.MathTaskPanes._private.versionedPagePath("license"), "ui/license-0.4.0.html");
  assert.equal(context.MathTaskPanes._private.versionedPagePath("unknown"), "");
  assert.equal(context.MathTaskPanes._private.pluginRootUrl(), "file:///C:/plugin");
  assert.equal(context.MathTaskPanes._private.isSafeFileUrl("file:///C:/plugin"), true);
  assert.equal(context.MathTaskPanes._private.isSafeFileUrl("file:///C:/plugin/../other"), false);
  assert.equal(context.MathTaskPanes._private.isSafeFileUrl("https://example.invalid/plugin"), false);
}

{
  const { context, app, values, calls, timers, panes } = createContext(
    "file:///C:/Program%20Files/WPS%20Math/index.html",
    "0.4.0"
  );
  let readyCount = 0;
  assert.equal(context.MathTaskPanes.openPackaged({
    app,
    pluginBaseUrl: "file:///C:/Program%20Files/WPS%20Math",
    role: "writer",
    name: "tool-center",
    view: "function-plot",
    width: 420,
    onReady() { readyCount += 1; }
  }), true);
  assert.equal(calls.length, 1);
  const paneUrl = calls[0][1];
  assert(paneUrl.startsWith("file:///C:/Program%20Files/WPS%20Math/ui/tool-center-0.4.0.html?"));
  assert.equal(queryValue(paneUrl, "hsmPane"), "tool-center");
  assert.equal(queryValue(paneUrl, "hsmHost"), "writer");
  assert.equal(queryValue(paneUrl, "hsmView"), "function-plot");
  assert(queryValue(paneUrl, "hsmToken"));
  assert.equal(calls[0][2], "高中数学工具");
  assert.equal(panes["pane-1"].Visible, true);
  assert.equal(panes["pane-1"].DockPosition, 2);
  assert.equal(panes["pane-1"].Width, 420);
  values[context.MathTaskPanes._private.storageKey("tool-center", "ready")] = queryValue(paneUrl, "hsmToken");
  timers.shift().callback();
  assert.equal(readyCount, 1);
  assert.equal(calls.length, 1);
}

{
  const { context, app, values, calls, timers, panes } = createContext("file:///C:/plugin/index.html", "0.4.0");
  const baseOptions = {
    app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "tool-center",
    width: 420
  };
  assert.equal(context.MathTaskPanes.openPackaged(Object.assign({}, baseOptions, { view: "function-plot" })), true);
  const firstUrl = calls[0][1];
  values[context.MathTaskPanes._private.storageKey("tool-center", "ready")] = queryValue(firstUrl, "hsmToken");
  timers.shift().callback();

  assert.equal(context.MathTaskPanes.openPackaged(Object.assign({}, baseOptions, { view: "license" })), true);
  assert.equal(calls.length, 1, "switching tools must reuse the visible task pane");
  assert.equal(panes["pane-1"].Visible, true);
  assert.equal(values[context.MathTaskPanes._private.storageKey("tool-center", "view")], "license");
  values[context.MathTaskPanes._private.storageKey("tool-center", "view-ack")] =
    values[context.MathTaskPanes._private.storageKey("tool-center", "view-request")];
  timers.shift().callback();
  assert.equal(calls.length, 1);
}

{
  const { context, app, calls, timers, panes } = createContext("file:///C:/plugin/index.html", "0.4.0");
  const options = {
    app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "presentation",
    name: "license",
    width: 420
  };
  assert.equal(context.MathTaskPanes.openPackaged(options), true);
  const staleTimer = timers.shift();
  assert.equal(context.MathTaskPanes.openPackaged(options), true);
  assert.equal(panes["pane-1"].Visible, false, "reopening must hide the prior task pane");
  staleTimer.callback();
  assert.equal(calls.length, 2, "a stale ready timer must not create a replacement pane");
  assert(calls[1][1].includes("/ui/license-0.4.0.html?"));
  assert.equal(queryValue(calls[1][1], "hsmHost"), "presentation");
  assert.equal(calls[1][2], "授权中心");
}

{
  const { context, app, calls, timers, panes } = createContext("file:///C:/plugin/index.html", "0.4.0");
  const failures = [];
  assert.equal(context.MathTaskPanes.openPackaged({
    app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "function-plot",
    readyTimeout: 25,
    onFailure(reason) { failures.push(reason); }
  }), true);
  timers.shift().callback();
  assert.equal(calls.length, 2, "a missing ready token must rebuild exactly once");
  assert.equal(panes["pane-1"].Visible, false);
  timers.shift().callback();
  assert.deepStrictEqual(failures, ["not-ready"]);
  assert.equal(panes["pane-2"].Visible, false);
}

{
  const { context, app } = createContext("file:///C:/plugin/index.html", "0.4.0");
  const failures = [];
  app.CreateTaskPane = () => null;
  assert.equal(context.MathTaskPanes.openPackaged({
    app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "license",
    onFailure(reason) { failures.push(reason); }
  }), true);
  assert.deepStrictEqual(failures, ["create-failed"], "two create failures must report once");
}

{
  const { context, app, values, panes } = createContext("file:///C:/plugin/index.html", "0.4.0");
  panes.legacy = { ID: "legacy", Visible: true };
  values.old_license_pane = "legacy";
  assert.equal(context.MathTaskPanes.openPackaged({
    app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "license",
    legacyKeys: ["old_license_pane"]
  }), true);
  assert.equal(panes.legacy.Visible, false);
  assert.equal(values.old_license_pane, "");
}

{
  const local = createContext("file:///C:/plugin/index.html", "0.4.0");
  assert.equal(local.context.MathTaskPanes.openPackaged({
    app: local.app,
    pluginBaseUrl: "file:///C:/different-root",
    role: "writer",
    name: "license"
  }), false);
  assert.equal(local.context.MathTaskPanes.openPackaged({
    app: local.app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "tool-center",
    view: "unknown"
  }), false);
  assert.equal(local.context.MathTaskPanes.openPackaged({
    app: local.app,
    pluginBaseUrl: "file:///C:/plugin",
    role: "writer",
    name: "../../remote"
  }), false);
  assert.equal(local.calls.length, 0);

  const remote = createContext("https://example.invalid/plugin/index.html", "0.4.0");
  assert.equal(remote.context.MathTaskPanes.openPackaged({
    app: remote.app,
    role: "writer",
    name: "license"
  }), false);
  assert.equal(remote.calls.length, 0);
}

{
  const url = "file:///C:/plugin/ui/tool-center-0.4.0.html?hsmPane=tool-center&hsmToken=ready-456&hsmHost=writer&hsmView=license";
  const { context, values } = createContext(url, "0.4.0");
  assert.equal(context.MathTaskPanes.signalReady("tool-center"), true);
  assert.equal(values[context.MathTaskPanes._private.storageKey("tool-center", "ready")], "ready-456");
}

{
  const url = "file:///C:/plugin/ui/license-0.4.0.html?hsmPane=license&hsmToken=ready-123&hsmHost=writer";
  const { context, values } = createContext(url, "0.4.0");
  assert.equal(context.MathTaskPanes.signalReady("license"), true);
  assert.equal(values[context.MathTaskPanes._private.storageKey("license", "ready")], "ready-123");
  assert.equal(context.MathTaskPanes.signalReady("function-plot"), false);
}

{
  const remote = createContext(
    "https://example.invalid/ui/license-0.4.0.html?hsmPane=license&hsmToken=ready-123&hsmHost=writer",
    "0.4.0"
  );
  assert.equal(remote.context.MathTaskPanes.signalReady("license"), false);
  const wrongFile = createContext(
    "file:///C:/plugin/ui/license.html?hsmPane=license&hsmToken=ready-123&hsmHost=writer",
    "0.4.0"
  );
  assert.equal(wrongFile.context.MathTaskPanes.signalReady("license"), false);
}

console.log("packaged file task-pane whitelist and readiness tests passed");
