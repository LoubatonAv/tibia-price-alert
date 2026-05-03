import axios from "axios";
import fs from "fs";
import "dotenv/config";

const API_URL = "https://api.tibiamarket.top";
const SERVER = "Harmonia";

const TAX_RATE = 0.02;

const MIN_PROFIT = 5000;
const MIN_PROFIT_PERCENT = 3;

const ITEM_IDS = "22118,22516,22721";

function getItemMap() {
  const raw = fs.readFileSync("./data/items.json");
  const items = JSON.parse(raw);

  const map = {};
  items.forEach((item) => {
    map[item.id] = item.name;
  });

  return map;
}

function calculateProfit(buyPrice, sellPrice) {
  const realBuyCost = buyPrice * (1 + TAX_RATE);
  const realSellIncome = sellPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: (profit / realBuyCost) * 100,
  };
}

async function getMarketValues() {
  const res = await axios.get(`${API_URL}/market_values`, {
    params: {
      server: SERVER,
      item_ids: ITEM_IDS,
    },
  });

  return res.data;
}

function getColor(profitPercent) {
  if (profitPercent >= 20) return 0x00ff00;
  if (profitPercent >= 10) return 0xffff00;
  return 0xff9900;
}

const STATE_FILE = "./state.json";
const MAX_HISTORY = 20;

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { items: {} };
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateItemHistory(state, item, calculated) {
  const id = String(item.id);

  if (!state.items[id]) {
    state.items[id] = [];
  }

  state.items[id].push({
    time: new Date().toISOString(),
    buyOffer: item.buy_offer,
    sellOffer: item.sell_offer,
    profit: calculated.profit,
    profitPercent: calculated.profitPercent,
    dayAverageSell: item.day_average_sell,
    monthAverageSell: item.month_average_sell,
    daySold: item.day_sold,
    monthSold: item.month_sold,
  });

  state.items[id] = state.items[id].slice(-MAX_HISTORY);
}

function analyzeHistory(history) {
  if (!history || history.length < 3) {
    return {
      historySignal: "⚪ NOT ENOUGH HISTORY",
      historyAdvice: "Need more bot runs before making a timing call.",
      historyScore: 0,
      bottomSignal: false,
      firstGreenSignal: false,
    };
  }

  const last3 = history.slice(-3);
  const prices = last3.map((h) => h.sellOffer);

  const falling = prices[0] > prices[1] && prices[1] > prices[2];
  const rising = prices[0] < prices[1] && prices[1] < prices[2];

  const previous = history[history.length - 2];
  const current = history[history.length - 1];

  const recovering =
    previous.sellOffer < previous.dayAverageSell &&
    current.sellOffer > previous.sellOffer;

  const stoppedFalling =
    history.length >= 4 &&
    history[history.length - 4].sellOffer >
      history[history.length - 3].sellOffer &&
    history[history.length - 3].sellOffer >
      history[history.length - 2].sellOffer &&
    current.sellOffer >= previous.sellOffer;

  const firstGreenAfterDrop =
    history.length >= 4 &&
    history[history.length - 4].sellOffer >
      history[history.length - 3].sellOffer &&
    history[history.length - 3].sellOffer >
      history[history.length - 2].sellOffer &&
    current.sellOffer > previous.sellOffer;

  if (firstGreenAfterDrop) {
    return {
      historySignal: "🟢 FIRST GREEN AFTER DROP",
      historyAdvice:
        "Price dropped for multiple runs and just bounced. This may be a strong buy timing signal.",
      historyScore: 25,
      bottomSignal: true,
      firstGreenSignal: true,
    };
  }

  if (stoppedFalling) {
    return {
      historySignal: "🟡 FALLING STOPPED",
      historyAdvice:
        "Price stopped falling. Wait one more run or buy small if profit is strong.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
    };
  }

  if (falling) {
    return {
      historySignal: "🔴 FALLING FOR 3 RUNS",
      historyAdvice:
        "Wait. Price is still dropping. Better entry may come later.",
      historyScore: -20,
      bottomSignal: false,
      firstGreenSignal: false,
    };
  }

  if (recovering) {
    return {
      historySignal: "🟢 POSSIBLE BOTTOM",
      historyAdvice:
        "Price may be recovering. Consider buying small if profit is good.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
    };
  }

  if (rising) {
    return {
      historySignal: "🟡 RISING FOR 3 RUNS",
      historyAdvice:
        "Good momentum, but avoid chasing if price is already inflated.",
      historyScore: 10,
      bottomSignal: false,
      firstGreenSignal: false,
    };
  }

  return {
    historySignal: "⚪ WEAK / UNCERTAIN",
    historyAdvice: "No clear direction. Combine with trend before acting.",
    historyScore: 0,
    bottomSignal: false,
    firstGreenSignal: false,
  };
}

