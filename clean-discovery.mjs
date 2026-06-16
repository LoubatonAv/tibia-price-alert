import { loadState, saveState } from "./lib/state.js";

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
const maxAgeDays = Number(flags.days || process.env.DISCOVERY_CLEAN_MAX_AGE_DAYS || 14);
const minGood = Number(flags["min-good"] || process.env.DISCOVERY_CLEAN_MIN_GOOD || 2);
const dryRun = Boolean(flags["dry-run"]);

const state = loadState();
state.discovery ||= {};
state.discovery.history ||= {};

const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
const entries = Object.entries(state.discovery.history);
let removed = 0;
let kept = 0;
const removedNames = [];

for (const [id, record] of entries) {
  const snapshots = Array.isArray(record.snapshots) ? record.snapshots : Array.isArray(record.runs) ? record.runs : [];
  const lastSeenRaw = record.lastSeen || record.lastSeenAt || record.updatedAt || snapshots.at(-1)?.time || snapshots.at(-1)?.at;
  const lastSeen = new Date(lastSeenRaw || 0).getTime();
  const goodCount = Number(record.goodCount ?? record.goodSnapshots ?? snapshots.filter((s) => s.good || s.isGood || s.decision === "GOOD").length);
  const isOld = Number.isFinite(lastSeen) && lastSeen > 0 && lastSeen < cutoff;
  const isWeak = goodCount < minGood;

  if (isOld && isWeak) {
    removed += 1;
    removedNames.push(`${record.name || id} (${id})`);
    if (!dryRun) delete state.discovery.history[id];
  } else {
    kept += 1;
  }
}

if (!dryRun) {
  state.discovery.lastCleanedAt = new Date().toISOString();
  saveState(state);
}

console.log("\nDISCOVERY CLEANUP\n");
console.log(`Mode: ${dryRun ? "dry run" : "saved"}`);
console.log(`Rule: remove candidates not seen for ${maxAgeDays}d AND with fewer than ${minGood} good snapshots.`);
console.log(`Kept: ${kept}`);
console.log(`Removed: ${removed}`);

if (removedNames.length > 0) {
  console.log("\nRemoved:");
  removedNames.slice(0, 25).forEach((name) => console.log(`- ${name}`));
  if (removedNames.length > 25) console.log(`...and ${removedNames.length - 25} more`);
}
