import fs from "fs";

function backup(path) {
  if (fs.existsSync(path) && !fs.existsSync(path + ".bak")) {
    fs.copyFileSync(path, path + ".bak");
  }
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error("Could not find patch target: " + label);
  }
  return text.replace(search, replacement);
}

const tradePath = "trade.js";
const batPath = "trade-manager.bat";

backup(tradePath);
backup(batPath);

let trade = fs.readFileSync(tradePath, "utf8");

if (!trade.includes('"sold-menu"')) {
  trade = replaceOnce(
    trade,
    '    "sold",\n    "open",',
    '    "sold",\n    "sold-menu",\n    "open",',
    "allowed actions"
  );
}

const soldMenuBlock = `
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

  return (
    flow.includes("EXTERNAL") ||
    flow.includes("LOOT") ||
    flow.includes("MANUAL_LISTING")
  );
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
    console.log("\\nSOLD ITEMS\\n");
    console.log("1) Flip / bought position");
    console.log("2) Loot / external item");

    const typeAnswer = await ask("\\nChoose type [1/2]: ");
    const kind = String(typeAnswer).trim() === "2" ? "loot" : "flip";
    const positions = getSellablePositions(positionsData, kind);

    if (positions.length === 0) {
      console.log(
        kind === "loot"
          ? "\\nNo loot/external sellable positions found."
          : "\\nNo flip sellable positions found."
      );
      return;
    }

    console.log(
      kind === "loot"
        ? "\\nLOOT / EXTERNAL POSITIONS\\n"
        : "\\nFLIP POSITIONS\\n"
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

    console.log("\\nCONFIRM SOLD\\n");
    console.log("Item: " + position.name + " (" + position.id + ")");
    console.log("Type: " + (kind === "loot" ? "Loot / external" : "Flip"));
    console.log("Quantity: " + quantity);
    console.log("Sell price: " + formatGp(sellPrice) + " gp each");

    const confirm = await ask("\\nConfirm this sale? Y/N: ");

    if (String(confirm).trim().toLowerCase() !== "y") {
      console.log("\\nCancelled. Nothing was saved.\\n");
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
        ? "\\nTRADE CLOSED\\n"
        : "\\nPARTIAL SALE RECORDED\\n"
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
`;

if (!trade.includes("async function runSoldMenu")) {
  trade = replaceOnce(
    trade,
    "const [, , rawAction, ...args] = process.argv;",
    soldMenuBlock + "\nconst [, , rawAction, ...args] = process.argv;",
    "insert sold menu helpers"
  );
}

if (!trade.includes('if (action === "sold-menu")')) {
  trade = replaceOnce(
    trade,
    'const positionsData = loadPositions();\n\nif (action === "check") {',
    'const positionsData = loadPositions();\n\nif (action === "sold-menu") {\n  await runSoldMenu(positionsData);\n  process.exit(0);\n}\n\nif (action === "check") {',
    "sold-menu branch"
  );
}

trade = trade.replace(
  "  node trade.js sold ITEM_ID_OR_NAME QUANTITY SELL_PRICE\n",
  "  node trade.js sold ITEM_ID_OR_NAME QUANTITY SELL_PRICE\n  node trade.js sold-menu\n"
);

fs.writeFileSync(tradePath, trade, "utf8");

let bat = fs.readFileSync(batPath, "utf8");

const soldBlock = `:sold
cls
echo SOLD ITEMS
echo.
echo Choose Flip for bought positions, or Loot / External for items added manually.
echo.
call npm run trade -- sold-menu
pause
goto menu

:stats`;

bat = bat.replace(/:sold[\s\S]*?\r?\n:stats/, soldBlock);

fs.writeFileSync(batPath, bat, "utf8");

console.log("Patched trade.js and trade-manager.bat");
console.log("Backups created if missing: trade.js.bak, trade-manager.bat.bak");
