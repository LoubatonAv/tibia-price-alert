const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function patchScanner() {
  const path = "scanner.js";
  let text = read(path);

  if (!text.includes("SCANNER_PROMOTION_FILE")) {
    const helper = `
const SCANNER_PROMOTION_FILE =
  process.env.SCANNER_PROMOTION_FILE || "./scanner-candidates.json";
const SCANNER_PROMOTION_SAVE_LIMIT = Number(
  process.env.SCANNER_PROMOTION_SAVE_LIMIT || SCANNER_TOP_LIMIT || 20,
);

function getScannerPromotionBucket(item) {
  if (
    item.scannerTier === "SAFE" &&
    item.conviction === "HIGH CONVICTION TRADE" &&
    Number(item.brainScore || 0) >= 82 &&
    Number(item.profitPercent || 0) >= 7
  ) {
    return "safe";
  }

  if (["SAFE", "WATCH"].includes(item.scannerTier)) return "watch";
  return "experimental";
}

function cleanScannerPromotionNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function saveScannerPromotionCandidates(rankedItems, meta = {}) {
  const now = new Date().toISOString();
  const candidates = rankedItems
    .filter((item) => item.scannerTier !== "AVOID")
    .slice(0, Math.max(1, SCANNER_PROMOTION_SAVE_LIMIT))
    .map((item, index) => {
      const actionPlan = buildScannerActionPlan(item);
      const moneyPlan = actionPlan.moneyPlan || item.moneyPlan || {};

      return {
        id: Number(item.id),
        itemId: Number(item.id),
        name: item.name,
        rank: index + 1,
        source: "scanner",
        seenAt: now,
        scannerTier: item.scannerTier,
        qualityTier: item.qualityTier || "WEAK",
        conviction: item.conviction || "UNKNOWN",
        suggestedBucket: getScannerPromotionBucket(item),
        scannerScore: cleanScannerPromotionNumber(item.scannerScore),
        brainScore: cleanScannerPromotionNumber(item.brainScore),
        tradeabilityScore: cleanScannerPromotionNumber(item.tradeabilityScore),
        moneyEdgeScore: cleanScannerPromotionNumber(moneyPlan.edgeScore),
        moneyEdgeLabel: moneyPlan.edgeLabel || "UNKNOWN",
        directAction: moneyPlan.directAction || "UNKNOWN",
        directReason: moneyPlan.directReason || "",
        recommendedQty: Number(moneyPlan.recommendedQty || 1),
        quantityLabel: moneyPlan.quantityLabel || "UNKNOWN",
        buyOffer: Math.round(Number(item.buyOffer || 0)),
        sellOffer: Math.round(Number(item.sellOffer || 0)),
        profit: Math.round(Number(item.profit || 0)),
        profitPercent: cleanScannerPromotionNumber(item.profitPercent),
        buyRange: actionPlan.buyRange,
        hardMaxBuy: actionPlan.maxChase,
        sellRange: actionPlan.sellRange,
        exitNote: actionPlan.exitNote,
        exitConfidence: item.exitConfidence || "UNKNOWN",
        fakeSpreadRisk: cleanScannerPromotionNumber(item.fakeSpreadRisk),
        volumeRatio: cleanScannerPromotionNumber(item.volumeRatio),
        daySold: cleanScannerPromotionNumber(item.daySold),
        monthSold: cleanScannerPromotionNumber(item.monthSold),
        marketPressure: cleanScannerPromotionNumber(item.marketPressure),
        marketPressureLevel: item.marketPressureLevel || "UNKNOWN",
        warnings: Array.isArray(item.tradeWarnings) ? item.tradeWarnings.slice(0, 5) : [],
        notes: Array.isArray(item.scannerNotes) ? item.scannerNotes.slice(0, 8) : [],
      };
    });

  const payload = {
    updatedAt: now,
    server: SERVER,
    source: "scanner",
    checked: meta.checked || 0,
    market: {
      volatility: meta.volatility,
      level: meta.runAdvice?.level,
      message: meta.runAdvice?.message,
    },
    candidates,
  };

  const tempPath = SCANNER_PROMOTION_FILE + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, SCANNER_PROMOTION_FILE);
  console.log(
    "Saved " + candidates.length + " scanner promotion candidates to " + SCANNER_PROMOTION_FILE + ".",
  );
}
`;

    const marker = "function buildScannerActionPlan(item) {";
    if (!text.includes(marker)) throw new Error("Could not find buildScannerActionPlan marker in scanner.js");
    text = text.replace(marker, helper + "\n" + marker);
  }

  if (!text.includes("saveScannerPromotionCandidates(topItems")) {
    const marker = "  const topItems = rankedItems.slice(0, SCANNER_TOP_LIMIT);\n";
    if (!text.includes(marker)) throw new Error("Could not find topItems marker in scanner.js");
    text = text.replace(
      marker,
      marker +
        "\n  saveScannerPromotionCandidates(topItems, {\n" +
        "    checked: analyzedItems.length,\n" +
        "    volatility,\n" +
        "    runAdvice,\n" +
        "  });\n",
    );
  }

  write(path, text);
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = JSON.parse(read(path));
  pkg.scripts ||= {};
  pkg.scripts["promote-scanner"] = "node promote-scanner-candidates.mjs";
  write(path, JSON.stringify(pkg, null, 2) + "\n");
}

function patchBat() {
  const path = "trade-manager.bat";
  if (!fs.existsSync(path)) return;
  let text = read(path);
  if (text.includes(":promotescanner")) return;

  const exitLineMatch = [...text.matchAll(/^echo (\d+)\. Exit\s*$/gim)].pop();
  const routeMatch = [...text.matchAll(/^if "%choice%"=="(\d+)" exit\s*$/gim)].pop();

  if (!exitLineMatch || !routeMatch) {
    console.log("trade-manager.bat: could not patch menu automatically; use npm run promote-scanner manually.");
    return;
  }

  const scannerOption = Number(exitLineMatch[1]);
  const exitOption = scannerOption + 1;

  text = text.replace(
    exitLineMatch[0],
    "echo " + scannerOption + ". Scanner Promotion\r\necho " + exitOption + ". Exit",
  );

  text = text.replace(
    routeMatch[0],
    "if \"%choice%\"==\"" + scannerOption + "\" goto promotescanner\r\nif \"%choice%\"==\"" + exitOption + "\" exit",
  );

  const label =
    "\r\n:promotescanner\r\n" +
    "cls\r\n" +
    "echo SCANNER PROMOTION\r\n" +
    "echo.\r\n" +
    "echo Promotes the latest Scanner research candidates into data/tracked-items.json.\r\n" +
    "echo Run Scanner first if this list is empty or old.\r\n" +
    "echo.\r\n" +
    "call npm run promote-scanner\r\n" +
    "pause\r\n" +
    "goto menu\r\n";

  text = text.trimEnd() + label;
  write(path, text);
}

patchScanner();
patchPackageJson();
patchBat();

console.log("Scanner promotion feature installed.");
