import fs from "fs";
import { loadState, saveState } from "./lib/state.js";
import {
  closeTrade,
  normalizePosition,
  calculateBuyOfferFee,
  calculateSellOfferFee,
  calculateClosedTrade,
} from "./lib/trades.js";
import { getItemMap } from "./lib/market.js";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

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

function printUsage() {
  console.log(`
Usage:

New safer flow:
  node trade.js buy ITEM_ID_OR_NAME ENTRY_PRICE QUANTITY TARGET_SELL [BRAIN_SCORE]
  node trade.js receive ITEM_ID_OR_NAME QUANTITY [ACTUAL_ENTRY_PRICE]
  node trade.js add ITEM_ID_OR_NAME QUANTITY COST_PER_ITEM
  node trade.js list ITEM_ID_OR_NAME QUANTITY LIST_PRICE
  node trade.js sold ITEM_ID_OR_NAME QUANTITY [SELL_PRICE]

Backward compatible old flow:
  node trade.js open ITEM_ID_OR_NAME ENTRY_PRICE QUANTITY TARGET_SELL [BRAIN_SCORE]
  node trade.js close ITEM_ID_OR_NAME SELL_PRICE [QUANTITY]

Stats:
  node trade.js stats
`);
}

function findActivePosition(positionsData, itemId) {
  return positionsData.positions.find(
    (p) => Number(p.id) === Number(itemId) && p.status !== "CLOSED",
  );
}

function findActivePositions(positionsData, itemId) {
  return positionsData.positions.filter(
    (p) => Number(p.id) === Number(itemId) && p.status !== "CLOSED",
  );
}

async function askYesNo(question) {
  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(`${question} `);
  rl.close();

  return ["y", "yes", "כן", "כ"].includes(answer.trim().toLowerCase());
}

