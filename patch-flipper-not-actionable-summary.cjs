const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function patchConstants() {
  const path = "lib/constants.js";
  let text = read(path);

  const replacement = `const DEBUG_REJECTION_ENV = String(
  process.env.FLIPS_DEBUG_REJECTIONS ||
    process.env.FLIPPER_DEBUG_REJECTIONS ||
    "false",
).toLowerCase();

export const FLIPS_DEBUG_REJECTIONS = ["1", "true", "yes", "y", "on"].includes(
  DEBUG_REJECTION_ENV,
);`;

  text = text.replace(
    /export const FLIPS_DEBUG_REJECTIONS =[\s\S]*?"true";/,
    replacement,
  );

  write(path, text);
}

function patchCheckFlips() {
  const path = "check-flips.js";
  let text = read(path);

  if (!text.includes("function printTrackedButNotActionableSummary")) {
    const helper = `
function printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals) {
  const buyIds = new Set(buySignals.map((item) => Number(item.id)));
  const sellIds = new Set(sellSignals.map((item) => Number(item.id)));

  const rows = analyzedItems
    .filter((item) => !buyIds.has(Number(item.id)))
    .filter((item) => !sellIds.has(Number(item.id)))
    .map((item) => {
      const reasons = Array.isArray(item.rejectionReasons) && item.rejectionReasons.length
        ? item.rejectionReasons.slice(0, 3).join(", ")
        : item.reason || "No BUY signal right now";

      const score =
        getNumber(item.brainScore) * 2 +
        getNumber(item.tradeabilityScore) * 2 +
        getNumber(item.profitPercent) * 3 +
        getNumber(item.profit) / 1000 -
        getNumber(item.fakeSpreadRisk) * 2 -
        (item.hasOpenPosition ? 100 : 0);

      return { item, reasons, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(process.env.FLIPPER_NOT_ACTIONABLE_LIMIT || 10));

  if (rows.length === 0) return;

  console.log("\\nTRACKED BUT NOT ACTIONABLE");
  console.log("--------------------------");

  rows.forEach(({ item, reasons }, index) => {
    const decision = item.decision || "UNKNOWN";
    const signalClass = item.signalClass || "REJECTED";
    const profit = formatGp(item.profit || 0);
    const roi = Number(item.profitPercent || 0).toFixed(2);

    console.log(
      \`\${index + 1}) \${item.name} (\${item.id})\\n\` +
        \`   Decision: \${decision} | Signal: \${signalClass}\\n\` +
        \`   Brain: \${item.brainScore ?? "?"}/100 | Tradeability: \${item.tradeabilityScore ?? "?"}/100\\n\` +
        \`   Profit: ~\${profit} gp ea | ROI: \${roi}%\\n\` +
        \`   Why no BUY: \${reasons}\\n\`,
    );
  });
}
`;

    const marker = "async function sendDiscordBuyAlerts(buySignals, state) {";
    if (!text.includes(marker)) throw new Error("Could not find sendDiscordBuyAlerts marker");
    text = text.replace(marker, helper + "\n" + marker);
  }

  if (!text.includes("printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals);")) {
    const marker = `  sellSignals.forEach((item) => {
    console.log(
      \`SELL \${item.name} (ID: \${item.id})\\n\` +
        \`Level: \${item.sellLevel}\\n\` +
        \`Current sell: \${item.sellOffer} | Target: \${item.trackedTargetSell}\\n\` +
        \`Brain: \${item.previousBrainScore} -> \${item.brainScore} | Drop: \${item.scoreDrop}\\n\` +
        \`Reason: \${item.sellReason}\\n\`,
    );
  });
`;

    if (!text.includes(marker)) {
      throw new Error("Could not find sellSignals console block");
    }

    text = text.replace(
      marker,
      marker + "\n  printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals);\n",
    );
  }

  write(path, text);
}

patchConstants();
patchCheckFlips();

console.log("Added tracked-but-not-actionable summary and flexible debug env support.");
