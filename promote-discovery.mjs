import fs from "fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadState } from "./lib/state.js";
import { getItemMap } from "./lib/market.js";

const TRACKED_PATHS = ["./data/tracked-items.json", "./tracked-items.json"];

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!String(token).startsWith("--")) continue;
    const key = String(token).slice(2);
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index++;
    }
  }
  return flags;
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function avg(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function parseIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  return String(value || "")
    .split(/[,\s]+/)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
}

function findTrackedPath() {
  return TRACKED_PATHS.find((path) => fs.existsSync(path)) || "./tracked-items.json";
}

function loadTracked() {
  const filePath = findTrackedPath();
  const tracked = JSON.parse(fs.readFileSync(filePath, "utf8"));
  tracked.core ||= [];
  tracked.watch ||= [];
  tracked.scanner ||= {};
  tracked.scanner.safe ||= [];
  tracked.scanner.watch ||= [];
  tracked.scanner.experimental ||= [];
  tracked.scanner.blacklist ||= [];
  return { filePath, tracked };
}

function trackedSet(tracked) {
  return new Set(uniqueNumbers([
    ...tracked.core,
    ...tracked.watch,
    ...tracked.scanner.safe,
    ...tracked.scanner.watch,
    ...tracked.scanner.experimental,
  ]));
}

function bucketArray(tracked, bucket) {
  if (bucket === "watch") return tracked.scanner.watch;
  if (bucket === "experimental") return tracked.scanner.experimental;
  return tracked.scanner.safe;
}

function setBucketArray(tracked, bucket, values) {
  if (bucket === "watch") tracked.scanner.watch = uniqueNumbers(values);
  else if (bucket === "experimental") tracked.scanner.experimental = uniqueNumbers(values);
  else tracked.scanner.safe = uniqueNumbers(values);
}

function applyCurrentSuggestions(suggestions, options = {}) {
  const itemMap = getItemMap();
  const { filePath, tracked } = loadTracked();
  const alreadyTracked = trackedSet(tracked);
  const result = {
    filePath,
    added: { watch: [], experimental: [], safe: [] },
    skipped: [],
  };

  for (const bucket of ["watch", "experimental", "safe"]) {
    for (const id of uniqueNumbers(suggestions[bucket] || [])) {
      const item = { id, name: itemMap[id] || `Unknown Item (${id})` };
      if (alreadyTracked.has(id)) {
        result.skipped.push({ ...item, bucket, reason: "already tracked" });
        continue;
      }
      result.added[bucket].push(item);
      alreadyTracked.add(id);
      if (!options.dryRun) {
        const next = bucketArray(tracked, bucket);
        next.push(id);
        setBucketArray(tracked, bucket, next);
      }
    }
  }

  if (!options.dryRun) {
    fs.writeFileSync(filePath, JSON.stringify(tracked, null, 2));
  }

  return result;
}

function printCurrentResult(result, options = {}) {
  const printBucket = (title, rows) => {
    console.log(`${title}:`);
    if (rows.length === 0) {
      console.log("- none");
      return;
    }
    rows.forEach((item) => console.log(`- ${item.name} (${item.id})`));
  };

  if (options.dryRun) console.log("Dry run: tracked items were not modified.\n");
  printBucket("Added to WATCH", result.added.watch);
  console.log("");
  printBucket("Added to EXPERIMENTAL", result.added.experimental);
  console.log("");
  printBucket("Added to SAFE", result.added.safe);
  console.log("");
  console.log("Skipped existing:");
  if (result.skipped.length === 0) console.log("- none");
  else result.skipped.forEach((item) => console.log(`- ${item.name} (${item.id})`));
  console.log(`\nTracked config: ${result.filePath}`);
}

function hasSuggestions(suggestions) {
  return ["watch", "experimental", "safe"].some((bucket) => parseIds(suggestions[bucket]).length > 0);
}

