const fs = require("fs");

const POSITIONS_FILE = "positions.json";
const STATE_FILE = "state.json";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}

function backup(path) {
  if (!fs.existsSync(path)) return;

  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  fs.copyFileSync(path, `${path}.bak-datafix-${stamp}`);
}

function normalizePosition(position) {
  if (!position.events) position.events = [];
  if (!position.openedAt && position.createdAt) position.openedAt = position.createdAt;
  if (!position.createdAt && position.openedAt) position.createdAt = position.openedAt;

  position.quantity = safeNumber(position.quantity, 0);
  position.originalQuantity = safeNumber(position.originalQuantity, position.quantity);
  position.orderedQuantity = safeNumber(position.orderedQuantity, position.originalQuantity);
  position.receivedQuantity = safeNumber(position.receivedQuantity, position.quantity);
  position.listedQuantity = safeNumber(position.listedQuantity, 0);
  position.soldQuantity = safeNumber(position.soldQuantity, 0);
  position.totalListedQuantity = safeNumber(position.totalListedQuantity, position.listedQuantity);
  position.buyOfferFeePaid = safeNumber(position.buyOfferFeePaid, 0);
  position.sellOfferFeePaid = safeNumber(position.sellOfferFeePaid, 0);

  return position;
}

function addFixEvent(position, type, details = {}) {
  position.events.push({
    type,
    at: new Date().toISOString(),
    ...details,
  });
}

function suggestedTargetSell(entryPrice) {
  const raw = safeNumber(entryPrice, 0) * 1.103;
  if (raw >= 10000) return Math.ceil(raw / 50) * 50;
  if (raw >= 1000) return Math.ceil(raw / 25) * 25;
  return Math.ceil(raw);
}

function buildSoldTrade(position, event) {
  const quantity = safeNumber(event.quantity, 0);
  const entryPrice = safeNumber(position.entryPrice || position.averageEntryPrice, 0);
  const sellPrice = safeNumber(event.sellPrice, 0);

  const grossBuy = entryPrice * quantity;
  const grossSell = sellPrice * quantity;

  const buyFeeBaseQty = Math.max(
    1,
    safeNumber(position.orderedQuantity, 0) ||
      safeNumber(position.originalQuantity, 0) ||
      quantity,
  );

  const sellFeeBaseQty = Math.max(
    1,
    safeNumber(position.totalListedQuantity, 0) ||
      safeNumber(position.listedQuantity, 0) ||
      safeNumber(position.soldQuantity, 0) ||
      quantity,
  );

  const buyOfferFeePaid =
    (safeNumber(position.buyOfferFeePaid, 0) / buyFeeBaseQty) * quantity;

  const sellOfferFeePaid =
    (safeNumber(position.sellOfferFeePaid, 0) / sellFeeBaseQty) * quantity;

  const totalFees = buyOfferFeePaid + sellOfferFeePaid;
  const netProfit = grossSell - grossBuy - totalFees;
  const realCost = grossBuy + totalFees;
  const roiPercent = realCost > 0 ? (netProfit / realCost) * 100 : 0;

  return {
    id: position.id,
    name: position.name,
    openedAt: position.openedAt || position.createdAt || null,
    closedAt: event.at || position.closedAt || new Date().toISOString(),
    entryPrice,
    sellPrice,
    quantity,
    grossBuy: roundMoney(grossBuy),
    grossSell: roundMoney(grossSell),
    buyOfferFeePaid: roundMoney(buyOfferFeePaid),
    sellOfferFeePaid: roundMoney(sellOfferFeePaid),
    totalFees: roundMoney(totalFees),
    taxPaid: roundMoney(totalFees),
    netProfit: roundMoney(netProfit),
    roiPercent: roundMoney(roiPercent),
    entryBrainScore: position.entryBrainScore ?? null,
    exitReason: event.exitReason || "DATA_FIXED_REBUILT",
  };
}

function sameTrade(a, b) {
  return (
    Number(a.id) === Number(b.id) &&
    String(a.closedAt || "") === String(b.closedAt || "") &&
    Number(a.quantity || 0) === Number(b.quantity || 0) &&
    Number(a.entryPrice || 0) === Number(b.entryPrice || 0) &&
    Number(a.sellPrice || 0) === Number(b.sellPrice || 0)
  );
}

function sameIgnoredTrade(a, b) {
  return (
    Number(a.id) === Number(b.id) &&
    Number(a.quantity || 0) === Number(b.quantity || 0) &&
    Number(a.entryPrice || 0) === Number(b.entryPrice || 0) &&
    Number(a.sellPrice || 0) === Number(b.sellPrice || 0) &&
    String(a.openedAt || "") === String(b.openedAt || "")
  );
}

