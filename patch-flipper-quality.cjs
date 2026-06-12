const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

if (!fs.existsSync(path + ".bak-quality-upgrade")) {
  fs.copyFileSync(path, path + ".bak-quality-upgrade");
}

const helperBlock = String.raw`
function getBuyFee(price, qty) {
  return Math.ceil(Number(price || 0) * Number(qty || 0) * TAX_RATE);
}

function getFlipperQualityScore(item) {
  return Math.round(
    clamp(
      getNumber(item.brainScore) * 0.32 +
        getNumber(item.tradeabilityScore) * 0.28 +
        getNumber(item.volumeRatio) * 10 +
        getNumber(item.realisticProfitPercent || item.profitPercent) * 2.2 -
        getNumber(item.fakeSpreadRisk) * 0.35 -
        getNumber(item.marketPressure) * 0.18,
      0,
      100,
    ),
  );
}

function getFlipperQualityLabel(item) {
  const score = getFlipperQualityScore(item);

  if (score >= 85 && item.signalConfidence >= 85) return "ELITE";
  if (score >= 74) return "STRONG";
  if (score >= 62) return "DECENT";
  if (score >= 48) return "WATCH ONLY";
  return "WEAK";
}

function getCapitalPlan(item) {
  const qty = Number(item.recommendedQty || 1);
  const maxBuy = Number(item.maxRealisticBuy || item.maxBuy || item.buyOffer || 0);
  const sellTarget = Number(item.realisticExit || item.targetSell || item.sellOffer || 0);
  const buyFee = getBuyFee(maxBuy, qty);
  const capitalLocked = maxBuy * qty + buyFee;
  const expectedProfitTotal = Number(item.realisticProfit || item.profit || 0) * qty;

  return {
    qty,
    maxBuy,
    sellTarget,
    buyFee,
    capitalLocked,
    expectedProfitTotal,
  };
}

function getEntryRange(item) {
  const maxBuy = Number(item.maxRealisticBuy || item.maxBuy || item.buyOffer || 0);

  if (!maxBuy) {
    return {
      low: 0,
      high: 0,
      text: "unknown",
    };
  }

  const low = Math.max(1, Math.floor(maxBuy * 0.985));
  const high = maxBuy;

  return {
    low,
    high,
    text: low === high ? formatGp(high) + " gp" : formatGp(low) + "–" + formatGp(high) + " gp",
  };
}

function getManualChecks(item) {
  const checks = [];

  checks.push("Check that the lowest sell offer is real and not only 1 overpriced item.");
  checks.push("Check how many items are ahead of your buy offer.");

  if (getNumber(item.fakeSpreadRisk) >= 25) {
    checks.push("Fake spread risk is not tiny — verify manually before buying.");
  }

  if (getNumber(item.volumeRatio) < 1) {
    checks.push("Volume is below ideal — do not buy too much.");
  }

  if (["HIGH", "EXTREME"].includes(item.marketPressureLevel)) {
    checks.push("Seller pressure is high — be extra patient.");
  }

  if (item.fillSpeed?.label && !["VERY FAST", "FAST"].includes(item.fillSpeed.label)) {
    checks.push("Exit may not be fast — avoid overstock.");
  }

  return checks;
}

function buildQualityActionPlan(item) {
  const capital = getCapitalPlan(item);
  const entry = getEntryRange(item);
  const quality = getFlipperQualityLabel(item);
  const score = getFlipperQualityScore(item);
  const checks = getManualChecks(item);

  let action = "BUY OFFER OK";

  if (quality === "ELITE") action = "BUY OFFER OK — HIGH PRIORITY";
  else if (quality === "STRONG") action = "BUY OFFER OK — PATIENT";
  else if (quality === "DECENT") action = "SMALL TEST ONLY";
  else action = "WATCH ONLY";

  if (item.signalClass === "BUY_CANDIDATE") {
    action = "RESEARCH / SMALL TEST ONLY";
  }

  return {
    quality,
    score,
    action,
    entry,
    capital,
    checks,
  };
}

function getNearMissScore(item) {
  return (
    getNumber(item.brainScore) * 2 +
    getNumber(item.tradeabilityScore) * 1.8 +
    getNumber(item.realisticProfitPercent || item.profitPercent) * 3 +
    getNumber(item.realisticProfit || item.profit) / 600 -
    getNumber(item.fakeSpreadRisk) * 1.8 -
    getNumber(item.marketPressure) * 0.8
  );
}

function getNearMisses(analyzedItems, buySignals) {
  const buyIds = new Set(buySignals.map((item) => String(item.id)));

  return analyzedItems
    .filter((item) => !buyIds.has(String(item.id)))
    .filter((item) => Number(item.profit || 0) > 0)
    .filter((item) => Number(item.sellOffer || 0) > 0)
    .map((item) => ({
      item,
      score: getNearMissScore(item),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => item);
}

function printQualityBuySignal(item) {
  const plan = buildQualityActionPlan(item);

  console.log(
    "BUY " + item.name + " (ID: " + item.id + ")\n" +
      "Quality: " + plan.quality + " / " + plan.score + "/100 | Confidence: " + item.signalConfidence + "/100\n" +
      "Action: " + plan.action + "\n" +
      "Entry range: " + plan.entry.text + " | Hard max: " + formatGp(plan.capital.maxBuy) + " gp\n" +
      "Sell target: " + formatGp(plan.capital.sellTarget) + " gp | Qty: " + plan.capital.qty + "\n" +
      "Capital locked: ~" + formatGp(plan.capital.capitalLocked) + " gp including buy fee\n" +
      "Expected profit total: ~" + formatGp(plan.capital.expectedProfitTotal) + " gp\n" +
      "Profit each: " + formatGp(item.realisticProfit || item.profit) + " gp (" +
        Number(item.realisticProfitPercent || item.profitPercent || 0).toFixed(2) + "%)\n" +
      "Exit speed: " + (item.fillSpeed?.label || "UNKNOWN") + " | expected days: " + (item.fillSpeed?.days || "?") + "\n" +
      "Brain: " + item.brainScore + "/100 | Tradeability: " + item.tradeabilityScore + "/100 | Fake spread: " + item.fakeSpreadRisk + "/100\n" +
      "Reason: " + item.reason + "\n" +
      "Manual checks:\n- " + plan.checks.slice(0, 4).join("\n- ") + "\n",
  );
}

function printNearMisses(analyzedItems, buySignals) {
  const nearMisses = getNearMisses(analyzedItems, buySignals);

  if (nearMisses.length === 0) return;

  console.log("\nNEAR MISSES / WATCHLIST");
  console.log("-----------------------");

  nearMisses.forEach((item, index) => {
    const reasons = (item.rejectionReasons || ["unknown"])
      .slice(0, 3)
      .join(" | ");

    console.log(
      "#" + (index + 1) + " " + item.name + " (ID: " + item.id + ")\n" +
        "Brain: " + item.brainScore + " | Tradeability: " + item.tradeabilityScore +
        " | Profit: " + formatGp(item.realisticProfit || item.profit) + " gp (" +
        Number(item.realisticProfitPercent || item.profitPercent || 0).toFixed(2) + "%)\n" +
        "Risk: " + item.fakeSpreadRisk + " | Volume: " + Number(item.volumeRatio || 0).toFixed(2) + "x" +
        " | Pressure: " + item.marketPressureLevel + "\n" +
        "Why not BUY: " + reasons + "\n",
    );
  });
}
`;

