import fs from "fs";
import { normalizePosition } from "./trades.js";

const POSITIONS_FILE = "./positions.json";

export function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) {
    return { positions: [] };
  }

  const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));

  if (!Array.isArray(data.positions)) {
    data.positions = [];
  }

  data.positions.forEach(normalizePosition);
  return data;
}

export function isOpenPosition(position) {
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

export function getOpenPositionForItem(itemId) {
  const data = loadPositions();

  return data.positions.find(
    (position) => String(position.id) === String(itemId) && isOpenPosition(position),
  );
}

export function getOpenPositionsForItem(itemId) {
  const data = loadPositions();

  return data.positions.filter(
    (position) => String(position.id) === String(itemId) && isOpenPosition(position),
  );
}
