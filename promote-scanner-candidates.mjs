import fs from "fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { addTrackedItem } from "./lib/trackedItemsWriter.js";

const CANDIDATES_FILE = process.env.SCANNER_PROMOTION_FILE || "./scanner-candidates.json";

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

function normalizeBucket(bucket) {
  const clean = String(bucket || "").toLowerCase().trim();
  if (["safe", "watch", "experimental"].includes(clean)) return clean;
  return "experimental";
}

function isPromotable(candidate, includeSpeculative = true) {
  if (!candidate?.id && !candidate?.itemId) return false;
  const tier = String(candidate.scannerTier || "").toUpperCase();
  if (tier === "AVOID") return false;
  if (tier === "SPECULATIVE") return includeSpeculative;
  return ["SAFE", "WATCH"].includes(tier);
}

function candidateLabel(candidate) {
  return [candidate.scannerTier, candidate.qualityTier, candidate.conviction]
    .filter(Boolean)
    .join(" / ");
}

function parseSelection(answer, candidates) {
  const clean = answer.trim().toLowerCase();
  if (!clean) return [];
  if (clean === "all") return candidates;

  return clean
    .split(/[ ,]+/)
    .map((part) => Number(part))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= candidates.length)
    .map((number) => candidates[number - 1]);
}

const flags = parseFlags(process.argv.slice(2));
const includeSpeculative = flags["no-speculative"] ? false : true;
const forceBucket = flags.bucket ? normalizeBucket(flags.bucket) : null;
const data = loadJson(CANDIDATES_FILE, { candidates: [] });
const allCandidates = Array.isArray(data.candidates) ? data.candidates : [];
const candidates = allCandidates
  .filter((candidate) => String(candidate.status || "PENDING").toUpperCase() !== "PROMOTED")
  .filter((candidate) => isPromotable(candidate, includeSpeculative))
  .slice(0, Number(flags.limit || 20));

console.log("\nSCANNER PROMOTION\n");

if (!fs.existsSync(CANDIDATES_FILE)) {
  console.log("No scanner-candidates.json found yet.");
  console.log("Run: npm run scanner");
  process.exit(0);
}

console.log(`Source: ${CANDIDATES_FILE}`);
console.log(`Updated: ${data.updatedAt || "unknown"}`);
console.log(`Market: ${data.market?.level || "unknown"} | Checked: ${data.checked ?? "unknown"}`);
console.log("");

if (candidates.length === 0) {
  console.log("No promotable scanner candidates found.");
  console.log("Run npm run scanner again, or use the Scanner only for research if all items are weak/avoid.");
  process.exit(0);
}

candidates.forEach((candidate, index) => {
  const bucket = forceBucket || normalizeBucket(candidate.suggestedBucket);
  const id = candidate.itemId || candidate.id;
  console.log(`#${index + 1} ${candidate.name} (${id})`);
  console.log(`Read: ${candidateLabel(candidate)}`);
  console.log(`Suggested bucket: ${bucket}`);
  console.log(`Buy: ${candidate.buyRange || formatGp(candidate.buyOffer)} | Sell: ${candidate.sellRange || formatGp(candidate.sellOffer)}`);
  console.log(`Profit: ~${formatGp(candidate.profit)} gp ea | ROI: ${Number(candidate.profitPercent || 0).toFixed(2)}% | Qty: ${candidate.recommendedQty || 1}`);
  console.log(`Action: ${candidate.directAction || "UNKNOWN"}`);
  if (candidate.warnings?.length) console.log(`Warnings: ${candidate.warnings.join(" ").slice(0, 220)}`);
  console.log("");
});

let chosen = [];
if (flags.all) {
  chosen = candidates;
} else if (flags.pick) {
  chosen = parseSelection(String(flags.pick), candidates);
} else {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Choose number(s), all, or Enter to cancel: ");
  rl.close();
  chosen = parseSelection(answer, candidates);
}

if (chosen.length === 0) {
  console.log("Cancelled. Nothing changed.");
  process.exit(0);
}

let changed = false;
for (const candidate of chosen) {
  const id = candidate.itemId || candidate.id;
  const bucket = forceBucket || normalizeBucket(candidate.suggestedBucket);
  const result = addTrackedItem(id, bucket);

  if (result.added) {
    candidate.status = "PROMOTED";
    candidate.promotedAt = new Date().toISOString();
    candidate.promotedBucket = result.section;
    changed = true;
    console.log(`Added ${candidate.name} (${id}) to ${result.section} in ${result.filePath}`);
  } else {
    candidate.status = String(result.reason || "SKIPPED").toLowerCase().includes("already") ? "ALREADY_TRACKED" : "SKIPPED";
    candidate.lastPromotionAttemptAt = new Date().toISOString();
    changed = true;
    console.log(`Skipped ${candidate.name} (${id}): ${result.reason}`);
  }
}

if (changed) saveJson(CANDIDATES_FILE, data);
