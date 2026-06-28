const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function insertBefore(source, marker, block) {
  if (source.includes(block.trim().slice(0, 60))) return source;
  const index = source.indexOf(marker);
  if (index === -1) throw new Error("Marker not found: " + marker);
  return source.slice(0, index) + block + "\n" + source.slice(index);
}

function patchTradeFlow() {
  const path = "trade-flow.mjs";
  let text = read(path);

  const fn = `
async function runCancelListing() {
  const data = loadPositions();
  const rows = activeListings(data);

  const position = await chooseFromList(rows, "CANCEL / REMOVE LISTED SELL OFFER", (row, index) => {
    console.log(
      \`\${index + 1}) \${row.name} (\${row.id}) | listed \${row.listedQuantity} @ \${formatGp(row.lastListPrice)} gp | flow \${row.flow || "UNKNOWN"} | age \${formatAge(row.lastListedAt)}\`,
    );
  });

  if (!position) return;

  const listedQty = Number(position.listedQuantity || 0);
  const qtyAnswer = await question(\`Quantity removed from Tibia Market [\${listedQty}]: \`);
  const cancelQty = qtyAnswer ? Number(qtyAnswer) : listedQty;

  if (!Number.isFinite(cancelQty) || cancelQty <= 0 || cancelQty > listedQty) {
    console.log("Invalid quantity.");
    return;
  }

  const confirmed = await yesNo("Did you actually cancel/remove this sell offer in Tibia Market? Y/N:");
  if (!confirmed) {
    console.log("Cancelled. Nothing saved.");
    return;
  }

  position.listedQuantity = Math.max(0, Number(position.listedQuantity || 0) - cancelQty);
  position.status = position.listedQuantity > 0 ? "PARTIALLY_LISTED" : "ITEMS_RECEIVED";
  position.lastListingCancelledAt = new Date().toISOString();

  addEvent(position, "LISTING_CANCELLED", {
    quantity: cancelQty,
    previousListPrice: Number(position.lastListPrice || 0),
    note: "Sell offer was removed from Tibia Market. Original listing fee is already paid/lost.",
  });

  savePositions(data);

  console.log("\\nLISTING CANCELLED / REMOVED");
  console.log(\`\${position.name}: removed \${cancelQty} from listed offers.\`);
  console.log(\`Still listed: \${position.listedQuantity}\`);
  console.log(\`Owned / ready to list: \${Math.max(0, Number(position.quantity || 0) - Number(position.listedQuantity || 0))}\`);
  console.log("\\nUse List ready items for sale when you want to relist at a new price.");
}
`;

  text = insertBefore(text, "\nasync function runAddLoot()", fn);

  if (!text.includes('else if (action === "cancel-listing") await runCancelListing();')) {
    text = text.replace(
      'else if (action === "sold") await runSold();',
      'else if (action === "sold") await runSold();\n  else if (action === "cancel-listing") await runCancelListing();'
    );
  }

  if (!text.includes("node trade-flow.mjs cancel-listing")) {
    text = text.replace(
      "  node trade-flow.mjs sold",
      "  node trade-flow.mjs sold\n  node trade-flow.mjs cancel-listing"
    );
  }

  write(path, text);
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = JSON.parse(read(path));
  pkg.scripts ||= {};
  pkg.scripts["flow-cancel-listing"] = "node trade-flow.mjs cancel-listing";
  write(path, JSON.stringify(pkg, null, 2) + "\n");
}

function patchBat() {
  const path = "trade-manager.bat";
  let text = read(path);

  text = text.replace(
    "echo 4. Mark listed items as sold",
    "echo 4. Listed items - sold / cancel"
  );

  const oldBlock = `:soldlisting
cls
call npm run flow-sold
pause
goto menu`;

  const newBlock = `:soldlisting
cls
echo ============================
echo        LISTED ITEMS
echo ============================
echo.
echo 1. Mark listed item as SOLD
echo    - Use after someone bought your sell offer.
echo.
echo 2. Cancel / remove listed sell offer
echo    - Use after you cancel a listing in Tibia Market.
echo    - Item becomes ready to list again at a new price.
echo.
echo 0. Back
echo.
set /p listedchoice=Choose option: 

if "%listedchoice%"=="1" call npm run flow-sold
if "%listedchoice%"=="2" call npm run flow-cancel-listing
if "%listedchoice%"=="0" goto menu
pause
goto soldlisting`;

  if (!text.includes("flow-cancel-listing")) {
    if (!text.includes(oldBlock)) {
      throw new Error("Could not find :soldlisting block");
    }
    text = text.replace(oldBlock, newBlock);
  }

  write(path, text);
}

patchTradeFlow();
patchPackageJson();
patchBat();

console.log("Added cancel/remove listed item flow.");
