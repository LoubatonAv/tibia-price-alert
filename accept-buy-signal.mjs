import fs from "fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { calculateBuyOfferFee, normalizePosition } from "./lib/trades.js";
import { getItemMap } from "./lib/market.js";

const POSITIONS_FILE = "./positions.json";
const PENDING_FILE = "./pending-buy-signals.json";

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function parseFlags(argv) {
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }

  return flags;
}

function loadJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, data) {
  const temp = `${path}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, path);
}

function loadPositions() {
  const data = loadJson(POSITIONS_FILE, { positions: [] });
  if (!Array.isArray(data.positions)) data.positions = [];
  data.positions.forEach(normalizePosition);
  return data;
}

function loadPendingData() {
  const raw = loadJson(PENDING_FILE, { signals: [] });
  if (Array.isArray(raw)) return { signals: raw };
  if (!Array.isArray(raw.signals)) raw.signals = [];
  return raw;
}

function getItemName(itemId, fallback = null) {
  const itemMap = getItemMap();
  return fallback || itemMap[Number(itemId)] || `Unknown Item (${itemId})`;
}

function isActivePosition(position) {
  const status = String(position.status || "OPEN").toUpperCase();
  return ![
    "CLOSED",
    "CANCELED",
    "CANCELLED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_CANCELED",
    "BUY_ORDER_EXPIRED",
    "EXPIRED",
  ].includes(status);
}

function getOpenExposure(positionsData, itemId) {
  return positionsData.positions.filter(
    (position) => String(position.id) === String(itemId) && isActivePosition(position),
  );
}

function quotePowerShellArg(value) {
  const text = String(value ?? "");
  return `"${text.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function buildAcceptCommand(signal) {
  const parts = [
    "npm run accept-buy --",
    "--item-id", String(signal.itemId ?? signal.id),
    "--name", quotePowerShellArg(signal.name),
    "--qty", String(signal.qty ?? signal.quantity ?? 1),
    "--buy", String(signal.buyPrice ?? signal.buy ?? signal.maxBuy),
    "--target", String(signal.targetSell ?? signal.target ?? 0),
  ];

  if (signal.profitTotal != null) parts.push("--profit-total", String(signal.profitTotal));
  if (signal.roi != null) parts.push("--roi", String(signal.roi));
  if (signal.quality != null) parts.push("--quality", quotePowerShellArg(signal.quality));
  if (signal.qualityScore != null) parts.push("--quality-score", String(signal.qualityScore));
  if (signal.confidence != null) parts.push("--confidence", String(signal.confidence));
  if (signal.brain != null || signal.brainScore != null) parts.push("--brain", String(signal.brain ?? signal.brainScore));

  return parts.join(" ");
}

async function ask(question) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function askYesNo(question) {
  const answer = await ask(`${question}: `);
  return String(answer).trim().toLowerCase() === "y";
}

function normalizeSignal(raw) {
  return {
    itemId: Number(raw.itemId ?? raw.id),
    name: raw.name,
    qty: Number(raw.qty ?? raw.quantity ?? raw.recommendedQty ?? 1),
    buyPrice: Number(raw.buyPrice ?? raw.buy ?? raw.maxBuy ?? raw.hardMaxBuy),
    targetSell: Number(raw.targetSell ?? raw.target ?? raw.sellTarget ?? 0),
    profitTotal: raw.profitTotal != null ? Number(raw.profitTotal) : null,
    roi: raw.roi != null ? Number(raw.roi) : null,
    quality: raw.quality || raw.signalClass || "UNKNOWN",
    qualityScore: raw.qualityScore != null ? Number(raw.qualityScore) : null,
    confidence: raw.confidence != null ? Number(raw.confidence) : null,
    brain: raw.brain != null ? Number(raw.brain) : raw.brainScore != null ? Number(raw.brainScore) : null,
    sourceSignalId: raw.signalId || raw.id || null,
  };
}

