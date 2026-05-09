import fs from "fs";

function uniqueNumbers(values) {
  return [
    ...new Set(
      values.map(Number).filter((value) => Number.isFinite(value) && value > 0),
    ),
  ];
}

export function readTrackedItems() {
  const tracked = JSON.parse(
    fs.readFileSync("./data/tracked-items.json", "utf8"),
  );

  return {
    core: tracked.core || [],
    watch: tracked.watch || [],
    scanner: {
      safe: tracked.scanner?.safe || [],
      watch: tracked.scanner?.watch || [],
      experimental: tracked.scanner?.experimental || [],
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
  ];

  const blacklist = new Set(uniqueNumbers(tracked.scanner.blacklist));

  return uniqueNumbers(selected).filter((id) => !blacklist.has(id));
}
