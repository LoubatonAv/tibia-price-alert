import fs from "fs";

const path = "./check-flips.js";
let text = fs.readFileSync(path, "utf8");

const startMarker = "async function sendDiscordBuyAlerts(buySignals, state) {";
const endMarker = "async function sendDiscordSellAlerts(sellSignals, state) {";

const start = text.indexOf(startMarker);
const end = text.indexOf(endMarker, start);

if (start === -1 || end === -1 || end <= start) {
  throw new Error("Could not find sendDiscordBuyAlerts block.");
}

const compactBuyFunction = String.raw`async function sendDiscordBuyAlerts(buySignals, state) {
  const alertable = buySignals.filter((item) => {
    const alertCheck = shouldSendBuyAlert(state, item);
    item.alertReason = alertCheck.alertReason;

    if (!alertCheck.shouldSend) {
      console.log(item.name + ": " + alertCheck.alertReason);
    }

    return alertCheck.shouldSend;
  });

  if (alertable.length === 0) {
    console.log("No simple BUY alerts after cooldown.");
    return;
  }

  const visibleAlerts = alertable.slice(0, 5);
  const hiddenCount = Math.max(0, alertable.length - visibleAlerts.length);

  function getCompactWarning(item) {
    const warnings = [
      item.signalClass === "BUY_CANDIDATE" ? "Manual check first. Not automatic BUY." : null,
      item.marketPressureLevel && item.marketPressureLevel !== "LOW"
        ? "Market pressure: " + item.marketPressureLevel
        : null,
      getNumber(item.fakeSpreadRisk, 0) >= 25
        ? "Fake spread risk: " + getNumber(item.fakeSpreadRisk, 0) + "/100"
        : null,
      getNumber(item.volumeRatio, 0) < 0.8
        ? "Volume a bit weak: " + getNumber(item.volumeRatio, 0).toFixed(2) + "x"
        : null,
      Array.isArray(item.tradeWarnings) && item.tradeWarnings.length
        ? item.tradeWarnings[0]
        : null,
      Array.isArray(item.marketPressureReasons) && item.marketPressureReasons.length
        ? item.marketPressureReasons[0]
        : null,
    ].filter(Boolean);

    return warnings.slice(0, 3).join("\n") || "No major warning.";
  }

  const embeds = visibleAlerts.map((item, index) => ({
    title: buildSimpleBuyTitle(item),
    color: getColor(item.brainScore),
    fields: [
      {
        name: "👉 DO THIS",
        value:
          (item.signalClass === "BUY_CANDIDATE" ? "**RESEARCH / TINY TEST ONLY**" : "**PLACE BUY OFFER**") + "\n" +
          "Buy max: **" + formatGp(getSignalBuyPrice(item)) + " gp**\n" +
          "Qty: **" + getSignalQuantity(item) + "** | Target: **" + formatGp(getSignalTargetSell(item)) + " gp**",
        inline: false,
      },
      {
        name: "💰 EXPECTED",
        value:
          "Profit: ~**" + formatGp(Math.round(getNumber(item.realisticProfit, item.profit) * getSignalQuantity(item))) + " gp** total\n" +
          "ROI: **" + getNumber(item.realisticProfitPercent, item.profitPercent).toFixed(2) + "%**",
        inline: true,
      },
      {
        name: "⚠️ CHECK",
        value:
          "Confidence: **" + getNumber(item.signalConfidence, 0) + "/100** | Brain: **" + getNumber(item.brainScore, 0) + "/100**\n" +
          getCompactWarning(item),
        inline: false,
      },
      {
        name: "✅ AFTER BUYING",
        value: "After placing the Buy Offer in Tibia, run: **npm run pending-buy**",
        inline: false,
      },
    ],
    footer: {
      text:
        "Item ID: " + item.id +
        " | " + (index + 1) + "/" + visibleAlerts.length +
        (hiddenCount ? " | " + hiddenCount + " more hidden this run" : ""),
    },
  }));

  for (let i = 0; i < embeds.length; i++) {
    const buyPayload = {
      content:
        i === 0
          ? "🟢 Tibia BUY signals on **" + SERVER + "** — showing " + visibleAlerts.length + "/" + alertable.length
          : "🟢 BUY signal " + (i + 1) + "/" + visibleAlerts.length + " on **" + SERVER + "**",
      embeds: [embeds[i]],
      allowed_mentions: { parse: [] },
    };

    try {
      await axios.post(DISCORD_WEBHOOK_URL, buyPayload, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Discord BUY webhook failed");
      console.error("Status:", err.response?.status);
      console.error("Response:", JSON.stringify(err.response?.data, null, 2));
      console.error("Payload summary:", {
        contentLength: buyPayload.content?.length ?? 0,
        embedsCount: buyPayload.embeds?.length ?? 0,
        payloadLength: JSON.stringify(buyPayload).length,
      });
      throw err;
    }
  }

  visibleAlerts.forEach((item) => markBuyAlertSent(state, item));

  console.log("Discord compact BUY alerts sent.");
}

`;

text = text.slice(0, start) + compactBuyFunction + text.slice(end);

fs.writeFileSync(path, text, "utf8");

console.log("Forced compact BUY alert format.");
