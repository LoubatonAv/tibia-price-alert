const fs = require("fs");

function backup(path) {
  if (fs.existsSync(path) && !fs.existsSync(path + ".bak-efficiency")) {
    fs.copyFileSync(path, path + ".bak-efficiency");
  }
}

function replaceOrFail(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error("Could not patch: " + label);
  return next;
}

function ensureAction(text, actionName, afterActionName) {
  const match = /!\[\s*([\s\S]*?)\]\.includes\(action\)/.exec(text);
  if (!match) throw new Error("Could not find action validation list.");

  const block = match[1];
  if (block.includes(`"${actionName}"`)) return text;

  const patchedBlock = block.replace(
    `"${afterActionName}",`,
    `"${afterActionName}",\n    "${actionName}",`
  );

  if (patchedBlock === block) {
    throw new Error(`Could not add action ${actionName}`);
  }

  return text.slice(0, match.index) +
    text.slice(match.index, match.index + match[0].length).replace(block, patchedBlock) +
    text.slice(match.index + match[0].length);
}

const tradePath = "trade.js";
const batPath = "trade-manager.bat";
const workflowPath = ".github/workflows/scanner.yml";

backup(tradePath);
backup(batPath);
backup(workflowPath);

let trade = fs.readFileSync(tradePath, "utf8");

const efficiencyBlock = String.raw`
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
`;

if (!trade.includes("async function runListMenu")) {
  trade = replaceOrFail(
    trade,
    "const [, , rawAction, ...args] = process.argv;",
    efficiencyBlock + "\nconst [, , rawAction, ...args] = process.argv;",
    "efficiency helper block"
  );
}

trade = ensureAction(trade, "list-menu", "list");
trade = ensureAction(trade, "stats-split", "stats");

if (!trade.includes('if (action === "stats-split")')) {
  trade = replaceOrFail(
    trade,
    'if (action === "stats") {\n  printStats();\n  process.exit(0);\n}\n',
    'if (action === "stats") {\n  printStats();\n  process.exit(0);\n}\n\nif (action === "stats-split") {\n  printStatsSplit();\n  process.exit(0);\n}\n',
    "stats-split branch"
  );
}

if (!trade.includes('if (action === "list-menu")')) {
  trade = replaceOrFail(
    trade,
    'const positionsData = loadPositions();\n',
    'const positionsData = loadPositions();\n\nif (action === "list-menu") {\n  await runListMenu(positionsData);\n  process.exit(0);\n}\n',
    "list-menu branch"
  );
}

trade = trade.replace(
  "  node trade.js list ITEM_ID_OR_NAME QUANTITY LIST_PRICE\n",
  "  node trade.js list ITEM_ID_OR_NAME QUANTITY LIST_PRICE\n  node trade.js list-menu\n"
);

trade = trade.replace(
  "  node trade.js stats\n",
  "  node trade.js stats\n  node trade.js stats-split\n"
);

fs.writeFileSync(tradePath, trade, "utf8");

let bat = fs.readFileSync(batPath, "utf8");

const newListBlock = `:list
cls
echo LIST ITEMS FOR SALE
echo.
echo This lists items from existing positions, so you do not create duplicate manual listings.
echo.
call npm run trade -- list-menu
pause
goto menu

:sold`;

bat = bat.replace(/:list[\s\S]*?\r?\n:sold/, newListBlock);

const newStatsBlock = `:stats
cls
call npm run trade -- stats-split
pause
goto menu

:orders`;

bat = bat.replace(/:stats[\s\S]*?\r?\n:orders/, newStatsBlock);

bat = bat.replace(
  /:runscanner[\s\S]*?\r?\n:rundiscovery/,
`:runscanner
cls
echo RUN SCANNER
echo.
echo This runs npm run scanner locally for tracked items / regular flips.
echo It also enables manual Snipe Watch for expensive underpriced listings.
echo.
set SCANNER_MODE=tracked
set SNIPE_MIN_SELL_PRICE=100000
set SNIPE_MIN_DISCOUNT_PERCENT=18
call npm run scanner
pause
goto menu

:rundiscovery`
);

fs.writeFileSync(batPath, bat, "utf8");

if (fs.existsSync(workflowPath)) {
  let workflow = fs.readFileSync(workflowPath, "utf8");

  if (!workflow.includes("SNIPE_MIN_SELL_PRICE")) {
    workflow = workflow.replace(
      /(\s+SCANNER_MODE:\s*tracked\s*)/,
      "$1          SNIPE_MIN_SELL_PRICE: 100000\n          SNIPE_MIN_DISCOUNT_PERCENT: 18\n"
    );
  }

  fs.writeFileSync(workflowPath, workflow, "utf8");
}

console.log("Efficiency phase 1 patch complete.");
console.log("Added:");
console.log("- trade.js list-menu");
console.log("- trade.js stats-split");
console.log("- BAT option 4 now lists from positions");
console.log("- BAT option 6 now shows split stats");
console.log("- Scanner snipe thresholds set to 100k / 18%");
