"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const scannerPath = path.join(projectRoot, "scripts", "zero-loopback-policy.js");
const {
  WRITER_SOURCE_FILES,
  PPT_SOURCE_FILES,
  foldStaticConcatenations,
  scanText,
  scanTarget
} = require(scannerPath);

const fixturesRoot = path.join(__dirname, "fixtures", "zero-loopback");

function rulesFor(source, file = "fixture.js", profile = "directory") {
  return new Set(scanText(source, { file, profile }).map(item => item.rule));
}

function writeFixture(root, relativePath, content) {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, "utf8");
}

function createNativePayload(root, host, includeManifest) {
  const files = host === "ppt" ? PPT_SOURCE_FILES : WRITER_SOURCE_FILES;
  for (const file of files) {
    let content = "\"use strict\";\n";
    if (file === "index.html") {
      content = "<!DOCTYPE html><html><head><script src=\"./main.js\"></script></head><body></body></html>\n";
    } else if (file === "manifest.xml") {
      content = `<JsPlugin><Name>${host === "ppt" ? "WpsHighSchoolMathPpt" : "WpsHighSchoolMath"}</Name></JsPlugin>\n`;
    } else if (file === "ribbon.xml") {
      content = "<customUI xmlns=\"http://schemas.microsoft.com/office/2006/01/customui\"><ribbon /></customUI>\n";
    }
    writeFixture(root, file, content);
  }
  if (includeManifest) {
    writeFixture(root, "PAYLOAD-MANIFEST.json", "{\"schemaVersion\":3}\n");
  }
}

{
  const folded = foldStaticConcatenations("window['XML' + /* deliberate */ 'Http' + 'Request'];");
  assert(folded.folded.includes('"XMLHttpRequest"'), "static string concatenation must be folded");
  assert(folded.concatenatedValues.includes("XMLHttpRequest"));
}

for (const value of [
  "localhost",
  "LOCALHOST",
  "127.0.0.1",
  "127.1",
  "127.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "2130706433",
  "0x7f000001",
  "0177.0.0.1",
  "0.0.0.0"
]) {
  const rules = rulesFor(`var endpoint = "http://${value}:40123/";`);
  assert(
    Array.from(rules).some(rule => rule.startsWith("loopback-")),
    `loopback variant was not rejected: ${value}`
  );
}

for (const term of [
  "openLocalEditor", "WpsHighSchoolMathEditorHost", "OAAssist", "ShellExecute",
  "CreateTaskPane", "CreateWebDialog", "GetWebDialog", "ShowDialog", "XMLHttpRequest",
  "fetch", "WebSocket", "EventSource", "sendBeacon", "RTCPeerConnection",
  "webkitRTCPeerConnection", "mozRTCPeerConnection", "ActiveXObject",
  "WinHttpRequest", "WScript.Shell"
]) {
  const source = term === "fetch" ? "window.fetch('./relative');" : `window[${JSON.stringify(term)}]();`;
  assert(rulesFor(source).has("forbidden-api"), `forbidden API was not rejected: ${term}`);
}

{
  const dynamic = [
    "var endpoint = 'http' + '://' + '127.' + '0.0.1' + ':40123';",
    "var kind = window['XML' + 'Http' + 'Request'];",
    "window.Application['OAA' + 'ssist']['Shell' + 'Execute']('helper.exe');"
  ].join("\n");
  const rules = rulesFor(dynamic);
  assert(rules.has("loopback-ipv4"));
  assert(rules.has("forbidden-api"));
}

{
  assert.equal(scanText("image.src = './assets/icon.png';", { file: "allowed.js" }).length, 0);
  assert(rulesFor("image.src = target;", "dynamic-setter.js").has("dom-url-setter"));
  assert(rulesFor("image['s' + 'rc'] = 'https://example.invalid/a.png';", "concat-setter.js").has("dom-url-setter"));
  assert(rulesFor("image.setAttribute('src', value);", "attribute-setter.js").has("dom-url-setter"));
  assert(rulesFor("<img src=\"https://example.invalid/a.png\">", "remote.html").has("remote-dom-url"));
}

{
  const officeNamespace = "<customUI xmlns=\"http://schemas.microsoft.com/office/2006/01/customui\" />";
  const svgNamespace = "<svg xmlns=\"http://www.w3.org/2000/svg\" />";
  assert.equal(scanText(officeNamespace, { file: "ribbon.xml" }).length, 0);
  assert.equal(scanText(svgNamespace, { file: "icon.svg" }).length, 0);
  assert(rulesFor("<root xmlns=\"http://example.invalid/custom\" />", "bad.xml").has("xml-namespace"));
  assert(
    rulesFor("var namespace = 'http://www.w3.org/2000/svg';", "misplaced.js").has("absolute-url"),
    "an allowed namespace URL must still be rejected outside an XML namespace attribute"
  );
}

