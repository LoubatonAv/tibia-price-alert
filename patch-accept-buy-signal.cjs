const fs = require("fs");

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = readJson(path, null);
  if (!pkg) throw new Error("package.json not found");

  pkg.scripts ||= {};
  pkg.scripts["accept-buy"] ||= "node accept-buy-signal.mjs";

  writeJson(path, pkg);
}

function ensureFsImport(text) {
  if (/from\s+["']node:fs["']/.test(text) || /from\s+["']fs["']/.test(text)) {
    return text;
  }

  return 'import fs from "node:fs";\n' + text;
}

function patchCheckFlips() {
  const path = "check-flips.js";
  if (!fs.existsSync(path)) throw new Error("check-flips.js not found");

  let text = fs.readFileSync(path, "utf8");
  text = ensureFsImport(text);

  const pendingBlock = String.raw`
function readPendingBuySignals() {
  if (!fs.existsSync("pending-buy-signals.json")) {
    return {
      version: 1,
      signals: [],
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync("pending-buy-signals.json", "utf8"));

    if (Array.isArray(data)) {
      return {
        version: 1,
        signals: data,
      };
    }

    return {
      version: 1,
      signals: Array.isArray(data.signals) ? data.signals : [],
    };
  } catch {
    return {
      version: 1,
      signals: [],
    };
  }
}

function writePendingBuySignals(data) {
  fs.writeFileSync("pending-buy-signals.json", JSON.stringify(data, null, 2) + "\n");
}

function makePendingBuySignal(item) {
  const plan =
    typeof buildQualityActionPlan === "function"
      ? buildQualityActionPlan(item)
      : null;

  const qty = Number(plan?.capital?.qty || item.recommendedQty || 1);
  const buyPrice = Number(
    plan?.capital?.maxBuy ||
      item.maxRealisticBuy ||
      item.maxBuy ||
      item.buyOffer ||
      0,
  );
  const targetSell = Number(
    plan?.capital?.sellTarget ||
      item.realisticExit ||
      item.targetSell ||
      item.sellOffer ||
      0,
  );
  const expectedProfitEach = Number(item.realisticProfit || item.profit || 0);
  const expectedProfitTotal =
    Number(plan?.capital?.expectedProfitTotal || expectedProfitEach * qty || 0);

  return {
    id: String(item.id),
    itemId: Number(item.id),
    name: item.name,
    source: "FLIPPER",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),

    qty,
    buyPrice,
    hardMaxBuy: buyPrice,
    targetSell,

    expectedProfitEach,
    expectedProfitTotal,
    expectedRoiPercent: Number(item.realisticProfitPercent || item.profitPercent || 0),

    quality: plan?.quality || null,
    qualityScore: plan?.score || null,
    confidence: Number(item.signalConfidence || 0),
    brainScore: Number(item.brainScore || 0),
    tradeabilityScore: Number(item.tradeabilityScore || 0),
    fakeSpreadRisk: Number(item.fakeSpreadRisk || 0),
    marketPressureLevel: item.marketPressureLevel || null,
    reason: item.reason || null,

    commandHint:
      "After placing this in Tibia Market: BAT -> Accept BUY Signal",
  };
}

function savePendingBuySignals(buySignals) {
  if (!Array.isArray(buySignals) || buySignals.length === 0) return;

  const data = readPendingBuySignals();
  data.version = 1;
  data.signals = Array.isArray(data.signals) ? data.signals : [];

  let added = 0;
  let updated = 0;

  for (const item of buySignals) {
    const next = makePendingBuySignal(item);

    if (!next.itemId || !next.name || !next.buyPrice || !next.qty) {
      continue;
    }

    const existing = data.signals.find((signal) => {
      return (
        String(signal.itemId || signal.id) === String(next.itemId) &&
        String(signal.status || "PENDING").toUpperCase() === "PENDING"
      );
    });

    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...next,
        createdAt: existing.createdAt || next.createdAt,
        updatedAt: new Date().toISOString(),
      });
      updated++;
    } else {
      data.signals.push(next);
      added++;
    }
  }

  data.signals.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  writePendingBuySignals(data);

  if (added || updated) {
    console.log(
      "Saved pending BUY signals: " +
        added +
        " added, " +
        updated +
        " updated. Use BAT -> Accept BUY Signal after placing the offer in Tibia.",
    );
  }
}
`;

  if (!text.includes("function savePendingBuySignals")) {
    const marker = "async function sendDiscordBuyAlerts";
    if (!text.includes(marker)) {
      throw new Error("Could not find sendDiscordBuyAlerts marker.");
    }

    text = text.replace(marker, pendingBlock + "\n" + marker);
  }

  if (!text.includes("savePendingBuySignals(buySignals);")) {
    const marker =
      "  await sendDiscordManualSnipeAlerts(analyzedItems, buySignals, state);";

    if (text.includes(marker)) {
      text = text.replace(marker, "  savePendingBuySignals(buySignals);\n" + marker);
    } else {
      const fallback = "  await sendDiscordBuyAlerts(buySignals, state);";
      if (!text.includes(fallback)) {
        throw new Error("Could not find place to save pending BUY signals.");
      }

      text = text.replace(fallback, "  savePendingBuySignals(buySignals);\n" + fallback);
    }
  }

  fs.writeFileSync(path, text, "utf8");
}

function patchBat() {
  const path = "trade-manager.bat";
  if (!fs.existsSync(path)) return;

  let bat = fs.readFileSync(path, "utf8");

  if (!bat.includes("Accept BUY Signal")) {
    bat = bat.replace(
      /echo\s+19\.?\s+Discovery Promotion\s*\r?\necho\s+20\.?\s+Exit/i,
      "echo 19. Discovery Promotion\r\necho 20. Accept BUY Signal\r\necho 21. Exit"
    );

    if (!/echo\s+20\.?\s+Accept BUY Signal/i.test(bat)) {
      bat = bat.replace(
        /echo\s+19\.?\s+Discovery Promotion\s*$/im,
        "echo 19. Discovery Promotion\r\necho 20. Accept BUY Signal\r\necho 21. Exit"
      );
    }

    let exitTarget = "exit";
    const old20 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"20"\s+goto\s+([^\s\r\n]+)/im);
    const old21 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"21"\s+goto\s+([^\s\r\n]+)/im);

    if (old21 && old21[1].toLowerCase() !== "acceptbuy") {
      exitTarget = old21[1];
    } else if (old20 && old20[1].toLowerCase() !== "acceptbuy") {
      exitTarget = old20[1];
    }

    bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"20"\s+goto\s+[^\r\n]+\r?\n?/gim, "");
    bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"21"\s+goto\s+[^\r\n]+\r?\n?/gim, "");

    const route19 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"19"\s+goto\s+promotion\s*$/im);
    const route18 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"18"\s+goto\s+relist\s*$/im);

    const route = route19 || route18;
    if (!route) throw new Error("Could not find BAT route area.");

    const insertAt = route.index + route[0].length;
    bat =
      bat.slice(0, insertAt) +
      `\r\nif "%choice%"=="20" goto acceptbuy\r\nif "%choice%"=="21" goto ${exitTarget}` +
      bat.slice(insertAt);

    const block = `

:acceptbuy
cls
echo ACCEPT BUY SIGNAL
echo.
echo Use this only after you actually placed the Buy Offer in Tibia Market.
echo.
call npm run accept-buy
echo.
echo Finished. Press any key to return to menu.
pause >nul
goto menu
`;

    if (!bat.includes(":acceptbuy")) {
      if (bat.includes(":promotion")) {
        bat = bat.replace(/\r?\n:promotion/i, block + "\r\n:promotion");
      } else if (bat.includes(":relist")) {
        bat = bat.replace(/\r?\n:relist/i, block + "\r\n:relist");
      } else {
        bat += block;
      }
    }
  }

  fs.writeFileSync(path, bat, "utf8");
}