function rebuildTradeStats(state) {
  const history = Array.isArray(state.tradeHistory) ? state.tradeHistory : [];

  const totalTrades = history.length;
  const totalProfit = history.reduce((sum, trade) => sum + safeNumber(trade.netProfit, 0), 0);
  const wins = history.filter((trade) => safeNumber(trade.netProfit, 0) >= 0).length;
  const losses = history.filter((trade) => safeNumber(trade.netProfit, 0) < 0).length;

  const bestTrade = [...history].sort(
    (a, b) => safeNumber(b.netProfit, 0) - safeNumber(a.netProfit, 0),
  )[0] || null;

  const worstTrade = [...history].sort(
    (a, b) => safeNumber(a.netProfit, 0) - safeNumber(b.netProfit, 0),
  )[0] || null;

  state.tradeStats = {
    totalTrades,
    totalProfit: roundMoney(totalProfit),
    wins,
    losses,
    bestTrade,
    worstTrade,
  };
}

if (!fs.existsSync(POSITIONS_FILE)) {
  console.error("positions.json not found.");
  process.exit(1);
}

backup(POSITIONS_FILE);
backup(STATE_FILE);

const positionsData = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
if (!Array.isArray(positionsData.positions)) positionsData.positions = [];

let removedDuplicates = 0;
let inferredBuyFees = 0;
let fixedTargets = 0;
let ignoredBadSales = 0;
let recalculatedSales = 0;

positionsData.positions.forEach(normalizePosition);

// Remove weak duplicate open positions, usually from manual JSON editing.
const groups = new Map();

positionsData.positions.forEach((position, index) => {
  const status = String(position.status || "").toUpperCase();
  if (status === "CLOSED") return;

  const key = [
    position.id,
    safeNumber(position.entryPrice || position.averageEntryPrice, 0),
    safeNumber(position.orderedQuantity || position.originalQuantity, 0),
    status,
  ].join("|");

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(index);
});

const removeIndexes = new Set();

for (const indexes of groups.values()) {
  if (indexes.length <= 1) continue;

  const scored = indexes
    .map((index) => {
      const position = positionsData.positions[index];
      const score =
        (position.createdAt ? 10 : 0) +
        (position.openedAt ? 5 : 0) +
        (Array.isArray(position.events) ? position.events.length : 0);

      return { index, position, score };
    })
    .sort((a, b) => b.score - a.score);

  const keeper = scored[0].position;

  for (const duplicate of scored.slice(1)) {
    const position = duplicate.position;

    if (!position.createdAt || position.events.length === 0) {
      if (safeNumber(position.buyOfferFeePaid, 0) > safeNumber(keeper.buyOfferFeePaid, 0)) {
        keeper.buyOfferFeePaid = safeNumber(position.buyOfferFeePaid, 0);
      }

      if (
        safeNumber(position.targetSell, 0) > safeNumber(keeper.targetSell, 0) &&
        safeNumber(position.targetSell, 0) > safeNumber(keeper.entryPrice, 0)
      ) {
        keeper.targetSell = safeNumber(position.targetSell, 0);
      }

      removeIndexes.add(duplicate.index);
      removedDuplicates += 1;
    }
  }
}

positionsData.positions = positionsData.positions.filter((_, index) => !removeIndexes.has(index));
positionsData.positions.forEach(normalizePosition);

// Infer missing buy fees from BUY_ORDER_PLACED events.
for (const position of positionsData.positions) {
  const buyOrderFees = position.events
    .filter((event) => event.type === "BUY_ORDER_PLACED")
    .map((event) => safeNumber(event.offerFeePaid, 0))
    .filter((fee) => fee > 0);

  const maxEventFee = buyOrderFees.length ? Math.max(...buyOrderFees) : 0;

  if (maxEventFee > safeNumber(position.buyOfferFeePaid, 0)) {
    const oldFee = safeNumber(position.buyOfferFeePaid, 0);
    position.buyOfferFeePaid = maxEventFee;
    inferredBuyFees += 1;

    addFixEvent(position, "DATA_FIX_BUY_FEE_INFERRED", {
      previousBuyOfferFeePaid: oldFee,
      newBuyOfferFeePaid: maxEventFee,
    });
  }
}

// Fix wrong target sell on open positions and matching BUY_ORDER_PLACED events.
for (const position of positionsData.positions) {
  const status = String(position.status || "").toUpperCase();
  const entryPrice = safeNumber(position.entryPrice || position.averageEntryPrice, 0);
  const targetSell = safeNumber(position.targetSell, 0);

  if (status !== "CLOSED" && entryPrice > 0 && targetSell > 0 && targetSell < entryPrice) {
    const newTarget = suggestedTargetSell(entryPrice);
    position.targetSell = newTarget;
    fixedTargets += 1;

    addFixEvent(position, "DATA_FIX_TARGET_SELL_UPDATED", {
      previousTargetSell: targetSell,
      newTargetSell: newTarget,
    });
  }

  for (const event of position.events) {
    if (event.type !== "BUY_ORDER_PLACED") continue;

    const eventTarget = safeNumber(event.targetSell, 0);
    const positionTarget = safeNumber(position.targetSell, 0);

    if (entryPrice > 0 && eventTarget > 0 && eventTarget < entryPrice && positionTarget >= entryPrice) {
      event.previousTargetSell = event.targetSell;
      event.targetSell = positionTarget;
      fixedTargets += 1;
    }
  }
}

