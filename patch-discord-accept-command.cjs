const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

const commandBlock = String.raw`
function quotePowerShellArg(value) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '\\"') + '"';
}

function getAcceptBuyCommand(item) {
  const plan =
    typeof buildQualityActionPlan === "function"
      ? buildQualityActionPlan(item)
      : null;

  const qty = Number(plan?.capital?.qty || item.recommendedQty || 1);
  const buyPrice = Number(
    plan?.capital?.maxBuy ||
      item.maxRealisticBuy ||
      item.maxBuy ||
      item.buyOffer ||
      0,
  );
  const targetSell = Number(
    plan?.capital?.sellTarget ||
      item.realisticExit ||
      item.targetSell ||
      item.sellOffer ||
      0,
  );

  const expectedProfitEach = Number(item.realisticProfit || item.profit || 0);
  const expectedProfitTotal = Number(
    plan?.capital?.expectedProfitTotal || expectedProfitEach * qty || 0,
  );
  const roi = Number(item.realisticProfitPercent || item.profitPercent || 0);

  return (
    "npm run accept-buy -- " +
    "--item-id " + Number(item.id) + " " +
    "--name " + quotePowerShellArg(item.name) + " " +
    "--qty " + qty + " " +
    "--buy " + Math.round(buyPrice) + " " +
    "--target " + Math.round(targetSell) + " " +
    "--profit-total " + Math.round(expectedProfitTotal) + " " +
    "--roi " + roi.toFixed(2) + " " +
    "--quality " + quotePowerShellArg(plan?.quality || "UNKNOWN") + " " +
    "--quality-score " + Number(plan?.score || 0) + " " +
    "--confidence " + Number(item.signalConfidence || 0) + " " +
    "--brain " + Number(item.brainScore || 0)
  );
}

function getAcceptBuyDiscordValue(item) {
  const command = getAcceptBuyCommand(item);

  return (
    "After you actually place this Buy Offer in Tibia Market, paste this in PowerShell:\\n" +
    "\`\`\`powershell\\n" +
    command +
    "\\n\`\`\`\\n" +
    "**Do not run it before placing the offer in Tibia.**"
  );
}
`;

if (!text.includes("function getAcceptBuyCommand")) {
  const marker = "function readPendingBuySignals";
  if (text.includes(marker)) {
    text = text.replace(marker, commandBlock + "\n" + marker);
  } else {
    const fallback = "async function sendDiscordBuyAlerts";
    if (!text.includes(fallback)) {
      throw new Error("Could not find place to insert accept-buy command helpers.");
    }
    text = text.replace(fallback, commandBlock + "\n" + fallback);
  }
}

// Add command hint to pending signal too.
if (!text.includes("acceptBuyCommand: getAcceptBuyCommand(item),")) {
  text = text.replace(
    'commandHint:\n      "After placing this in Tibia Market: BAT -> Accept BUY Signal",',
    'commandHint:\n      "After placing this in Tibia Market: BAT -> Accept BUY Signal",\n    acceptBuyCommand: getAcceptBuyCommand(item),'
  );
}

// Add Discord embed field after ACTION field if not already present.
if (!text.includes('name: "📋 COPY-PASTE ACCEPT COMMAND"')) {
  const exposureField = /      \{\s*name: "🧯 EXPOSURE GUARD",[\s\S]*?inline: false,\s*\},/m;
  const capitalField = /      \{\s*name: "💼 CAPITAL",[\s\S]*?inline: true,\s*\},/m;
  const actionField = /      \{\s*name: "👉 ACTION",[\s\S]*?inline: false,\s*\},/m;

  const fieldToInsertAfter =
    text.match(exposureField)?.[0] ||
    text.match(capitalField)?.[0] ||
    text.match(actionField)?.[0];

  if (!fieldToInsertAfter) {
    throw new Error("Could not find Discord BUY embed field to insert command after.");
  }

  const commandField =
    fieldToInsertAfter +
    `
      {
        name: "📋 COPY-PASTE ACCEPT COMMAND",
        value: getAcceptBuyDiscordValue(item),
        inline: false,
      },`;

  text = text.replace(fieldToInsertAfter, commandField);
}

fs.writeFileSync(path, text, "utf8");

console.log("Discord accept-buy copy command added.");