function getFakeSpreadRisk(item) {
  const sellOffer = item.sell_offer || 0;
  const dayAvgSell = item.day_average_sell || 0;
  const monthAvgSell = item.month_average_sell || 0;
  const daySold = item.day_sold || 0;
  const monthSold = item.month_sold || 0;

  let risk = 0;
  const warnings = [];

  if (monthAvgSell > 0 && sellOffer > monthAvgSell * 1.25) {
    risk += 30;
    warnings.push("Sell offer is much higher than monthly average.");
  }

  if (dayAvgSell > 0 && sellOffer > dayAvgSell * 1.2) {
    risk += 25;
    warnings.push("Sell offer is much higher than today's average.");
  }

  const avgDailyVolume = monthSold / 30;

  if (avgDailyVolume > 0 && daySold < avgDailyVolume * 0.5) {
    risk += 20;
    warnings.push("Low volume today. May be hard to resell.");
  }

  const rawSpreadPercent =
    item.buy_offer > 0
      ? ((item.sell_offer - item.buy_offer) / item.buy_offer) * 100
      : 0;

  if (rawSpreadPercent > 40) {
    risk += 25;
    warnings.push("Huge spread. Could be bait/fake pricing.");
  }

  return {
    fakeSpreadRisk: risk,
    fakeSpreadWarnings: warnings.length
      ? warnings.join("\n")
      : "No major fake spread warning.",
  };
}

function getDecision(item, profit, profitPercent, fakeSpreadRisk, historyData) {
  const daySell = item.day_average_sell || 0;
  const monthSell = item.month_average_sell || 0;
  const daySold = item.day_sold || 0;
  const monthSold = item.month_sold || 0;

  const dayVsMonthSell =
    monthSell > 0 ? ((daySell - monthSell) / monthSell) * 100 : 0;

  const averageDailyVolume = monthSold / 30;
  const volumeRatio = averageDailyVolume > 0 ? daySold / averageDailyVolume : 0;

  const isGoodProfit =
    profit >= MIN_PROFIT && profitPercent >= MIN_PROFIT_PERCENT;

  const isRising = dayVsMonthSell > 2;
  const isFalling = dayVsMonthSell < -2;
  const hasGoodVolume = volumeRatio >= 1;
  const hasLowVolume = volumeRatio < 0.5;
  const hasDownwardPressure = dayVsMonthSell < 0 && volumeRatio < 1;

  let decision = "⚪ WATCH";
  let action = "Watch this item, but do not buy yet.";
  let reason = "The numbers are not strong enough yet.";

  if (fakeSpreadRisk >= 40) {
    decision = "🔴 AVOID";
    action = "Do not buy. The spread may be fake or hard to sell.";
    reason = "Fake spread risk is too high.";
  } else if (isGoodProfit && historyData?.firstGreenSignal && !hasLowVolume) {
    decision = "🟢 BUY NOW - POSSIBLE BOTTOM";
    action = `Price bounced after falling. Try buying at or below ${item.buy_offer.toLocaleString()} gp, but do not overpay.`;
    reason = "Strong profit plus first green signal after a drop.";
  } else if (isGoodProfit && historyData?.bottomSignal && !hasLowVolume) {
    decision = "🟡 BUY SMALL / TEST ENTRY";
    action = `Price may be bottoming. Buy small at or below ${item.buy_offer.toLocaleString()} gp, or wait one more run for confirmation.`;
    reason = "Profit is good and the falling move may be ending.";
  } else if (isGoodProfit && isRising && hasGoodVolume) {
    decision = "🟢 BUY NOW";
    action = `Try buying at or below ${item.buy_offer.toLocaleString()} gp. Target sell around ${item.sell_offer.toLocaleString()} gp.`;
    reason = "Good profit, rising price, and healthy volume.";
  } else if (isGoodProfit && isFalling) {
    decision = "🟡 WAIT 1–2 DAYS";
    action =
      "Do not buy yet. Price is falling, so you may get a better entry soon.";
    reason = "The flip is profitable, but the market is currently moving down.";
  } else if (isGoodProfit && hasDownwardPressure) {
    decision = "🟡 WAIT";
    action = "Wait for stabilization or a price bounce before buying.";
    reason = "Downward pressure: trend is negative and volume is weak.";
  } else if (isGoodProfit && hasLowVolume) {
    decision = "🟠 RISKY BUY";
    action = "Only buy a small amount. This may be hard to resell quickly.";
    reason = "Profit looks good, but liquidity is low.";
  } else if (isGoodProfit) {
    decision = "🟡 BUY ONLY IF CHEAP";
    action = `Only buy if you can get it below ${Math.floor(
      item.buy_offer * 0.98,
    ).toLocaleString()} gp.`;
    reason = "Profit exists, but trend/volume are not strong enough.";
  } else if (isRising && hasGoodVolume) {
    decision = "🔵 WATCH CLOSELY";
    action = "Do not buy yet. This may become profitable soon.";
    reason = "Price and volume are rising, but profit is not good enough yet.";
  } else if (isFalling) {
    decision = "🔴 AVOID";
    action = "Avoid buying now. Wait for stabilization.";
    reason = "Price is falling compared to the monthly average.";
  }

  return {
    decision,
    action,
    reason,
    dayVsMonthSell,
    volumeRatio,
  };
}

