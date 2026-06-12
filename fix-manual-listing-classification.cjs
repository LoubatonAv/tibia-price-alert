const fs = require("fs");

const path = "trade.js";
let text = fs.readFileSync(path, "utf8");

const oldBlock = /function isLootOrExternalPosition\(position\) \{[\s\S]*?\n\}/;

const newBlock = `function isLootOrExternalPosition(position) {
  const flow = String(position.flow || "").toUpperCase();
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const buyOfferFeePaid = Number(position.buyOfferFeePaid || 0);

  // Pure external/loot inventory.
  if (flow.includes("EXTERNAL")) return true;
  if (flow.includes("LOOT")) return true;

  // Manual listing can be either:
  // - loot/external if entry cost is 0
  // - flip if it has a real entry price / buy fee
  if (flow.includes("MANUAL_LISTING")) {
    return entryPrice <= 0 && buyOfferFeePaid <= 0;
  }

  return false;
}`;

if (!oldBlock.test(text)) {
  throw new Error("Could not find isLootOrExternalPosition() in trade.js");
}

text = text.replace(oldBlock, newBlock);
fs.writeFileSync(path, text, "utf8");

console.log("Fixed MANUAL_LISTING classification.");
