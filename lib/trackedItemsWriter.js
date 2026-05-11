import fs from "fs";

const TRACKED_PATHS = ["./data/tracked-items.json", "./tracked-items.json"];

function findTrackedPath() {
  return (
    TRACKED_PATHS.find((path) => fs.existsSync(path)) || "./tracked-items.json"
  );
}

function uniqueNumbers(values = []) {
  return [
    ...new Set(values.map(Number).filter((n) => Number.isFinite(n) && n > 0)),
  ];
}

export function addTrackedItem(itemId, section = "safe") {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) {
    return { added: false, reason: "Invalid item ID" };
  }

  const filePath = findTrackedPath();
  const tracked = JSON.parse(fs.readFileSync(filePath, "utf8"));

  tracked.core ||= [];
  tracked.watch ||= [];
  tracked.scanner ||= {};
  tracked.scanner.safe ||= [];
  tracked.scanner.watch ||= [];
  tracked.scanner.experimental ||= [];
  tracked.scanner.blacklist ||= [];

  const allTracked = uniqueNumbers([
    ...tracked.core,
    ...tracked.watch,
    ...tracked.scanner.safe,
    ...tracked.scanner.watch,
    ...tracked.scanner.experimental,
  ]);

  if (allTracked.includes(id)) {
    return { added: false, reason: "Item is already tracked", filePath };
  }

  if (section === "watch") {
    tracked.scanner.watch.push(id);
    tracked.scanner.watch = uniqueNumbers(tracked.scanner.watch);
  } else if (section === "experimental") {
    tracked.scanner.experimental.push(id);
    tracked.scanner.experimental = uniqueNumbers(tracked.scanner.experimental);
  } else {
    tracked.scanner.safe.push(id);
    tracked.scanner.safe = uniqueNumbers(tracked.scanner.safe);
  }

  fs.writeFileSync(filePath, JSON.stringify(tracked, null, 2));

  return { added: true, filePath, section };
}
