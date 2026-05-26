import fs from "fs";
import { loadState, saveState } from "./lib/state.js";
import {
  closeTrade,
  normalizePosition,
  calculateBuyOfferFee,
  calculateSellOfferFee,
} from "./lib/trades.js";
import { getItemMap } from "./lib/market.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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
  const ordered = Number(
    position.orderedQuantity || position.originalQuantity || 0,
  );
  const received = Number(position.receivedQuantity || 0);
  const stillWaiting = Math.max(0, ordered - received);

  console.log(`Item: ${position.name}`);
  console.log(`Status: ${position.status}`);
  console.log(
    `Order age: ${formatAge(position.openedAt || position.createdAt)}`,
  );
  console.log(`Ordered quantity: ${ordered}`);
  console.log(`Still waiting: ${stillWaiting}`);
  console.log(`Owned / unsold quantity: ${position.quantity}`);
  console.log(`Original quantity: ${position.originalQuantity}`);
  console.log(`Received: ${position.receivedQuantity}`);
  console.log(`Listed: ${position.listedQuantity}`);
  console.log(`Sold: ${position.soldQuantity}`);
  console.log(`Entry: ${formatGp(position.entryPrice)} gp`);
  console.log(
    `Target sell: ${targetSell > 0 ? `${formatGp(targetSell)} gp` : "auto / not set"}`,
  );
  console.log(`Buy fee paid: ${formatGp(position.buyOfferFeePaid)} gp`);
  if (["BUY_ORDER_PLACED", "BUY_ORDER_PARTIAL"].includes(position.status)) {
    console.log(
      `If cancelled now, buy fee is already lost: ${formatGp(position.buyOfferFeePaid)} gp`,
    );
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

  const active = positionsData.positions.filter(
    (position) => position.status !== "CLOSED",
  );

  console.log("\nOPEN ORDERS / POSITIONS\n");

  if (active.length === 0) {
    console.log("No open orders or positions.");
    return;
  }

  active.forEach((position, index) => {
    normalizePosition(position);
    const ordered = Number(
      position.orderedQuantity || position.originalQuantity || 0,
    );
    const received = Number(position.receivedQuantity || 0);
    const waiting = Math.max(0, ordered - received);

    console.log(`#${index + 1} ${position.name} (${position.id})`);
    console.log(`Status: ${position.status}`);
    console.log(`Age: ${formatAge(position.openedAt || position.createdAt)}`);
    console.log(
      `Entry: ${formatGp(position.entryPrice)} gp | Target: ${position.targetSell ? `${formatGp(position.targetSell)} gp` : "auto / not set"}`,
    );
    console.log(
      `Ordered: ${ordered} | Waiting: ${waiting} | Owned: ${position.quantity} | Listed: ${position.listedQuantity} | Sold: ${position.soldQuantity}`,
    );
    console.log(
      `Market fees paid: buy offer ${formatGp(position.buyOfferFeePaid)} gp, sell offer ${formatGp(position.sellOfferFeePaid)} gp`,
    );
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
  "buy-fee": "buyfee",
};
const action = actionAliases[rawAction] || rawAction;

if (
  ![
    "buy",
    "receive",
    "list",
    "sold",
    "open",
    "close",
    "add",
    "orders",
    "cancel",
    "expire",
    "stats",
    "buyfee",
  ].includes(action)
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
if (action === "buyfee") {
  const parsed = parseItemAndOptionalNumberArgs(args);

  if (!parsed || !parsed.itemInput) {
    console.log(`
Usage:
  node trade.js buyfee ITEM_ID_OR_NAME [BUY_OFFER_FEE]

Examples:
  node trade.js buyfee "stone skin amulet"
  node trade.js buyfee stone skin amulet
  node trade.js buyfee stone skin amulet 1639.8
`);
    process.exit(1);
  }

  const { itemInput, manualNumber } = parsed;
  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);

  if (!position) {
    fail("No active position found for this item.");
  }

  normalizePosition(position);

  const entryPrice = Number(
    position.averageEntryPrice || position.entryPrice || 0,
  );
  const quantity = Number(
    position.originalQuantity ||
      position.orderedQuantity ||
      position.receivedQuantity ||
      position.quantity ||
      0,
  );

  const calculatedBuyOfferFee = calculateBuyOfferFee(entryPrice, quantity);
  const newBuyOfferFee =
    manualNumber !== null ? manualNumber : calculatedBuyOfferFee;

  if (!Number.isFinite(newBuyOfferFee) || newBuyOfferFee < 0) {
    fail("BUY_OFFER_FEE must be 0 or higher.");
  }

  const previousBuyOfferFee = Number(position.buyOfferFeePaid || 0);

  position.buyOfferFeePaid = newBuyOfferFee;

  addEvent(position, "BUY_OFFER_FEE_UPDATED", {
    previousBuyOfferFee,
    newBuyOfferFee,
    calculatedBuyOfferFee,
    entryPrice,
    quantity,
    source: manualNumber !== null ? "manual" : "auto_calculated",
  });

  savePositions(positionsData);

  console.log("\nBUY OFFER FEE UPDATED\n");
  console.log(`Item: ${position.name}`);
  console.log(`Entry: ${formatGp(entryPrice)} gp`);
  console.log(`Quantity used: ${quantity}`);
  console.log(`Previous buy offer fee: ${formatGp(previousBuyOfferFee)} gp`);
  console.log(`New buy offer fee: ${formatGp(newBuyOfferFee)} gp`);
  console.log(`Auto calculated fee: ${formatGp(calculatedBuyOfferFee)} gp`);
  process.exit(0);
}
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
  if (costPerItem && !Number.isFinite(Number(costPerItem)))
    fail("COST_PER_ITEM must be a number.");

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
    buyOfferFeePaid,
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
  console.log(
    "Next step: list items for sale, instant sell, or keep tracking.",
  );
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
    fail(
      "This order already received items. Use list/sold flow for owned items; cancel only untouched buy orders.",
    );
  }

  const now = new Date().toISOString();
  const reason =
    reasonParts.join(" ") ||
    (action === "expire" ? "Order expired after 30 days" : "Manual cancel");

  position.status =
    action === "expire" ? "BUY_ORDER_EXPIRED" : "BUY_ORDER_CANCELLED";
  position.cancelledAt = now;
  position.cancelReason = reason;
  addEvent(position, position.status, {
    reason,
    lostBuyOfferFee: Number(position.buyOfferFeePaid || 0),
  });

  savePositions(positionsData);

  console.log(
    action === "expire" ? "\nBUY ORDER EXPIRED\n" : "\nBUY ORDER CANCELLED\n",
  );
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

async function chooseActivePosition(positionsData, itemId) {
  const positions = Array.isArray(positionsData.positions)
    ? positionsData.positions
    : [];

  const activePositions = positions.filter((position) => {
    const sameItem = String(position.id) === String(itemId);
    const status = String(position.status || "").toUpperCase();

    const isClosed =
      status === "SOLD" ||
      status === "CLOSED" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "BUY_ORDER_CANCELLED" ||
      status === "BUY_ORDER_EXPIRED";

    const ownedQuantity = Number(position.quantity || 0);

    return sameItem && !isClosed && ownedQuantity > 0;
  });

  if (activePositions.length === 0) {
    return null;
  }

  if (activePositions.length === 1) {
    return activePositions[0];
  }

  console.log("\nMultiple active positions found for this item:\n");

  activePositions.forEach((position, index) => {
    const ownedQuantity = Number(position.quantity || 0);
    const listedQuantity = Number(position.listedQuantity || 0);
    const availableToList = Math.max(0, ownedQuantity - listedQuantity);

    console.log(
      `${index + 1}) ${position.name} | status: ${position.status} | owned: ${ownedQuantity} | listed: ${listedQuantity} | available: ${availableToList} | entry: ${
        position.entryPrice ?? position.averageEntryPrice ?? "?"
      } gp`,
    );
  });

  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(
    "\nChoose which position to update by number: ",
  );

  rl.close();

  const selectedIndex = Number(answer) - 1;

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= activePositions.length
  ) {
    fail("Invalid position selection.");
  }

  return activePositions[selectedIndex];
}

