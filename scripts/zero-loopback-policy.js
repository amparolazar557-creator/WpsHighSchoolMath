"use strict";

const fs = require("fs");
const path = require("path");

const ALLOWED_XML_NAMESPACES = new Set([
  "http://schemas.microsoft.com/office/2006/01/customui",
  "http://www.w3.org/2000/svg"
]);

const WRITER_SOURCE_FILES = [
  "index.html",
  "main.js",
  "manifest.xml",
  "ribbon.xml",
  "assets/wechat-qr.jpg",
  "assets/wechat-qr.svg",
  "js/symbols.js",
  "js/taskpane.js",
  "js/license-public-key.js",
  "js/license.js",
  "js/vendor/tweetnacl-fast.min.js",
  "js/vendor/TWEETNACL-LICENSE.txt",
  "js/plot-config.js",
  "js/plot-analysis.js",
  "js/plotter.js",
  "js/plot-library.js",
  "js/function-plot-document.js",
  "js/function-plot-native.js",
  "js/ribbon.js",
  "ui/function-plot.css",
  "ui/function-plot.html",
  "ui/function-plot.js",
  "ui/function-analysis.js",
  "ui/function-plot-entry.js",
  "ui/license.css",
  "ui/license.html",
  "ui/license-entry.js",
  "ui/license-ui.js",
  "ui/tool-center.css",
  "ui/tool-center.html",
  "ui/tool-center.js"
];

const PPT_SOURCE_FILES = [
  "index.html",
  "main.js",
  "manifest.xml",
  "ribbon.xml",
  "assets/wechat-qr.jpg",
  "assets/wechat-qr.svg",
  "js/symbols.js",
  "js/ppt-api.js",
  "js/taskpane.js",
  "js/license-public-key.js",
  "js/license.js",
  "js/vendor/tweetnacl-fast.min.js",
  "js/vendor/TWEETNACL-LICENSE.txt",
  "js/plot-config.js",
  "js/plot-analysis.js",
  "js/plotter.js",
  "js/plot-library.js",
  "js/function-plot-document.js",
  "js/function-plot-native.js",
  "js/ribbon-ppt.js",
  "ui/function-plot.css",
  "ui/function-plot.html",
  "ui/function-plot.js",
  "ui/function-analysis.js",
  "ui/function-plot-entry.js",
  "ui/license.css",
  "ui/license.html",
  "ui/license-entry.js",
  "ui/license-ui.js",
  "ui/tool-center.css",
  "ui/tool-center.html",
  "ui/tool-center.js"
];

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".json", ".xml", ".html", ".htm", ".svg",
  ".css", ".ps1", ".psm1", ".psd1", ".cmd", ".bat", ".cs", ".txt"
]);

const URL_PROPERTIES = "src|href|action|formAction|formaction|poster|data";
const SOURCE_EXCLUDED_DIRECTORIES = new Set([
  ".git", ".playwright-cli", "node_modules", "tests", "specs", "migration",
  "evidence", "archive", "history", "release"
]);

const BANNED_TERMS = [
  "openLocalEditor",
  "OAAssist",
  "ShellExecute",
  "CreateWebDialog",
  "GetWebDialog",
  "ShowDialog",
  "XMLHttpRequest",
  "fetch",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "mozRTCPeerConnection",
  "ActiveXObject",
  "WinHttpRequest",
  "WScript.Shell"
];

