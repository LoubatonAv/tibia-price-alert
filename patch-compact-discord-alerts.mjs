import fs from "fs";

const path = "./check-flips.js";
let text = fs.readFileSync(path, "utf8");

function replaceFunctionFields(text, functionStartMarker, functionEndMarker, newFieldsBlock) {
  const start = text.indexOf(functionStartMarker);
  const end = text.indexOf(functionEndMarker, start);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find function block: ${functionStartMarker}`);
  }

  const before = text.slice(0, start);
  let block = text.slice(start, end);
  const after = text.slice(end);

  const fieldsStart = block.indexOf("      fields: [");
  const footerStart = block.indexOf("      footer: {", fieldsStart);

  if (fieldsStart === -1 || footerStart === -1 || footerStart <= fieldsStart) {
    throw new Error(`Could not find fields/footer block inside: ${functionStartMarker}`);
  }

  block = block.slice(0, fieldsStart) + newFieldsBlock + block.slice(footerStart);

  return before + block + after;
}

const compactBuyFields = `      fields: [
        {
          name: "👉 WHAT TO DO",
          value:
            \`\${item.signalClass === "BUY_CANDIDATE" ? "**RESEARCH / SMALL TEST ONLY**" : "**PLACE BUY OFFER**"}\\n\` +
            \`Buy max: **\${formatGp(getSignalBuyPrice(item))} gp**\\n\` +
            \`Qty: **\${getSignalQuantity(item)}** | Target: **\${formatGp(getSignalTargetSell(item))} gp**\`,
          inline: false,
        },
        {
          name: "💰 EXPECTED",
          value:
            \`Profit: ~**\${formatGp(Math.round(getNumber(item.realisticProfit, item.profit) * getSignalQuantity(item)))} gp** total\\n\` +
            \`ROI: **\${getNumber(item.realisticProfitPercent, item.profitPercent).toFixed(2)}%**\`,
          inline: true,
        },
        {
          name: "⚠️ CHECK",
          value:
            [
              \`Confidence **\${getNumber(item.signalConfidence, 0)}/100** | Brain **\${getNumber(item.brainScore, 0)}/100**\`,
              item.signalClass === "BUY_CANDIDATE" ? "Not automatic BUY. Manual check first." : null,
              item.marketPressureLevel && item.marketPressureLevel !== "LOW"
                ? \`Market pressure: **\${item.marketPressureLevel}**\`
                : null,
              getNumber(item.fakeSpreadRisk, 0) >= 25
                ? \`Fake spread risk: **\${getNumber(item.fakeSpreadRisk, 0)}/100**\`
                : null,
              Array.isArray(item.tradeWarnings) && item.tradeWarnings.length
                ? item.tradeWarnings[0]
                : null,
              Array.isArray(item.marketPressureReasons) && item.marketPressureReasons.length
                ? item.marketPressureReasons[0]
                : null,
            ].filter(Boolean).slice(0, 4).join("\\n") || "No major warnings.",
          inline: false,
        },
        {
          name: "✅ AFTER BUYING",
          value: "After you actually place the Buy Offer in Tibia, run: `npm run pending-buy`",
          inline: false,
        },
      ],
`;

const compactSellFields = `      fields: [
      {
        name: "👉 WHAT TO DO",
        value:
          \`**\${item.sellAction}**\\n\` +
          \`List around: **\${formatGp(item.sellOffer)} gp**\\n\` +
          \`Target was: **\${formatGp(item.trackedTargetSell)} gp**\`,
        inline: false,
      },
      {
        name: "💰 POSITION",
        value:
          \`Entry: **\${formatGp(item.entryPrice)} gp** | Qty: **\${item.quantity}**\\n\` +
          \`Net profit: **\${formatGp(item.currentProfitEach)} gp each** (**\${item.currentProfitPercent.toFixed(2)}%**)\`,
        inline: false,
      },
      {
        name: "⚠️ WHY",
        value:
          [
            item.sellReason,
            \`Brain: **\${item.previousBrainScore} → \${item.brainScore}**\`,
            \`Volume: **\${item.volumeRatio.toFixed(2)}x** | Fake spread: **\${item.fakeSpreadRisk}/100**\`,
          ].filter(Boolean).join("\\n"),
        inline: false,
      },
    ],
`;

text = replaceFunctionFields(
  text,
  "async function sendDiscordBuyAlerts(buySignals, state) {",
  "async function sendDiscordSellAlerts(sellSignals, state) {",
  compactBuyFields
);

text = replaceFunctionFields(
  text,
  "async function sendDiscordSellAlerts(sellSignals, state) {",
  "function getScannerTier(item) {",
  compactSellFields
);

fs.writeFileSync(path, text, "utf8");

console.log("Patched Discord BUY/SELL alerts to compact actionable format.");
