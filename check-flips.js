import axios from "axios";
import fs from "fs";
import "dotenv/config";

const API_URL = "https://api.tibiamarket.top";
const SERVER = "Harmonia";

const TAX_RATE = 0.02;

const MIN_PROFIT = 5000;
const MIN_PROFIT_PERCENT = 3;

const STATE_FILE = "./state.json";
const MAX_HISTORY = 20;

const ALERT_COOLDOWN_HOURS = 12;
const SCORE_IMPROVEMENT_TO_REALERT = 10;

function getTrackedItemIds() {
  const tracked = JSON.parse(fs.readFileSync("./tracked-items.json", "utf8"));

  return [...tracked.core, ...tracked.watch].join(",");
}

const ITEM_IDS = getTrackedItemIds();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function getColor(brainScore) {
  if (brainScore >= 80) return 0x00ff00;
  if (brainScore >= 65) return 0xffff00;
  if (brainScore >= 50) return 0xff9900;
  return 0xff0000;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { items: {}, alerts: {}, market: {} };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!state.items) state.items = {};
  if (!state.alerts) state.alerts = {};
  if (!state.market) state.market = {};

  return state;
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

function calculateMarketVolatility(opportunities, state) {
  let volatility = 0;

  opportunities.forEach((item) => {
    const history = state.items[String(item.id)];
    if (!history || history.length < 2) return;

    const last = history[history.length - 1];
    const prev = history[history.length - 2];

    const priceChange =
      prev.sellOffer > 0
        ? Math.abs((last.sellOffer - prev.sellOffer) / prev.sellOffer) * 100
        : 0;

    const profitChange = Math.abs(
      (last.profitPercent || 0) - (prev.profitPercent || 0),
    );

    volatility += priceChange * 0.7 + profitChange * 0.3;
  });

  return Math.round(volatility);
}

