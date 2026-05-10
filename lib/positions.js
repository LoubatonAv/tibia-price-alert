import fs from "fs";

const POSITIONS_FILE = "./positions.json";

export function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) {
    return { positions: [] };
  }

  const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));

  if (!Array.isArray(data.positions)) {
    data.positions = [];
  }

  return data;
}

export function getOpenPositionForItem(itemId) {
  const data = loadPositions();

  return data.positions.find(
    (position) =>
      String(position.id) === String(itemId) &&
      String(position.status || "OPEN").toUpperCase() === "OPEN",
  );
}
