const fs = require("fs");

const tradePath = "trade.js";
const batPath = "trade-manager.bat";

function backup(path) {
  if (fs.existsSync(path) && !fs.existsSync(path + ".bak-relist")) {
    fs.copyFileSync(path, path + ".bak-relist");
  }
}

function addAction(text, actionName, afterActionName) {
  const match = /!\[\s*([\s\S]*?)\]\.includes\(action\)/.exec(text);
  if (!match) throw new Error("Could not find action validation list.");

  const block = match[1];
  if (block.includes(`"${actionName}"`)) return text;

  const newBlock = block.replace(
    `"${afterActionName}",`,
    `"${afterActionName}",\n    "${actionName}",`
  );

  if (newBlock === block) {
    throw new Error("Could not add action " + actionName);
  }

  return (
    text.slice(0, match.index) +
    match[0].replace(block, newBlock) +
    text.slice(match.index + match[0].length)
  );
}

backup(tradePath);
backup(batPath);

let trade = fs.readFileSync(tradePath, "utf8");

const relistBlock = String.raw`
function getRelistablePositions(positionsData) {
  return (positionsData.positions || [])
    .filter((position) => {
      normalizePosition(position);

      const status = String(position.status || "").toUpperCase();
      const listedQuantity = Number(position.listedQuantity || 0);

      if (position.ignoredForStats) return false;
      if (["CLOSED", "SOLD", "CANCELLED", "CANCELED", "BUY_ORDER_CANCELLED", "BUY_ORDER_EXPIRED"].includes(status)) {
        return false;
      }

      return listedQuantity > 0 || status === "LISTED_FOR_SALE" || status === "PARTIALLY_LISTED";
    })
    .sort((a, b) => {
      const aTime = new Date(a.lastListedAt || a.openedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.lastListedAt || b.openedAt || b.createdAt || 0).getTime();
      return aTime - bTime;
    });
}

function printRelistablePositions(positions) {
  positions.forEach((position, index) => {
    normalizePosition(position);

    const listed = Number(position.listedQuantity || 0);
    const entry = Number(position.entryPrice || position.averageEntryPrice || 0);
    const lastPrice = Number(position.lastListPrice || position.targetSell || 0);
    const sellFees = Number(position.sellOfferFeePaid || 0);

    console.log(String(index + 1) + ") " + position.name + " (" + position.id + ")");
    console.log("   Status: " + position.status + " | age " + formatAge(position.openedAt || position.createdAt));
    console.log("   Listed: " + listed + " | Entry: " + formatGp(entry) + " gp | Current list: " + formatGp(lastPrice) + " gp");
    console.log("   Sell fees paid so far: " + formatGp(sellFees) + " gp");
    console.log("");
  });
}

async function runRelistMenu(positionsData) {
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const positions = getRelistablePositions(positionsData);

      console.log("\nRELIST / UPDATE EXISTING LISTING\n");

      if (positions.length === 0) {
        console.log("No currently listed positions found.");
        console.log("Use List Items For Sale first.");
        return;
      }

      printRelistablePositions(positions);

      const indexAnswer = await rl.question("Choose listed position number, or Enter to cancel: ");
      if (!String(indexAnswer).trim()) {
        console.log("\nCancelled.\n");
        return;
      }

      const selectedIndex = Number(indexAnswer) - 1;

      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= positions.length) {
        console.log("\nInvalid selection.\n");
        continue;
      }

      const position = positions[selectedIndex];
      normalizePosition(position);

      const currentListed = Number(position.listedQuantity || 0);
      const currentPrice = Number(position.lastListPrice || position.targetSell || 0);

      const qtyAnswer = await rl.question("Quantity relisted [Enter = " + currentListed + "]: ");
      const relistQty = String(qtyAnswer).trim() ? Number(qtyAnswer) : currentListed;

      if (!isPositiveNumber(relistQty)) {
        console.log("\nQuantity must be positive.\n");
        continue;
      }

      if (relistQty > Number(position.quantity || 0)) {
        console.log("\nCannot relist more than owned quantity: " + Number(position.quantity || 0) + "\n");
        continue;
      }

      const priceAnswer = await rl.question(
        "New list price each" + (currentPrice > 0 ? " [old/current = " + formatGp(currentPrice) + " gp]" : "") + ": "
      );

      const newListPrice = Number(priceAnswer);

      if (!isPositiveNumber(newListPrice)) {
        console.log("\nNew list price must be positive.\n");
        continue;
      }

      const newFee = calculateSellOfferFee(newListPrice, relistQty);
      const oldPriceText = currentPrice > 0 ? formatGp(currentPrice) + " gp" : "unknown";

      console.log("\nCONFIRM RELIST\n");
      console.log("Item: " + position.name + " (" + position.id + ")");
      console.log("Quantity: " + relistQty);
      console.log("Old/current price: " + oldPriceText);
      console.log("New price: " + formatGp(newListPrice) + " gp each");
      console.log("New sell offer fee: " + formatGp(newFee) + " gp");
      console.log("\nImportant: confirm only if you actually cancelled/relisted or updated the offer in Tibia Market.");

      const confirm = await rl.question("\nSave this relist? Y/N: ");

      if (String(confirm).trim().toLowerCase() !== "y") {
        console.log("\nCancelled. Nothing was saved.\n");
      } else {
        const now = new Date().toISOString();

        position.listedQuantity = relistQty;
        position.totalListedQuantity = Number(position.totalListedQuantity || 0) + relistQty;
        position.sellOfferFeePaid = Number(position.sellOfferFeePaid || 0) + newFee;
        position.lastListPrice = newListPrice;
        position.lastRelistedAt = now;
        position.lastListedAt = now;
        position.status =
          relistQty >= Number(position.quantity || 0)
            ? "LISTED_FOR_SALE"
            : "PARTIALLY_LISTED";

        addEvent(position, "RELISTED_FOR_SALE", {
          quantity: relistQty,
          previousListPrice: currentPrice || null,
          listPrice: newListPrice,
          offerFeePaid: newFee,
          source: "RELIST_MENU",
        });

        savePositions(positionsData);

        console.log("\nRELIST SAVED\n");
        printPosition(position);
        console.log("New list price: " + formatGp(newListPrice) + " gp");
        console.log("New sell offer fee paid: " + formatGp(newFee) + " gp");
      }

      const again = await rl.question("\nRelist another item? Y/N: ");
      if (String(again).trim().toLowerCase() !== "y") {
        return;
      }
    }
  } finally {
    rl.close();
  }
}
`;

