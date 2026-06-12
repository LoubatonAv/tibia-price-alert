const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

if (!text.includes("function getManualSnipeChecks")) {
  throw new Error("Missing getManualSnipeChecks. Run patch-manual-snipe-split.cjs first.");
}

if (!fs.existsSync(path + ".bak-discord-manual-snipe")) {
  fs.copyFileSync(path, path + ".bak-discord-manual-snipe");
}

const discordSnipeBlock = String.raw`
function shouldSendManualSnipeAlert(state, item) {
  if (!state.manualSnipeAlerts) state.manualSnipeAlerts = {};

  const id = String(item.id);
  const lastAlert = state.manualSnipeAlerts[id];
  const cooldownHours = Number(process.env.MANUAL_SNIPE_ALERT_COOLDOWN_HOURS || 12);

  if (!lastAlert) {
    return {
      shouldSend: true,
      reason: "New manual snipe candidate.",
    };
  }

  const hoursSinceLastAlert =
    (Date.now() - new Date(lastAlert.time).getTime()) / 1000 / 60 / 60;

  const currentProfit = getNumber(item.realisticProfit || item.profit);
  const previousProfit = getNumber(lastAlert.profit);
  const profitImprovedEnough =
    previousProfit > 0 && currentProfit >= previousProfit * 1.25;

  if (profitImprovedEnough) {
    return {
      shouldSend: true,
      reason: "Manual snipe profit improved meaningfully.",
    };
  }

  if (hoursSinceLastAlert >= cooldownHours) {
    return {
      shouldSend: true,
      reason: "Manual snipe cooldown passed.",
    };
  }

  return {
    shouldSend: false,
    reason: "Skipped duplicate manual snipe alert.",
  };
}

function markManualSnipeAlertSent(state, item) {
  if (!state.manualSnipeAlerts) state.manualSnipeAlerts = {};

  const id = String(item.id);

  state.manualSnipeAlerts[id] = {
    type: "MANUAL_SNIPE",
    time: new Date().toISOString(),
    name: item.name,
    profit: getNumber(item.realisticProfit || item.profit),
    profitPercent: getNumber(item.realisticProfitPercent || item.profitPercent),
    sellOffer: getNumber(item.sellOffer || item.realisticExit || item.targetSell),
    fakeSpreadRisk: getNumber(item.fakeSpreadRisk),
    volumeRatio: getNumber(item.volumeRatio),
    marketPressureLevel: item.marketPressureLevel,
  };
}

async function sendDiscordManualSnipeAlerts(analyzedItems, buySignals, state) {
  const candidates = getManualSnipeChecks(analyzedItems, buySignals);

  if (candidates.length === 0) {
    return;
  }

  const alertable = candidates.filter((item) => {
    const check = shouldSendManualSnipeAlert(state, item);

    if (!check.shouldSend) {
      console.log(item.name + ": " + check.reason);
    }

    item.manualSnipeAlertReason = check.reason;
    return check.shouldSend;
  });

  if (alertable.length === 0) {
    console.log("No manual snipe alerts after cooldown.");
    return;
  }

  const embeds = alertable.slice(0, 5).map((item) => {
    const profit = getNumber(item.realisticProfit || item.profit);
    const profitPercent = getNumber(item.realisticProfitPercent || item.profitPercent);
    const sellPrice = getNumber(item.sellOffer || item.realisticExit || item.targetSell);
    const reasons = (item.rejectionReasons || ["manual verification required"])
      .slice(0, 4)
      .join("\n");

    return {
      title: "🟣 MANUAL SNIPE CHECK — " + item.name,
      color: 0x9b59b6,
      fields: [
        {
          name: "⚠️ NOT AUTO BUY",
          value:
            "**Manual check only.** Do not buy before checking Tibia Market yourself.",
          inline: false,
        },
        {
          name: "💰 POSSIBLE UPSIDE",
          value:
            "Possible profit: **~" + formatGp(profit) + " gp**\n" +
            "Percent: **" + profitPercent.toFixed(2) + "%**\n" +
            "Observed/reference sell: **" + formatGp(sellPrice) + " gp**",
          inline: false,
        },
        {
          name: "☠️ WHY RISKY",
          value:
            "Risk: **" + item.fakeSpreadRisk + "/100**\n" +
            "Volume: **" + Number(item.volumeRatio || 0).toFixed(2) + "x**\n" +
            "Pressure: **" + item.marketPressureLevel + "**",
          inline: true,
        },
        {
          name: "🔎 REJECTION REASONS",
          value: reasons || "No reasons recorded.",
          inline: false,
        },
        {
          name: "✅ MANUAL CHECKLIST",
          value:
            "1. Check real lowest sell offer quantity\n" +
            "2. Check recent market history\n" +
            "3. Check if there are buyers or only fake spread\n" +
            "4. Buy only if you can survive a slow exit",
          inline: false,
        },
      ],
      footer: {
        text: "Item ID: " + item.id + " | Manual snipe only | Tax included",
      },
    };
  });

  await axios.post(DISCORD_WEBHOOK_URL, {
    content:
      "🟣 Tibia Manual Snipe checks on **" +
      SERVER +
      "** — high value but risky (" +
      alertable.length +
      ")",
    embeds,
  });

  alertable.forEach((item) => markManualSnipeAlertSent(state, item));

  console.log("Discord manual snipe alert sent.");
}
`;

if (!text.includes("async function sendDiscordManualSnipeAlerts")) {
  text = text.replace(
    "async function sendDiscordBuyAlerts",
    discordSnipeBlock + "\nasync function sendDiscordBuyAlerts"
  );
}

if (!text.includes("await sendDiscordManualSnipeAlerts(analyzedItems, buySignals, state);")) {
  text = text.replace(
    "  await sendDiscordBuyAlerts(buySignals, state);",
    "  await sendDiscordManualSnipeAlerts(analyzedItems, buySignals, state);\n  await sendDiscordBuyAlerts(buySignals, state);"
  );
}

// Avoid sending boring empty summary if there is a manual snipe candidate.
text = text.replace(
  /SEND_EMPTY_SUMMARY &&\s*buySignals\.length === 0 &&\s*sellSignals\.length === 0/g,
  "SEND_EMPTY_SUMMARY &&\n    buySignals.length === 0 &&\n    sellSignals.length === 0 &&\n    getManualSnipeChecks(analyzedItems, buySignals).length === 0"
);

fs.writeFileSync(path, text, "utf8");

console.log("Discord manual snipe alerts patch complete.");