const LOOPBACK_PATTERNS = [
  ["loopback-localhost", /localhost/i],
  ["loopback-ipv4", /(?:^|[^0-9])127(?:\.[0-9]{1,3}){1,3}(?:[^0-9]|$)/i],
  ["loopback-ipv6", /(?:^|[^0-9a-f])::1(?:[^0-9a-f]|$)/i],
  ["loopback-ipv4-mapped", /::ffff:127(?:\.[0-9]{1,3}){1,3}/i],
  ["loopback-decimal", /(?:^|[^0-9])2130706433(?:[^0-9]|$)/i],
  ["loopback-hex", /(?:^|[^0-9a-f])0x7f000001(?:[^0-9a-f]|$)/i],
  ["loopback-octal", /(?:^|[^0-9])0177\.0\.0\.1(?:[^0-9]|$)/i],
  ["loopback-unspecified", /(?:^|[^0-9])0\.0\.0\.0(?:[^0-9]|$)/i]
];

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function lineAt(source, index) {
  return source.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function makeViolation(rule, file, detail, source, index) {
  return {
    rule,
    file: normalizeRelative(file || "."),
    line: source && Number.isFinite(index) ? lineAt(source, index) : null,
    detail
  };
}

function decodeEscapeSequence(source, index) {
  const marker = source[index];
  const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
  if (Object.prototype.hasOwnProperty.call(simple, marker)) {
    return { value: simple[marker], end: index + 1 };
  }
  if (marker === "x" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
    return { value: String.fromCharCode(parseInt(source.slice(index + 1, index + 3), 16)), end: index + 3 };
  }
  if (marker === "u") {
    if (source[index + 1] === "{") {
      const close = source.indexOf("}", index + 2);
      const codePointText = close >= 0 ? source.slice(index + 2, close) : "";
      if (/^[0-9a-f]{1,6}$/i.test(codePointText)) {
        return { value: String.fromCodePoint(parseInt(codePointText, 16)), end: close + 1 };
      }
    }
    if (/^[0-9a-f]{4}$/i.test(source.slice(index + 1, index + 5))) {
      return { value: String.fromCharCode(parseInt(source.slice(index + 1, index + 5), 16)), end: index + 5 };
    }
  }
  if (marker === "\r" && source[index + 1] === "\n") {
    return { value: "", end: index + 2 };
  }
  if (marker === "\r" || marker === "\n") {
    return { value: "", end: index + 1 };
  }
  return { value: marker || "", end: index + 1 };
}

function tokenizeStaticStrings(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if (char === "+") {
      tokens.push({ type: "plus", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      const quote = char;
      const start = index;
      let value = "";
      let isStatic = true;
      index += 1;
      while (index < source.length) {
        if (source[index] === quote) {
          index += 1;
          break;
        }
        if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
          isStatic = false;
        }
        if (source[index] === "\\") {
          const decoded = decodeEscapeSequence(source, index + 1);
          value += decoded.value;
          index = decoded.end;
        } else {
          value += source[index];
          index += 1;
        }
      }
      tokens.push({ type: isStatic ? "string" : "other", start, end: index, value });
      continue;
    }
    const start = index;
    index += 1;
    while (index < source.length && !/[\s+'"`]/.test(source[index])) {
      if (source[index] === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) break;
      index += 1;
    }
    tokens.push({ type: "other", start, end: index });
  }
  return tokens;
}

function foldStaticConcatenations(source) {
  const tokens = tokenizeStaticStrings(source);
  const replacements = [];
  const literalValues = [];
  const concatenatedValues = [];
  for (const token of tokens) {
    if (token.type === "string") literalValues.push(token.value);
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "string") continue;
    let cursor = index;
    let value = tokens[index].value;
    while (tokens[cursor + 1] && tokens[cursor + 2] &&
      tokens[cursor + 1].type === "plus" && tokens[cursor + 2].type === "string") {
      value += tokens[cursor + 2].value;
      cursor += 2;
    }
    if (cursor > index) {
      replacements.push({ start: tokens[index].start, end: tokens[cursor].end, value });
      concatenatedValues.push(value);
      index = cursor;
    }
  }
  let folded = source;
  for (const replacement of replacements.slice().sort((left, right) => right.start - left.start)) {
    folded = folded.slice(0, replacement.start) + JSON.stringify(replacement.value) + folded.slice(replacement.end);
  }
  return { folded, literalValues, concatenatedValues };
}

function isAllowedRelativeUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.startsWith("#")) return true;
  if (normalized.startsWith("//") || normalized.startsWith("\\\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  return true;
}

function maskAllowedNamespaceAttributes(source) {
  return source.replace(
    /xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi,
    (match, quote, value) => ALLOWED_XML_NAMESPACES.has(value) ? " ".repeat(match.length) : match
  );
}

function addUniqueViolation(violations, violation) {
  if (!violations.some(item => item.rule === violation.rule && item.file === violation.file &&
    item.line === violation.line && item.detail === violation.detail)) {
    violations.push(violation);
  }
}

function scanText(source, options = {}) {
  const file = options.file || "inline.js";
  const extension = path.extname(file).toLowerCase();
  const profile = options.profile || "directory";
  const violations = [];
  const foldedResult = foldStaticConcatenations(source);
  const views = [source, foldedResult.folded]
    .concat(foldedResult.literalValues)
    .concat(foldedResult.concatenatedValues);

  for (const [rule, expression] of LOOPBACK_PATTERNS) {
    const matchedView = views.find(view => expression.test(view));
    if (matchedView !== undefined) {
      const match = expression.exec(matchedView);
      const sourceIndex = source.toLowerCase().indexOf((match && match[0] || "").trim().toLowerCase());
      addUniqueViolation(violations, makeViolation(rule, file, "检测到本机回环地址或其等价写法。", source, sourceIndex));
    }
  }

  for (const term of BANNED_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?:[^A-Za-z0-9_$]|$)`, "i");
    if (views.some(view => expression.test(view))) {
      const sourceIndex = source.toLowerCase().indexOf(term.toLowerCase());
      addUniqueViolation(violations, makeViolation(
        "forbidden-api",
        file,
        `检测到正式运行链路禁止的 API/标识符：${term}。`,
        source,
        sourceIndex
      ));
    }
  }

  const createTaskPaneExpression = /(?:^|[^A-Za-z0-9_$])CreateTaskPane(?:[^A-Za-z0-9_$]|$)/i;
  const normalizedFile = normalizeRelative(file).toLowerCase();
  const isThirdPartyLicenseText = /(^|\/)js\/vendor\/tweetnacl-license\.txt$/.test(normalizedFile);
  if (!/(^|\/)js\/taskpane\.js$/.test(normalizedFile) && views.some(view => createTaskPaneExpression.test(view))) {
    const sourceIndex = source.toLowerCase().indexOf("createtaskpane");
    addUniqueViolation(violations, makeViolation(
      "forbidden-api",
      file,
      "CreateTaskPane 只允许出现在受限的 js/taskpane.js 管理器中。",
      source,
      sourceIndex
    ));
  }

  const legacyEditorHostExpression = /(?:^|[^A-Za-z0-9_$])WpsHighSchoolMathEditorHost(?:[^A-Za-z0-9_$]|$)/i;
  if (views.some(view => legacyEditorHostExpression.test(view))) {
    const cleanupScript = /(^|\/)(?:offline-)?(?:install|uninstall)\.ps1$/.test(normalizedFile);
    const legacyMentions = source.match(/WpsHighSchoolMathEditorHost/gi) || [];
    const cleanupOnly = cleanupScript && legacyMentions.length === 1 &&
      /Get-Process\s+-Name\s+["']WpsHighSchoolMathEditorHost["']/i.test(source);
    if (!cleanupOnly) {
      const sourceIndex = source.toLowerCase().indexOf("wpshighschoolmatheditorhost");
      addUniqueViolation(violations, makeViolation(
        "forbidden-api",
        file,
        "WpsHighSchoolMathEditorHost 只允许在安装或卸载脚本中作为遗留进程清理目标。",
        source,
        sourceIndex
      ));
    }
  }

  const namespaceExpression = /xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(["'])([^"']+)\1/gi;
  let namespaceMatch;
  while ((namespaceMatch = namespaceExpression.exec(foldedResult.folded))) {
    if (!ALLOWED_XML_NAMESPACES.has(namespaceMatch[2])) {
      addUniqueViolation(violations, makeViolation(
        "xml-namespace",
        file,
        `不允许的 XML 命名空间：${namespaceMatch[2]}。`,
        source,
        namespaceMatch.index
      ));
    }
  }

  const withoutAllowedNamespaces = maskAllowedNamespaceAttributes(foldedResult.folded);
  const absoluteUrlExpression = /(?:https?|wss?|ftp|file):\/\/[^\s"'<>]+|(?:^|[\s"'(=])\/\/[A-Za-z0-9.-]+/gi;
  let absoluteMatch;
  while ((absoluteMatch = absoluteUrlExpression.exec(withoutAllowedNamespaces))) {
    const absoluteValue = absoluteMatch[0].trim();
    if (isThirdPartyLicenseText) {
      continue;
    }
    if (/(^|\/)js\/taskpane\.js$/.test(normalizedFile) && /^file:\/\/\/$/i.test(absoluteValue)) {
      continue;
    }
    addUniqueViolation(violations, makeViolation(
      "absolute-url",
      file,
      `生产文件只能使用相对路径；检测到绝对 URL：${absoluteValue}。`,
      source,
      absoluteMatch.index
    ));
  }

  if ([".html", ".htm", ".xml", ".svg"].includes(extension)) {
    const attributeExpression = new RegExp(`\\b(${URL_PROPERTIES})\\s*=\\s*(["'])([^"']*)\\2`, "gi");
    let attributeMatch;
    while ((attributeMatch = attributeExpression.exec(foldedResult.folded))) {
      if (!isAllowedRelativeUrl(attributeMatch[3])) {
        addUniqueViolation(violations, makeViolation(
          "remote-dom-url",
          file,
          `DOM 属性 ${attributeMatch[1]} 只能引用相对文件路径。`,
          source,
          attributeMatch.index
        ));
      }
    }
  }

  if ([".js", ".mjs", ".cjs", ".html", ".htm"].includes(extension)) {
    const assignmentExpression = new RegExp(
      `(?:\\.\\s*(${URL_PROPERTIES})|\\[\\s*["'](${URL_PROPERTIES})["']\\s*\\])\\s*=\\s*([^;\\r\\n]+)`,
      "gi"
    );
    let assignmentMatch;
    while ((assignmentMatch = assignmentExpression.exec(foldedResult.folded))) {
      const property = assignmentMatch[1] || assignmentMatch[2];
      const rightSide = assignmentMatch[3].trim();
      const quoted = /^(["'])([\s\S]*?)\1\s*$/.exec(rightSide);
      if (!quoted || !isAllowedRelativeUrl(quoted[2])) {
        addUniqueViolation(violations, makeViolation(
          "dom-url-setter",
          file,
          `运行时 DOM URL 属性 ${property} 必须赋确定的相对路径。`,
          source,
          assignmentMatch.index
        ));
      }
    }
    const setAttributeExpression = new RegExp(
      `\\.setAttribute\\s*\\(\\s*["'](${URL_PROPERTIES})["']\\s*,\\s*([^,\\)]+)`,
      "gi"
    );
    let setAttributeMatch;
    while ((setAttributeMatch = setAttributeExpression.exec(foldedResult.folded))) {
      const rightSide = setAttributeMatch[2].trim();
      const quoted = /^(["'])([\s\S]*?)\1\s*$/.exec(rightSide);
      if (!quoted || !isAllowedRelativeUrl(quoted[2])) {
        addUniqueViolation(violations, makeViolation(
          "dom-url-setter",
          file,
          `setAttribute(${setAttributeMatch[1]}) 必须使用确定的相对路径。`,
          source,
          setAttributeMatch.index
        ));
      }
    }
  }

  if (profile === "bootstrapper" && [".ps1", ".psm1", ".cmd", ".bat", ".cs"].includes(extension)) {
    const installerRules = [
      ["installer-network-api", /\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpListener|TcpListener)\b/i],
      ["installer-port-parameter", /(?:--?|\/)\s*(?:port|listen|listener|bind)\b|\b(?:candidatePort|listen|listener|bind)\s*\(/i],
      ["installer-self-elevation", /\bStart-Process\b/i]
    ];
    for (const [rule, expression] of installerRules) {
      const match = expression.exec(foldedResult.folded);
      if (match) {
        addUniqueViolation(violations, makeViolation(
          rule,
          file,
          `安装器解包脚本包含禁止的联网、监听或自提权路径：${match[0]}。`,
          source,
          match.index
        ));
      }
    }
  }

  return violations;
}

function walkFiles(root, options = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  function visit(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryRelative = normalizeRelative(path.join(relative, entry.name));
      if (entry.isDirectory()) {
        if (options.excludedDirectories && options.excludedDirectories.has(entry.name.toLowerCase())) continue;
        visit(path.join(current, entry.name), entryRelative);
      } else if (entry.isFile()) {
        files.push(entryRelative);
      }
    }
  }
  visit(root, "");
  return files.sort((left, right) => left.localeCompare(right));
}

function isForbiddenPayloadFile(relativePath, profile) {
  const normalized = normalizeRelative(relativePath).toLowerCase();
  if (/(^|\/)entry\.js$/.test(normalized)) return "entry.js";
  if (/(^|\/)runtime(?:\/|$)/.test(normalized)) return "runtime/**";
  if (/wpshighschoolmatheditorhost/i.test(normalized)) return "WpsHighSchoolMathEditorHost";
  if (profile !== "source" && /\.(?:exe|dll)$/i.test(normalized)) return "payload 内二进制";
  return "";
}

function readTextFile(fullPath) {
  const stat = fs.statSync(fullPath);
  if (stat.size > 8 * 1024 * 1024) {
    throw new Error(`文本文件超过 8 MB 扫描上限：${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf8");
}

function scanFiles(root, relativeFiles, profile, violations) {
  for (const relativeFile of relativeFiles) {
    const fullPath = path.join(root, ...normalizeRelative(relativeFile).split("/"));
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(relativeFile).toLowerCase())) continue;
    const source = readTextFile(fullPath);
    for (const violation of scanText(source, { file: relativeFile, profile })) {
      addUniqueViolation(violations, violation);
    }
  }
}

function enforceWhitelist(actualFiles, expectedFiles, options, violations) {
  const expected = new Set(expectedFiles.map(item => normalizeRelative(item).toLowerCase()));
  const optional = new Set((options.optionalFiles || []).map(item => normalizeRelative(item).toLowerCase()));
  const actual = new Set(actualFiles.map(item => normalizeRelative(item).toLowerCase()));
  for (const required of expected) {
    if (!actual.has(required)) {
      addUniqueViolation(violations, makeViolation("missing-whitelist-file", required, "生产白名单文件缺失。"));
    }
  }
  for (const file of actualFiles) {
    const normalized = normalizeRelative(file).toLowerCase();
    if (!expected.has(normalized) && !optional.has(normalized)) {
      addUniqueViolation(violations, makeViolation("extra-file", file, "文件不在该载荷的精确白名单中。"));
    }
  }
}

function detectHost(root) {
  if (fs.existsSync(path.join(root, "js", "ribbon-ppt.js"))) return "ppt";
  const manifestPath = path.join(root, "manifest.xml");
  if (fs.existsSync(manifestPath) && /WpsHighSchoolMathPpt/i.test(fs.readFileSync(manifestPath, "utf8"))) return "ppt";
  return "writer";
}

function scanPayloadDirectory(root, options = {}) {
  const profile = options.profile || "staging";
  const violations = [];
  const files = walkFiles(root);
  const host = options.host || detectHost(root);
  const expected = (options.whitelist || (host === "ppt" ? PPT_SOURCE_FILES : WRITER_SOURCE_FILES)).slice();
  const payloadManifestPath = path.join(root, "PAYLOAD-MANIFEST.json");
  if (fs.existsSync(payloadManifestPath)) {
    try {
      const payloadManifest = JSON.parse(fs.readFileSync(payloadManifestPath, "utf8"));
      const safeVersion = String(payloadManifest.version || "").replace(/[^A-Za-z0-9._-]/g, "_");
      if (safeVersion) {
        expected.push(
          `ui/function-plot-${safeVersion}.html`,
          `ui/license-${safeVersion}.html`,
          `ui/tool-center-${safeVersion}.html`
        );
      }
    } catch (_) {
      addUniqueViolation(violations, makeViolation("invalid-payload-manifest", "PAYLOAD-MANIFEST.json", "无法读取载荷版本白名单。"));
    }
  }
  const optional = profile === "installed" ? [] : ["PAYLOAD-MANIFEST.json"];
  enforceWhitelist(files, expected.concat(profile === "installed" ? ["PAYLOAD-MANIFEST.json"] : []), { optionalFiles: optional }, violations);
  for (const file of files) {
    const forbidden = isForbiddenPayloadFile(file, profile);
    if (forbidden) {
      addUniqueViolation(violations, makeViolation("forbidden-file", file, `正式载荷禁止文件：${forbidden}。`));
    }
  }
  scanFiles(root, files, profile, violations);
  return { profile, root: path.resolve(root), host, filesScanned: files.length, violations };
}

function scanSource(root, options = {}) {
  const violations = [];
  const writerFiles = WRITER_SOURCE_FILES;
  const pptFiles = PPT_SOURCE_FILES.map(file => ["index.html", "main.js", "manifest.xml", "ribbon.xml"].includes(file) ? `ppt/${file}` : file);
  const productionFiles = Array.from(new Set(writerFiles.concat(pptFiles))).sort();
  const allSourceFiles = walkFiles(root, { excludedDirectories: SOURCE_EXCLUDED_DIRECTORIES });

  for (const file of productionFiles) {
    if (!fs.existsSync(path.join(root, ...file.split("/")))) {
      addUniqueViolation(violations, makeViolation("missing-whitelist-file", file, "设计白名单中的生产源码尚不存在。"));
    }
  }
  for (const file of allSourceFiles) {
    const forbidden = isForbiddenPayloadFile(file, "source");
    if (forbidden) {
      addUniqueViolation(violations, makeViolation("forbidden-file", file, `生产源码区包含禁止文件：${forbidden}。`));
    }
  }
  scanFiles(root, productionFiles, "source", violations);
  return { profile: "source", root: path.resolve(root), filesScanned: productionFiles.length, violations };
}

function loadCustomWhitelist(whitelistPath, profile, host) {
  if (!whitelistPath) return null;
  const source = fs.readFileSync(whitelistPath, "utf8");
  if (path.extname(whitelistPath).toLowerCase() !== ".json") {
    return source.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  }
  const parsed = JSON.parse(source);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.files)) return parsed.files;
  if (parsed && parsed[profile] && Array.isArray(parsed[profile])) return parsed[profile];
  if (parsed && parsed[host] && Array.isArray(parsed[host])) return parsed[host];
  throw new Error("白名单 JSON 必须是字符串数组，或包含 files/profile/host 数组。 ");
}

function scanRecursiveDirectory(root, options = {}) {
  const profile = options.profile || "directory";
  const violations = [];
  const files = walkFiles(root);
  if (options.whitelist) {
    enforceWhitelist(files, options.whitelist, {}, violations);
  }
  for (const file of files) {
    const forbidden = isForbiddenPayloadFile(file, profile);
    if (forbidden) {
      addUniqueViolation(violations, makeViolation("forbidden-file", file, `生产目录包含禁止文件：${forbidden}。`));
    }
  }
  scanFiles(root, files, profile, violations);
  return { profile, root: path.resolve(root), filesScanned: files.length, violations };
}

function scanPackageTree(root, options = {}) {
  const base = scanRecursiveDirectory(root, options);
  const payloadRoot = path.join(root, "payload");
  if (!fs.existsSync(payloadRoot) || !fs.statSync(payloadRoot).isDirectory()) return base;
  for (const entry of fs.readdirSync(payloadRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const payloadPath = path.join(payloadRoot, entry.name);
    const result = scanPayloadDirectory(payloadPath, { profile: options.profile });
    for (const violation of result.violations) {
      const prefixed = Object.assign({}, violation, { file: normalizeRelative(path.join("payload", entry.name, violation.file)) });
      addUniqueViolation(base.violations, prefixed);
    }
  }
  return base;
}

function scanTarget(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const profile = options.profile || "source";
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`扫描根目录不存在：${root}`);
  }
  if (profile === "source") return scanSource(root, options);
  const whitelist = options.whitelistPath ? loadCustomWhitelist(options.whitelistPath, profile, options.host) : options.whitelist;
  if (profile === "staging" || profile === "installed") {
    if (fs.existsSync(path.join(root, "payload"))) {
      return scanPackageTree(root, { profile, whitelist });
    }
    return scanPayloadDirectory(root, { profile, host: options.host, whitelist });
  }
  if (profile === "bootstrapper") {
    return scanPackageTree(root, { profile, whitelist });
  }
  if (profile === "directory") {
    return scanRecursiveDirectory(root, { profile, whitelist });
  }
  throw new Error(`未知扫描 profile：${profile}`);
}

function parseArguments(argv) {
  const options = { root: process.cwd(), profile: "source", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = argv[++index];
    else if (argument === "--profile") options.profile = argv[++index];
    else if (argument === "--host") options.host = argv[++index];
    else if (argument === "--whitelist") options.whitelistPath = argv[++index];
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function usage() {
  return [
    "零 localhost/回环策略扫描器",
    "",
    "用法：node scripts/zero-loopback-policy.js --profile <source|staging|bootstrapper|installed|directory> --root <目录>",
    "可选：--host <writer|ppt> --whitelist <JSON或逐行清单> --json",
    "",
    "source       扫描仓库中的 Writer/PPT 设计白名单，并拒绝生产区禁用文件",
    "staging      扫描单一暂存 payload，或包含 payload/ 的安装暂存根",
    "bootstrapper 扫描 bootstrapper 解包根、安装脚本及其中的 payload/",
    "installed    严格扫描单一安装后 payload（要求 PAYLOAD-MANIFEST.json）",
    "directory    扫描任意正反夹具目录，不强制内置 payload 白名单"
  ].join("\n");
}

function runCli(argv) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const result = scanTarget(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.violations.length === 0) {
      process.stdout.write(`零回环策略通过：${result.profile}，扫描 ${result.filesScanned} 个文件。\n`);
    } else {
      process.stderr.write(`零回环策略拒绝：${result.profile}，发现 ${result.violations.length} 项。\n`);
      for (const violation of result.violations) {
        const location = violation.line ? `${violation.file}:${violation.line}` : violation.file;
        process.stderr.write(`- [${violation.rule}] ${location} ${violation.detail}\n`);
      }
    }
    return result.violations.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`零回环策略扫描失败：${error.message}\n`);
    return 2;
  }
}

module.exports = {
  ALLOWED_XML_NAMESPACES,
  WRITER_SOURCE_FILES,
  PPT_SOURCE_FILES,
  foldStaticConcatenations,
  scanText,
  scanTarget,
  runCli
};

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