function validateSignal(signal) {
  const errors = [];
  if (!Number.isFinite(signal.itemId) || signal.itemId <= 0) errors.push("missing/invalid item ID");
  if (!signal.name) errors.push("missing item name");
  if (!Number.isFinite(signal.qty) || signal.qty <= 0) errors.push("missing/invalid quantity");
  if (!Number.isFinite(signal.buyPrice) || signal.buyPrice <= 0) errors.push("missing/invalid buy price");
  if (!Number.isFinite(signal.targetSell) || signal.targetSell < 0) errors.push("missing/invalid target sell");
  return errors;
}

function selectPendingSignals(pendingData) {
  const now = Date.now();
  return pendingData.signals
    .filter((signal) => String(signal.status || "PENDING").toUpperCase() === "PENDING")
    .filter((signal) => {
      const seen = new Date(signal.seenAt || signal.createdAt || 0).getTime();
      if (!Number.isFinite(seen) || seen <= 0) return true;
      return now - seen <= 14 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(b.seenAt || 0) - new Date(a.seenAt || 0));
}

function markMatchingPendingAccepted(pendingData, acceptedSignal) {
  const candidates = pendingData.signals
    .filter((signal) => String(signal.status || "PENDING").toUpperCase() === "PENDING")
    .filter((signal) => String(signal.itemId ?? signal.id) === String(acceptedSignal.itemId))
    .sort((a, b) => new Date(b.seenAt || 0) - new Date(a.seenAt || 0));

  const exact = candidates.find((signal) => {
    const qty = Number(signal.qty ?? signal.quantity ?? signal.recommendedQty ?? 0);
    const buy = Number(signal.buyPrice ?? signal.buy ?? signal.maxBuy ?? signal.hardMaxBuy ?? 0);
    return qty === acceptedSignal.qty && Math.abs(buy - acceptedSignal.buyPrice) <= Math.max(1, acceptedSignal.buyPrice * 0.02);
  });

  const target = exact || candidates[0];
  if (!target) return false;

  target.status = "ACCEPTED";
  target.acceptedAt = new Date().toISOString();
  target.acceptedBuyPrice = acceptedSignal.buyPrice;
  target.acceptedQty = acceptedSignal.qty;
  target.acceptedTargetSell = acceptedSignal.targetSell;
  return true;
}

async function chooseSignalInteractively() {
  const pendingData = loadPendingData();
  const pending = selectPendingSignals(pendingData);

  console.log("\nACCEPT BUY SIGNAL\n");

  if (pending.length === 0) {
    console.log("No pending BUY signals found.");
    console.log("Use the Discord copy-paste command, or run `npm run pending-buy` to inspect old signals.");
    process.exit(0);
  }

  pending.forEach((signal, index) => {
    console.log(`#${index + 1} ${signal.name} (${signal.itemId ?? signal.id})`);
    console.log(`Qty: ${signal.qty ?? signal.quantity ?? signal.recommendedQty ?? 1}`);
    console.log(`Buy / hard max: ${formatGp(signal.buyPrice ?? signal.buy ?? signal.maxBuy ?? signal.hardMaxBuy)} gp`);
    console.log(`Target sell: ${formatGp(signal.targetSell ?? signal.target ?? 0)} gp`);
    console.log(`Quality: ${signal.quality || signal.signalClass || "UNKNOWN"} | confidence: ${signal.confidence ?? "N/A"}`);
    console.log("");
  });

  const answer = await ask("Choose signal number, or Enter to cancel: ");
  if (!answer.trim()) {
    console.log("\nCancelled. Nothing saved.");
    process.exit(0);
  }

  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= pending.length) {
    console.log("\nInvalid selection. Nothing saved.");
    process.exit(1);
  }

  return normalizeSignal(pending[index]);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  let signal;
  if (flags["item-id"] || flags.itemId) {
    signal = normalizeSignal({
      itemId: flags["item-id"] ?? flags.itemId,
      name: flags.name || getItemName(flags["item-id"] ?? flags.itemId),
      qty: flags.qty ?? flags.quantity,
      buyPrice: flags.buy ?? flags["buy-price"],
      targetSell: flags.target ?? flags["target-sell"],
      profitTotal: flags["profit-total"],
      roi: flags.roi,
      quality: flags.quality,
      qualityScore: flags["quality-score"],
      confidence: flags.confidence,
      brain: flags.brain,
    });
  } else {
    signal = await chooseSignalInteractively();
  }

  signal.name = getItemName(signal.itemId, signal.name);
  const errors = validateSignal(signal);
  if (errors.length > 0) {
    console.log(`\nCannot accept BUY signal: ${errors.join(", ")}.`);
    process.exit(1);
  }

  const positionsData = loadPositions();
  const exposure = getOpenExposure(positionsData, signal.itemId);

  console.log("\nSELECTED BUY SIGNAL\n");
  console.log(`${signal.name} (${signal.itemId})`);
  console.log(`Qty: ${signal.qty}`);
  console.log(`Buy price / hard max: ${formatGp(signal.buyPrice)} gp`);
  console.log(`Target sell: ${formatGp(signal.targetSell)} gp`);
  if (signal.profitTotal != null && Number.isFinite(signal.profitTotal)) {
    console.log(`Expected profit: ~${formatGp(signal.profitTotal)} gp total`);
  }
  console.log(`Quality: ${signal.quality || "UNKNOWN"} | confidence: ${signal.confidence ?? "N/A"}`);

  if (exposure.length > 0 && !flags.force) {
    console.log("\nEXPOSURE WARNING");
    exposure.forEach((position, index) => {
      const waiting = Math.max(0, Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0));
      console.log(`${index + 1}) ${position.name} | ${position.status} | waiting ${waiting} | owned ${position.quantity} | listed ${position.listedQuantity}`);
    });

    const continueAnyway = await askYesNo("This item already has open exposure. Continue anyway? Y/N");
    if (!continueAnyway) {
      console.log("\nCancelled. Nothing saved.");
      process.exit(0);
    }
  }

  const buyOfferFee = calculateBuyOfferFee(signal.buyPrice, signal.qty);
  console.log("\nThis will create a BUY_ORDER_PLACED position.");
  console.log(`Buy offer fee: ${formatGp(buyOfferFee)} gp`);

  const confirmed = await askYesNo("\nDid you ACTUALLY place this Buy Offer in Tibia Market? Y/N");
  if (!confirmed) {
    console.log("\nCancelled. Nothing saved.");
    process.exit(0);
  }

  const now = new Date().toISOString();
  const position = {
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
    buyOfferFeePaid: buyOfferFee,
    sellOfferFeePaid: 0,
    targetSell: signal.targetSell || 0,
    desiredMargin: 0.06,
    entryBrainScore: signal.brain ?? null,
    acceptedSignal: {
      quality: signal.quality || null,
      qualityScore: signal.qualityScore ?? null,
      confidence: signal.confidence ?? null,
      expectedProfitTotal: signal.profitTotal ?? null,
      expectedRoi: signal.roi ?? null,
    },
    status: "BUY_ORDER_PLACED",
    events: [
      {
        type: "BUY_ORDER_PLACED",
        at: now,
        entryPrice: signal.buyPrice,
        quantity: signal.qty,
        targetSell: signal.targetSell || 0,
        offerFeePaid: buyOfferFee,
        brainScore: signal.brain ?? null,
        source: "ACCEPTED_BUY_SIGNAL",
      },
    ],
  };

  positionsData.positions.push(position);
  saveJson(POSITIONS_FILE, positionsData);

  const pendingData = loadPendingData();
  const marked = markMatchingPendingAccepted(pendingData, signal);
  if (marked) saveJson(PENDING_FILE, pendingData);

  console.log("\nBUY SIGNAL ACCEPTED AND TRACKED\n");
  console.log(`${signal.name} (${signal.itemId})`);
  console.log(`Status: BUY_ORDER_PLACED`);
  console.log(`Entry: ${formatGp(signal.buyPrice)} gp`);
  console.log(`Waiting: ${signal.qty}`);
  console.log(`Pending signal cleanup: ${marked ? "marked ACCEPTED" : "no matching pending signal found"}`);
  console.log("\nNext: when the Tibia buy offer fills, use Receive Items.");
}

main().catch((error) => {
  console.error("Accept BUY signal failed:", error);
  process.exit(1);
});