async function runCurrentMode(flags, state) {
  const suggestions = {
    watch: flags.watch ? parseIds(flags.watch) : parseIds(state.discovery?.lastSuggestedAdditions?.watch),
    experimental: flags.experimental ? parseIds(flags.experimental) : parseIds(state.discovery?.lastSuggestedAdditions?.experimental),
    safe: flags.safe ? parseIds(flags.safe) : parseIds(state.discovery?.lastSuggestedAdditions?.safe),
  };

  console.log("\nDISCOVERY CURRENT-RUN TRACKED ITEM ADDITIONS\n");

  if (!hasSuggestions(suggestions)) {
    console.log("No suggested tracked-item additions from this run.");
    return;
  }

  if (flags.prompt && !flags["dry-run"]) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Add these suggested items to TRACKED ITEMS now? Y/N: ");
    rl.close();
    if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
      console.log("Cancelled. Nothing changed.");
      return;
    }
  }

  const result = applyCurrentSuggestions(suggestions, { dryRun: Boolean(flags["dry-run"]) });
  printCurrentResult(result, { dryRun: Boolean(flags["dry-run"]) });
}

function getSnapshots(record) {
  if (Array.isArray(record.snapshots)) return record.snapshots;
  if (Array.isArray(record.runs)) return record.runs;
  if (Array.isArray(record.history)) return record.history;
  return [];
}

function isGoodSnapshot(snapshot, minProfit, minRoi) {
  if (snapshot.good === true || snapshot.isGood === true) return true;
  const profit = Number(snapshot.profit ?? snapshot.netProfit ?? snapshot.expectedProfit ?? 0);
  const roi = Number(snapshot.roi ?? snapshot.roiPercent ?? snapshot.profitPercent ?? 0);
  return profit >= minProfit && roi >= minRoi;
}

function chooseBucket(candidate) {
  if (candidate.good >= 5 && candidate.avgProfit >= 2500 && candidate.avgRoi >= 7) return "safe";
  if (candidate.good >= 3 && candidate.avgProfit >= 1500 && candidate.avgRoi >= 5) return "watch";
  return "experimental";
}

async function runHistoricalMode(flags, state) {
  const itemMap = getItemMap();
  const minGood = Number(process.env.DISCOVERY_PROMOTE_MIN_GOOD || 2);
  const minProfit = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_PROFIT || 1000);
  const minRoi = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_ROI || 5);

  const records = Object.entries(state.discovery?.history || {}).map(([id, record]) => {
    const snapshots = getSnapshots(record);
    const good = snapshots.filter((snapshot) => isGoodSnapshot(snapshot, minProfit, minRoi)).length ||
      Number(record.goodCount || record.goodSnapshots || 0);
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

  console.log("\nDISCOVERY HISTORICAL PROMOTION CHECK\n");

  if (records.length === 0) {
    console.log("No historical promotion candidates found.");
    console.log(`Need: ${minGood}+ good snapshots, avg profit ${formatGp(minProfit)}+ gp, avg ROI ${minRoi}%+.`);
    return;
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
    return;
  }

  const chosen = answer.trim().toLowerCase() === "all"
    ? records
    : [records[Number(answer.trim()) - 1]].filter(Boolean);

  if (chosen.length === 0) {
    console.log("Invalid choice. Nothing changed.");
    process.exit(1);
  }

  const suggestions = { watch: [], experimental: [], safe: [] };
  chosen.forEach((candidate) => suggestions[candidate.bucket].push(candidate.id));
  const result = applyCurrentSuggestions(suggestions, { dryRun: Boolean(flags["dry-run"]) });
  printCurrentResult(result, { dryRun: Boolean(flags["dry-run"]) });
}

const flags = parseFlags(process.argv.slice(2));
const state = loadState();

if (flags["from-current-run"] || flags.watch || flags.experimental || flags.safe) {
  await runCurrentMode(flags, state);
} else {
  await runHistoricalMode(flags, state);
}
