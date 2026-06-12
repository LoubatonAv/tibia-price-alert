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
  node trade.js list-menu
  node trade.js sold ITEM_ID_OR_NAME QUANTITY SELL_PRICE
  node trade.js sold-menu
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
  node trade.js dashboard
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

if (action === "list-menu") {
  runListMenu(positionsData)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("List menu failed:", error);
      process.exit(1);
    });
}

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


function isClosedLikePosition(position) {
  const status = String(position.status || "").toUpperCase();

  return [
    "CLOSED",
    "SOLD",
    "CANCELLED",
    "CANCELED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_EXPIRED",
  ].includes(status);
}

function isLootOrExternalPosition(position) {
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
}

function getSellablePositions(positionsData, kind) {
  return (positionsData.positions || [])
    .filter((position) => {
      normalizePosition(position);

      if (isClosedLikePosition(position)) return false;
      if (Number(position.quantity || 0) <= 0) return false;

      const isExternal = isLootOrExternalPosition(position);

      if (kind === "loot") return isExternal;
      return !isExternal;
    })
    .sort((a, b) => {
      const aListed = Number(a.listedQuantity || 0) > 0 ? 1 : 0;
      const bListed = Number(b.listedQuantity || 0) > 0 ? 1 : 0;

      if (bListed !== aListed) return bListed - aListed;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

function printSellablePositions(positions) {
  positions.forEach((position, index) => {
    normalizePosition(position);

    console.log(
      String(index + 1) + ") " + position.name + " (" + position.id + ")"
    );
    console.log("   Status: " + position.status + " | Flow: " + position.flow);
    console.log(
      "   Owned: " + Number(position.quantity || 0) +
        " | Listed: " + Number(position.listedQuantity || 0) +
        " | Sold: " + Number(position.soldQuantity || 0)
    );
    console.log(
      "   Entry: " + formatGp(position.entryPrice) + " gp" +
        " | Last list: " +
        (Number(position.lastListPrice || 0) > 0
          ? formatGp(position.lastListPrice) + " gp"
          : "N/A")
    );
    console.log("");
  });
}

async function runSoldMenu(positionsData) {
  const rl = readline.createInterface({ input, output });
  const ask = (question) => rl.question(question);

  try {
    console.log("\nSOLD ITEMS\n");
    console.log("1) Flip / bought position");
    console.log("2) Loot / external item");

    const typeAnswer = await ask("\nChoose type [1/2]: ");
    const kind = String(typeAnswer).trim() === "2" ? "loot" : "flip";
    const positions = getSellablePositions(positionsData, kind);

    if (positions.length === 0) {
      console.log(
        kind === "loot"
          ? "\nNo loot/external sellable positions found."
          : "\nNo flip sellable positions found."
      );
      return;
    }

    console.log(
      kind === "loot"
        ? "\nLOOT / EXTERNAL POSITIONS\n"
        : "\nFLIP POSITIONS\n"
    );
    printSellablePositions(positions);

    const indexAnswer = await ask("Choose position number: ");
    const selectedIndex = Number(indexAnswer) - 1;

    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= positions.length
    ) {
      fail("Invalid position selection.");
    }

    const position = positions[selectedIndex];
    normalizePosition(position);

    const ownedQty = Number(position.quantity || 0);
    const listedQty = Number(position.listedQuantity || 0);
    const defaultQty = Math.max(1, Math.min(ownedQty, listedQty || ownedQty));

    const qtyAnswer = await ask(
      "Quantity sold [Enter = " + defaultQty + "]: "
    );
    const quantity = String(qtyAnswer).trim()
      ? Number(qtyAnswer)
      : defaultQty;

    if (!isPositiveNumber(quantity)) fail("QUANTITY must be a positive number.");
    if (quantity > ownedQty) {
      fail("Cannot sell " + quantity + "; only " + ownedQty + " owned/unsold.");
    }

    const defaultSellPrice = Number(position.lastListPrice || 0);
    const pricePrompt =
      "Sell price each" +
      (defaultSellPrice > 0
        ? " [Enter = " + formatGp(defaultSellPrice) + " gp]"
        : "") +
      ": ";
    const priceAnswer = await ask(pricePrompt);
    const sellPrice = String(priceAnswer).trim()
      ? Number(priceAnswer)
      : defaultSellPrice;

    if (!isPositiveNumber(sellPrice)) {
      fail("SELL_PRICE must be a positive number.");
    }

    console.log("\nCONFIRM SOLD\n");
    console.log("Item: " + position.name + " (" + position.id + ")");
    console.log("Type: " + (kind === "loot" ? "Loot / external" : "Flip"));
    console.log("Quantity: " + quantity);
    console.log("Sell price: " + formatGp(sellPrice) + " gp each");

    const confirm = await ask("\nConfirm this sale? Y/N: ");

    if (String(confirm).trim().toLowerCase() !== "y") {
      console.log("\nCancelled. Nothing was saved.\n");
      return;
    }

    const state = loadState();
    const trade = closeTrade({
      state,
      position,
      sellPrice,
      quantity,
      exitReason: kind === "loot" ? "LOOT_OR_EXTERNAL_SOLD" : "FLIP_SOLD_FROM_MENU",
    });

    savePositions(positionsData);
    saveState(state);

    console.log(
      position.status === "CLOSED"
        ? "\nTRADE CLOSED\n"
        : "\nPARTIAL SALE RECORDED\n"
    );
    console.log("Item: " + trade.name);
    console.log("Sold quantity: " + trade.quantity);
    console.log("Remaining quantity: " + position.quantity);
    console.log("Entry: " + formatGp(trade.entryPrice) + " gp");
    console.log("Sell: " + formatGp(trade.sellPrice) + " gp");
    console.log("Total fees used: " + formatGp(trade.totalFees) + " gp");
    console.log("Profit: " + formatGp(trade.netProfit) + " gp");
    console.log("ROI: " + trade.roiPercent.toFixed(2) + "%");
  } finally {
    rl.close();
  }
}


function getDashboardAgeHours(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / 1000 / 60 / 60);
}

function getDashboardStatus(position) {
  return String(position.status || "").toUpperCase();
}

function getDashboardFlow(position) {
  return String(position.flow || "").toUpperCase();
}

function getDashboardWaitingQuantity(position) {
  const ordered = Number(position.orderedQuantity || position.originalQuantity || 0);
  const received = Number(position.receivedQuantity || 0);
  return Math.max(0, ordered - received);
}

function getDashboardKind(position) {
  const flow = getDashboardFlow(position);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const buyFee = Number(position.buyOfferFeePaid || 0);

  if (flow.includes("EXTERNAL") || flow.includes("LOOT")) return "Loot / external";
  if (flow.includes("MANUAL_LISTING") && entryPrice <= 0 && buyFee <= 0) return "Loot / external";
  return "Flip";
}

function getOpenDashboardPositions() {
  const positionsData = loadPositions();

  return (positionsData.positions || [])
    .map((position) => {
      normalizePosition(position);
      return position;
    })
    .filter((position) => getDashboardStatus(position) !== "CLOSED");
}

function printDashboardPosition(position, index, extraLines = []) {
  normalizePosition(position);

  const status = position.status || "UNKNOWN";
  const kind = getDashboardKind(position);
  const waiting = getDashboardWaitingQuantity(position);
  const lastListPrice = Number(position.lastListPrice || 0);

  console.log(String(index + 1) + ") " + position.name + " (" + position.id + ")");
  console.log("   " + kind + " | " + status + " | age " + formatAge(position.openedAt || position.createdAt));
  console.log(
    "   Entry: " + formatGp(position.entryPrice) + " gp" +
      " | Owned: " + Number(position.quantity || 0) +
      " | Listed: " + Number(position.listedQuantity || 0) +
      " | Waiting: " + waiting
  );

  if (lastListPrice > 0) {
    console.log(
      "   Last list: " + formatGp(lastListPrice) + " gp" +
        " | listed age " + formatAge(position.lastListedAt)
    );
  }

  for (const line of extraLines) {
    console.log("   " + line);
  }

  console.log("");
}

function getDashboardSuspiciousNotes(position) {
  const notes = [];
  const status = getDashboardStatus(position);
  const quantity = Number(position.quantity || 0);
  const listed = Number(position.listedQuantity || 0);
  const waiting = getDashboardWaitingQuantity(position);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const targetSell = Number(position.targetSell || 0);
  const ageHours = getDashboardAgeHours(position.openedAt || position.createdAt);

  if (listed > quantity) notes.push("Listed quantity is higher than owned quantity.");
  if (quantity <= 0 && waiting <= 0 && status !== "CLOSED") notes.push("No quantity left, but position is still open.");
  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 27 && ageHours < 24 * 30) notes.push("Buy order is near 30 days; check if it should expire soon.");
  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 30) notes.push("Buy order is older than 30 days; consider expire/cancel.");
  if (entryPrice > 0 && targetSell > 0 && targetSell < entryPrice) notes.push("Target sell is lower than entry price.");

  return notes;
}

