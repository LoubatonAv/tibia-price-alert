import fs from "fs";

const TRACKED_PATHS = ["./data/tracked-items.json", "./tracked-items.json"];

function uniqueNumbers(values) {
  return [
    ...new Set(
      values.map(Number).filter((value) => Number.isFinite(value) && value > 0),
    ),
  ];
}

function findTrackedPath() {
  return TRACKED_PATHS.find((path) => fs.existsSync(path)) || "./tracked-items.json";
}

export function readTrackedItems() {
  const tracked = JSON.parse(fs.readFileSync(findTrackedPath(), "utf8"));

  return {
    core: tracked.core || [],
    watch: tracked.watch || [],
    scanner: {
      safe: tracked.scanner?.safe || [],
      watch: tracked.scanner?.watch || [],
      experimental: tracked.scanner?.experimental || [],
      snipe: tracked.scanner?.snipe || [],
      blacklist: tracked.scanner?.blacklist || [],
    },
  };
}

export function getTrackedItemIds() {
  const tracked = readTrackedItems();

  const selected = [
    ...tracked.core,
    ...tracked.watch,
    ...tracked.scanner.safe,
    ...tracked.scanner.watch,
    ...tracked.scanner.experimental,
    ...tracked.scanner.snipe,
  ];

  const blacklist = new Set(uniqueNumbers(tracked.scanner.blacklist));

  return uniqueNumbers(selected).filter((id) => !blacklist.has(id));
}

export function getSnipeItemIds() {
  const tracked = readTrackedItems();
  return uniqueNumbers(tracked.scanner.snipe);
}

export function getTrackedItemSets() {
  const tracked = readTrackedItems();

  return {
    core: new Set(uniqueNumbers(tracked.core)),
    watch: new Set(uniqueNumbers(tracked.watch)),
    safe: new Set(uniqueNumbers(tracked.scanner.safe)),
    scannerWatch: new Set(uniqueNumbers(tracked.scanner.watch)),
    experimental: new Set(uniqueNumbers(tracked.scanner.experimental)),
    snipe: new Set(uniqueNumbers(tracked.scanner.snipe)),
    blacklist: new Set(uniqueNumbers(tracked.scanner.blacklist)),
  };
}

export function getTrackedCategory(itemId) {
  const id = Number(itemId);
  const sets = getTrackedItemSets();

  if (sets.core.has(id)) return "core";
  if (sets.safe.has(id)) return "scanner.safe";
  if (sets.scannerWatch.has(id)) return "scanner.watch";
  if (sets.experimental.has(id)) return "scanner.experimental";
  if (sets.watch.has(id)) return "watch";
  if (sets.snipe.has(id)) return "scanner.snipe";
  return null;
}

export function getDiscoveryItemIds() {
  const discoveryPaths = ["./data/discovery-items.json", "./discovery-items.json"];
  const path = discoveryPaths.find((candidate) => fs.existsSync(candidate));

  if (!path) return [];

  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const ids = Array.isArray(parsed) ? parsed : parsed.items || [];
  const blacklist = getTrackedItemSets().blacklist;

  return uniqueNumbers(ids).filter((id) => !blacklist.has(id));
}