const acceptScript = String.raw`
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TAX_RATE = 0.02;

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];

    if (!part.startsWith("--")) continue;

    const key = part.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }

  return args;
}

function loadPendingSignals() {
  const data = readJson("pending-buy-signals.json", {
    version: 1,
    signals: [],
  });

  if (Array.isArray(data)) {
    return {
      version: 1,
      signals: data,
    };
  }

  return {
    version: 1,
    signals: Array.isArray(data.signals) ? data.signals : [],
  };
}

function savePendingSignals(data) {
  writeJson("pending-buy-signals.json", data);
}

function loadPositions() {
  const data = readJson("positions.json", {
    positions: [],
  });

  data.positions ||= [];
  return data;
}

function savePositions(data) {
  writeJson("positions.json", data);
}

function calculateBuyOfferFee(price, qty) {
  return Math.ceil(Number(price || 0) * Number(qty || 0) * TAX_RATE);
}

function isOpenPosition(position) {
  const status = String(position.status || "").toUpperCase();

  return ![
    "CLOSED",
    "SOLD",
    "CANCELLED",
    "CANCELED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_EXPIRED",
  ].includes(status);
}

function getOpenExposure(positionsData, itemId) {
  const id = String(itemId);

  return positionsData.positions
    .filter((position) => String(position.id) === id)
    .filter(isOpenPosition);
}

function normalizeSignal(signal) {
  return {
    itemId: Number(signal.itemId || signal.id),
    name: signal.name,
    qty: Number(signal.qty || signal.quantity || 1),
    buyPrice: Number(signal.buyPrice || signal.hardMaxBuy || signal.maxBuy || 0),
    targetSell: Number(signal.targetSell || signal.sellTarget || 0),
    expectedProfitEach: Number(signal.expectedProfitEach || 0),
    expectedProfitTotal: Number(signal.expectedProfitTotal || 0),
    expectedRoiPercent: Number(signal.expectedRoiPercent || 0),
    quality: signal.quality || null,
    qualityScore: signal.qualityScore || null,
    confidence: Number(signal.confidence || 0),
    brainScore: Number(signal.brainScore || 0),
    reason: signal.reason || null,
    raw: signal,
  };
}

function createPositionFromSignal(signal) {
  const now = new Date().toISOString();
  const buyFee = calculateBuyOfferFee(signal.buyPrice, signal.qty);

  return {
    id: signal.itemId,
    name: signal.name,
    createdAt: now,
    openedAt: now,
    flow: "BUY_ORDER_FLOW",
    source: "ACCEPTED_BUY_SIGNAL",

    entryPrice: signal.buyPrice,
    averageEntryPrice: signal.buyPrice,

    originalQuantity: signal.qty,
    quantity: 0,
    orderedQuantity: signal.qty,
    receivedQuantity: 0,
    listedQuantity: 0,
    soldQuantity: 0,
    totalListedQuantity: 0,

    buyOfferFeePaid: buyFee,
    sellOfferFeePaid: 0,

    targetSell: signal.targetSell || null,
    desiredMargin: signal.expectedRoiPercent || 0,
    entryBrainScore: signal.brainScore || null,

    signalQuality: signal.quality,
    signalQualityScore: signal.qualityScore,
    signalConfidence: signal.confidence,
    signalReason: signal.reason,

    status: "BUY_ORDER_PLACED",

    events: [
      {
        type: "BUY_ORDER_PLACED",
        at: now,
        source: "ACCEPT_BUY_SIGNAL",
        quantity: signal.qty,
        buyPrice: signal.buyPrice,
        targetSell: signal.targetSell || null,
        feePaid: buyFee,
        expectedProfitEach: signal.expectedProfitEach,
        expectedProfitTotal: signal.expectedProfitTotal,
        expectedRoiPercent: signal.expectedRoiPercent,
      },
    ],
  };
}

function printSignal(signal, index = null) {
  const prefix = index === null ? "" : "#" + (index + 1) + " ";

  console.log(prefix + signal.name + " (" + signal.itemId + ")");
  console.log("Qty: " + signal.qty);
  console.log("Buy price / hard max: " + formatGp(signal.buyPrice) + " gp");
  console.log("Target sell: " + formatGp(signal.targetSell) + " gp");
  console.log("Expected profit: ~" + formatGp(signal.expectedProfitTotal) + " gp total");
  console.log("Quality: " + (signal.quality || "UNKNOWN") + " | confidence: " + signal.confidence);
  console.log("");
}

async function choosePendingSignal(rl) {
  const pendingData = loadPendingSignals();
  const pending = pendingData.signals
    .filter((signal) => String(signal.status || "PENDING").toUpperCase() === "PENDING")
    .map(normalizeSignal)
    .filter((signal) => signal.itemId && signal.name && signal.buyPrice && signal.qty);

  console.log("\nACCEPT BUY SIGNAL\n");

  if (pending.length === 0) {
    console.log("No pending BUY signals found.");
    console.log("");
    console.log("Run Flipper Check locally first:");
    console.log("npm run flips");
    console.log("");
    return null;
  }

  pending.forEach(printSignal);

  const answer = await rl.question("Choose signal number, or Enter to cancel: ");
  if (!String(answer).trim()) return null;

  const index = Number(answer) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= pending.length) {
    console.log("Invalid selection.");
    return null;
  }

  return {
    signal: pending[index],
    pendingData,
  };
}

function getSignalFromArgs(args) {
  if (!args["item-id"] && !args.itemId && !args.id) return null;

  return normalizeSignal({
    itemId: args["item-id"] || args.itemId || args.id,
    name: args.name,
    qty: args.qty || args.quantity || 1,
    buyPrice: args.buy || args.buyPrice || args["buy-price"],
    targetSell: args.target || args.targetSell || args["target-sell"],
    expectedProfitEach: args.profitEach || args["profit-each"],
    expectedProfitTotal: args.profitTotal || args["profit-total"],
    expectedRoiPercent: args.roi || args["roi-percent"],
    quality: args.quality,
    qualityScore: args.qualityScore || args["quality-score"],
    confidence: args.confidence,
    brainScore: args.brain || args.brainScore,
    reason: args.reason,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  try {
    let selected = null;
    let pendingData = null;

    const argSignal = getSignalFromArgs(args);

    if (argSignal) {
      selected = argSignal;
    } else {
      const result = await choosePendingSignal(rl);
      if (!result) return;

      selected = result.signal;
      pendingData = result.pendingData;
    }

    if (!selected.itemId || !selected.name || !selected.buyPrice || !selected.qty) {
      throw new Error("Signal is missing itemId/name/buyPrice/qty.");
    }

    console.log("\nSELECTED BUY SIGNAL\n");
    printSignal(selected);

    const positionsData = loadPositions();
    const exposure = getOpenExposure(positionsData, selected.itemId);

    if (exposure.length > 0) {
      console.log("WARNING: existing open exposure found for this item:");
      for (const position of exposure) {
        console.log(
          "- " +
            position.status +
            " | waiting " +
            Math.max(
              0,
              Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
            ) +
            " | owned " +
            Number(position.quantity || 0) +
            " | listed " +
            Number(position.listedQuantity || 0),
        );
      }
      console.log("");
    }

    console.log("This will create a BUY_ORDER_PLACED position.");
    console.log("Buy offer fee: " + formatGp(calculateBuyOfferFee(selected.buyPrice, selected.qty)) + " gp");
    console.log("");

    const confirm = await rl.question(
      "Did you ACTUALLY place this Buy Offer in Tibia Market? Y/N: ",
    );

    if (String(confirm).trim().toLowerCase() !== "y") {
      console.log("\nCancelled. Nothing saved.");
      return;
    }

    if (exposure.length > 0 && !args.force) {
      const confirmExposure = await rl.question(
        "You already have exposure. Add another position anyway? Y/N: ",
      );

      if (String(confirmExposure).trim().toLowerCase() !== "y") {
        console.log("\nCancelled. Nothing saved.");
        return;
      }
    }

    const position = createPositionFromSignal(selected);

    positionsData.positions.push(position);
    savePositions(positionsData);

    if (pendingData) {
      for (const signal of pendingData.signals) {
        if (
          String(signal.itemId || signal.id) === String(selected.itemId) &&
          String(signal.status || "PENDING").toUpperCase() === "PENDING"
        ) {
          signal.status = "ACCEPTED";
          signal.acceptedAt = new Date().toISOString();
          signal.acceptedBuyPrice = selected.buyPrice;
          signal.acceptedQty = selected.qty;
          signal.acceptedTargetSell = selected.targetSell;
          break;
        }
      }

      savePendingSignals(pendingData);
    }

    console.log("\nBUY ORDER CREATED\n");
    console.log(position.name + " (" + position.id + ")");
    console.log("Qty: " + position.orderedQuantity);
    console.log("Entry: " + formatGp(position.entryPrice) + " gp");
    console.log("Target sell: " + formatGp(position.targetSell) + " gp");
    console.log("Buy fee paid: " + formatGp(position.buyOfferFeePaid) + " gp");
    console.log("");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Accept BUY signal failed:", error);
  process.exit(1);
});
`;

fs.writeFileSync("accept-buy-signal.mjs", acceptScript, "utf8");

patchPackageJson();
patchCheckFlips();
patchBat();

console.log("Accept BUY Signal installed.");
console.log("Added:");
console.log("- accept-buy-signal.mjs");
console.log("- npm run accept-buy");
console.log("- pending-buy-signals.json from local flipper BUY signals");
console.log("- BAT option 20 Accept BUY Signal");