async function askYesNo(question) {
  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(`${question}: `);

  rl.close();

  return String(answer).trim().toLowerCase() === "y";
}

function parseListArgs(args) {
  if (args.length < 3) {
    return null;
  }

  const listPrice = args[args.length - 1];
  const quantity = args[args.length - 2];
  const itemInput = args.slice(0, -2).join(" ");

  return {
    itemInput,
    quantity,
    listPrice,
  };
}

function parseItemAndOptionalNumberArgs(args) {
  if (args.length < 1) {
    return null;
  }

  const lastArg = args[args.length - 1];
  const hasManualNumber = Number.isFinite(Number(lastArg));

  return {
    itemInput: hasManualNumber ? args.slice(0, -1).join(" ") : args.join(" "),
    manualNumber: hasManualNumber ? Number(lastArg) : null,
  };
}

if (action === "list") {
  const parsed = parseListArgs(args);

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { itemInput, quantity, listPrice } = parsed;

  if (!itemInput || !quantity || !listPrice) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(quantity)) {
    fail("QUANTITY must be a positive number.");
  }

  if (!isPositiveNumber(listPrice)) {
    fail("LIST_PRICE must be a positive number.");
  }

  const resolvedItem = resolveItem(itemInput);
  let position = await chooseActivePosition(positionsData, resolvedItem.id);

  const listQty = Number(quantity);
  const numericListPrice = Number(listPrice);

  if (!position) {
    console.log(`\nNo active position found for ${resolvedItem.name}.`);
    console.log(
      `You are trying to list ${listQty}x at ${formatGp(numericListPrice)} gp each.`,
    );

    const createNew = await askYesNo(
      "\nCreate a new position for this already-listed item? Y/N",
    );

    if (!createNew) {
      console.log("\nCancelled. Nothing was saved.\n");
      process.exit(0);
    }

    const rl = readline.createInterface({ input, output });

    const entryAnswer = await rl.question(
      "\nEnter actual entry price / cost per item. Use 0 if this was loot/drop: ",
    );

    rl.close();

    const entryPrice = Number(entryAnswer);

    if (!Number.isFinite(entryPrice) || entryPrice < 0) {
      fail("ENTRY_PRICE must be 0 or higher.");
    }
    const hadBuyOfferFee = await askYesNo(
      "\nDid you originally buy this through a Tibia buy offer? Y/N",
    );

    const buyOfferFeePaid = hadBuyOfferFee
      ? calculateBuyOfferFee(entryPrice, listQty)
      : 0;

    const now = new Date().toISOString();

    position = {
      id: resolvedItem.id,
      name: resolvedItem.name,
      createdAt: now,
      openedAt: now,
      flow: "MANUAL_LISTING",
      entryPrice,
      averageEntryPrice: entryPrice,
      originalQuantity: listQty,
      quantity: listQty,
      orderedQuantity: listQty,
      receivedQuantity: listQty,
      listedQuantity: 0,
      soldQuantity: 0,
      totalListedQuantity: 0,
      buyOfferFeePaid: 0,
      sellOfferFeePaid: 0,
      targetSell: null,
      desiredMargin: 0,
      entryBrainScore: null,
      status: "EXTERNAL_READY",
      events: [
        {
          type: "MANUAL_POSITION_CREATED_FROM_LISTING",
          at: now,
          quantity: listQty,
          entryPrice,
          listPrice: numericListPrice,
          buyOfferFeePaid,
        },
      ],
    };

    positionsData.positions.push(position);
  }

  normalizePosition(position);

  const ownedQuantity = Number(position.quantity || 0);
  const alreadyListedQuantity = Number(position.listedQuantity || 0);
  const availableToList = Math.max(0, ownedQuantity - alreadyListedQuantity);

  const isAlreadyFullyListed =
    alreadyListedQuantity >= ownedQuantity && ownedQuantity > 0;

  let sellOfferFeePaid = 0;

  if (isAlreadyFullyListed) {
    console.log(
      `\nThis item is already listed for sale: ${alreadyListedQuantity}/${ownedQuantity}.`,
    );
    console.log(
      `Current tracked list price: ${formatGp(position.lastListPrice)} gp`,
    );
    console.log(`New list price: ${formatGp(numericListPrice)} gp`);

    const updateExisting = await askYesNo(
      "\nDid you cancel/relist or update this sell offer in Tibia Market? Y/N",
    );

    if (!updateExisting) {
      console.log("\nCancelled. Nothing was changed.\n");
      process.exit(0);
    }

    if (listQty !== alreadyListedQuantity) {
      fail(
        `This position is already fully listed with ${alreadyListedQuantity} items. Use sold when items sell, or cancel manually if you removed the offer.`,
      );
    }

    sellOfferFeePaid = calculateSellOfferFee(numericListPrice, listQty);

    position.sellOfferFeePaid =
      Number(position.sellOfferFeePaid || 0) + sellOfferFeePaid;

    position.lastListPrice = numericListPrice;
    position.lastListedAt = new Date().toISOString();

    addEvent(position, "SELL_OFFER_RELISTED", {
      quantity: listQty,
      listPrice: numericListPrice,
      offerFeePaid: sellOfferFeePaid,
      previousListPrice: position.lastListPrice,
    });
  } else {
    if (listQty > availableToList) {
      fail(
        `Cannot list ${listQty}; only ${availableToList} unlisted items are available. Owned: ${ownedQuantity}, already listed: ${alreadyListedQuantity}.`,
      );
    }

    sellOfferFeePaid = calculateSellOfferFee(numericListPrice, listQty);

    position.listedQuantity = alreadyListedQuantity + listQty;
    position.totalListedQuantity =
      Number(position.totalListedQuantity || 0) + listQty;
    position.sellOfferFeePaid =
      Number(position.sellOfferFeePaid || 0) + sellOfferFeePaid;
    position.lastListPrice = numericListPrice;
    position.lastListedAt = new Date().toISOString();

    position.status =
      position.listedQuantity >= Number(position.quantity || 0)
        ? "LISTED_FOR_SALE"
        : "PARTIALLY_LISTED";
  }

  position.status =
    position.listedQuantity >= Number(position.quantity || 0)
      ? "LISTED_FOR_SALE"
      : "PARTIALLY_LISTED";

  addEvent(position, "LISTED_FOR_SALE", {
    quantity: listQty,
    listPrice: numericListPrice,
    offerFeePaid: sellOfferFeePaid,
  });

  savePositions(positionsData);

  console.log("\nITEMS LISTED FOR SALE\n");
  printPosition(position);
  console.log(`List price: ${formatGp(numericListPrice)} gp`);
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
