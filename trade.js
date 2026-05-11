import fs from "fs";
import { loadState, saveState } from "./lib/state.js";
import { closeTrade } from "./lib/trades.js";
import { getItemMap } from "./lib/market.js";
function resolveItem(input) {
  const itemMap = getItemMap();

  // Numeric ID
  if (!isNaN(Number(input))) {
    const id = Number(input);

    return {
      id,
      name: itemMap[id] || `Unknown Item (${id})`,
    };
  }

  // Search by name
  const normalized = String(input).trim().toLowerCase();

  const found = Object.entries(itemMap).find(
    ([_, name]) => String(name).trim().toLowerCase() === normalized,
  );

  if (!found) {
    throw new Error(`Item not found: ${input}`);
  }

  return {
    id: Number(found[0]),
    name: found[1],
  };
}

const POSITIONS_FILE = "./positions.json";

function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) {
    return { positions: [] };
  }

  return JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
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

function printUsage() {
  console.log(`
Usage:

Open position:
  node trade.js open ITEM_ID ENTRY_PRICE QUANTITY TARGET_SELL BRAIN_SCORE
Close position:
  node trade.js close ITEM_ID SELL_PRICE

Stats:
  node trade.js stats
`);
}

const [, , action, ...args] = process.argv;

if (!["open", "close", "stats"].includes(action)) {
  printUsage();
  process.exit(1);
}

const positionsData = loadPositions();
if (action === "stats") {
  const state = loadState();
  const history = state.tradeHistory || [];

  const totalTrades = history.length;
  const wins = history.filter((t) => t.netProfit >= 0).length;
  const losses = history.filter((t) => t.netProfit < 0).length;
  const totalProfit = history.reduce(
    (sum, t) => sum + Number(t.netProfit || 0),
    0,
  );
  const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
  const avgRoi =
    totalTrades > 0
      ? history.reduce((sum, t) => sum + Number(t.roiPercent || 0), 0) /
        totalTrades
      : 0;

  const bestTrade = [...history].sort((a, b) => b.netProfit - a.netProfit)[0];

  const itemStats = {};

  for (const trade of history) {
    const key = String(trade.id);
    if (!itemStats[key]) {
      itemStats[key] = {
        id: trade.id,
        name: trade.name,
        trades: 0,
        totalProfit: 0,
        totalRoi: 0,
      };
    }

    itemStats[key].trades += 1;
    itemStats[key].totalProfit += Number(trade.netProfit || 0);
    itemStats[key].totalRoi += Number(trade.roiPercent || 0);
  }

  const rankedItems = Object.entries(itemStats)
    .map(([_, stats]) => ({
      id: stats.id,
      name: stats.name,
      trades: stats.trades,
      totalProfit: stats.totalProfit,
      avgRoi: stats.totalRoi / stats.trades,
    }))
    .sort((a, b) => b.totalProfit - a.totalProfit);

  const worstTrade = [...history].sort((a, b) => a.netProfit - b.netProfit)[0];

  console.log("\nTIBIA TRADE STATS\n");
  console.log(`Total trades: ${totalTrades}`);
  console.log(`Wins: ${wins}`);
  console.log(`Losses: ${losses}`);
  console.log(
    `Winrate: ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : "0.00"}%`,
  );
  console.log(`Total profit: ${Math.round(totalProfit).toLocaleString()} gp`);
  console.log(`Average profit: ${Math.round(avgProfit).toLocaleString()} gp`);
  console.log(`Average ROI: ${avgRoi.toFixed(2)}%`);

  if (bestTrade) {
    console.log(
      `\nBest trade: ${bestTrade.name} (+${Math.round(bestTrade.netProfit).toLocaleString()} gp)`,
    );
  }

  if (worstTrade) {
    console.log(
      `Worst trade: ${worstTrade.name} (${Math.round(worstTrade.netProfit).toLocaleString()} gp)`,
    );
  }
  if (rankedItems.length > 0) {
    console.log("\nTop items:\n");

    rankedItems.slice(0, 5).forEach((item, index) => {
      console.log(
        `#${index + 1} ${item.name}\n` +
          `Trades: ${item.trades}\n` +
          `Profit: ${Math.round(item.totalProfit).toLocaleString()} gp\n` +
          `Average ROI: ${item.avgRoi.toFixed(2)}%\n`,
      );
    });
  }
  process.exit(0);
}
if (!positionsData.positions) {
  positionsData.positions = [];
}

if (action === "open") {
  const [itemInput, entryPrice, quantity, targetSell, brainScore] = args;

  if (!itemInput || !entryPrice || !quantity || !targetSell) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(entryPrice))
    fail("ENTRY_PRICE must be a positive number.");
  if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
  if (!isPositiveNumber(targetSell))
    fail("TARGET_SELL must be a positive number.");

  if (
    brainScore &&
    (!Number.isFinite(Number(brainScore)) ||
      Number(brainScore) < 0 ||
      Number(brainScore) > 100)
  ) {
    fail("BRAIN_SCORE must be between 0 and 100.");
  }
  const resolvedItem = resolveItem(itemInput);
  const existingOpen = positionsData.positions.find(
    (p) => Number(p.id) === resolvedItem.id && p.status !== "CLOSED",
  );

  if (existingOpen) {
    console.log("There is already an OPEN position for this item.");
    process.exit(1);
  }

  const position = {
    id: resolvedItem.id,
    name: resolvedItem.name,
    openedAt: new Date().toISOString(),
    entryPrice: Number(entryPrice),
    quantity: Number(quantity),
    targetSell: Number(targetSell),
    desiredMargin: 0.06,
    entryBrainScore: brainScore ? Number(brainScore) : null,
    status: "OPEN",
  };

  positionsData.positions.push(position);
  savePositions(positionsData);

  console.log("\nPOSITION OPENED\n");
  console.log(`Item: ${position.name}`);
  console.log(`Quantity: ${position.quantity}`);
  console.log(`Entry: ${position.entryPrice}`);
  console.log(`Target sell: ${position.targetSell}`);
  console.log(`Brain: ${position.entryBrainScore ?? "N/A"}`);

  process.exit(0);
}

if (action === "close") {
  const [itemInput, sellPrice] = args;
  if (!itemInput || !sellPrice) {
    printUsage();
    process.exit(1);
  }

  if (!isPositiveNumber(sellPrice))
    fail("SELL_PRICE must be a positive number.");

  const resolvedItem = resolveItem(itemInput);
  const position = positionsData.positions.find(
    (p) => Number(p.id) === resolvedItem.id && p.status !== "CLOSED",
  );

  if (!position) {
    console.log("No OPEN position found.");
    process.exit(1);
  }

  if (!position.openedAt) {
    position.openedAt = new Date().toISOString();
  }

  const state = loadState();

  const trade = closeTrade({
    state,
    position,
    sellPrice: Number(sellPrice),
    exitReason: "MANUAL_CLOSE",
  });

  position.status = "CLOSED";
  position.closedAt = trade.closedAt;
  position.finalSellPrice = Number(sellPrice);

  savePositions(positionsData);
  saveState(state);

  console.log("\nTRADE CLOSED\n");
  console.log(`Item: ${trade.name}`);
  console.log(`Quantity: ${trade.quantity}`);
  console.log(`Entry: ${trade.entryPrice}`);
  console.log(`Sell: ${trade.sellPrice}`);
  console.log(`Profit: ${Math.round(trade.netProfit)} gp`);
  console.log(`ROI: ${trade.roiPercent.toFixed(2)}%`);
}