for (const source of [
  "Invoke-WebRequest https://example.invalid",
  "Invoke-RestMethod -Uri https://example.invalid",
  "$client = New-Object Net.WebClient",
  "$listener = [Net.HttpListener]::new()",
  "$tcp = [Net.Sockets.TcpListener]::new()",
  "powershell.exe install.ps1 --port 39000",
  "Start-Process powershell.exe"
]) {
  const rules = rulesFor(source, "install.ps1", "bootstrapper");
  assert(
    Array.from(rules).some(rule => rule.startsWith("installer-")),
    `bootstrapper script policy did not reject: ${source}`
  );
}

{
  const allowed = scanTarget({
    profile: "directory",
    root: path.join(fixturesRoot, "allowed-native")
  });
  assert.deepStrictEqual(allowed.violations, [], "the minimal WPS-native fixture must pass");

  const legacy = scanTarget({
    profile: "directory",
    root: path.join(fixturesRoot, "legacy-0.3.3-production")
  });
  const legacyRules = new Set(legacy.violations.map(item => item.rule));
  assert(legacyRules.has("forbidden-file"));
  assert(legacyRules.has("forbidden-api"));
  assert(Array.from(legacyRules).some(rule => rule.startsWith("loopback-")));

  const rejectedVariants = scanTarget({
    profile: "directory",
    root: path.join(fixturesRoot, "rejected-variants")
  });
  const rejectedRules = new Set(rejectedVariants.violations.map(item => item.rule));
  for (const requiredRule of ["forbidden-api", "absolute-url", "dom-url-setter", "remote-dom-url", "xml-namespace"]) {
    assert(rejectedRules.has(requiredRule), `negative fixtures did not exercise ${requiredRule}`);
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-zero-loopback-"));
try {
  const stagingWriter = path.join(tempRoot, "writer-staging");
  createNativePayload(stagingWriter, "writer", false);
  assert.deepStrictEqual(
    scanTarget({ profile: "staging", root: stagingWriter, host: "writer" }).violations,
    [],
    "a precise native Writer staging payload must pass"
  );

  const installedWriter = path.join(tempRoot, "writer-installed");
  createNativePayload(installedWriter, "writer", true);
  assert.deepStrictEqual(
    scanTarget({ profile: "installed", root: installedWriter, host: "writer" }).violations,
    [],
    "an installed Writer payload with its generated manifest must pass"
  );

  writeFixture(installedWriter, "unexpected.js", "\"use strict\";\n");
  assert(
    scanTarget({ profile: "installed", root: installedWriter, host: "writer" })
      .violations.some(item => item.rule === "extra-file"),
    "installed payload scans must reject extra files"
  );

  const bootstrapperRoot = path.join(tempRoot, "bootstrapper-expanded");
  createNativePayload(path.join(bootstrapperRoot, "payload", "writer"), "writer", true);
  createNativePayload(path.join(bootstrapperRoot, "payload", "ppt"), "ppt", true);
  writeFixture(bootstrapperRoot, "install.ps1", "Write-Output 'offline native install'\n");
  writeFixture(bootstrapperRoot, "uninstall.ps1", "Write-Output 'offline native uninstall'\n");
  assert.deepStrictEqual(
    scanTarget({ profile: "bootstrapper", root: bootstrapperRoot }).violations,
    [],
    "bootstrapper expanded resources and both payloads must be scannable"
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

{
  const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  if (/^0\.3\./.test(packageInfo.version)) {
    const currentSource = scanTarget({ profile: "source", root: projectRoot });
    assert(currentSource.violations.length > 0, "the current 0.3.x production source must be rejected");
    assert(currentSource.violations.some(item => item.rule === "forbidden-file"));
    assert(currentSource.violations.some(item => item.rule === "forbidden-api"));

    const currentStyleStaging = scanTarget({
      profile: "staging",
      root: path.join(fixturesRoot, "legacy-0.3.3-production"),
      host: "writer"
    });
    assert(currentStyleStaging.violations.length > 0, "the current 0.3.x staging shape must be rejected");
    assert(currentStyleStaging.violations.some(item => item.rule === "forbidden-file"));
  }
}

{
  const allowedCli = spawnSync(process.execPath, [
    scannerPath,
    "--profile", "directory",
    "--root", path.join(fixturesRoot, "allowed-native")
  ], { encoding: "utf8" });
  assert.equal(allowedCli.status, 0, allowedCli.stderr);

  const rejectedCli = spawnSync(process.execPath, [
    scannerPath,
    "--profile", "directory",
    "--root", path.join(fixturesRoot, "legacy-0.3.3-production")
  ], { encoding: "utf8" });
  assert.equal(rejectedCli.status, 1, "policy rejection must return a non-zero exit code");
}

console.log("zero-loopback static policy, fixtures, and profile tests passed");
