const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

if (!fs.existsSync(path + ".bak-snipe-split")) {
  fs.copyFileSync(path, path + ".bak-snipe-split");
}

const snipeBlock = String.raw`
function getManualSnipeChecks(analyzedItems, buySignals) {
  const buyIds = new Set(buySignals.map((item) => String(item.id)));

  const minProfit = Number(process.env.FLIPPER_SNIPE_MIN_PROFIT || 50000);
  const minSellPrice = Number(
    process.env.FLIPPER_SNIPE_MIN_SELL ||
      process.env.SNIPE_MIN_SELL_PRICE ||
      100000,
  );

  return analyzedItems
    .filter((item) => !buyIds.has(String(item.id)))
    .filter((item) => {
      const profit = getNumber(item.realisticProfit || item.profit);
      const sellPrice = getNumber(item.sellOffer || item.realisticExit || item.targetSell);
      const risk = getNumber(item.fakeSpreadRisk);
      const volume = getNumber(item.volumeRatio);
      const pressure = String(item.marketPressureLevel || "").toUpperCase();

      const expensiveEnough = sellPrice >= minSellPrice || profit >= minProfit;
      const meaningfulProfit = profit >= minProfit;
      const needsManualReview =
        risk >= 60 ||
        volume <= 0.25 ||
        pressure === "HIGH" ||
        pressure === "EXTREME" ||
        getNumber(item.brainScore) <= 25;

      return expensiveEnough && meaningfulProfit && needsManualReview;
    })
    .sort((a, b) => {
      const aProfit = getNumber(a.realisticProfit || a.profit);
      const bProfit = getNumber(b.realisticProfit || b.profit);
      return bProfit - aProfit;
    })
    .slice(0, 5);
}

function printManualSnipeChecks(analyzedItems, buySignals) {
  const items = getManualSnipeChecks(analyzedItems, buySignals);

  if (items.length === 0) return;

  console.log("\nMANUAL SNIPE CHECK / HIGH VALUE BUT RISKY");
  console.log("----------------------------------------");
  console.log("These are NOT automatic BUY signals. Open Tibia Market and verify manually.\n");

  items.forEach((item, index) => {
    const profit = getNumber(item.realisticProfit || item.profit);
    const profitPercent = getNumber(item.realisticProfitPercent || item.profitPercent);
    const sellPrice = getNumber(item.sellOffer || item.realisticExit || item.targetSell);

    const reasons = (item.rejectionReasons || ["manual verification required"])
      .slice(0, 4)
      .join(" | ");

    console.log(
      "#" + (index + 1) + " " + item.name + " (ID: " + item.id + ")\n" +
        "Possible profit: ~" + formatGp(profit) + " gp (" + profitPercent.toFixed(2) + "%)\n" +
        "Observed sell/reference: " + formatGp(sellPrice) + " gp\n" +
        "Risk: " + item.fakeSpreadRisk + "/100 | Volume: " + Number(item.volumeRatio || 0).toFixed(2) + "x" +
        " | Pressure: " + item.marketPressureLevel + "\n" +
        "Why manual only: " + reasons + "\n" +
        "Manual action: check real lowest sell, quantity, recent market history, and whether you can actually exit.\n",
    );
  });
}
`;

if (!text.includes("function getManualSnipeChecks")) {
  const marker = "function printNearMisses(analyzedItems, buySignals)";
  if (!text.includes(marker)) {
    throw new Error("Could not find printNearMisses marker.");
  }

  text = text.replace(marker, snipeBlock + "\n" + marker);
}

// Make Near Misses ignore items already classified as manual snipe.
if (!text.includes("manualSnipeIds")) {
  text = text.replace(
    "  const nearMisses = getNearMisses(analyzedItems, buySignals);",
    `  const manualSnipeIds = new Set(
    getManualSnipeChecks(analyzedItems, buySignals).map((item) => String(item.id)),
  );

  const nearMisses = getNearMisses(analyzedItems, buySignals)
    .filter((item) => !manualSnipeIds.has(String(item.id)));`
  );
}

// Print manual snipe section before regular near misses.
if (!text.includes("printManualSnipeChecks(analyzedItems, buySignals);")) {
  text = text.replace(
    "  printNearMisses(analyzedItems, buySignals);",
    "  printManualSnipeChecks(analyzedItems, buySignals);\n  printNearMisses(analyzedItems, buySignals);"
  );
}

fs.writeFileSync(path, text, "utf8");

console.log("Manual snipe split patch complete.");