function printDashboardSection(title, items, emptyText, printer) {
  console.log("\n" + title);
  console.log("-".repeat(title.length));

  if (items.length === 0) {
    console.log(emptyText + "\n");
    return;
  }

  items.forEach((item, index) => printer(item, index));
}

function printDashboard() {
  const openPositions = getOpenDashboardPositions();
  const listed = openPositions
    .filter((position) => Number(position.quantity || 0) > 0 && Number(position.listedQuantity || 0) > 0)
    .sort((a, b) => getDashboardAgeHours(b.lastListedAt) - getDashboardAgeHours(a.lastListedAt));

  const needToList = openPositions
    .filter((position) => Number(position.quantity || 0) > 0 && Number(position.listedQuantity || 0) <= 0)
    .sort((a, b) => getDashboardAgeHours(b.openedAt || b.createdAt) - getDashboardAgeHours(a.openedAt || a.createdAt));

  const buyOrders = openPositions
    .filter((position) => getDashboardWaitingQuantity(position) > 0)
    .sort((a, b) => getDashboardAgeHours(b.openedAt || b.createdAt) - getDashboardAgeHours(a.openedAt || a.createdAt));

  const staleDays = Number(process.env.TIBIA_STALE_LISTING_DAYS || 7);
  const staleListed = listed.filter((position) => getDashboardAgeHours(position.lastListedAt) >= staleDays * 24);

  const suspicious = openPositions
    .map((position) => ({ position, notes: getDashboardSuspiciousNotes(position) }))
    .filter((entry) => entry.notes.length > 0);

  const listedValue = listed.reduce(
    (sum, position) => sum + Number(position.listedQuantity || 0) * Number(position.lastListPrice || 0),
    0,
  );

  const openCost = openPositions.reduce(
    (sum, position) => sum + Number(position.quantity || 0) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  const buyOrderCommitment = buyOrders.reduce(
    (sum, position) => sum + getDashboardWaitingQuantity(position) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  console.log("\nTIBIA ACTION DASHBOARD\n");
  console.log("Open positions: " + openPositions.length);
  console.log("Need to list: " + needToList.length);
  console.log("Listed / waiting to sell: " + listed.length);
  console.log("Open buy orders: " + buyOrders.length);
  console.log("Stale listings (" + staleDays + "d+): " + staleListed.length);
  console.log("Suspicious positions: " + suspicious.length);
  console.log("Estimated open item cost: " + formatGp(openCost) + " gp");
  console.log("Estimated buy order commitment: " + formatGp(buyOrderCommitment) + " gp");
  console.log("Estimated listed value: " + formatGp(listedValue) + " gp");

  console.log("\nNEXT ACTIONS");
  console.log("------------");
  if (needToList.length > 0) console.log("1) List received items for sale: use BAT option 4.");
  if (listed.length > 0) console.log("2) Check Tibia market sold items: use BAT option 5.");
  if (staleListed.length > 0) console.log("3) Review stale listings: run Sell Check or relist manually.");
  if (buyOrders.length > 0) console.log("4) Check whether buy orders filled: use BAT option 2 when received.");
  if (suspicious.length > 0) console.log("5) Fix suspicious positions before trusting stats.");
  if (needToList.length + listed.length + staleListed.length + buyOrders.length + suspicious.length === 0) {
    console.log("Nothing urgent. You can run scanner/flips or discovery.");
  }

  printDashboardSection(
    "NEED TO LIST",
    needToList,
    "No received unlisted items.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "LISTED / WAITING TO SELL",
    listed,
    "No active listed positions.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "OPEN BUY ORDERS",
    buyOrders,
    "No buy orders waiting.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "STALE LISTINGS",
    staleListed,
    "No stale listings.",
    (position, index) => printDashboardPosition(position, index, ["Action: check live market price; consider relist/update."]),
  );

  console.log("\nSUSPICIOUS POSITIONS");
  console.log("--------------------");
  if (suspicious.length === 0) {
    console.log("No obvious data issues found.\n");
  } else {
    suspicious.forEach((entry, index) => printDashboardPosition(entry.position, index, entry.notes.map((note) => "Warning: " + note)));
  }
}


function tradeToolStatus(position) {
  return String(position.status || "").toUpperCase();
}

function tradeToolFlow(position) {
  return String(position.flow || "").toUpperCase();
}

function tradeToolIsClosed(position) {
  const status = tradeToolStatus(position);

  return [
    "CLOSED",
    "SOLD",
    "CANCELLED",
    "CANCELED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_EXPIRED",
  ].includes(status);
}

function tradeToolKind(position) {
  const flow = tradeToolFlow(position);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const buyFee = Number(position.buyOfferFeePaid || 0);

  if (flow.includes("EXTERNAL") || flow.includes("LOOT")) {
    return "Loot / external";
  }

  if (flow.includes("MANUAL_LISTING") && entryPrice <= 0 && buyFee <= 0) {
    return "Loot / external";
  }

  return "Flip";
}

function tradeToolAvailableToList(position) {
  normalizePosition(position);

  const owned = Number(position.quantity || 0);
  const listed = Number(position.listedQuantity || 0);

  return Math.max(0, owned - listed);
}

function tradeToolSuggestedListPrice(position) {
  const targetSell = Number(position.targetSell || 0);
  const lastListPrice = Number(position.lastListPrice || 0);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);

  if (targetSell > 0) return targetSell;
  if (lastListPrice > 0) return lastListPrice;
  if (entryPrice > 0) return calculateDefaultTargetSell(entryPrice, 0.06);

  return 0;
}

function getPositionsReadyToList(positionsData) {
  return (positionsData.positions || [])
    .filter((position) => {
      normalizePosition(position);

      if (tradeToolIsClosed(position)) return false;
      if (tradeToolAvailableToList(position) <= 0) return false;

      const status = tradeToolStatus(position);
      if (status === "BUY_ORDER_PLACED") return false;
      if (status === "BUY_ORDER_CANCELLED") return false;
      if (status === "BUY_ORDER_EXPIRED") return false;

      return true;
    })
    .sort((a, b) => {
      const aAge = new Date(a.openedAt || a.createdAt || 0).getTime();
      const bAge = new Date(b.openedAt || b.createdAt || 0).getTime();
      return aAge - bAge;
    });
}

function printListMenuPositions(positions) {
  positions.forEach((position, index) => {
    normalizePosition(position);

    const available = tradeToolAvailableToList(position);
    const suggestedPrice = tradeToolSuggestedListPrice(position);

    console.log(String(index + 1) + ") " + position.name + " (" + position.id + ")");
    console.log("   " + tradeToolKind(position) + " | " + position.status + " | age " + formatAge(position.openedAt || position.createdAt));
    console.log(
      "   Entry: " + formatGp(position.entryPrice) + " gp" +
        " | Owned: " + Number(position.quantity || 0) +
        " | Listed: " + Number(position.listedQuantity || 0) +
        " | Available: " + available
    );

    if (suggestedPrice > 0) {
      console.log("   Suggested/default list price: " + formatGp(suggestedPrice) + " gp");
    }

    console.log("");
  });
}

async function runListMenu(positionsData) {
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const positions = getPositionsReadyToList(positionsData);

      console.log("\nLIST ITEMS FOR SALE\n");

      if (positions.length === 0) {
        console.log("No owned unlisted positions found.");
        console.log("Use Receive Items first, or Add Loot / External Items.");
        return;
      }

      printListMenuPositions(positions);

      const indexAnswer = await rl.question("Choose position number, or Enter to cancel: ");
      if (!String(indexAnswer).trim()) {
        console.log("\nCancelled.\n");
        return;
      }

      const selectedIndex = Number(indexAnswer) - 1;

      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= positions.length
      ) {
        console.log("\nInvalid selection.\n");
        continue;
      }

      const position = positions[selectedIndex];
      normalizePosition(position);

      const available = tradeToolAvailableToList(position);
      const defaultQty = available;

      const qtyAnswer = await rl.question("Quantity to list [Enter = " + defaultQty + "]: ");
      const listQty = String(qtyAnswer).trim() ? Number(qtyAnswer) : defaultQty;

      if (!isPositiveNumber(listQty)) {
        console.log("\nQuantity must be positive.\n");
        continue;
      }

      if (listQty > available) {
        console.log("\nCannot list " + listQty + "; only " + available + " available.\n");
        continue;
      }

      const defaultListPrice = tradeToolSuggestedListPrice(position);
      const pricePrompt =
        "List price each" +
        (defaultListPrice > 0 ? " [Enter = " + formatGp(defaultListPrice) + " gp]" : "") +
        ": ";

      const priceAnswer = await rl.question(pricePrompt);
      const listPrice = String(priceAnswer).trim() ? Number(priceAnswer) : defaultListPrice;

      if (!isPositiveNumber(listPrice)) {
        console.log("\nList price must be positive.\n");
        continue;
      }

      console.log("\nCONFIRM LISTING\n");
      console.log("Item: " + position.name + " (" + position.id + ")");
      console.log("Type: " + tradeToolKind(position));
      console.log("Quantity: " + listQty);
      console.log("List price: " + formatGp(listPrice) + " gp each");
      console.log("Sell offer fee: " + formatGp(calculateSellOfferFee(listPrice, listQty)) + " gp");

      const confirm = await rl.question("\nDid you ACTUALLY list this in Tibia Market? Y/N: ");

      if (String(confirm).trim().toLowerCase() !== "y") {
        console.log("\nCancelled. Nothing was saved.\n");
      } else {
        const sellOfferFeePaid = calculateSellOfferFee(listPrice, listQty);

        position.listedQuantity = Number(position.listedQuantity || 0) + listQty;
        position.totalListedQuantity = Number(position.totalListedQuantity || 0) + listQty;
        position.sellOfferFeePaid = Number(position.sellOfferFeePaid || 0) + sellOfferFeePaid;
        position.lastListPrice = listPrice;
        position.lastListedAt = new Date().toISOString();

        position.status =
          position.listedQuantity >= Number(position.quantity || 0)
            ? "LISTED_FOR_SALE"
            : "PARTIALLY_LISTED";

        addEvent(position, "LISTED_FOR_SALE", {
          quantity: listQty,
          listPrice,
          offerFeePaid: sellOfferFeePaid,
          source: "LIST_MENU",
        });

        savePositions(positionsData);

        console.log("\nITEMS LISTED FOR SALE\n");
        printPosition(position);
        console.log("List price: " + formatGp(listPrice) + " gp");
        console.log("Sell offer fee paid: " + formatGp(sellOfferFeePaid) + " gp");
      }

      const again = await rl.question("\nList another item? Y/N: ");
      if (String(again).trim().toLowerCase() !== "y") {
        return;
      }
    }
  } finally {
    rl.close();
  }
}

