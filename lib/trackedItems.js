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
