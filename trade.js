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
  const tempFile = `${POSITIONS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, POSITIONS_FILE);
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isNumericArg(value) {
  return value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function parseItemWithTrailingNumbers(args, minNumbers, maxNumbers = minNumbers) {
  if (!Array.isArray(args) || args.length < minNumbers + 1) {
    return null;
  }

  const numbers = [];
  let index = args.length - 1;

  while (index >= 0 && isNumericArg(args[index]) && numbers.length < maxNumbers) {
    numbers.unshift(args[index]);
    index -= 1;
  }

  const itemInput = args.slice(0, index + 1).join(" ").trim();

  if (!itemInput || numbers.length < minNumbers) {
    return null;
  }

  return { itemInput, numbers };
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
  node trade.js check ITEM_ID_OR_NAME ENTRY_PRICE SELL_PRICE [QUANTITY]

Backward compatible old flow:
  node trade.js open ITEM_ID_OR_NAME ENTRY_PRICE QUANTITY TARGET_SELL [BRAIN_SCORE]
  node trade.js close ITEM_ID_OR_NAME SELL_PRICE [QUANTITY]

Stats:
  node trade.js orders
  node trade.js cancel ITEM_ID_OR_NAME [REASON]
  node trade.js expire ITEM_ID_OR_NAME
  node trade.js stats
  node trade.js stats-split
  node trade.js dashboard
  node trade.js verify-order ITEM_ID_OR_NAME
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
  const avgRoiText = formatAverageRoi(history);

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
        roiCount: 0,
      };
    }

    itemStats[key].trades += 1;
    itemStats[key].quantity += Number(trade.quantity || 0);
    itemStats[key].totalProfit += Number(trade.netProfit || 0);
    if (!isExternalTrade(trade)) {
      itemStats[key].totalRoi += Number(trade.roiPercent || 0);
      itemStats[key].roiCount += 1;
    }
  }

  const rankedItems = Object.entries(itemStats)
    .map(([_, stats]) => ({
      id: stats.id,
      name: stats.name,
      trades: stats.trades,
      quantity: stats.quantity,
      totalProfit: stats.totalProfit,
      avgRoi: stats.roiCount > 0 ? stats.totalRoi / stats.roiCount : null,
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
  console.log(`Average ROI: ${avgRoiText}`);

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
          `Average ROI: ${item.avgRoi === null ? "N/A — external / loot item" : `${item.avgRoi.toFixed(2)}%`}\n`,
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


function isClosedLike(position) {
  const status = String(position.status || "OPEN").toUpperCase();
  return [
    "CLOSED",
    "CANCELED",
    "CANCELLED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_CANCELED",
    "BUY_ORDER_EXPIRED",
    "EXPIRED",
  ].includes(status);
}

function isExternalTrade(trade) {
  const flow = String(trade.flow || "").toUpperCase();
  return flow.includes("EXTERNAL") || Number(trade.entryPrice || 0) <= 0;
}

function formatAverageRoi(trades) {
  const roiTrades = trades.filter(
    (trade) => !isExternalTrade(trade) && Number.isFinite(Number(trade.roiPercent)),
  );

  if (roiTrades.length === 0) return "N/A";

  const avgRoi =
    roiTrades.reduce((sum, trade) => sum + Number(trade.roiPercent || 0), 0) /
    roiTrades.length;

  return `${avgRoi.toFixed(2)}%`;
}

function loadPendingSignals() {
  if (!fs.existsSync("./pending-buy-signals.json")) return { signals: [] };

  try {
    const raw = JSON.parse(fs.readFileSync("./pending-buy-signals.json", "utf8"));
    if (Array.isArray(raw)) return { signals: raw };
    if (!Array.isArray(raw.signals)) raw.signals = [];
    return raw;
  } catch {
    return { signals: [] };
  }
}

function isManualCheckFresh(position, hours = 24) {
  if (!position.lastManualCheckAt) return false;
  const checkedAt = new Date(position.lastManualCheckAt).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  return Date.now() - checkedAt < hours * 60 * 60 * 1000;
}

function printDashboard() {
  const positionsData = loadPositions();
  const pendingData = loadPendingSignals();
  const active = positionsData.positions.filter((position) => !isClosedLike(position));

  const openBuyOrders = active.filter((position) => {
    normalizePosition(position);
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );
    return String(position.status).startsWith("BUY_ORDER") && waiting > 0;
  });

  const needToList = active.filter((position) => {
    normalizePosition(position);
    const owned = Number(position.quantity || 0);
    const listed = Number(position.listedQuantity || 0);
    return owned > listed;
  });

  const listed = active.filter((position) => Number(position.listedQuantity || 0) > 0);

  const staleListings = listed.filter((position) => {
    if (!position.lastListedAt) return false;
    const ageDays = (Date.now() - new Date(position.lastListedAt).getTime()) / 86400000;
    return ageDays >= 7;
  });

  const suspicious = active.filter((position) => {
    normalizePosition(position);
    const ageDays = (Date.now() - new Date(position.openedAt || position.createdAt).getTime()) / 86400000;
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );

    return (
      (String(position.status).startsWith("BUY_ORDER") && waiting > 0 && ageDays >= 29 && !isManualCheckFresh(position)) ||
      Number(position.quantity || 0) < 0 ||
      Number(position.listedQuantity || 0) > Number(position.quantity || 0)
    );
  });

  const pendingCounts = pendingData.signals.reduce((acc, signal) => {
    const status = String(signal.status || "PENDING").toUpperCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const openItemCost = active.reduce((sum, position) => {
    const ownedUnlisted = Math.max(0, Number(position.quantity || 0));
    return sum + Number(position.entryPrice || 0) * ownedUnlisted;
  }, 0);

  const buyOrderCommitment = openBuyOrders.reduce((sum, position) => {
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );
    return sum + Number(position.entryPrice || 0) * waiting + Number(position.buyOfferFeePaid || 0);
  }, 0);

  const listedValue = listed.reduce((sum, position) => {
    return sum + Number(position.lastListPrice || 0) * Number(position.listedQuantity || 0);
  }, 0);

  console.log("\nTIBIA ACTION DASHBOARD\n");
  console.log(`Open positions: ${active.length}`);
  console.log(`Need to list: ${needToList.length}`);
  console.log(`Listed / waiting to sell: ${listed.length}`);
  console.log(`Open buy orders: ${openBuyOrders.length}`);
  console.log(`Stale listings (7d+): ${staleListings.length}`);
  console.log(`Suspicious positions: ${suspicious.length}`);
  console.log(`Pending BUY signals: ${pendingCounts.PENDING || 0}`);
  console.log(`Estimated open item cost: ${formatGp(openItemCost)} gp`);
  console.log(`Estimated buy order commitment: ${formatGp(buyOrderCommitment)} gp`);
  console.log(`Estimated listed value: ${formatGp(listedValue)} gp`);

  console.log("\nNEXT ACTIONS\n------------");
  console.log("1. BUY: review pending buy signals/orders with BAT option 2.");
  console.log("2. RECEIVE: if a buy order filled, use BAT option 3.");
  console.log("3. SELL OFFERS: create a sell offer for loot, flips, or crafted scrolls with BAT option 4.");
  console.log("4. SELL OFFERS: mark active offers as SOLD or cancel them with BAT option 4.");

  if ((pendingCounts.PENDING || 0) === 0 &&
      openBuyOrders.length === 0 &&
      needToList.length === 0 &&
      staleListings.length === 0 &&
      suspicious.length === 0) {
    console.log("\nNo urgent actions right now.");
  }

  if (staleListings.length > 0) {
    console.log("\nNote: stale listings exist. Use SELL OFFERS option 4 if they sold or you cancelled them.");
  }

  if (suspicious.length > 0) {
    console.log("\nNote: suspicious positions exist. Check them before trusting stats.");
  }

  function printSection(title, rows, render) {
    console.log(`\n${title}\n${"-".repeat(title.length)}`);
    if (rows.length === 0) {
      console.log(title === "SELL OFFERS - READY TO LIST" ? "No owned unlisted items." : "None.");
      return;
    }
    rows.forEach(render);
  }

  printSection("SELL OFFERS - READY TO LIST", needToList, (position, index) => {
    console.log(`${index + 1}) ${position.name} (${position.id})`);
    console.log(`   Owned: ${position.quantity} | Listed: ${position.listedQuantity} | Entry: ${formatGp(position.entryPrice)} gp`);
  });

  printSection("SELL OFFERS - ACTIVE LISTINGS", listed, (position, index) => {
    console.log(`${index + 1}) ${position.name} (${position.id})`);
    console.log(`   Listed: ${position.listedQuantity} | Price: ${formatGp(position.lastListPrice)} gp | age ${formatAge(position.lastListedAt)}`);
  });

  printSection("OPEN BUY ORDERS", openBuyOrders, (position, index) => {
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );
    console.log(`${index + 1}) ${position.name} (${position.id})`);
    console.log(`   Flip | ${position.status} | age ${formatAge(position.openedAt || position.createdAt)}`);
    console.log(`   Entry: ${formatGp(position.entryPrice)} gp | Owned: ${position.quantity} | Listed: ${position.listedQuantity} | Waiting: ${waiting}`);
    if (position.lastManualCheckAt) {
      console.log(`   Last manual market check: ${formatAge(position.lastManualCheckAt)} ago`);
    }
  });

  printSection("SUSPICIOUS POSITIONS", suspicious, (position, index) => {
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );
    console.log(`${index + 1}) ${position.name} (${position.id})`);
    console.log(`   Flip | ${position.status} | age ${formatAge(position.openedAt || position.createdAt)}`);
    console.log(`   Entry: ${formatGp(position.entryPrice)} gp | Owned: ${position.quantity} | Listed: ${position.listedQuantity} | Waiting: ${waiting}`);
    if (String(position.status).startsWith("BUY_ORDER") && waiting > 0) {
      console.log("   Warning: Buy order is near 30 days; check if it should expire soon.");
      console.log("   If still active in Tibia, run: npm run trade -- verify-order \"ITEM NAME\"");
    }
  });
}

function printStatsSplit() {
  const state = loadState();
  const history = state.tradeHistory || [];
  const flips = history.filter((trade) => !isExternalTrade(trade));
  const external = history.filter(isExternalTrade);

  const sumProfit = (rows) => rows.reduce((sum, trade) => sum + Number(trade.netProfit || 0), 0);
  const sumQty = (rows) => rows.reduce((sum, trade) => sum + Number(trade.quantity || 0), 0);

  const flipProfit = sumProfit(flips);
  const externalProfit = sumProfit(external);
  const totalProfit = flipProfit + externalProfit;
  const flipShare = totalProfit !== 0 ? (flipProfit / totalProfit) * 100 : 0;

  console.log("\nTIBIA TRADE STATS — SPLIT VIEW\n");
  console.log(`Total profit: ${formatGp(totalProfit)} gp`);
  console.log(`Real flip profit: ${formatGp(flipProfit)} gp`);
  console.log(`Loot / external profit: ${formatGp(externalProfit)} gp`);
  console.log(`Flip share: ${flipShare.toFixed(2)}%`);
  console.log("");
  console.log(`Flip sales: ${flips.length} events | ${sumQty(flips)} items | ROI: ${formatAverageRoi(flips)}`);
  console.log(`External sales: ${external.length} events | ${sumQty(external)} items | ROI: N/A when entry price is 0`);
}


const [, , rawAction, ...args] = process.argv;
const actionAliases = {
  "buy-order": "buy",
  add: "add",
  open: "open",
  close: "close",
  positions: "orders",
  "buy-fee": "buyfee",
  dashboard: "dashboard",
  "stats-split": "stats-split",
  "verify-order": "verify-order",
  "confirm-active": "verify-order",
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
    "stats-split",
    "dashboard",
    "verify-order",
    "buyfee",
    "check",
  ].includes(action)
) {
  printUsage();
  process.exit(1);
}

if (action === "stats") {
  printStats();
  process.exit(0);
}

if (action === "stats-split") {
  printStatsSplit();
  process.exit(0);
}

if (action === "dashboard") {
  printDashboard();
  process.exit(0);
}

if (action === "orders") {
  printOrders();
  process.exit(0);
}

const positionsData = loadPositions();

if (action === "verify-order") {
  const itemInput = args.join(" ").trim();

  if (!itemInput) {
    console.log("\nUsage: node trade.js verify-order ITEM_ID_OR_NAME\n");
    process.exit(1);
  }

  const resolvedItem = resolveItem(itemInput);
  const position = positionsData.positions.find((candidate) => {
    normalizePosition(candidate);
    const waiting = Math.max(
      0,
      Number(candidate.orderedQuantity || 0) - Number(candidate.receivedQuantity || 0),
    );
    return (
      Number(candidate.id) === Number(resolvedItem.id) &&
      !isClosedLike(candidate) &&
      String(candidate.status || "").startsWith("BUY_ORDER") &&
      waiting > 0
    );
  });

  if (!position) {
    fail("No active buy order found for this item.");
  }

  console.log("\nVERIFY OLD BUY ORDER\n");
  printPosition(position);
  const stillActive = await askYesNo("\nIs this buy order still active in Tibia Market? Y/N");

  if (stillActive) {
    position.lastManualCheckAt = new Date().toISOString();
    addEvent(position, "BUY_ORDER_STILL_ACTIVE_CONFIRMED", {
      note: "User confirmed the buy order still exists in Tibia Market.",
    });
    savePositions(positionsData);
    console.log("\nConfirmed. Dashboard warning will be quiet for about 24h.\n");
    process.exit(0);
  }

  const expired = await askYesNo("\nDid it expire/disappear from Tibia Market? Y/N");
  if (expired) {
    position.status = "BUY_ORDER_EXPIRED";
    position.closedAt = new Date().toISOString();
    addEvent(position, "BUY_ORDER_EXPIRED", {
      note: "User said the order expired/disappeared from Tibia Market.",
    });
    savePositions(positionsData);
    console.log("\nMarked as BUY_ORDER_EXPIRED.\n");
    process.exit(0);
  }

  console.log("\nNo change saved. Use cancel/expire manually if needed.\n");
  process.exit(0);
}

if (action === "check") {
  const parsed = parseItemWithTrailingNumbers(args, 2, 3);

  if (!parsed) {
    console.log(`
