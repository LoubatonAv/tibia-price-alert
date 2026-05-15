import fs from "fs";
import { loadState, saveState } from "./lib/state.js";
import {
  closeTrade,
  normalizePosition,
  calculateBuyOfferFee,
  calculateSellOfferFee,
} from "./lib/trades.js";
import { getItemMap } from "./lib/market.js";

const POSITIONS_FILE = "./positions.json";

function resolveItem(input) {
  const itemMap = getItemMap();

  if (!isNaN(Number(input))) {
    const id = Number(input);

    return {
      id,
      name: itemMap[id] || `Unknown Item (${id})`,
    };
  }

  const normalized = String(input).trim().toLowerCase();

  const found = Object.entries(itemMap).find(
    ([_, name]) => String(name).trim().toLowerCase() === normalized,
  );

  if (!found) {
    throw new Error(
      `Item not found: ${input}. Try using the numeric item ID instead.`,
    );
  }

  return {
    id: Number(found[0]),
    name: found[1],
  };
}

function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) {
    return { positions: [] };
  }

  const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
  if (!data.positions) data.positions = [];
  data.positions.forEach(normalizePosition);
  return data;
}

function savePositions(data) {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function fail(message) {
  console.log(`\n❌ ${message}\n`);
  process.exit(1);
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function calculateDefaultTargetSell(entryPrice, desiredMargin = 0.06) {
  const price = Number(entryPrice || 0);
  if (!price) return 0;
  return Math.ceil((price * (1 + desiredMargin)) / (1 - 0.02));
}

function formatAge(fromDate) {
  if (!fromDate) return "N/A";
  const diffMs = Date.now() - new Date(fromDate).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "N/A";
  const hours = diffMs / 1000 / 60 / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function printUsage() {
  console.log(`
Usage:

New safer flow:
  node trade.js buy ITEM_ID_OR_NAME ENTRY_PRICE QUANTITY [TARGET_SELL] [BRAIN_SCORE]
  node trade.js receive ITEM_ID_OR_NAME QUANTITY [ACTUAL_ENTRY_PRICE]
  node trade.js list ITEM_ID_OR_NAME QUANTITY LIST_PRICE
  node trade.js sold ITEM_ID_OR_NAME QUANTITY SELL_PRICE

Backward compatible old flow:
  node trade.js open ITEM_ID_OR_NAME ENTRY_PRICE QUANTITY TARGET_SELL [BRAIN_SCORE]
  node trade.js close ITEM_ID_OR_NAME SELL_PRICE [QUANTITY]

Stats:
  node trade.js orders
  node trade.js cancel ITEM_ID_OR_NAME [REASON]
  node trade.js expire ITEM_ID_OR_NAME
  node trade.js stats
`);
}

function findActivePosition(positionsData, itemId) {
  return positionsData.positions.find(
    (p) => Number(p.id) === Number(itemId) && p.status !== "CLOSED",
  );
}

function addEvent(position, type, details = {}) {
  normalizePosition(position);
  position.events.push({
    type,
    at: new Date().toISOString(),
    ...details,
  });
}

function printPosition(position) {
  const targetSell = Number(position.targetSell || 0);
  const ordered = Number(position.orderedQuantity || position.originalQuantity || 0);
  const received = Number(position.receivedQuantity || 0);
  const stillWaiting = Math.max(0, ordered - received);

  console.log(`Item: ${position.name}`);
  console.log(`Status: ${position.status}`);
  console.log(`Order age: ${formatAge(position.openedAt || position.createdAt)}`);
  console.log(`Ordered quantity: ${ordered}`);
  console.log(`Still waiting: ${stillWaiting}`);
  console.log(`Owned / unsold quantity: ${position.quantity}`);
  console.log(`Original quantity: ${position.originalQuantity}`);
  console.log(`Received: ${position.receivedQuantity}`);
  console.log(`Listed: ${position.listedQuantity}`);
  console.log(`Sold: ${position.soldQuantity}`);
  console.log(`Entry: ${formatGp(position.entryPrice)} gp`);
  console.log(`Target sell: ${targetSell > 0 ? `${formatGp(targetSell)} gp` : "auto / not set"}`);
  console.log(`Buy fee paid: ${formatGp(position.buyOfferFeePaid)} gp`);
  if (["BUY_ORDER_PLACED", "BUY_ORDER_PARTIAL"].includes(position.status)) {
    console.log(`If cancelled now, buy fee is already lost: ${formatGp(position.buyOfferFeePaid)} gp`);
  }
  console.log(`Brain: ${position.entryBrainScore ?? "N/A"}`);
}

function printStats() {
  const state = loadState();
  const history = state.tradeHistory || [];

  const totalTrades = history.length;
  const wins = history.filter((t) => t.netProfit >= 0).length;
  const losses = history.filter((t) => t.netProfit < 0).length;
  const totalProfit = history.reduce(
    (sum, t) => sum + Number(t.netProfit || 0),
    0,
  );
  const totalQuantity = history.reduce(
    (sum, t) => sum + Number(t.quantity || 0),
    0,
  );
  const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
  const avgRoi =
    totalTrades > 0
      ? history.reduce((sum, t) => sum + Number(t.roiPercent || 0), 0) /
        totalTrades
      : 0;

  const bestTrade = [...history].sort((a, b) => b.netProfit - a.netProfit)[0];
  const worstTrade = [...history].sort((a, b) => a.netProfit - b.netProfit)[0];

  const itemStats = {};

  for (const trade of history) {
    const key = String(trade.id);
    if (!itemStats[key]) {
      itemStats[key] = {
        id: trade.id,
        name: trade.name,
        trades: 0,
        quantity: 0,
        totalProfit: 0,
        totalRoi: 0,
      };
    }

    itemStats[key].trades += 1;
    itemStats[key].quantity += Number(trade.quantity || 0);
    itemStats[key].totalProfit += Number(trade.netProfit || 0);
    itemStats[key].totalRoi += Number(trade.roiPercent || 0);
  }

  const rankedItems = Object.entries(itemStats)
    .map(([_, stats]) => ({
      id: stats.id,
      name: stats.name,
      trades: stats.trades,
      quantity: stats.quantity,
      totalProfit: stats.totalProfit,
      avgRoi: stats.totalRoi / stats.trades,
    }))
    .sort((a, b) => b.totalProfit - a.totalProfit);

  console.log("\nTIBIA TRADE STATS\n");
  console.log(`Closed sale events: ${totalTrades}`);
  console.log(`Total items sold: ${totalQuantity}`);
  console.log(`Wins: ${wins}`);
  console.log(`Losses: ${losses}`);
  console.log(
    `Winrate: ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : "0.00"}%`,
  );
  console.log(`Total profit: ${formatGp(totalProfit)} gp`);
  console.log(`Average profit per sale event: ${formatGp(avgProfit)} gp`);
  console.log(`Average ROI: ${avgRoi.toFixed(2)}%`);

  if (bestTrade) {
    console.log(
      `\nBest sale: ${bestTrade.name} (+${formatGp(bestTrade.netProfit)} gp, qty ${bestTrade.quantity})`,
    );
  }

  if (worstTrade) {
    console.log(
      `Worst sale: ${worstTrade.name} (${formatGp(worstTrade.netProfit)} gp, qty ${worstTrade.quantity})`,
    );
  }

  if (rankedItems.length > 0) {
    console.log("\nTop items:\n");

    rankedItems.slice(0, 5).forEach((item, index) => {
      console.log(
        `#${index + 1} ${item.name}\n` +
          `Sale events: ${item.trades}\n` +
          `Quantity sold: ${item.quantity}\n` +
          `Profit: ${formatGp(item.totalProfit)} gp\n` +
          `Average ROI: ${item.avgRoi.toFixed(2)}%\n`,
      );
    });
  }
}

function printOrders() {
  const positionsData = loadPositions();
  const active = positionsData.positions.filter((position) => position.status !== "CLOSED");

  console.log("\nOPEN ORDERS / POSITIONS\n");

  if (active.length === 0) {
    console.log("No open orders or positions.");
    return;
  }

  active.forEach((position, index) => {
    normalizePosition(position);
    const ordered = Number(position.orderedQuantity || position.originalQuantity || 0);
    const received = Number(position.receivedQuantity || 0);
    const waiting = Math.max(0, ordered - received);

    console.log(`#${index + 1} ${position.name} (${position.id})`);
    console.log(`Status: ${position.status}`);
    console.log(`Age: ${formatAge(position.openedAt || position.createdAt)}`);
    console.log(`Entry: ${formatGp(position.entryPrice)} gp | Target: ${position.targetSell ? `${formatGp(position.targetSell)} gp` : "auto / not set"}`);
    console.log(`Ordered: ${ordered} | Waiting: ${waiting} | Owned: ${position.quantity} | Listed: ${position.listedQuantity} | Sold: ${position.soldQuantity}`);
    console.log(`Fees paid: buy ${formatGp(position.buyOfferFeePaid)} gp, sell ${formatGp(position.sellOfferFeePaid)} gp`);
    console.log("");
  });
}

const [, , rawAction, ...args] = process.argv;
const actionAliases = {
  "buy-order": "buy",
  add: "add",
  open: "open",
  close: "close",
  positions: "orders",
};
const action = actionAliases[rawAction] || rawAction;

if (
  !["buy", "receive", "list", "sold", "open", "close", "add", "orders", "cancel", "expire", "stats"].includes(action)
) {
  printUsage();
  process.exit(1);
}

if (action === "stats") {
  printStats();
  process.exit(0);
}

if (action === "orders") {
  printOrders();
  process.exit(0);
}

const positionsData = loadPositions();

if (action === "buy" || action === "open") {
  const [itemInput, entryPrice, quantity, targetSell, brainScore] = args;

  if (!itemInput || !entryPrice || !quantity) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(entryPrice))
    fail("ENTRY_PRICE must be a positive number.");
  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  const finalTargetSell = isPositiveNumber(targetSell)
    ? Number(targetSell)
    : calculateDefaultTargetSell(Number(entryPrice));

  if (
    brainScore &&
    (!Number.isFinite(Number(brainScore)) ||
      Number(brainScore) < 0 ||
      Number(brainScore) > 100)
  ) {
    fail("BRAIN_SCORE must be between 0 and 100.");
  }

  const resolvedItem = resolveItem(itemInput);
  const existingOpen = findActivePosition(positionsData, resolvedItem.id);

  if (existingOpen) {
    console.log("There is already an active position for this item.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const qty = Number(quantity);
  const buyOfferFeePaid = calculateBuyOfferFee(Number(entryPrice), qty);

  const position = {
    id: resolvedItem.id,
    name: resolvedItem.name,
    createdAt: now,
    openedAt: now,
    flow: action === "open" ? "LEGACY_OPEN" : "BUY_ORDER_FLOW",
    entryPrice: Number(entryPrice),
    averageEntryPrice: Number(entryPrice),

    originalQuantity: qty,

    // quantity = how many items you CURRENTLY own and have not sold yet
    quantity: action === "open" ? qty : 0,

    orderedQuantity: qty,
    receivedQuantity: action === "open" ? qty : 0,

    listedQuantity: 0,

    // ADD THIS:
    soldQuantity: 0,

    totalListedQuantity: 0,

    buyOfferFeePaid,
    sellOfferFeePaid: 0,

    targetSell: finalTargetSell,
    desiredMargin: 0.06,
    entryBrainScore: brainScore ? Number(brainScore) : null,

    status: action === "open" ? "OPEN" : "BUY_ORDER_PLACED",

    events: [
      {
        type: action === "open" ? "LEGACY_OPEN" : "BUY_ORDER_PLACED",
        at: now,
        entryPrice: Number(entryPrice),
        quantity: qty,
        targetSell: finalTargetSell,
        offerFeePaid: buyOfferFeePaid,
        brainScore: brainScore ? Number(brainScore) : null,
      },
    ],
  };

  positionsData.positions.push(position);
  savePositions(positionsData);

  console.log(
    action === "open" ? "\nPOSITION OPENED\n" : "\nBUY ORDER ADDED\n",
  );
  printPosition(position);
  console.log(`Buy offer fee paid: ${formatGp(buyOfferFeePaid)} gp`);
  process.exit(0);
}

if (action === "add") {
  const [itemInput, quantity, costPerItem = 0] = args;
  if (!itemInput || !quantity) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (costPerItem && !Number.isFinite(Number(costPerItem))) fail("COST_PER_ITEM must be a number.");

  const resolvedItem = resolveItem(itemInput);
  const existingOpen = findActivePosition(positionsData, resolvedItem.id);

  if (existingOpen) {
    console.log("There is already an active position for this item.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const qty = Number(quantity);
  const cost = Number(costPerItem || 0);

  const position = {
    id: resolvedItem.id,
    name: resolvedItem.name,
    createdAt: now,
    openedAt: now,
    flow: "EXTERNAL_INVENTORY",
    entryPrice: cost,
    averageEntryPrice: cost,
    originalQuantity: qty,
    quantity: qty,
    orderedQuantity: qty,
    receivedQuantity: qty,
    listedQuantity: 0,
    soldQuantity: 0,
    totalListedQuantity: 0,
    buyOfferFeePaid: 0,
    sellOfferFeePaid: 0,
    targetSell: 0,
    desiredMargin: 0.06,
    entryBrainScore: null,
    status: "EXTERNAL_READY",
    events: [
      {
        type: "EXTERNAL_ITEMS_ADDED",
        at: now,
        quantity: qty,
        entryPrice: cost,
      },
    ],
  };

  positionsData.positions.push(position);
  savePositions(positionsData);

  console.log("\nEXTERNAL ITEMS ADDED\n");
  printPosition(position);
  console.log("Next step: list items for sale, instant sell, or keep tracking.");
  process.exit(0);
}

if (action === "cancel" || action === "expire") {
  const [itemInput, ...reasonParts] = args;
  if (!itemInput) {
    printUsage();
    process.exit(1);
  }

  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);
  if (!position) fail("No active order/position found for this item.");

  normalizePosition(position);

  if (position.quantity > 0 || position.receivedQuantity > 0) {
    fail("This order already received items. Use list/sold flow for owned items; cancel only untouched buy orders.");
  }

  const now = new Date().toISOString();
  const reason = reasonParts.join(" ") || (action === "expire" ? "Order expired after 30 days" : "Manual cancel");

  position.status = action === "expire" ? "BUY_ORDER_EXPIRED" : "BUY_ORDER_CANCELLED";
  position.cancelledAt = now;
  position.cancelReason = reason;
  addEvent(position, position.status, {
    reason,
    lostBuyOfferFee: Number(position.buyOfferFeePaid || 0),
  });

  savePositions(positionsData);

  console.log(action === "expire" ? "\nBUY ORDER EXPIRED\n" : "\nBUY ORDER CANCELLED\n");
  printPosition(position);
  console.log(`Reason: ${reason}`);
  console.log(`Fee lost: ${formatGp(position.buyOfferFeePaid)} gp`);
  process.exit(0);
}

if (action === "receive") {
  const [itemInput, quantity, actualEntryPrice] = args;
  if (!itemInput || !quantity) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (actualEntryPrice && !isPositiveNumber(actualEntryPrice)) {
    fail("ACTUAL_ENTRY_PRICE must be a positive number.");
  }

  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found for this item.");

  const receiveQty = Number(quantity);
  const newEntry = actualEntryPrice
    ? Number(actualEntryPrice)
    : position.entryPrice;
  const previousReceived = Number(position.receivedQuantity || 0);
  const previousCost =
    previousReceived *
    Number(position.averageEntryPrice || position.entryPrice || 0);
  const newCost = receiveQty * newEntry;
  const newReceivedTotal = previousReceived + receiveQty;

  position.receivedQuantity = newReceivedTotal;
  position.quantity = Number(position.quantity || 0) + receiveQty;
  position.averageEntryPrice =
    newReceivedTotal > 0
      ? (previousCost + newCost) / newReceivedTotal
      : newEntry;
  position.entryPrice = position.averageEntryPrice;
  position.status = "ITEMS_RECEIVED";

  addEvent(position, "ITEMS_RECEIVED", {
    quantity: receiveQty,
    entryPrice: newEntry,
    averageEntryPrice: position.averageEntryPrice,
  });

  savePositions(positionsData);

  console.log("\nITEMS RECEIVED\n");
  printPosition(position);
  process.exit(0);
}

if (action === "list") {
  const [itemInput, quantity, listPrice] = args;
  if (!itemInput || !quantity || !listPrice) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (!isPositiveNumber(listPrice))
    fail("LIST_PRICE must be a positive number.");

  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found for this item.");

  const listQty = Number(quantity);
  if (listQty > Number(position.quantity || 0)) {
    fail(
      `Cannot list ${listQty}; only ${position.quantity} unsold items are tracked.`,
    );
  }

  const sellOfferFeePaid = calculateSellOfferFee(Number(listPrice), listQty);

  position.listedQuantity = Number(position.listedQuantity || 0) + listQty;
  position.totalListedQuantity =
    Number(position.totalListedQuantity || 0) + listQty;
  position.sellOfferFeePaid =
    Number(position.sellOfferFeePaid || 0) + sellOfferFeePaid;
  position.lastListPrice = Number(listPrice);
  position.lastListedAt = new Date().toISOString();
  position.status =
    position.listedQuantity >= position.quantity
      ? "LISTED_FOR_SALE"
      : "PARTIALLY_LISTED";

  addEvent(position, "LISTED_FOR_SALE", {
    quantity: listQty,
    listPrice: Number(listPrice),
    offerFeePaid: sellOfferFeePaid,
  });

  savePositions(positionsData);

  console.log("\nITEMS LISTED FOR SALE\n");
  printPosition(position);
  console.log(`List price: ${formatGp(listPrice)} gp`);
  console.log(`Sell offer fee paid: ${formatGp(sellOfferFeePaid)} gp`);
  process.exit(0);
}

if (action === "sold" || action === "close") {
  const [itemInput, firstNumber, secondNumber] = args;
  if (!itemInput || !firstNumber) {
    printUsage();
    process.exit(1);
  }

  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found.");

  const quantity =
    action === "close" && !secondNumber
      ? position.quantity
      : Number(firstNumber);
  const sellPrice =
    action === "close" && !secondNumber
      ? Number(firstNumber)
      : secondNumber
        ? Number(secondNumber)
        : Number(position.lastListPrice || 0);

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (!isPositiveNumber(sellPrice))
    fail("SELL_PRICE must be a positive number.");

  const state = loadState();

  const trade = closeTrade({
    state,
    position,
    sellPrice,
    quantity,
    exitReason: action === "close" ? "MANUAL_CLOSE" : "PARTIAL_OR_FULL_SOLD",
  });

  savePositions(positionsData);
  saveState(state);

  console.log(
    position.status === "CLOSED"
      ? "\nTRADE CLOSED\n"
      : "\nPARTIAL SALE RECORDED\n",
  );
  console.log(`Item: ${trade.name}`);
  console.log(`Sold quantity: ${trade.quantity}`);
  if (position.status === "BUY_ORDER_PLACED") {
    console.log(`Ordered quantity: ${position.orderedQuantity}`);
  } else {
    console.log(`Remaining quantity: ${position.quantity}`);
  }
  console.log(`Entry: ${formatGp(trade.entryPrice)} gp`);
  console.log(`Sell: ${formatGp(trade.sellPrice)} gp`);
  console.log(`Buy offer fee used: ${formatGp(trade.buyOfferFeePaid)} gp`);
  console.log(`Sell offer fee used: ${formatGp(trade.sellOfferFeePaid)} gp`);
  console.log(`Total fees used: ${formatGp(trade.totalFees)} gp`);
  console.log(`Profit: ${formatGp(trade.netProfit)} gp`);
  console.log(`ROI: ${trade.roiPercent.toFixed(2)}%`);
  process.exit(0);
}
