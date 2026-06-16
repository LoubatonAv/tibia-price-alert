const fs = require("fs");

const path = "trade-manager.bat";
let text = fs.readFileSync(path, "utf8");

const start = text.indexOf(":markettools");
if (start === -1) throw new Error(":markettools not found");

const prompt = text.indexOf("set /p toolchoice=Choose option:", start);
if (prompt === -1) throw new Error("toolchoice prompt not found");

const before = text.slice(0, start);
const marketBlock = text.slice(start, prompt);
const after = text.slice(prompt);

const oldMenuStart = marketBlock.indexOf("echo 1. Run Flipper check");
const oldMenuEnd = marketBlock.indexOf("echo 0. Back");

if (oldMenuStart === -1 || oldMenuEnd === -1) {
  throw new Error("Could not find market tools menu echo block");
}

const oldMenuEndLine = marketBlock.indexOf("\n", oldMenuEnd);
const endIndex = oldMenuEndLine === -1 ? marketBlock.length : oldMenuEndLine + 1;

const newMenu = [
  "echo 1. Run Flipper check - BUY/SELL alerts",
  "echo    - What is worth buying or selling right now from tracked items.",
  "echo.",
  "echo 2. Run Scanner - research tracked pool",
  "echo    - Research view: what might be worth adding, watching, or testing.",
  "echo.",
  "echo 3. Promote Scanner candidates to Flipper",
  "echo    - Add good Scanner finds into tracked-items so Flipper can alert on them.",
  "echo.",
  "echo 4. Run Discovery scanner - find new items",
  "echo    - Search wider item pool for new flip candidates not already tracked.",
  "echo.",
  "echo 5. Promote Discovery candidates to Flipper",
  "echo    - Add repeated good Discovery finds into tracked-items.",
  "echo.",
  "echo 6. Clean old Discovery candidates",
  "echo    - Remove weak or old Discovery noise so promotion stays clean.",
  "echo.",
  "echo 7. Sell price advisor",
  "echo    - Helps choose a listing price before you place a sell offer.",
  "echo.",
  "echo 8. Buy price advisor",
  "echo    - Helps choose a buy offer price before you place a buy offer.",
  "echo.",
  "echo 9. Quick profit check",
  "echo    - Manual profit/ROI check for one item and one sell price.",
  "echo.",
  "echo 0. Back",
  ""
].join("\r\n");

const patchedMarketBlock =
  marketBlock.slice(0, oldMenuStart) +
  newMenu +
  marketBlock.slice(endIndex);

fs.writeFileSync(path, before + patchedMarketBlock + after, "utf8");
console.log("Added explanations under Find Trades / Market Tools options.");