function getNextRunRecommendation(volatility) {
  if (volatility >= 25) {
    return {
      level: "HIGH",
      nextRunHours: 1,
      message: "Market is very active. Check frequently.",
    };
  }

  if (volatility >= 10) {
    return {
      level: "MEDIUM",
      nextRunHours: 3,
      message: "Market is moving. Moderate check frequency.",
    };
  }

  return {
    level: "LOW",
    nextRunHours: 6,
    message: "Market is calm. No need to check often.",
  };
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

function calculateBrainScore(item) {
  let score = 50;
  const notes = [];

  const profitScore = clamp(item.profitPercent * 2.2, 0, 35);
  score += profitScore;
  notes.push(`Profit score: +${profitScore.toFixed(1)}`);

  const rawProfitScore = clamp(item.profit / 1000, 0, 20);
  score += rawProfitScore;
  notes.push(`Raw profit score: +${rawProfitScore.toFixed(1)}`);

  if (item.dayVsMonthSell > 5) {
    score += 12;
    notes.push("Strong rising trend: +12");
  } else if (item.dayVsMonthSell > 2) {
    score += 7;
    notes.push("Rising trend: +7");
  } else if (item.dayVsMonthSell < -5) {
    score -= 18;
    notes.push("Strong falling trend: -18");
  } else if (item.dayVsMonthSell < -2) {
    score -= 10;
    notes.push("Falling trend: -10");
  }

  if (item.volumeRatio >= 2) {
    score += 12;
    notes.push("Very strong volume: +12");
  } else if (item.volumeRatio >= 1) {
    score += 7;
    notes.push("Good volume: +7");
  } else if (item.volumeRatio < 0.5) {
    score -= 15;
    notes.push("Low volume: -15");
  }

  score += item.historyScore;
  notes.push(
    `History score: ${item.historyScore >= 0 ? "+" : ""}${item.historyScore}`,
  );

  score -= item.fakeSpreadRisk;
  notes.push(`Fake spread risk: -${item.fakeSpreadRisk}`);

  if (item.firstGreenSignal) {
    score += 10;
    notes.push("First green after drop bonus: +10");
  } else if (item.bottomSignal) {
    score += 5;
    notes.push("Bottom forming bonus: +5");
  }

  score = Math.round(clamp(score, 0, 100));

  let confidence = "LOW";
  if (score >= 80) confidence = "HIGH";
  else if (score >= 65) confidence = "MEDIUM-HIGH";
  else if (score >= 50) confidence = "MEDIUM";

  let riskLevel = "HIGH";
  if (item.fakeSpreadRisk >= 40 || item.volumeRatio < 0.5) {
    riskLevel = "HIGH";
  } else if (score >= 75 && item.volumeRatio >= 1) {
    riskLevel = "LOW-MEDIUM";
  } else if (score >= 60) {
    riskLevel = "MEDIUM";
  }

  let positionSize = "DO NOT BUY";
  if (score >= 85 && riskLevel !== "HIGH") {
    positionSize = "LARGE";
  } else if (score >= 75 && riskLevel !== "HIGH") {
    positionSize = "MEDIUM";
  } else if (score >= 60) {
    positionSize = "SMALL / TEST";
  } else if (score >= 50) {
    positionSize = "WATCH ONLY";
  }

  const targetSell = Math.floor(item.sellOffer * 0.99);
  const stopLoss = Math.floor(item.buyOffer * 0.97);
  const maxBuy = Math.floor(item.buyOffer * 0.99);

  let brainSummary = "Weak or unclear opportunity.";
  if (score >= 85) {
    brainSummary =
      "Very strong setup. Only enter if price is still close to the shown buy price.";
  } else if (score >= 75) {
    brainSummary = "Strong setup, but avoid overpaying.";
  } else if (score >= 60) {
    brainSummary = "Decent setup. Small/test entry only.";
  } else if (score >= 50) {
    brainSummary = "Watchlist item. Not enough strength yet.";
  }

  return {
    brainScore: score,
    confidence,
    riskLevel,
    positionSize,
    maxBuy,
    targetSell,
    stopLoss,
    brainSummary,
    brainNotes: notes,
  };
}

function shouldSendAlert(state, item) {
  const id = String(item.id);
  const lastAlert = state.alerts[id];

  if (!lastAlert) {
    return {
      shouldSend: true,
      alertReason: "First alert for this item.",
    };
  }

  const hoursSinceLastAlert =
    (Date.now() - new Date(lastAlert.time).getTime()) / 1000 / 60 / 60;

  const scoreImproved =
    item.brainScore >= lastAlert.brainScore + SCORE_IMPROVEMENT_TO_REALERT;

  const newStrongSignal = item.firstGreenSignal && !lastAlert.firstGreenSignal;

  if (hoursSinceLastAlert >= ALERT_COOLDOWN_HOURS) {
    return {
      shouldSend: true,
      alertReason: `Cooldown passed (${hoursSinceLastAlert.toFixed(1)}h).`,
    };
  }

  if (scoreImproved) {
    return {
      shouldSend: true,
      alertReason: `Brain score improved from ${lastAlert.brainScore} to ${item.brainScore}.`,
    };
  }

  if (newStrongSignal) {
    return {
      shouldSend: true,
      alertReason: "New first-green-after-drop signal.",
    };
  }

  return {
    shouldSend: false,
    alertReason: `Skipped duplicate alert. Last alert was ${hoursSinceLastAlert.toFixed(1)}h ago.`,
  };
}

function markAlertSent(state, item) {
  const id = String(item.id);

  state.alerts[id] = {
    time: new Date().toISOString(),
    brainScore: item.brainScore,
    profit: item.profit,
    profitPercent: item.profitPercent,
    decision: item.decision,
    firstGreenSignal: item.firstGreenSignal,
  };
}

function buildTitle(item) {
  let tag = "";

  if (item.brainScore >= 85) {
    tag = " (A+ SETUP)";
  } else if (item.firstGreenSignal) {
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

async function sendDiscordAlert(opportunities, state) {
  if (opportunities.length === 0) {
    console.log("No big profitable flips found. No Discord message sent.");
    return;
  }

  const alertable = opportunities.filter((item) => {
    const alertCheck = shouldSendAlert(state, item);
    item.alertReason = alertCheck.alertReason;

    if (!alertCheck.shouldSend) {
      console.log(`${item.name}: ${alertCheck.alertReason}`);
    }

    return alertCheck.shouldSend;
  });

  if (alertable.length === 0) {
    console.log("No new alerts after cooldown/anti-spam filter.");
    return;
  }

  const embeds = alertable.slice(0, 5).map((item) => ({
    title: buildTitle(item),
    color: getColor(item.brainScore),
    fields: [
      {
        name: "🧠 Brain",
        value:
          `Score: **${item.brainScore}/100**\n` +
          `Confidence: **${item.confidence}**\n` +
          `Risk: **${item.riskLevel}**\n` +
          `Size: **${item.positionSize}**`,
        inline: false,
      },
      {
        name: "💰 Profit",
        value: `${Math.round(item.profit).toLocaleString()} gp (${item.profitPercent.toFixed(2)}%)`,
        inline: true,
      },
      {
        name: "💸 Trade Plan",
        value:
          `Max buy: ${item.maxBuy.toLocaleString()} gp\n` +
          `Target sell: ${item.targetSell.toLocaleString()} gp\n` +
          `Stop loss-ish: ${item.stopLoss.toLocaleString()} gp`,
        inline: true,
      },
      {
        name: "📉 Market",
        value: `Trend: ${item.dayVsMonthSell.toFixed(2)}%\nVolume: ${item.volumeRatio.toFixed(2)}x`,
        inline: true,
      },
      {
        name: "🌍 Market State",
        value:
          `Volatility: ${state.market?.volatility ?? 0}\n` +
          `Level: ${state.market?.level ?? "UNKNOWN"}\n` +
          `Next Check: ~${state.market?.nextRunHours ?? "?"}h\n` +
          `${state.market?.message ?? ""}`,
        inline: false,
      },
      {
        name: "🧠 Timing",
        value: `${item.historySignal}\n${item.historyAdvice}`,
        inline: false,
      },
      {
        name: "⚠️ Risk",
        value: `Fake Spread: ${item.fakeSpreadRisk}/100\n${item.fakeSpreadWarnings}`,
        inline: false,
      },
      {
        name: "👉 Action",
        value: `${item.action}\n\n${item.brainSummary}`,
        inline: false,
      },
      {
        name: "🔔 Alert Reason",
        value: item.alertReason,
        inline: false,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included | Anti-spam enabled`,
    },
  }));

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: `🧠 Tibia Flipper Brain alerts on **${SERVER}**`,
    embeds,
  });

  alertable.forEach((item) => markAlertSent(state, item));

  console.log("Discord brain alert sent.");
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

      const analyzedItem = {
        id: item.id,
        name: itemMap[item.id] || "Unknown",
        buyOffer: item.buy_offer,
        sellOffer: item.sell_offer,
        ...result,
        ...decisionData,
        ...historyData,
        ...fakeRiskData,
      };

      return {
        ...analyzedItem,
        ...calculateBrainScore(analyzedItem),
      };
    })
    .filter((item) => {
      return (
        item.profit >= MIN_PROFIT &&
        item.profitPercent >= MIN_PROFIT_PERCENT &&
        item.brainScore >= 50
      );
    })
    .sort((a, b) => b.brainScore - a.brainScore || b.profit - a.profit);

  const volatility = calculateMarketVolatility(opportunities, state);
  const runAdvice = getNextRunRecommendation(volatility);

  state.market = {
    lastRun: new Date().toISOString(),
    volatility,
    level: runAdvice.level,
    nextRunHours: runAdvice.nextRunHours,
    message: runAdvice.message,
  };

  console.log(
    `\n🧠 MARKET STATE\nVolatility: ${volatility}\nLevel: ${runAdvice.level}\nNext run in ~${runAdvice.nextRunHours}h\n${runAdvice.message}\n`,
  );

  opportunities.forEach((item) => {
    console.log(
      `${item.decision} ${item.name} (ID: ${item.id})\n` +
        `Brain Score: ${item.brainScore}/100 | Confidence: ${item.confidence} | Risk: ${item.riskLevel}\n` +
        `Position Size: ${item.positionSize}\n` +
        `Buy: ${item.buyOffer} | Sell: ${item.sellOffer}\n` +
        `Max Buy: ${item.maxBuy} | Target Sell: ${item.targetSell} | Stop Loss-ish: ${item.stopLoss}\n` +
        `Profit: ${item.profit.toFixed(0)} (${item.profitPercent.toFixed(2)}%)\n` +
        `Reason: ${item.reason}\n` +
        `Action: ${item.action}\n` +
        `Brain: ${item.brainSummary}\n` +
        `Fake Spread Risk: ${item.fakeSpreadRisk}/100\n` +
        `Warnings: ${item.fakeSpreadWarnings}\n` +
        `History: ${item.historySignal}\n` +
        `Advice: ${item.historyAdvice}\n`,
    );
  });

  await sendDiscordAlert(opportunities, state);

  saveState(state);
}

main().catch(async (err) => {
  console.error("Bot crashed:", err);
  await sendDiscordErrorAlert(err);
  process.exit(1);
});
