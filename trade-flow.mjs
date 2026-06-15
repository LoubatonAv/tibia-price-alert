import fs from "fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { getItemMap } from "./lib/market.js";
import { loadState, saveState } from "./lib/state.js";
import {
  closeTrade,
  normalizePosition,
  calculateSellOfferFee,
  calculateBuyOfferFee,
} from "./lib/trades.js";

const POSITIONS_FILE = "./positions.json";

function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) return { positions: [] };
  const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
  if (!Array.isArray(data.positions)) data.positions = [];
  data.positions.forEach(normalizePosition);
  return data;
}

function savePositions(data) {
  const temp = `${POSITIONS_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, POSITIONS_FILE);
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function formatAge(fromDate) {
  if (!fromDate) return "N/A";
  const time = new Date(fromDate).getTime();
  if (!Number.isFinite(time)) return "N/A";
  const hours = (Date.now() - time) / 36e5;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function isClosedLike(position) {
  const status = String(position.status || "").toUpperCase();
  return [
    "CLOSED",
    "SOLD",
    "CANCELLED",
    "CANCELED",
    "BUY_ORDER_CANCELLED",
    "BUY_ORDER_CANCELED",
    "BUY_ORDER_EXPIRED",
    "EXPIRED",
  ].includes(status);
}

function addEvent(position, type, details = {}) {
  normalizePosition(position);
  position.events.push({ type, at: new Date().toISOString(), ...details });
}

function resolveItem(inputValue) {
  const itemMap = getItemMap();
  const raw = String(inputValue || "").trim();

  if (!raw) throw new Error("Item name or ID is required.");

  if (Number.isFinite(Number(raw))) {
    const id = Number(raw);
    return { id, name: itemMap[id] || `Unknown Item (${id})` };
  }

  const normalized = raw.toLowerCase();
  const found = Object.entries(itemMap).find(
    ([, name]) => String(name).trim().toLowerCase() === normalized,
  );

  if (!found) throw new Error(`Item not found: ${raw}. Try numeric item ID.`);

  return { id: Number(found[0]), name: found[1] };
}

function activePositions(data) {
  return data.positions.filter((position) => !isClosedLike(position));
}

function openBuyOrders(data) {
  return activePositions(data).filter((position) => {
    normalizePosition(position);
    const waiting = Math.max(
      0,
      Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
    );
    return String(position.status || "").startsWith("BUY_ORDER") && waiting > 0;
  });
}

function readyToList(data) {
  return activePositions(data).filter((position) => {
    normalizePosition(position);
    return Number(position.quantity || 0) > Number(position.listedQuantity || 0);
  });
}

function activeListings(data) {
  return activePositions(data).filter((position) => {
    normalizePosition(position);
    return Number(position.listedQuantity || 0) > 0;
  });
}

async function question(text) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(text);
  rl.close();
  return answer.trim();
}

async function yesNo(text) {
  const answer = (await question(text + " ")).toLowerCase();
  return answer === "y" || answer === "yes" || answer === "×›×Ÿ";
}

async function chooseFromList(rows, title, renderRow) {
  console.log(`\n${title}\n${"-".repeat(title.length)}\n`);

  if (rows.length === 0) {
    console.log("Nothing to show.");
    return null;
  }

  rows.forEach((row, index) => renderRow(row, index));

  const answer = await question("Choose number, or Enter to cancel: ");
  if (!answer) return null;

  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    console.log("Invalid choice.");
    return null;
  }

  return rows[index];
}

async function runReceive() {
  const data = loadPositions();
  const rows = openBuyOrders(data);

  const position = await chooseFromList(rows, "RECEIVE FILLED BUY ORDER", (row, index) => {
    const waiting = Math.max(
      0,
      Number(row.orderedQuantity || 0) - Number(row.receivedQuantity || 0),
    );
    console.log(
      `${index + 1}) ${row.name} (${row.id}) | waiting ${waiting} | entry ${formatGp(row.entryPrice)} gp | age ${formatAge(row.openedAt || row.createdAt)}`,
    );
  });

  if (!position) return;

  const waiting = Math.max(
    0,
    Number(position.orderedQuantity || 0) - Number(position.receivedQuantity || 0),
  );
  const qtyAnswer = await question(`Quantity received [${waiting}]: `);
  const receiveQty = qtyAnswer ? Number(qtyAnswer) : waiting;

  if (!Number.isFinite(receiveQty) || receiveQty <= 0 || receiveQty > waiting) {
    console.log("Invalid quantity.");
    return;
  }

  const entryAnswer = await question(
    `Actual entry price per item, Enter to use ${formatGp(position.entryPrice)}: `,
  );
  const entryPrice = entryAnswer ? Number(entryAnswer) : Number(position.entryPrice || 0);

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    console.log("Invalid entry price.");
    return;
  }

  const confirmed = await yesNo("Did you actually receive these items in Tibia? Y/N:");
  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  const previousReceived = Number(position.receivedQuantity || 0);
  const previousCost = previousReceived * Number(position.averageEntryPrice || position.entryPrice || 0);
  const newReceivedTotal = previousReceived + receiveQty;
  const newCost = receiveQty * entryPrice;

  position.receivedQuantity = newReceivedTotal;
  position.quantity = Number(position.quantity || 0) + receiveQty;
  position.averageEntryPrice = newReceivedTotal > 0 ? (previousCost + newCost) / newReceivedTotal : entryPrice;
  position.entryPrice = position.averageEntryPrice;

  const stillWaiting = Math.max(0, Number(position.orderedQuantity || 0) - newReceivedTotal);
  position.status = stillWaiting > 0 ? "BUY_ORDER_PARTIAL" : "ITEMS_RECEIVED";

  addEvent(position, "ITEMS_RECEIVED", {
    quantity: receiveQty,
    entryPrice,
    averageEntryPrice: position.averageEntryPrice,
  });

  savePositions(data);

  console.log("\nITEMS RECEIVED");
  console.log(`${position.name}: received ${receiveQty}, owned now ${position.quantity}, still waiting ${stillWaiting}.`);
}

async function runList() {
  const data = loadPositions();
  const rows = readyToList(data);

  const position = await chooseFromList(rows, "LIST READY ITEMS", (row, index) => {
    const available = Math.max(0, Number(row.quantity || 0) - Number(row.listedQuantity || 0));
    console.log(
      `${index + 1}) ${row.name} (${row.id}) | available ${available} | entry ${formatGp(row.entryPrice)} gp | flow ${row.flow || "UNKNOWN"}`,
    );
  });

  if (!position) return;

  const available = Math.max(0, Number(position.quantity || 0) - Number(position.listedQuantity || 0));
  const qtyAnswer = await question(`Quantity to list [${available}]: `);
  const listQty = qtyAnswer ? Number(qtyAnswer) : available;

  if (!Number.isFinite(listQty) || listQty <= 0 || listQty > available) {
    console.log("Invalid quantity.");
    return;
  }

  const listPrice = Number(await question("Planned sell price EACH item: "));
  if (!Number.isFinite(listPrice) || listPrice <= 0) {
    console.log("Invalid list price.");
    return;
  }

  const lowestSellAnswer = await question("Current lowest sell price in Tibia Market [same as planned]: ");
  const lowestSell = lowestSellAnswer ? Number(lowestSellAnswer) : listPrice;
  const lowestSellQtyAnswer = await question("Quantity at current lowest sell [0 if unknown]: ");
  const lowestSellQty = lowestSellQtyAnswer ? Number(lowestSellQtyAnswer) : 0;

  console.log("\nRunning sell advisor first...\n");
  const advisor = spawnSync(
    "node",
    [
      "inventory.js",
      "sell",
      String(position.name),
      String(listQty),
      String(listPrice),
      "--entry-price",
      String(position.entryPrice || 0),
      "--lowest-sell",
      String(lowestSell || 0),
      "--lowest-sell-qty",
      String(lowestSellQty || 0),
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );

  if (advisor.status !== 0) {
    console.log("Sell advisor failed. Position was not updated.");
    return;
  }

  const confirmed = await yesNo("Did you actually place this sell offer in Tibia Market? Y/N:");
  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  const fee = calculateSellOfferFee(listPrice, listQty);
  position.listedQuantity = Number(position.listedQuantity || 0) + listQty;
  position.totalListedQuantity = Number(position.totalListedQuantity || 0) + listQty;
  position.sellOfferFeePaid = Number(position.sellOfferFeePaid || 0) + fee;
  position.lastListPrice = listPrice;
  position.lastListedAt = new Date().toISOString();
  position.status = position.listedQuantity >= Number(position.quantity || 0) ? "LISTED_FOR_SALE" : "PARTIALLY_LISTED";

  addEvent(position, "LISTED_FOR_SALE", {
    quantity: listQty,
    listPrice,
    offerFeePaid: fee,
  });

  savePositions(data);

  console.log("\nITEMS LISTED FOR SALE");
  console.log(`${position.name}: listed ${listQty} @ ${formatGp(listPrice)} gp. Fee: ${formatGp(fee)} gp.`);
}

async function runSold() {
  const data = loadPositions();
  const rows = activeListings(data);

  const position = await chooseFromList(rows, "MARK SOLD LISTING", (row, index) => {
    console.log(
      `${index + 1}) ${row.name} (${row.id}) | listed ${row.listedQuantity} @ ${formatGp(row.lastListPrice)} gp | flow ${row.flow || "UNKNOWN"} | age ${formatAge(row.lastListedAt)}`,
    );
  });

  if (!position) return;

  const listedQty = Number(position.listedQuantity || 0);
  const qtyAnswer = await question(`Quantity sold [${listedQty}]: `);
  const soldQty = qtyAnswer ? Number(qtyAnswer) : listedQty;

  if (!Number.isFinite(soldQty) || soldQty <= 0 || soldQty > listedQty || soldQty > Number(position.quantity || 0)) {
    console.log("Invalid quantity.");
    return;
  }

  const priceAnswer = await question(`Actual sell price EACH [${formatGp(position.lastListPrice)}]: `);
  const sellPrice = priceAnswer ? Number(priceAnswer) : Number(position.lastListPrice || 0);

  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    console.log("Invalid sell price.");
    return;
  }

  const confirmed = await yesNo("Did these items actually sell in Tibia Market? Y/N:");
  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  const state = loadState();
  let trade;

  try {
    trade = closeTrade({
      state,
      position,
      sellPrice,
      quantity: soldQty,
      exitReason: "SOLD_FROM_LISTING_MENU",
    });
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return;
  }

  savePositions(data);
  saveState(state);

  console.log("\nSALE RECORDED");
  console.log(`${trade.name}: sold ${trade.quantity} @ ${formatGp(trade.sellPrice)} gp.`);
  console.log(`Profit: ${formatGp(trade.netProfit)} gp | ROI: ${trade.isExternal ? "N/A â€” loot/external" : `${trade.roiPercent.toFixed(2)}%`}`);
  console.log(`Remaining owned: ${position.quantity} | Remaining listed: ${position.listedQuantity}`);
}

async function runAddLoot() {
  console.log("\nADD LOOT / EXTERNAL ITEMS\n");
  const itemInput = await question("Item name or ID: ");
  const item = resolveItem(itemInput);
  const qty = Number(await question("Quantity: "));

  if (!Number.isFinite(qty) || qty <= 0) {
    console.log("Invalid quantity.");
    return;
  }

  const costAnswer = await question("Cost per item [0 for loot/drop]: ");
  const entryPrice = costAnswer ? Number(costAnswer) : 0;

  if (!Number.isFinite(entryPrice) || entryPrice < 0) {
    console.log("Invalid cost.");
    return;
  }

  let buyOfferFeePaid = 0;
  if (entryPrice > 0) {
    const boughtByOffer = await yesNo("Did you buy this through a Tibia buy offer? Y/N:");
    buyOfferFeePaid = boughtByOffer ? calculateBuyOfferFee(entryPrice, qty) : 0;
  }

  const confirmed = await yesNo("Add these items to local tracking? Y/N:");
  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  const data = loadPositions();
  const now = new Date().toISOString();
  const isExternal = entryPrice <= 0;

  data.positions.push({
    id: item.id,
    name: item.name,
    createdAt: now,
    openedAt: now,
    flow: isExternal ? "LOOT_OR_EXTERNAL" : "MANUAL_EXTERNAL_BUY",
    entryPrice,
    averageEntryPrice: entryPrice,
    originalQuantity: qty,
    orderedQuantity: qty,
    receivedQuantity: qty,
    quantity: qty,
    listedQuantity: 0,
    soldQuantity: 0,
    totalListedQuantity: 0,
    buyOfferFeePaid,
    sellOfferFeePaid: 0,
    targetSell: null,
    desiredMargin: 0,
    entryBrainScore: null,
    status: "ITEMS_RECEIVED",
    events: [
      {
        type: isExternal ? "LOOT_OR_EXTERNAL_ADDED" : "MANUAL_EXTERNAL_BUY_ADDED",
        at: now,
        quantity: qty,
        entryPrice,
        buyOfferFeePaid,
      },
    ],
  });

  savePositions(data);
  console.log(`\nAdded ${qty}x ${item.name}. Use List Ready Items when you place a sell offer.`);
}

async function runCancelOrExpire(kind) {
  const data = loadPositions();
  const rows = openBuyOrders(data);
  const title = kind === "expire" ? "EXPIRE BUY ORDER" : "CANCEL BUY ORDER";

  const position = await chooseFromList(rows, title, (row, index) => {
    const waiting = Math.max(
      0,
      Number(row.orderedQuantity || 0) - Number(row.receivedQuantity || 0),
    );
    console.log(
      `${index + 1}) ${row.name} (${row.id}) | waiting ${waiting} | fee already paid ${formatGp(row.buyOfferFeePaid)} gp | age ${formatAge(row.openedAt || row.createdAt)}`,
    );
  });

  if (!position) return;

  const confirmed = await yesNo(
    kind === "expire"
      ? "Did this buy order really expire/disappear in Tibia? Y/N:"
      : "Did you really cancel this buy order in Tibia? Y/N:",
  );

  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  position.status = kind === "expire" ? "BUY_ORDER_EXPIRED" : "BUY_ORDER_CANCELLED";
  position.closedAt = new Date().toISOString();
  addEvent(position, kind === "expire" ? "BUY_ORDER_EXPIRED" : "BUY_ORDER_CANCELLED", {
    feeLost: Number(position.buyOfferFeePaid || 0),
  });

  savePositions(data);
  console.log(`\n${position.name}: ${position.status}. Fee lost: ${formatGp(position.buyOfferFeePaid)} gp.`);
}

const action = String(process.argv[2] || "").toLowerCase();

try {
  if (action === "receive") await runReceive();
  else if (action === "list") await runList();
  else if (action === "sold") await runSold();
  else if (action === "add-loot") await runAddLoot();
  else if (action === "cancel") await runCancelOrExpire("cancel");
  else if (action === "expire") await runCancelOrExpire("expire");
  else {
    console.log(`
Usage:
  node trade-flow.mjs receive
  node trade-flow.mjs list
  node trade-flow.mjs sold
  node trade-flow.mjs add-loot
  node trade-flow.mjs cancel
  node trade-flow.mjs expire
`);
  }
} catch (error) {
  console.log(`\nError: ${error.message}`);
  process.exit(1);
}