function getSoldEventsFromPositions() {
  const positionsData = loadPositions();
  const sales = [];

  for (const position of positionsData.positions || []) {
    normalizePosition(position);

    if (position.ignoredForStats) continue;

    for (const event of position.events || []) {
      if (event.type !== "SOLD_ITEMS") continue;

      sales.push({
        id: position.id,
        name: position.name,
        kind: tradeToolKind(position),
        flow: position.flow || "UNKNOWN",
        quantity: Number(event.quantity || 0),
        entryPrice: Number(position.entryPrice || position.averageEntryPrice || 0),
        sellPrice: Number(event.sellPrice || 0),
        netProfit: Number(event.netProfit || 0),
        roiPercent: Number(event.roiPercent || 0),
        at: event.at || position.closedAt || null,
      });
    }
  }

  return sales;
}

function printStatsSplit() {
  const sales = getSoldEventsFromPositions();

  const flipSales = sales.filter((sale) => sale.kind === "Flip");
  const lootSales = sales.filter((sale) => sale.kind !== "Flip");

  function sum(list, field) {
    return list.reduce((total, sale) => total + Number(sale[field] || 0), 0);
  }

  function avg(list, field) {
    return list.length > 0 ? sum(list, field) / list.length : 0;
  }

  function printBlock(title, list) {
    const totalProfit = sum(list, "netProfit");
    const totalQty = sum(list, "quantity");
    const wins = list.filter((sale) => sale.netProfit >= 0).length;
    const losses = list.filter((sale) => sale.netProfit < 0).length;

    console.log("\n" + title);
    console.log("-".repeat(title.length));
    console.log("Sale events: " + list.length);
    console.log("Quantity sold: " + totalQty);
    console.log("Profit: " + formatGp(totalProfit) + " gp");
    console.log("Average profit/event: " + formatGp(list.length ? totalProfit / list.length : 0) + " gp");
    console.log("Average ROI: " + avg(list, "roiPercent").toFixed(2) + "%");
    console.log("Wins/Losses: " + wins + "/" + losses);
  }

  function printTopItems(title, list) {
    const byItem = new Map();

    for (const sale of list) {
      const key = String(sale.id);
      if (!byItem.has(key)) {
        byItem.set(key, {
          id: sale.id,
          name: sale.name,
          events: 0,
          quantity: 0,
          profit: 0,
          roiTotal: 0,
        });
      }

      const item = byItem.get(key);
      item.events += 1;
      item.quantity += sale.quantity;
      item.profit += sale.netProfit;
      item.roiTotal += sale.roiPercent;
    }

    const ranked = [...byItem.values()].sort((a, b) => b.profit - a.profit);

    console.log("\n" + title);
    console.log("-".repeat(title.length));

    if (ranked.length === 0) {
      console.log("None.");
      return;
    }

    ranked.slice(0, 5).forEach((item, index) => {
      console.log(
        "#" + (index + 1) + " " + item.name + "\n" +
          "Sale events: " + item.events + "\n" +
          "Quantity sold: " + item.quantity + "\n" +
          "Profit: " + formatGp(item.profit) + " gp\n" +
          "Average ROI: " + (item.roiTotal / item.events).toFixed(2) + "%\n"
      );
    });
  }

  const totalProfit = sum(sales, "netProfit");
  const flipProfit = sum(flipSales, "netProfit");
  const lootProfit = sum(lootSales, "netProfit");

  console.log("\nTIBIA TRADE STATS — SPLIT VIEW\n");
  console.log("Total profit: " + formatGp(totalProfit) + " gp");
  console.log("Real flip profit: " + formatGp(flipProfit) + " gp");
  console.log("Loot / external profit: " + formatGp(lootProfit) + " gp");
  console.log("Flip share: " + (totalProfit ? ((flipProfit / totalProfit) * 100).toFixed(2) : "0.00") + "%");

  printBlock("FLIPS", flipSales);
  printBlock("LOOT / EXTERNAL", lootSales);
  printTopItems("TOP FLIP ITEMS", flipSales);
  printTopItems("TOP LOOT / EXTERNAL ITEMS", lootSales);
}

const [, , rawAction, ...args] = process.argv;
const actionAliases = {
  dash: "dashboard",
  "action-dashboard": "dashboard",
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
    "list-menu",
    "sold",
    "sold-menu",
    "open",
    "close",
    "add",
    "orders",
    "dashboard",
    "cancel",
    "expire",
    "stats",
    "stats-split",
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

if (action === "orders") {
  printOrders();
  process.exit(0);
}

if (action === "dashboard") {
  printDashboard();
  process.exit(0);
}

const positionsData = loadPositions();

if (action === "sold-menu") {
  await runSoldMenu(positionsData);
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
      buyOfferFeePaid,
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