Usage:
  node trade.js check ITEM_ID_OR_NAME ENTRY_PRICE SELL_PRICE [QUANTITY]

Examples:
  node trade.js check stone skin amulet 8199 9500 10
  node trade.js check "stone skin amulet" 8199 9500 10
`);
    process.exit(1);
  }

  const { itemInput, numbers } = parsed;
  const [entryPriceRaw, sellPriceRaw, quantityRaw = "1"] = numbers;
  const entryPrice = Number(entryPriceRaw);
  const sellPrice = Number(sellPriceRaw);
  const quantity = Number(quantityRaw);

  if (!isPositiveNumber(entryPrice)) fail("ENTRY_PRICE must be a positive number.");
  if (!isPositiveNumber(sellPrice)) fail("SELL_PRICE must be a positive number.");
  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");

  const resolvedItem = resolveItem(itemInput);
  const buyFee = calculateBuyOfferFee(entryPrice, quantity);
  const sellFee = calculateSellOfferFee(sellPrice, quantity);
  const grossBuy = entryPrice * quantity;
  const grossSell = sellPrice * quantity;
  const netProfit = grossSell - grossBuy - buyFee - sellFee;
  const realCost = grossBuy + buyFee + sellFee;
  const roiPercent = realCost > 0 ? (netProfit / realCost) * 100 : 0;
  const breakEvenSell = Math.ceil((entryPrice + buyFee / quantity + sellFee / quantity) / (1 - 0));
  const minimumGoodProfit = Math.max(300 * quantity, grossBuy * 0.04);

  console.log("\nTRADE CHECK\n");
  console.log(`Item: ${resolvedItem.name} (${resolvedItem.id})`);
  console.log(`Quantity: ${quantity}`);
  console.log(`Buy: ${formatGp(entryPrice)} gp each`);
  console.log(`Sell: ${formatGp(sellPrice)} gp each`);
  console.log(`Fees: buy ${formatGp(buyFee)} gp + sell ${formatGp(sellFee)} gp`);
  console.log(`Net profit: ${formatGp(netProfit)} gp total (${formatGp(netProfit / quantity)} gp each)`);
  console.log(`ROI after fees: ${roiPercent.toFixed(2)}%`);

  if (netProfit <= 0) {
    console.log("\nDirect read: ❌ Do not buy — this loses money after fees.");
  } else if (netProfit < minimumGoodProfit || roiPercent < 4) {
    console.log("\nDirect read: 🟡 Very thin — only worth it if it sells fast and you are sure.");
  } else {
    console.log("\nDirect read: ✅ Looks profitable after fees.");
  }

  console.log("Next step: if you buy it, record it with `node trade.js buy ...` or `node trade.js add ...`.");
  process.exit(0);
}

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
  const parsed = parseItemWithTrailingNumbers(args, 2, 4);

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { itemInput, numbers } = parsed;
  const [entryPrice, quantity, targetSell, brainScore] = numbers;

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

    buyOfferFeePaid: 0,
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
  const parsed = parseItemWithTrailingNumbers(args, 1, 2);

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { itemInput, numbers } = parsed;
  const [quantity, costPerItem = 0] = numbers;

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
  const parsed = parseItemWithTrailingNumbers(args, 1, 2);

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { itemInput, numbers } = parsed;
  const [quantity, actualEntryPrice] = numbers;

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (actualEntryPrice && !isPositiveNumber(actualEntryPrice)) {
    fail("ACTUAL_ENTRY_PRICE must be a positive number.");
  }

  const resolvedItem = resolveItem(itemInput);
  const position = findActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found for this item.");

  normalizePosition(position);

  const receiveQty = Number(quantity);
  const orderedQty = Number(position.orderedQuantity || position.originalQuantity || 0);
  const previousReceived = Number(position.receivedQuantity || 0);

  if (orderedQty > 0 && previousReceived + receiveQty > orderedQty) {
    fail(
      `Cannot receive ${receiveQty}; order was for ${orderedQty}, already received ${previousReceived}.`,
    );
  }

  const newEntry = actualEntryPrice
    ? Number(actualEntryPrice)
    : position.entryPrice;
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


function getActiveOwnedPositionsForItem(positionsData, itemId) {
  const positions = Array.isArray(positionsData.positions)
    ? positionsData.positions
    : [];

  return positions.filter((position) => {
    const sameItem = String(position.id) === String(itemId);
    const status = String(position.status || "").toUpperCase();

    const isClosed =
      status === "SOLD" ||
      status === "CLOSED" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "BUY_ORDER_CANCELLED" ||
      status === "BUY_ORDER_EXPIRED" ||
      status === "EXPIRED";

    const ownedQuantity = Number(position.quantity || 0);

    return sameItem && !isClosed && ownedQuantity > 0;
  });
}

async function chooseActivePositionForListing(positionsData, itemId, requestedQuantity) {
  const activePositions = getActiveOwnedPositionsForItem(positionsData, itemId);

  const listablePositions = activePositions.filter((position) => {
    const ownedQuantity = Number(position.quantity || 0);
    const listedQuantity = Number(position.listedQuantity || 0);
    const availableToList = Math.max(0, ownedQuantity - listedQuantity);

    return availableToList >= Number(requestedQuantity || 0);
  });

  if (listablePositions.length === 0) {
    return null;
  }

  if (listablePositions.length === 1) {
    return listablePositions[0];
  }

  console.log("\nMultiple listable positions found for this item:\n");

  listablePositions.forEach((position, index) => {
    const ownedQuantity = Number(position.quantity || 0);
    const listedQuantity = Number(position.listedQuantity || 0);
    const availableToList = Math.max(0, ownedQuantity - listedQuantity);

    console.log(
      `${index + 1}) ${position.name} | flow: ${position.flow || "UNKNOWN"} | status: ${position.status} | owned: ${ownedQuantity} | listed: ${listedQuantity} | available: ${availableToList} | entry: ${
        position.entryPrice ?? position.averageEntryPrice ?? "?"
      } gp`,
    );
  });

  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(
    "\nChoose which position to list by number: ",
  );

  rl.close();

  const selectedIndex = Number(answer) - 1;

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= listablePositions.length
  ) {
    fail("Invalid position selection.");
  }

  return listablePositions[selectedIndex];
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

  const cleanArgs = [];
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const value = args[i];

    if (
      value === "--entry-price" ||
      value === "--actual-entry" ||
      value === "--cost"
    ) {
      const number = Number(args[i + 1]);
      options.entryPrice = Number.isFinite(number) && number >= 0 ? number : null;
      i += 1;
      continue;
    }

    if (value === "--source" || value === "--flow") {
      options.source = args[i + 1] || "";
      i += 1;
      continue;
    }

    cleanArgs.push(value);
  }

  if (cleanArgs.length < 3) {
    return null;
  }

  let entryPrice = options.entryPrice;
  let listPrice = cleanArgs[cleanArgs.length - 1];
  let quantity = cleanArgs[cleanArgs.length - 2];
  let itemInput = cleanArgs.slice(0, -2).join(" ");

  // Support shorthand:
  // trade.js list "stone skin amulet" 9 15992 0
  // item + quantity + listPrice + entryPrice
  if (
    cleanArgs.length >= 4 &&
    entryPrice === undefined &&
    Number(cleanArgs[cleanArgs.length - 1]) >= 0 &&
    Number(cleanArgs[cleanArgs.length - 2]) > 0 &&
    Number(cleanArgs[cleanArgs.length - 3]) > 0
  ) {
    entryPrice = Number(cleanArgs[cleanArgs.length - 1]);
    listPrice = cleanArgs[cleanArgs.length - 2];
    quantity = cleanArgs[cleanArgs.length - 3];
    itemInput = cleanArgs.slice(0, -3).join(" ");
  }

  return {
    itemInput,
    quantity,
    listPrice,
    entryPrice,
    source: options.source || "",
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

  const listQty = Number(quantity);
  const numericListPrice = Number(listPrice);
  const listEntryPrice =
    Number.isFinite(Number(parsed.entryPrice)) && Number(parsed.entryPrice) >= 0
      ? Number(parsed.entryPrice)
      : null;

  let position = await chooseActivePositionForListing(
    positionsData,
    resolvedItem.id,
    listQty,
  );


  if (!position) {
    const existingSameItemPositions = getActiveOwnedPositionsForItem(
      positionsData,
      resolvedItem.id,
    );

    if (existingSameItemPositions.length > 0) {
      console.log(
        `\nNo unlisted quantity is available in existing positions for ${resolvedItem.name}.`,
      );
      console.log(
        "Existing same-item positions are probably already fully listed.",
      );
      console.log(
        "This is normal when you have a flip position already listed and you want to list extra loot/external items.",
      );
      console.log("\nExisting same-item positions:\n");

      existingSameItemPositions.forEach((existingPosition, index) => {
        const ownedQuantity = Number(existingPosition.quantity || 0);
        const listedQuantity = Number(existingPosition.listedQuantity || 0);
        const availableToList = Math.max(0, ownedQuantity - listedQuantity);

        console.log(
          `${index + 1}) ${existingPosition.name} | flow: ${existingPosition.flow || "UNKNOWN"} | status: ${existingPosition.status} | owned: ${ownedQuantity} | listed: ${listedQuantity} | available: ${availableToList}`,
        );
      });
    } else {
      console.log(`\nNo active position found for ${resolvedItem.name}.`);
    }

    console.log(
      `\nYou are trying to list ${listQty}x at ${formatGp(numericListPrice)} gp each.`,
    );

    const createNew = await askYesNo(
      "\nCreate a separate new loot/external/manual position for these listed items? Y/N",
    );

    if (!createNew) {
      console.log("\nCancelled. Nothing was saved.\n");
      process.exit(0);
    }

    let entryPrice = listEntryPrice;

    if (entryPrice === null) {
      const rl = readline.createInterface({ input, output });

      const entryAnswer = await rl.question(
        "\nEnter actual entry price / cost per item. Use 0 if this was loot/drop: ",
      );

      rl.close();

      entryPrice = Number(entryAnswer);
    }

    if (!Number.isFinite(entryPrice) || entryPrice < 0) {
      fail("ENTRY_PRICE must be 0 or higher.");
    }

    let buyOfferFeePaid = 0;

    if (entryPrice > 0) {
      const hadBuyOfferFee = await askYesNo(
        "\nDid you originally buy this through a Tibia buy offer? Y/N",
      );

      buyOfferFeePaid = hadBuyOfferFee
        ? calculateBuyOfferFee(entryPrice, listQty)
        : 0;
    }

    const now = new Date().toISOString();
    const isLootOrExternal = entryPrice <= 0;

    position = {
      id: resolvedItem.id,
      name: resolvedItem.name,
      createdAt: now,
      openedAt: now,
      flow: isLootOrExternal ? "LOOT_OR_EXTERNAL_LISTING" : "MANUAL_LISTING",
      entryPrice,
      averageEntryPrice: entryPrice,
      originalQuantity: listQty,
      quantity: listQty,
      orderedQuantity: listQty,
      receivedQuantity: listQty,
      listedQuantity: 0,
      soldQuantity: 0,
      totalListedQuantity: 0,
      buyOfferFeePaid,
      sellOfferFeePaid: 0,
      targetSell: null,
      desiredMargin: 0,
      entryBrainScore: null,
      status: "EXTERNAL_READY",
      events: [
        {
          type: isLootOrExternal
            ? "LOOT_OR_EXTERNAL_POSITION_CREATED_FROM_LISTING"
            : "MANUAL_POSITION_CREATED_FROM_LISTING",
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

    const previousListPrice = position.lastListPrice || null;

    sellOfferFeePaid = calculateSellOfferFee(numericListPrice, listQty);

    position.sellOfferFeePaid =
      Number(position.sellOfferFeePaid || 0) + sellOfferFeePaid;

    position.lastListPrice = numericListPrice;
    position.lastListedAt = new Date().toISOString();

    addEvent(position, "SELL_OFFER_RELISTED", {
      quantity: listQty,
      listPrice: numericListPrice,
      offerFeePaid: sellOfferFeePaid,
      previousListPrice,
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
  const parsed = parseItemWithTrailingNumbers(args, 1, 2);

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { itemInput, numbers } = parsed;
  const [firstNumber, secondNumber] = numbers;

  const resolvedItem = resolveItem(itemInput);
  const position = await chooseActivePosition(positionsData, resolvedItem.id);

  if (!position) fail("No active position found.");

  normalizePosition(position);

  let quantity;
  let sellPrice;

  if (action === "close") {
    sellPrice = Number(firstNumber);
    quantity = secondNumber ? Number(secondNumber) : Number(position.quantity || 0);
  } else {
    quantity = Number(firstNumber);
    sellPrice = secondNumber ? Number(secondNumber) : Number(position.lastListPrice || 0);
  }

  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (!isPositiveNumber(sellPrice))
    fail("SELL_PRICE must be a positive number.");

  const state = loadState();

  let trade;

  try {
    trade = closeTrade({
      state,
      position,
      sellPrice,
      quantity,
      exitReason: action === "close" ? "MANUAL_CLOSE" : "PARTIAL_OR_FULL_SOLD",
    });
  } catch (error) {
    fail(error.message);
  }

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
