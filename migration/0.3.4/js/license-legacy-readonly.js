(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HsmLegacyLicenseReadonly = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // These constants and algorithms are frozen from the published 0.3.3 payload.
  var PRODUCT = "WpsHighSchoolMath";
  var SECRET = "WPS-HIGH-SCHOOL-MATH-LOCAL-LICENSE-2026";

  function pad(value, size) {
    var text = String(value);
    while (text.length < size) {
      text = "0" + text;
    }
    return text;
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function hashText(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  }

  function signature(machineId, plan, expires) {
    return pad(hashText(PRODUCT + "|" + machineId + "|" + plan + "|" + expires + "|" + SECRET), 7).slice(-7);
  }

  function parseLicenseCode(code) {
    var compact = normalizeCode(code);
    var match = /^HSM([MQYP])([0-9]{8}|PERMANENT)(HSM[A-Z0-9]{10})([A-Z0-9]{7})$/.exec(compact);
    if (!match) {
      return null;
    }
    return {
      plan: match[1],
      expires: match[2],
      machineId: match[3],
      signature: match[4]
    };
  }

  function isPermanent(expires) {
    return expires === "PERMANENT";
  }

  function expiryToDate(expires) {
    if (!/^[0-9]{8}$/.test(expires)) {
      return null;
    }
    return expires.slice(0, 4) + "-" + expires.slice(4, 6) + "-" + expires.slice(6, 8);
  }

  function daysBetween(startDate, endDate) {
    var start = new Date(startDate + "T00:00:00");
    var end = new Date(endDate + "T00:00:00");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return 0;
    }
    return Math.floor((end.getTime() - start.getTime()) / 86400000);
  }

  function isExpiredAt(expires, currentDate) {
    if (isPermanent(expires)) {
      return false;
    }
    var date = expiryToDate(expires);
    return !date || daysBetween(currentDate, date) < 0;
  }

  function validateLicenseCode(code, machineId, currentDate) {
    var normalizedMachineId = normalizeCode(machineId);
    var parsed = parseLicenseCode(code);
    if (!parsed) {
      return { valid: false, reason: "激活码格式不正确。", machineId: normalizedMachineId };
    }
    if (parsed.machineId !== normalizedMachineId) {
      return { valid: false, reason: "激活码与本机机器码不匹配。", machineId: normalizedMachineId };
    }
    if (parsed.signature !== signature(parsed.machineId, parsed.plan, parsed.expires)) {
      return { valid: false, reason: "激活码校验失败。", machineId: normalizedMachineId };
    }
    if (isExpiredAt(parsed.expires, currentDate)) {
      return { valid: false, reason: "激活码已经过期。", machineId: normalizedMachineId };
    }
    return { valid: true, license: parsed, machineId: normalizedMachineId };
  }

  // Inputs must already have passed validateLicenseCode. A positive result means
  // left is stronger; permanent wins, then the later expiration date wins.
  function compareLicenseStrength(left, right) {
    if (!left && !right) {
      return 0;
    }
    if (left && !right) {
      return 1;
    }
    if (!left && right) {
      return -1;
    }
    if (isPermanent(left.expires)) {
      return isPermanent(right.expires) ? 0 : 1;
    }
    if (isPermanent(right.expires)) {
      return -1;
    }
    if (left.expires === right.expires) {
      return 0;
    }
    return left.expires > right.expires ? 1 : -1;
  }

  return Object.freeze({
    sourceVersion: "0.3.3",
    normalizeCode: normalizeCode,
    hashText: hashText,
    signature: signature,
    parseLicenseCode: parseLicenseCode,
    isPermanent: isPermanent,
    expiryToDate: expiryToDate,
    daysBetween: daysBetween,
    isExpiredAt: isExpiredAt,
    validateLicenseCode: validateLicenseCode,
    compareLicenseStrength: compareLicenseStrength
  });
});