function buildTitle(item, index) {
  let tag = "";

  if (item.firstGreenSignal) {
    tag = " (BOTTOM SIGNAL)";
  } else if (item.bottomSignal) {
    tag = " (BOTTOM FORMING)";
  } else if (item.historySignal.includes("FALLING")) {
    tag = " (FALLING)";
  } else if (item.fakeSpreadRisk >= 40) {
    tag = " (RISKY / FAKE)";
  } else if (item.dayVsMonthSell > 2) {
    tag = " (RISING)";
  }

  return `${item.decision} — ${item.name}${tag}`;
}

async function sendDiscordAlert(opportunities) {
  if (opportunities.length === 0) {
    console.log("No big profitable flips found. No Discord message sent.");
    return;
  }

  const embeds = opportunities.slice(0, 5).map((item, index) => ({
    title: buildTitle(item, index),
    color: getColor(item.profitPercent),
    fields: [
      {
        name: "💰 Profit",
        value: `${Math.round(item.profit).toLocaleString()} gp (${item.profitPercent.toFixed(2)}%)`,
        inline: false,
      },
      {
        name: "💸 Trade",
        value: `Buy: ${item.buyOffer.toLocaleString()} → Sell: ${item.sellOffer.toLocaleString()}`,
        inline: false,
      },
      {
        name: "📉 Market",
        value: `Trend: ${item.dayVsMonthSell.toFixed(2)}%\nVolume: ${item.volumeRatio.toFixed(2)}x`,
        inline: true,
      },
      {
        name: "🧠 Timing",
        value: `${item.historySignal}\n${item.historyAdvice}`,
        inline: true,
      },
      {
        name: "⚠️ Risk",
        value: `Fake Spread: ${item.fakeSpreadRisk}/100`,
        inline: true,
      },
      {
        name: "👉 Action",
        value: item.action,
        inline: false,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included`,
    },
  }));

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: `🔥 Big Tibia flip opportunities on **${SERVER}**`,
    embeds,
  });

  console.log("Discord alert sent.");
}

async function sendDiscordErrorAlert(err) {
  const message = err?.stack || err?.message || String(err);

  try {
    if (!process.env.DISCORD_WEBHOOK_URL) {
      console.error("Missing DISCORD_WEBHOOK_URL");
      return;
    }

    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      content: `🚨 **Tibia Flipper crashed**\n\n\`\`\`${message.slice(
        0,
        1800,
      )}\`\`\``,
    });

    console.log("Discord error alert sent.");
  } catch (discordErr) {
    console.error("Failed to send Discord error alert:", discordErr);
  }
}

async function main() {
  const items = await getMarketValues();
  const itemMap = getItemMap();
  const state = loadState();

  const opportunities = items
    .map((item) => {
      const result = calculateProfit(item.buy_offer, item.sell_offer);

      updateItemHistory(state, item, result);

      const history = state.items[String(item.id)];
      const historyData = analyzeHistory(history);

      const fakeRiskData = getFakeSpreadRisk(item);

      const decisionData = getDecision(
        item,
        result.profit,
        result.profitPercent,
        fakeRiskData.fakeSpreadRisk,
        historyData,
      );

      return {
        id: item.id,
        name: itemMap[item.id] || "Unknown",
        buyOffer: item.buy_offer,
        sellOffer: item.sell_offer,
        ...result,
        ...decisionData,
        ...historyData,
        ...fakeRiskData,
      };
    })
    .filter((item) => {
      return (
        item.profit >= MIN_PROFIT && item.profitPercent >= MIN_PROFIT_PERCENT
      );
    })
    .sort((a, b) => b.profit - a.profit);

  opportunities.forEach((item) => {
    console.log(
      `${item.decision} ${item.name} (ID: ${item.id})\n` +
        `Buy: ${item.buyOffer} | Sell: ${item.sellOffer}\n` +
        `Profit: ${item.profit.toFixed(0)} (${item.profitPercent.toFixed(2)}%)\n` +
        `Reason: ${item.reason}\n` +
        `Action: ${item.action}\n` +
        `Fake Spread Risk: ${item.fakeSpreadRisk}/100\n` +
        `Warnings: ${item.fakeSpreadWarnings}\n` +
        `History: ${item.historySignal}\n` +
        `Advice: ${item.historyAdvice}\n`,
    );
  });

  saveState(state);

  await sendDiscordAlert(opportunities);
}

main().catch(async (err) => {
  console.error("Bot crashed:", err);
  await sendDiscordErrorAlert(err);
  process.exit(1);
});
