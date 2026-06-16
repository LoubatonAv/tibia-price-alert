import fs from "fs";
import { normalizePosition } from "./lib/trades.js";

const PENDING_FILE = "./pending-buy-signals.json";
const POSITIONS_FILE = "./positions.json";

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
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

function loadPendingData() {
  const raw = loadJson(PENDING_FILE, { signals: [] });
  if (Array.isArray(raw)) return { signals: raw };
  if (!Array.isArray(raw.signals)) raw.signals = [];
  return raw;
}

function loadPositions() {
  const data = loadJson(POSITIONS_FILE, { positions: [] });
  if (!Array.isArray(data.positions)) data.positions = [];
  data.positions.forEach(normalizePosition);
  return data;
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

function quotePowerShellArg(value) {
  const text = String(value ?? "");
  return `"${text.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function buildAcceptCommand(signal) {
  const itemId = signal.itemId ?? signal.id;
  const qty = signal.qty ?? signal.quantity ?? signal.recommendedQty ?? 1;
  const buy = signal.buyPrice ?? signal.buy ?? signal.maxBuy ?? signal.hardMaxBuy;
  const target = signal.targetSell ?? signal.target ?? signal.sellTarget ?? 0;
  const parts = [
    "npm run accept-buy --",
    "--item-id", String(itemId),
    "--name", quotePowerShellArg(signal.name),
    "--qty", String(qty),
    "--buy", String(buy),
    "--target", String(target),
  ];

  if (signal.profitTotal != null) parts.push("--profit-total", String(signal.profitTotal));
  if (signal.roi != null) parts.push("--roi", String(signal.roi));
  if (signal.quality != null) parts.push("--quality", quotePowerShellArg(signal.quality));
  if (signal.qualityScore != null) parts.push("--quality-score", String(signal.qualityScore));
  if (signal.confidence != null) parts.push("--confidence", String(signal.confidence));
  if (signal.brain != null || signal.brainScore != null) parts.push("--brain", String(signal.brain ?? signal.brainScore));

  return parts.join(" ");
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const maxAgeDays = Number(flags.days || 14);
const projectPath = process.env.ACCEPT_BUY_PROJECT_PATH || "C:\\Users\\Avner\\Desktop\\Projects\\tibia-price-alert";

const pendingData = loadPendingData();
const positionsData = loadPositions();
const now = Date.now();
let changed = false;

for (const signal of pendingData.signals) {
  const status = String(signal.status || "PENDING").toUpperCase();
  const seen = new Date(signal.seenAt || signal.createdAt || 0).getTime();
  const ageDays = Number.isFinite(seen) && seen > 0 ? (now - seen) / 86400000 : 0;
  const itemId = signal.itemId ?? signal.id;
  const hasActivePosition = positionsData.positions.some(
    (position) => String(position.id) === String(itemId) && isActivePosition(position),
  );

  if (status === "PENDING" && hasActivePosition) {
    signal.status = "ALREADY_TRACKED";
    signal.alreadyTrackedAt = new Date().toISOString();
    changed = true;
  } else if (status === "PENDING" && ageDays > maxAgeDays) {
    signal.status = "EXPIRED";
    signal.expiredAt = new Date().toISOString();
    changed = true;
  }
}

if (changed) saveJson(PENDING_FILE, pendingData);

const sorted = [...pendingData.signals].sort(
  (a, b) => new Date(b.seenAt || b.createdAt || 0) - new Date(a.seenAt || a.createdAt || 0),
);

console.log("\nPENDING BUY SIGNALS\n");

if (sorted.length === 0) {
  console.log("No pending BUY signal history found.");
  process.exit(0);
}

const counts = sorted.reduce((acc, signal) => {
  const status = String(signal.status || "PENDING").toUpperCase();
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

console.log(Object.entries(counts).map(([key, value]) => `${key}: ${value}`).join(" | "));
console.log("");

sorted.slice(0, 20).forEach((signal, index) => {
  const status = String(signal.status || "PENDING").toUpperCase();
  const itemId = signal.itemId ?? signal.id;
  const qty = signal.qty ?? signal.quantity ?? signal.recommendedQty ?? 1;
  const buy = signal.buyPrice ?? signal.buy ?? signal.maxBuy ?? signal.hardMaxBuy;
  const target = signal.targetSell ?? signal.target ?? signal.sellTarget ?? 0;

  console.log(`#${index + 1} ${signal.name} (${itemId}) — ${status}`);
  console.log(`Seen: ${signal.seenAt || signal.createdAt || "unknown"}`);
  console.log(`Qty: ${qty} | Buy: ${formatGp(buy)} gp | Target: ${formatGp(target)} gp`);
  console.log(`Quality: ${signal.quality || signal.signalClass || "UNKNOWN"} | Confidence: ${signal.confidence ?? "N/A"}`);

  if (status === "PENDING") {
    console.log("Copy after you actually place the offer in Tibia:");
    console.log(`cd ${quotePowerShellArg(projectPath)}`);
    console.log(buildAcceptCommand(signal));
  }

  console.log("");
});
