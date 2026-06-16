import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadState } from "./lib/state.js";
import { addTrackedItem } from "./lib/trackedItemsWriter.js";
import { getItemMap } from "./lib/market.js";

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function avg(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function getSnapshots(record) {
  if (Array.isArray(record.snapshots)) return record.snapshots;
  if (Array.isArray(record.runs)) return record.runs;
  if (Array.isArray(record.history)) return record.history;
  return [];
}

function isGoodSnapshot(snapshot) {
  if (snapshot.good === true || snapshot.isGood === true) return true;
  const profit = Number(snapshot.profit ?? snapshot.netProfit ?? snapshot.expectedProfit ?? 0);
  const roi = Number(snapshot.roi ?? snapshot.roiPercent ?? snapshot.profitPercent ?? 0);
  return profit >= Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_PROFIT || 1000) && roi >= Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_ROI || 5);
}

function chooseBucket(candidate) {
  if (candidate.good >= 5 && candidate.avgProfit >= 2500 && candidate.avgRoi >= 7) return "safe";
  if (candidate.good >= 3 && candidate.avgProfit >= 1500 && candidate.avgRoi >= 5) return "watch";
  return "experimental";
}

const state = loadState();
const itemMap = getItemMap();
const minGood = Number(process.env.DISCOVERY_PROMOTE_MIN_GOOD || 2);
const minProfit = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_PROFIT || 1000);
const minRoi = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_ROI || 5);

const records = Object.entries(state.discovery?.history || {}).map(([id, record]) => {
  const snapshots = getSnapshots(record);
  const good = snapshots.filter(isGoodSnapshot).length || Number(record.goodCount || record.goodSnapshots || 0);
  const profits = snapshots.map((s) => s.profit ?? s.netProfit ?? s.expectedProfit).filter((v) => Number.isFinite(Number(v)));
  const rois = snapshots.map((s) => s.roi ?? s.roiPercent ?? s.profitPercent).filter((v) => Number.isFinite(Number(v)));
  const candidate = {
    id: Number(id),
    name: record.name || itemMap[Number(id)] || `Unknown Item (${id})`,
    snapshots: snapshots.length,
    good,
    avgProfit: avg(profits),
    avgRoi: avg(rois),
    lastSeen: record.lastSeen || record.lastSeenAt || record.updatedAt || snapshots.at(-1)?.time || snapshots.at(-1)?.at || "unknown",
  };
  candidate.bucket = chooseBucket(candidate);
  return candidate;
}).filter((candidate) => candidate.good >= minGood && candidate.avgProfit >= minProfit && candidate.avgRoi >= minRoi)
  .sort((a, b) => b.good - a.good || b.avgProfit - a.avgProfit || b.avgRoi - a.avgRoi);

console.log("\nDISCOVERY PROMOTION\n");

if (records.length === 0) {
  console.log("No promotion candidates found.");
  console.log(`Need: ${minGood}+ good snapshots, avg profit ${formatGp(minProfit)}+ gp, avg ROI ${minRoi}%+.`);
  process.exit(0);
}

records.slice(0, 20).forEach((candidate, index) => {
  console.log(`#${index + 1} ${candidate.name} (${candidate.id})`);
  console.log(`Suggested bucket: ${candidate.bucket}`);
  console.log(`Good snapshots: ${candidate.good}/${candidate.snapshots}`);
  console.log(`Avg profit: ~${formatGp(candidate.avgProfit)} gp | Avg ROI: ${candidate.avgRoi.toFixed(2)}%`);
  console.log(`Last seen: ${candidate.lastSeen}`);
  console.log("");
});

const rl = readline.createInterface({ input, output });
const answer = await rl.question("Choose number to promote, `all` to promote all, or Enter to cancel: ");
rl.close();

if (!answer.trim()) {
  console.log("Cancelled. Nothing changed.");
  process.exit(0);
}

const chosen = answer.trim().toLowerCase() === "all"
  ? records
  : [records[Number(answer.trim()) - 1]].filter(Boolean);

if (chosen.length === 0) {
  console.log("Invalid choice. Nothing changed.");
  process.exit(1);
}

for (const candidate of chosen) {
  const result = addTrackedItem(candidate.id, candidate.bucket);
  if (result.added) {
    console.log(`Added ${candidate.name} (${candidate.id}) to ${result.section} in ${result.filePath}`);
  } else {
    console.log(`Skipped ${candidate.name} (${candidate.id}): ${result.reason}`);
  }
}