async function chooseActivePosition(positionsData, itemId) {
  const positions = findActivePositions(positionsData, itemId);

  if (positions.length === 0) return null;
  if (positions.length === 1) return positions[0];

  console.log("\nMultiple active positions found:\n");

  positions.forEach((position, index) => {
    console.log(
      `${index + 1}. ${position.flow} | qty ${position.quantity} | listed ${position.listedQuantity} | cost ${formatGp(position.entryPrice)} gp | status ${position.status}`,
    );
  });

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("\nChoose position number: ");
  rl.close();

  const selectedIndex = Number(answer) - 1;

  if (!Number.isInteger(selectedIndex) || !positions[selectedIndex]) {
    fail("Invalid position choice.");
  }

  return positions[selectedIndex];
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
  console.log(`Item: ${position.name}`);
  console.log(`Status: ${position.status}`);
  if (position.status === "BUY_ORDER_PLACED") {
    console.log(`Ordered quantity: ${position.orderedQuantity}`);
  } else {
    console.log(`Remaining quantity: ${position.quantity}`);
  }
  console.log(`Original quantity: ${position.originalQuantity}`);
  console.log(`Received: ${position.receivedQuantity}`);
  console.log(`Listed: ${position.listedQuantity}`);
  console.log(`Sold: ${position.soldQuantity}`);
  console.log(`Entry: ${formatGp(position.entryPrice)} gp`);
  console.log(`Target sell: ${formatGp(position.targetSell)} gp`);
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

const [, , rawAction, ...args] = process.argv;
const actionAliases = {
  "buy-order": "buy",
  open: "open",
  close: "close",
};
const action = actionAliases[rawAction] || rawAction;

if (
  !["buy", "receive", "list", "sold", "open", "close", "stats", "add"].includes(
    action,
  )
) {
  printUsage();
  process.exit(1);
}

if (action === "stats") {
  printStats();
  process.exit(0);
}

const positionsData = loadPositions();

if (action === "add") {
  const [itemInput, quantity, costPerItem] = args;

  if (!itemInput || !quantity || costPerItem === undefined) {
    printUsage();
    process.exit(1);
  }

  const qty = Number(quantity);
  const cost = Number(costPerItem);

  if (!isPositiveNumber(qty)) {
    fail("QUANTITY must be a positive number.");
  }

  if (!Number.isFinite(cost) || cost < 0) {
    fail("COST_PER_ITEM must be 0 or higher.");
  }
  if (cost > 0) {
    const confirmedCost = await askYesNo(
      `\nYou entered cost ${formatGp(cost)} gp per item. For loot/drop this should usually be 0. Are you sure? Y/N`,
    );

    if (!confirmedCost) {
      console.log(
        "\nCancelled. Add the item again with cost 0 if this was loot/drop.\n",
      );
      process.exit(0);
    }
  }

  const resolvedItem = resolveItem(itemInput);
  const positionsData = loadPositions();

  const now = new Date().toISOString();

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
    targetSell: null,
    desiredMargin: 0,
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
  console.log(`Item: ${resolvedItem.name}`);
  console.log(`Quantity: ${qty}`);
  console.log(`Cost per item: ${formatGp(cost)} gp`);
  console.log(`Status: READY`);
  console.log(`Next step:`);

  if (cost === 0) {
    console.log(`- Usually: LIST ITEMS FOR SALE`);
    console.log(`- Or use SOLD ITEMS only for instant sell to buy offers`);
  } else {
    console.log(`- List or sell when ready`);
  }

  process.exit(0);
}

if (action === "buy" || action === "open") {
  const [itemInput, entryPrice, quantity, targetSell, brainScore] = args;

  if (!itemInput || !entryPrice || !quantity || !targetSell) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(entryPrice)) {
    fail("ENTRY_PRICE must be a positive number.");
  }

  if (!isPositiveNumber(quantity)) {
    fail("QUANTITY must be a positive number.");
  }

  if (!isPositiveNumber(targetSell)) {
    fail("TARGET_SELL must be a positive number.");
  }

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
    quantity: action === "open" ? qty : 0,
    orderedQuantity: qty,
    receivedQuantity: action === "open" ? qty : 0,
    listedQuantity: 0,
    soldQuantity: 0,
    totalListedQuantity: 0,
    buyOfferFeePaid,
    sellOfferFeePaid: 0,
    targetSell: Number(targetSell),
    desiredMargin: 0.06,
    entryBrainScore: brainScore ? Number(brainScore) : null,
    status: action === "open" ? "OPEN" : "BUY_ORDER_PLACED",
    events: [
      {
        type: action === "open" ? "LEGACY_OPEN" : "BUY_ORDER_PLACED",
        at: now,
        entryPrice: Number(entryPrice),
        quantity: qty,
        targetSell: Number(targetSell),
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
  const position = await chooseActivePosition(positionsData, resolvedItem.id);

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
  const position = await chooseActivePosition(positionsData, resolvedItem.id);

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
  const position = await chooseActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found.");

  const quantity =
    action === "close" && !secondNumber
      ? position.quantity
      : Number(firstNumber);

  if (!isPositiveNumber(quantity)) {
    fail("QUANTITY must be a positive number.");
  }

  let sellPrice;

  if (action === "sold") {
    if (secondNumber) {
      // Custom/manual sell price was provided.
      sellPrice = Number(secondNumber);
    } else if (
      position.lastListPrice &&
      Number(position.listedQuantity || 0) >= Number(quantity)
    ) {
      // Normal flow: listed first, then sold.
      sellPrice = Number(position.lastListPrice);
      console.log(`\nUsing last listed price: ${formatGp(sellPrice)} gp`);
    } else {
      fail(
        "SELL_PRICE is required because this item was not listed first. Use: node trade.js sold ITEM QUANTITY SELL_PRICE",
      );
    }
  } else {
    sellPrice =
      action === "close" && !secondNumber
        ? Number(firstNumber)
        : Number(secondNumber);
  }

  if (!isPositiveNumber(sellPrice)) {
    fail("SELL_PRICE must be a positive number.");
  }

  if (
    action === "sold" &&
    Number(position.listedQuantity || 0) < Number(quantity)
  ) {
    const instantSell = await askYesNo(
      "\nThis quantity was not fully listed first. Was this an instant sell to a buy offer? Y/N",
    );

    if (!instantSell) {
      console.log(
        "\nCancelled. Use 'List Items For Sale' first, or provide a custom instant-sell price.\n",
      );
      process.exit(0);
    }
  }

  const previewTrade = calculateClosedTrade(
    position,
    sellPrice,
    action === "close" ? "MANUAL_CLOSE" : "PARTIAL_OR_FULL_SOLD",
    quantity,
  );

  console.log("\nSALE PREVIEW\n");
  console.log(`Item: ${previewTrade.name}`);
  console.log(`Quantity: ${previewTrade.quantity}`);
  console.log(`Entry/cost: ${formatGp(previewTrade.entryPrice)} gp`);
  console.log(`Sell price: ${formatGp(previewTrade.sellPrice)} gp`);
  console.log(
    `Buy offer fee used: ${formatGp(previewTrade.buyOfferFeePaid)} gp`,
  );
  console.log(
    `Sell offer fee used: ${formatGp(previewTrade.sellOfferFeePaid)} gp`,
  );
  console.log(`Total fees used: ${formatGp(previewTrade.totalFees)} gp`);
  console.log(`Expected profit: ${formatGp(previewTrade.netProfit)} gp`);
  console.log(`Expected ROI: ${previewTrade.roiPercent.toFixed(2)}%`);

  const confirmSale = await askYesNo("\nConfirm and save this sale? Y/N");

  if (!confirmSale) {
    console.log("\nSale cancelled. Nothing was saved.\n");
    process.exit(0);
  }

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
