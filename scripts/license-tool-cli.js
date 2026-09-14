const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const issuer = require("./license-issuer");

function publicKeyModulePath() {
  if (process.env.HSM_LICENSE_PUBLIC_KEY_MODULE) {
    return path.resolve(process.env.HSM_LICENSE_PUBLIC_KEY_MODULE);
  }
  const adjacent = path.join(__dirname, "license-public-key.js");
  return fs.existsSync(adjacent) ? adjacent : path.join(__dirname, "..", "js", "license-public-key.js");
}

function loadExpectedPublicKey() {
  const modulePath = publicKeyModulePath();
  if (!fs.existsSync(modulePath)) {
    throw new Error(`插件公钥文件不存在：${modulePath}`);
  }
  delete require.cache[require.resolve(modulePath)];
  const encoded = String(require(modulePath) || "").trim();
  const raw = Buffer.from(encoded, "base64");
  if (raw.length !== 32 || raw.toString("base64") !== encoded) {
    throw new Error("插件公钥格式无效，请重新构建发码工具。");
  }
  return { encoded, raw, modulePath };
}

function publicKeyFingerprint(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16).toUpperCase();
}

function historyPath(privateKeyPath) {
  return process.env.HSM_LICENSE_HISTORY_PATH || path.join(path.dirname(privateKeyPath), "issuance-history.csv");
}

function getStatus() {
  const expected = loadExpectedPublicKey();
  const privateKeyPath = issuer.defaultPrivateKeyPath();
  const result = {
    ok: true,
    keyExists: fs.existsSync(privateKeyPath),
    keyMatches: false,
    privateKeyPath,
    publicKeyModulePath: expected.modulePath,
    publicKeyFingerprint: publicKeyFingerprint(expected.raw),
    historyPath: historyPath(privateKeyPath),
    keyError: ""
  };

  if (!result.keyExists) return result;
  try {
    const actual = Buffer.from(issuer.publicKeyBase64(privateKeyPath), "base64");
    result.keyMatches = actual.length === expected.raw.length && crypto.timingSafeEqual(actual, expected.raw);
    if (!result.keyMatches) {
      result.keyError = "当前私钥与插件公钥不匹配，已禁止生成激活码。";
    }
  } catch (error) {
    result.keyError = `私钥无法读取：${error.message || String(error)}`;
  }
  return result;
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

function appendHistory(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const exists = fs.existsSync(filePath);
  const header = ["生成时间", "机器码", "授权类型", "起始日期", "到期日期", "激活码", "公钥指纹"];
  const row = [
    record.issuedAt,
    record.machineId,
    record.planLabel,
    record.startDate,
    record.expiresDisplay,
    record.code,
    record.publicKeyFingerprint
  ];
  const content = `${exists ? "" : `\uFEFF${header.map(csvCell).join(",")}\r\n`}${row.map(csvCell).join(",")}\r\n`;
  fs.appendFileSync(filePath, content, "utf8");
}

function issueLicense() {
  const status = getStatus();
  if (!status.keyExists) {
    throw new Error(`未找到发码私钥：${status.privateKeyPath}`);
  }
  if (!status.keyMatches) {
    throw new Error(status.keyError || "当前私钥与插件公钥不匹配。");
  }

  const machineId = issuer.normalizeMachineId(process.env.HSM_TOOL_MACHINE_ID);
  const plan = issuer.normalizePlan(process.env.HSM_TOOL_PLAN);
  const startDate = String(process.env.HSM_TOOL_START_DATE || "").trim();
  if (!/^HSM[A-Z0-9]{10}$/.test(machineId)) {
    throw new Error("机器码格式不正确，应为 HSM 加 10 位字母或数字。");
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("起始日期格式不正确，应为 yyyy-MM-dd。");
  }

  const code = issuer.createLicenseCode(machineId, plan, startDate || undefined, status.privateKeyPath);
  const parsed = issuer.parseLicenseCode(code);
  if (!parsed) throw new Error("生成的激活码格式校验失败。");
  const expiresDisplay = parsed.expires === "PERMANENT"
    ? "永久有效"
    : `${parsed.expires.slice(0, 4)}-${parsed.expires.slice(4, 6)}-${parsed.expires.slice(6, 8)}`;
  const record = {
    issuedAt: new Date().toISOString(),
    machineId,
    plan,
    planLabel: issuer.PLAN_LABELS[plan],
    startDate: startDate || new Date().toISOString().slice(0, 10),
    expires: parsed.expires,
    expiresDisplay,
    code,
    publicKeyFingerprint: status.publicKeyFingerprint,
    historyPath: status.historyPath
  };
  appendHistory(status.historyPath, record);
  return { ok: true, ...record };
}

function writeResult(result, exitCode) {
  process.stdout.write(JSON.stringify(result));
  process.exitCode = exitCode;
}

try {
  const command = String(process.argv[2] || "status").toLowerCase();
  if (command === "status") {
    writeResult(getStatus(), 0);
  } else if (command === "issue") {
    writeResult(issueLicense(), 0);
  } else {
    throw new Error(`不支持的命令：${command}`);
  }
} catch (error) {
  writeResult({ ok: false, error: error.message || String(error) }, 1);
}