// Mark obvious accidental duplicate sales as ignored for stats.
// Example: BUY_ORDER_FLOW sold at exact entry price with no sell fee,
// followed by MANUAL_LISTING of the same item/qty/entry.
for (const position of positionsData.positions) {
  if (String(position.status || "").toUpperCase() !== "CLOSED") continue;
  if (!String(position.flow || "").toUpperCase().includes("BUY_ORDER_FLOW")) continue;

  const soldEvents = position.events.filter((event) => event.type === "SOLD_ITEMS");
  if (soldEvents.length === 0) continue;

  const soldEvent = soldEvents[soldEvents.length - 1];

  const looksLikeAccidentalSale =
    safeNumber(soldEvent.sellPrice, 0) === safeNumber(position.entryPrice, 0) &&
    safeNumber(soldEvent.sellOfferFeePaid, 0) === 0;

  if (!looksLikeAccidentalSale) continue;

  const matchingManualListing = positionsData.positions.find((other) => {
    if (other === position) return false;

    return (
      Number(other.id) === Number(position.id) &&
      String(other.flow || "").toUpperCase().includes("MANUAL_LISTING") &&
      safeNumber(other.entryPrice || other.averageEntryPrice, 0) ===
        safeNumber(position.entryPrice || position.averageEntryPrice, 0) &&
      safeNumber(other.originalQuantity, 0) === safeNumber(position.originalQuantity, 0)
    );
  });

  if (matchingManualListing && !position.ignoredForStats) {
    position.ignoredForStats = true;
    ignoredBadSales += 1;

    addFixEvent(position, "DATA_FIX_IGNORED_DUPLICATE_SALE", {
      reason:
        "Looks like an accidental sold event before the real manual listing/sale. Kept for audit, ignored in rebuilt stats.",
      matchedPositionCreatedAt: matchingManualListing.createdAt || null,
    });
  }
}

// Recalculate SOLD_ITEMS events from corrected top-level fees.
const rebuiltTrades = [];
const ignoredTrades = [];

for (const position of positionsData.positions) {
  for (const event of position.events) {
    if (event.type !== "SOLD_ITEMS") continue;

    const trade = buildSoldTrade(position, event);

    event.grossSell = trade.grossSell;
    event.buyOfferFeePaid = trade.buyOfferFeePaid;
    event.sellOfferFeePaid = trade.sellOfferFeePaid;
    event.totalFees = trade.totalFees;
    event.netProfit = trade.netProfit;
    event.roiPercent = trade.roiPercent;

    recalculatedSales += 1;

    if (position.ignoredForStats) {
      ignoredTrades.push(trade);
    } else {
      rebuiltTrades.push(trade);
    }
  }
}

fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positionsData, null, 2) + "\n");

// Update state.json safely: preserve unrelated state, remove ignored bad trades,
// update matching trades, append missing sold events from positions.
if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (!Array.isArray(state.tradeHistory)) state.tradeHistory = [];

  state.tradeHistory = state.tradeHistory.filter(
    (trade) => !ignoredTrades.some((ignored) => sameTrade(trade, ignored) || sameIgnoredTrade(trade, ignored)),
  );

  for (const rebuilt of rebuiltTrades) {
    const existingIndex = state.tradeHistory.findIndex(
      (trade) => sameTrade(trade, rebuilt) || sameIgnoredTrade(trade, rebuilt),
    );

    if (existingIndex >= 0) {
      state.tradeHistory[existingIndex] = {
        ...state.tradeHistory[existingIndex],
        ...rebuilt,
      };
    } else {
      state.tradeHistory.push(rebuilt);
    }
  }

  state.tradeHistory.sort((a, b) => String(a.closedAt || "").localeCompare(String(b.closedAt || "")));
  rebuildTradeStats(state);

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

console.log("Data fix complete.");
console.log("Removed duplicate open positions:", removedDuplicates);
console.log("Inferred missing buy fees:", inferredBuyFees);
console.log("Fixed target sell values/events:", fixedTargets);
console.log("Ignored accidental duplicate sold events:", ignoredBadSales);
console.log("Recalculated sold events:", recalculatedSales);
console.log("");
console.log("Next checks:");
console.log("  npm run trade -- dashboard");
console.log("  npm run trade -- stats");