if (!text.includes("function buildQualityActionPlan")) {
  const marker = "async function sendDiscordBuyAlerts";
  if (!text.includes(marker)) {
    throw new Error("Could not find sendDiscordBuyAlerts marker.");
  }

  text = text.replace(marker, helperBlock + "\n" + marker);
}

// Replace old console BUY print block with quality print.
// This targets the existing buySignals.forEach block.
const oldBuyConsoleBlock = /buySignals\.forEach\(\(item\) => \{\s*console\.log\([\s\S]*?`Reason: \$\{item\.reason\}\\n`,\s*\);\s*\}\);/m;

if (oldBuyConsoleBlock.test(text) && !text.includes("buySignals.forEach((item) => printQualityBuySignal(item));")) {
  text = text.replace(
    oldBuyConsoleBlock,
    "buySignals.forEach((item) => printQualityBuySignal(item));"
  );
}

// Add near misses after sell signals print block.
if (!text.includes("printNearMisses(analyzedItems, buySignals);")) {
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

  if (text.includes(marker)) {
    text = text.replace(marker, marker + "\n  printNearMisses(analyzedItems, buySignals);\n");
  } else {
    const fallback = "  if (\n    SEND_EMPTY_SUMMARY &&";
    if (!text.includes(fallback)) {
      throw new Error("Could not find place to add near misses.");
    }
    text = text.replace(fallback, "  printNearMisses(analyzedItems, buySignals);\n\n" + fallback);
  }
}

// Enrich Discord BUY embed by adding Quality Plan and Capital Plan fields.
if (!text.includes('name: "🎚️ QUALITY PLAN"')) {
  const actionField = `      {
        name: "👉 ACTION",
        value: \`Place BUY offer around **\${formatGp(item.maxRealisticBuy)} gp** or lower. Current top buy: \${formatGp(item.maxBuy)} gp.\`,
        inline: false,
      },`;

  const newActionFields = `      {
        name: "👉 ACTION",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "**" + plan.action + "**\\n" +
            "Entry range: **" + plan.entry.text + "**\\n" +
            "Hard max: **" + formatGp(plan.capital.maxBuy) + " gp**"
          );
        })(),
        inline: false,
      },
      {
        name: "🎚️ QUALITY PLAN",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "Quality: **" + plan.quality + "** (" + plan.score + "/100)\\n" +
            "Exit speed: **" + (item.fillSpeed?.label || "UNKNOWN") + "** / " + (item.fillSpeed?.days || "?") + " days\\n" +
            "Manual check: " + plan.checks[0]
          );
        })(),
        inline: false,
      },
      {
        name: "💼 CAPITAL",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "Qty: **" + plan.capital.qty + "**\\n" +
            "Locked: **~" + formatGp(plan.capital.capitalLocked) + " gp**\\n" +
            "Expected total profit: **~" + formatGp(plan.capital.expectedProfitTotal) + " gp**"
          );
        })(),
        inline: true,
      },`;

  if (text.includes(actionField)) {
    text = text.replace(actionField, newActionFields);
  } else {
    console.log("Warning: could not patch Discord ACTION field. Console quality upgrade still applied.");
  }
}

fs.writeFileSync(path, text, "utf8");

console.log("Flipper quality upgrade patch complete.");
