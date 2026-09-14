const issuer = require("./license-issuer");

function usage() {
  console.log([
    "Usage:",
    "  node scripts/license-code.js <machine-code> <month|quarter|year|permanent> [start-date]",
    "",
    "For renewal, use the customer's current expiry date as start-date.",
    "This makes the new period continue from the original expiry date.",
    "",
    "Examples:",
    "  node scripts/license-code.js HSMABC1234567 month",
    "  node scripts/license-code.js HSMABC1234567 quarter 2026-06-18",
    "  node scripts/license-code.js HSMABC1234567 permanent"
  ].join("\n"));
}

const machineCode = process.argv[2];
const planInput = process.argv[3];
const issuedAt = process.argv[4];

if (!machineCode || !planInput) {
  usage();
  process.exit(1);
}

try {
  const plan = issuer.normalizePlan(planInput);
  const code = issuer.createLicenseCode(machineCode, plan, issuedAt);
  const parsed = issuer.parseLicenseCode(code);
  console.log(`机器码: ${issuer.normalizeMachineId(machineCode)}`);
  console.log(`类型: ${issuer.PLAN_LABELS[plan] || plan}`);
  console.log(`有效期: ${parsed.expires === "PERMANENT" ? "永久有效" : parsed.expires}`);
  console.log(`激活码: ${code}`);
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exit(1);
}