if (!trade.includes("async function runRelistMenu")) {
  const marker = "const [, , rawAction, ...args] = process.argv;";
  if (!trade.includes(marker)) throw new Error("Could not find action parser marker.");

  trade = trade.replace(marker, relistBlock + "\n" + marker);
}

trade = addAction(trade, "relist-menu", "list-menu");

// Remove duplicate/broken relist branches if script is rerun.
trade = trade.replace(
  /if \(action === "relist-menu"\) \{\s*runRelistMenu\(positionsData\)[\s\S]*?\n\}\s*\n/g,
  ""
);

const rawActionIndex = trade.indexOf("const [, , rawAction, ...args] = process.argv;");
const positionsMarker = "const positionsData = loadPositions();";
const positionsIndex = trade.indexOf(positionsMarker, rawActionIndex);

if (positionsIndex < 0) {
  throw new Error("Could not find top-level positionsData load.");
}

const insertAt = positionsIndex + positionsMarker.length;

const branch = `

if (action === "relist-menu") {
  runRelistMenu(positionsData)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Relist menu failed:", error);
      process.exit(1);
    });
}
`;

trade = trade.slice(0, insertAt) + branch + trade.slice(insertAt);

trade = trade.replace(
  "  node trade.js list-menu\n",
  "  node trade.js list-menu\n  node trade.js relist-menu\n"
);

fs.writeFileSync(tradePath, trade, "utf8");

let bat = fs.readFileSync(batPath, "utf8");

if (!bat.includes("Relist / Update Listing")) {
  bat = bat.replace("echo 17 Action Dashboard", "echo 17 Action Dashboard\r\necho 18 Relist / Update Listing");
  bat = bat.replace("echo 18 Exit", "echo 19 Exit");

  bat = bat.replace('if "%choice%"=="17" goto dashboard', 'if "%choice%"=="17" goto dashboard\r\nif "%choice%"=="18" goto relist');

  bat = bat.replace(/if "%choice%"=="18" goto ([a-zA-Z0-9_]+)/, 'if "%choice%"=="19" goto $1');

  const relistBatBlock = `
:relist
cls
echo RELIST / UPDATE EXISTING LISTING
echo.
echo Use this only after you actually changed the listing in Tibia Market.
echo.
call npm run trade -- relist-menu
pause
goto menu

`;

  if (bat.includes(":dashboard")) {
    bat = bat.replace(":dashboard", relistBatBlock + ":dashboard");
  } else {
    bat += relistBatBlock;
  }
}

fs.writeFileSync(batPath, bat, "utf8");

console.log("Relist menu patch complete.");
