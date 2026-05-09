import axios from "axios";
import fs from "fs";
import "dotenv/config";
import { sendDiscordErrorAlert } from "./lib/discord.js";
import { SERVER, getItemMap, getMarketValues } from "./lib/market.js";
import { getTrackedItemIds } from "./lib/trackedItems.js";
import {
  analyzeHistory,
  analyzeSellMomentum,
  getFakeSpreadRisk,
  calculateBrainScore,
} from "./lib/scoring.js";

const TAX_RATE = 0.02;

const MIN_PROFIT = 5000;
const MIN_PROFIT_PERCENT = 3;

const STATE_FILE = "./state.json";
const MAX_HISTORY = 20;

const ALERT_COOLDOWN_HOURS = 12;
const SELL_ALERT_COOLDOWN_HOURS = 6;

const MIN_SIMPLE_BUY_BRAIN_SCORE = 70;
const MIN_SIMPLE_BUY_PROFIT_PERCENT = 5;
const MIN_SIMPLE_BUY_VOLUME_RATIO = 0.7;
const MAX_SIMPLE_BUY_FAKE_SPREAD_RISK = 30;

const SEND_EMPTY_SUMMARY = true;
const SCORE_DROP_WARNING = 15;
const SCORE_DROP_PANIC = 25;

const SCANNER_TOP_LIMIT = Number(process.env.SCANNER_TOP_LIMIT || 10);
const SCANNER_POOL = String(process.env.SCANNER_POOL || "all").toLowerCase();
const DISCORD_WEBHOOK_URL = process.env.TIBIA_SCANNER_WEBHOOK_URL;

const ITEM_IDS = getTrackedItemIds();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatGp(value) {
  return Math.round(value || 0).toLocaleString();
}

function calculateProfit(buyPrice, sellPrice) {
  const realBuyCost = buyPrice * (1 + TAX_RATE);
  const realSellIncome = sellPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
  };
}

function getColor(brainScore) {
  if (brainScore >= 85) return 0x00ff00;
  if (brainScore >= 70) return 0xffff00;
  return 0xff9900;
}

function getSellColor(level) {
  if (level === "PANIC") return 0xff0000;
  if (level === "SELL_NOW") return 0x00ff00;
  if (level === "TAKE_PROFIT") return 0xffff00;
  return 0xff9900;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { items: {}, alerts: {}, sellAlerts: {}, market: {} };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!state.items) state.items = {};
  if (!state.alerts) state.alerts = {};
  if (!state.sellAlerts) state.sellAlerts = {};
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

function calculateMarketVolatility(items, state) {
  let volatility = 0;

  items.forEach((item) => {
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
    message: "Market is calm.",
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

  let decision = "WATCH";
  let action = "Do nothing.";
  let reason = "Not strong enough.";

  if (fakeSpreadRisk >= 40) {
    decision = "AVOID";
    action = "Do not buy.";
    reason = "Fake spread risk is too high.";
  } else if (isGoodProfit && historyData?.firstGreenSignal && !hasLowVolume) {
    decision = "BUY";
    action = `Place buy offer around ${item.buy_offer.toLocaleString()} gp.`;
    reason = "Strong profit and first green after drop.";
  } else if (isGoodProfit && historyData?.bottomSignal && !hasLowVolume) {
    decision = "BUY";
    action = `Place small buy offer around ${item.buy_offer.toLocaleString()} gp.`;
    reason = "Profit is good and price may be bottoming.";
  } else if (isGoodProfit && isRising && hasGoodVolume) {
    decision = "BUY";
    action = `Place buy offer around ${item.buy_offer.toLocaleString()} gp.`;
    reason = "Good profit, rising price, and healthy volume.";
  } else if (isGoodProfit && isFalling) {
    decision = "WAIT";
    action = "Do not buy yet.";
    reason = "Profit exists, but price is falling.";
  } else if (isGoodProfit && hasDownwardPressure) {
    decision = "WAIT";
    action = "Wait for stabilization.";
    reason = "Trend is negative and volume is weak.";
  } else if (isGoodProfit && hasLowVolume) {
    decision = "WAIT";
    action = "Do not buy unless you accept slow resale.";
    reason = "Profit looks good, but liquidity is low.";
  } else if (isGoodProfit) {
    decision = "BUY";
    action = `Place buy offer only if you can buy around ${item.buy_offer.toLocaleString()} gp or lower.`;
    reason = "Profit exists, but setup is not perfect.";
  } else if (isRising && hasGoodVolume) {
    decision = "WATCH";
    action = "Do nothing yet.";
    reason = "Price and volume are rising, but profit is not enough.";
  } else if (isFalling) {
    decision = "AVOID";
    action = "Avoid buying.";
    reason = "Price is falling.";
  }

  return {
    decision,
    action,
    reason,
    dayVsMonthSell,
    volumeRatio,
  };
}

function isSimpleBuySignal(item) {
  const hasGoodLiquidity = item.monthSold >= 100 && item.daySold >= 3;

  const hasSafeSpread = item.fakeSpreadRisk < 30;

  const hasHealthyVolume = item.volumeRatio >= 0.8;

  const hasGoodProfit = item.profit >= MIN_PROFIT && item.profitPercent >= 5;

  const hasGoodBrain = item.brainScore >= 75;

  const notFalling = !item.fallingHard;

  return (
    item.decision === "BUY" &&
    hasGoodLiquidity &&
    hasSafeSpread &&
    hasHealthyVolume &&
    hasGoodProfit &&
    hasGoodBrain &&
    notFalling
  );
}

function getSellDecision(item, state) {
  const id = String(item.id);
  const lastBuyAlert = state.alerts[id];

  if (!lastBuyAlert || lastBuyAlert.type !== "SIMPLE_BUY") {
    return {
      hasPreviousBuyAlert: false,
      trackedTargetSell: item.targetSell,
      previousBrainScore: item.brainScore,
      scoreDrop: 0,
      sellLevel: null,
      sellDecision: "HOLD",
      sellAction: "No sell signal.",
      sellReason: "No previous simple BUY signal from this bot version.",
    };
  }

  const trackedTargetSell = lastBuyAlert.targetSell || item.targetSell;
  const previousBrainScore = lastBuyAlert.brainScore ?? item.brainScore;
  const scoreDrop = previousBrainScore - item.brainScore;

  const targetHit = item.sellOffer >= trackedTargetSell;
  const scoreWarning = scoreDrop >= SCORE_DROP_WARNING;
  const scorePanic = scoreDrop >= SCORE_DROP_PANIC;

  const badFakeSpread = item.fakeSpreadRisk >= 40;
  const badVolume = item.volumeRatio < 0.5;
  const exitRisk = badFakeSpread || badVolume;

  const momentumDropping = item.momentumDropping;
  const momentumBad = item.momentumBad;

  let sellLevel = null;
  let sellDecision = "HOLD";
  let sellAction = "Hold. No sell signal yet.";
  let sellReason = "No strong exit signal right now.";

  if (exitRisk && (scorePanic || momentumBad)) {
    sellLevel = "PANIC";
    sellDecision = "SELL";
    sellAction = "SELL / EXIT. Setup got dangerous.";
    sellReason = "Risk got bad and momentum/Brain Score collapsed.";
  } else if (targetHit) {
    sellLevel = "SELL_NOW";
    sellDecision = "SELL";
    sellAction = `SELL / LIST now around ${formatGp(item.sellOffer)} gp.`;
    sellReason = `Target reached: ${formatGp(trackedTargetSell)} gp.`;
  } else if (momentumDropping && item.profitPercent > 0) {
    sellLevel = "TAKE_PROFIT";
    sellDecision = "SELL";
    sellAction = "SELL / TAKE PROFIT. Momentum is weakening.";
    sellReason = "Recent sell price momentum started dropping.";
  } else if (scoreWarning) {
    sellLevel = "WARNING";
    sellDecision = "SELL";
    sellAction = "Consider selling. Brain Score dropped hard.";
    sellReason = `Brain Score dropped from ${previousBrainScore} to ${item.brainScore}.`;
  } else if (exitRisk) {
    sellLevel = "WARNING";
    sellDecision = "SELL";
    sellAction = "Consider selling. Liquidity/risk got worse.";
    sellReason = "Fake spread risk or volume got worse.";
  }

  return {
    hasPreviousBuyAlert: true,
    trackedTargetSell,
    previousBrainScore,
    scoreDrop,
    sellLevel,
    sellDecision,
    sellAction,
    sellReason,
  };
}

function shouldSendBuyAlert(state, item) {
  const id = String(item.id);
  const lastAlert = state.alerts[id];

  if (!lastAlert || lastAlert.type !== "SIMPLE_BUY") {
    return {
      shouldSend: true,
      alertReason: "New BUY signal.",
    };
  }

  const hoursSinceLastAlert =
    (Date.now() - new Date(lastAlert.time).getTime()) / 1000 / 60 / 60;

  const targetChangedEnough =
    Math.abs(item.targetSell - lastAlert.targetSell) >= item.targetSell * 0.03;

  const scoreImproved = item.brainScore >= lastAlert.brainScore + 10;

  if (hoursSinceLastAlert >= ALERT_COOLDOWN_HOURS) {
    return {
      shouldSend: true,
      alertReason: `BUY cooldown passed (${hoursSinceLastAlert.toFixed(1)}h).`,
    };
  }

  if (scoreImproved) {
    return {
      shouldSend: true,
      alertReason: `Brain improved from ${lastAlert.brainScore} to ${item.brainScore}.`,
    };
  }

  if (targetChangedEnough) {
    return {
      shouldSend: true,
      alertReason: "Target price changed meaningfully.",
    };
  }

  return {
    shouldSend: false,
    alertReason: `Skipped duplicate BUY. Last BUY was ${hoursSinceLastAlert.toFixed(1)}h ago.`,
  };
}

function shouldSendSellAlert(state, item) {
  if (!item.sellLevel) {
    return {
      shouldSend: false,
      sellAlertReason: "No SELL signal.",
    };
  }

  const id = String(item.id);
  const lastSellAlert = state.sellAlerts[id];

  if (!lastSellAlert) {
    return {
      shouldSend: true,
      sellAlertReason: "New SELL signal.",
    };
  }

  const hoursSinceLastSellAlert =
    (Date.now() - new Date(lastSellAlert.time).getTime()) / 1000 / 60 / 60;

  const becameMoreUrgent =
    urgencyRank(item.sellLevel) > urgencyRank(lastSellAlert.sellLevel);

  const scoreDroppedMore =
    item.scoreDrop >= (lastSellAlert.scoreDrop || 0) + 10;

  if (becameMoreUrgent) {
    return {
      shouldSend: true,
      sellAlertReason: `SELL became more urgent: ${lastSellAlert.sellLevel} → ${item.sellLevel}.`,
    };
  }

  if (scoreDroppedMore) {
    return {
      shouldSend: true,
      sellAlertReason: `Brain dropped more sharply. Drop is now ${item.scoreDrop}.`,
    };
  }

  if (hoursSinceLastSellAlert >= SELL_ALERT_COOLDOWN_HOURS) {
    return {
      shouldSend: true,
      sellAlertReason: `SELL cooldown passed (${hoursSinceLastSellAlert.toFixed(1)}h).`,
    };
  }

  return {
    shouldSend: false,
    sellAlertReason: `Skipped duplicate SELL. Last SELL was ${hoursSinceLastSellAlert.toFixed(1)}h ago.`,
  };
}

function urgencyRank(level) {
  if (level === "PANIC") return 4;
  if (level === "SELL_NOW") return 3;
  if (level === "TAKE_PROFIT") return 2;
  if (level === "WARNING") return 1;
  return 0;
}

function markBuyAlertSent(state, item) {
  const id = String(item.id);

  state.alerts[id] = {
    type: "SIMPLE_BUY",
    time: new Date().toISOString(),
    brainScore: item.brainScore,
    strength: item.strength,
    profit: item.profit,
    profitPercent: item.profitPercent,
    maxBuy: item.maxBuy,
    targetSell: item.targetSell,
    stopLoss: item.stopLoss,
    buyOffer: item.buyOffer,
    sellOffer: item.sellOffer,
  };
}

function markSellAlertSent(state, item) {
  const id = String(item.id);

  state.sellAlerts[id] = {
    type: "SIMPLE_SELL",
    time: new Date().toISOString(),
    sellLevel: item.sellLevel,
    brainScore: item.brainScore,
    previousBrainScore: item.previousBrainScore,
    scoreDrop: item.scoreDrop,
    sellOffer: item.sellOffer,
    trackedTargetSell: item.trackedTargetSell,
    fakeSpreadRisk: item.fakeSpreadRisk,
    volumeRatio: item.volumeRatio,
  };
}

function buildSimpleBuyTitle(item) {
  if (item.brainScore >= 85) return `🟢 BUY — ${item.name} — VERY STRONG`;
  if (item.brainScore >= 75) return `🟢 BUY — ${item.name} — STRONG`;
  return `🟡 BUY — ${item.name} — GOOD`;
}

function buildSimpleSellTitle(item) {
  if (item.sellLevel === "PANIC") return `🚨 SELL — ${item.name} — EXIT`;
  if (item.sellLevel === "SELL_NOW")
    return `🔴 SELL — ${item.name} — TARGET HIT`;
  if (item.sellLevel === "TAKE_PROFIT") {
    return `🟠 SELL — ${item.name} — TAKE PROFIT`;
  }
  return `🟠 SELL — ${item.name} — WARNING`;
}

async function sendDiscordBuyAlerts(buySignals, state) {
  const alertable = buySignals.filter((item) => {
    const alertCheck = shouldSendBuyAlert(state, item);
    item.alertReason = alertCheck.alertReason;

    if (!alertCheck.shouldSend) {
      console.log(`${item.name}: ${alertCheck.alertReason}`);
    }

    return alertCheck.shouldSend;
  });

  if (alertable.length === 0) {
    console.log("No simple BUY alerts after cooldown.");
    return;
  }

  const embeds = alertable.slice(0, 5).map((item) => ({
    title: buildSimpleBuyTitle(item),
    color: getColor(item.brainScore),
    fields: [
      {
        name: "👉 ACTION",
        value: `Place BUY offer around **${formatGp(item.maxBuy)} gp** or lower.`,
        inline: false,
      },
      {
        name: "🎯 SELL TARGET",
        value: `List/Sell around **${formatGp(item.targetSell)} gp**.`,
        inline: false,
      },
      {
        name: "🧠 BRAIN",
        value:
          `Score: **${item.brainScore}/100**\n` +
          `Strength: **${item.strength}**\n` +
          `Risk: **${item.riskLevel}**`,
        inline: true,
      },
      {
        name: "💰 PROFIT",
        value:
          `Expected: **${formatGp(item.profit)} gp**\n` +
          `Percent: **${item.profitPercent.toFixed(2)}%**`,
        inline: true,
      },
      {
        name: "📊 WHY",
        value:
          `${item.reason}\n` +
          `Trend: ${item.dayVsMonthSell.toFixed(2)}%\n` +
          `Volume: ${item.volumeRatio.toFixed(2)}x\n` +
          `Fake spread risk: ${item.fakeSpreadRisk}/100`,
        inline: false,
      },
      {
        name: "🛑 SAFETY",
        value: `If price drops hard, consider exiting around **${formatGp(item.stopLoss)} gp**.`,
        inline: false,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included | Simple BUY/SELL mode`,
    },
  }));

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: `🟢 Tibia Flipper BUY signals on **${SERVER}**`,
    embeds,
  });

  alertable.forEach((item) => markBuyAlertSent(state, item));

  console.log("Discord simple BUY alert sent.");
}

async function sendDiscordSellAlerts(sellSignals, state) {
  const alertable = sellSignals.filter((item) => {
    const alertCheck = shouldSendSellAlert(state, item);
    item.sellAlertReason = alertCheck.sellAlertReason;

    if (!alertCheck.shouldSend) {
      console.log(`${item.name}: ${alertCheck.sellAlertReason}`);
    }

    return alertCheck.shouldSend;
  });

  if (alertable.length === 0) {
    console.log("No simple SELL alerts after cooldown.");
    return;
  }

  const embeds = alertable.slice(0, 5).map((item) => ({
    title: buildSimpleSellTitle(item),
    color: getSellColor(item.sellLevel),
    fields: [
      {
        name: "👉 ACTION",
        value: `**${item.sellAction}**`,
        inline: false,
      },
      {
        name: "🎯 TARGET",
        value:
          `Target: **${formatGp(item.trackedTargetSell)} gp**\n` +
          `Current sell price: **${formatGp(item.sellOffer)} gp**`,
        inline: true,
      },
      {
        name: "🧠 BRAIN",
        value:
          `Previous: **${item.previousBrainScore}/100**\n` +
          `Now: **${item.brainScore}/100**\n` +
          `Drop: **${item.scoreDrop}**`,
        inline: true,
      },
      {
        name: "📊 WHY",
        value:
          `${item.sellReason}\n` +
          `Momentum: ${item.sellMomentumSignal}\n` +
          `Volume: ${item.volumeRatio.toFixed(2)}x\n` +
          `Fake spread risk: ${item.fakeSpreadRisk}/100`,
        inline: false,
      },
      {
        name: "NOTE",
        value: "This SELL alert assumes you followed the previous BUY signal.",
        inline: false,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included | Simple BUY/SELL mode`,
    },
  }));

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: `🔴 Tibia Flipper SELL signals on **${SERVER}**`,
    embeds,
  });

  alertable.forEach((item) => markSellAlertSent(state, item));

  console.log("Discord simple SELL alert sent.");
}

function getExitConfidence(item) {
  if (!item.buyOffer || !item.sellOffer || item.profit <= 0) return "VERY LOW";
  if (item.daySold >= 30 && item.monthSold >= 500 && item.fakeSpreadRisk <= 20)
    return "HIGH";
  if (item.daySold >= 10 && item.monthSold >= 250 && item.fakeSpreadRisk <= 35)
    return "MEDIUM";
  if (item.daySold >= 3 && item.monthSold >= 100 && item.fakeSpreadRisk <= 55)
    return "LOW";
  return "VERY LOW";
}

function getMarketClass(item) {
  if (!item.buyOffer || !item.sellOffer) return "NO MARKET";
  if (item.profit <= 0) return "NO PROFIT AFTER TAX";
  if (item.daySold === 0 || item.monthSold < 30) return "DEAD MARKET";
  if (item.profitPercent > 80 && item.monthSold < 250) return "FAKE SPREAD";
  if (item.fakeSpreadRisk >= 80) return "FAKE SPREAD";
  if (item.daySold >= 30 && item.monthSold >= 500 && item.fakeSpreadRisk <= 25)
    return "FAST FLIP";
  if (item.daySold >= 8 && item.monthSold >= 250) return "SAFE FLIP";
  if (item.daySold >= 3 && item.monthSold >= 100) return "SLOW FLIP";
  return "RISKY";
}

function getScannerTier(item) {
  if (
    ["DEAD MARKET", "FAKE SPREAD", "NO MARKET", "NO PROFIT AFTER TAX"].includes(
      item.marketClass,
    )
  ) {
    return "AVOID";
  }

  if (
    item.scannerScore >= 75 &&
    item.exitConfidence === "HIGH" &&
    item.monthSold >= 500 &&
    item.fakeSpreadRisk <= 20 &&
    item.profit > 0
  ) {
    return "SAFE";
  }

  if (
    item.scannerScore >= 55 &&
    ["HIGH", "MEDIUM"].includes(item.exitConfidence) &&
    item.monthSold >= 150 &&
    item.fakeSpreadRisk <= 45 &&
    item.profit > 0
  ) {
    return "WATCH";
  }

  return "SPECULATIVE";
}

function getUndervaluedPercent(item) {
  if (!item.monthAverageSell || !item.sellOffer) return 0;
  return (
    ((item.monthAverageSell - item.sellOffer) / item.monthAverageSell) * 100
  );
}

function calculateScannerScore(item) {
  let score = 0;
  const notes = [];
  const hardCaps = [];

  const profitPercentScore = clamp(item.profitPercent * 1.6, 0, 15);
  score += profitPercentScore;
  notes.push(`profit% +${profitPercentScore.toFixed(1)}`);

  const rawProfitScore = clamp(item.profit / 10000, 0, 10);
  score += rawProfitScore;
  notes.push(`raw profit +${rawProfitScore.toFixed(1)}`);

  let liquidityScore = 0;
  if (item.monthSold >= 1500) liquidityScore = 28;
  else if (item.monthSold >= 700) liquidityScore = 25;
  else if (item.monthSold >= 300) liquidityScore = 21;
  else if (item.monthSold >= 150) liquidityScore = 15;
  else if (item.monthSold >= 75) liquidityScore = 9;
  else if (item.monthSold >= 30) liquidityScore = 4;
  score += liquidityScore;
  notes.push(`liquidity +${liquidityScore}`);

  const cappedVolumeRatio = clamp(item.volumeRatio, 0, 2.5);
  const volumeScore = clamp(cappedVolumeRatio * 5, 0, 12);
  score += volumeScore;
  notes.push(`volume +${volumeScore.toFixed(1)}`);

  let stabilityScore = 8;
  if (Math.abs(item.dayVsMonthSell) <= 2) stabilityScore = 15;
  else if (Math.abs(item.dayVsMonthSell) <= 5) stabilityScore = 11;
  else if (Math.abs(item.dayVsMonthSell) <= 10) stabilityScore = 6;
  else stabilityScore = 2;
  score += stabilityScore;
  notes.push(`stability +${stabilityScore}`);

  const undervaluedPercent = getUndervaluedPercent(item);
  let undervaluedScore = 0;
  if (item.profit > 0 && item.monthSold >= 100 && item.daySold >= 3) {
    if (undervaluedPercent >= 20) undervaluedScore = 12;
    else if (undervaluedPercent >= 12) undervaluedScore = 8;
    else if (undervaluedPercent >= 6) undervaluedScore = 4;
  }
  score += undervaluedScore;
  notes.push(
    `undervalued +${undervaluedScore} (${undervaluedPercent.toFixed(1)}%)`,
  );

  const historyBonus = clamp(item.historyScore, -12, 12);
  score += historyBonus;
  notes.push(`history ${historyBonus >= 0 ? "+" : ""}${historyBonus}`);

  const riskPenalty = clamp(item.fakeSpreadRisk * 0.75, 0, 45);
  score -= riskPenalty;
  notes.push(`risk -${riskPenalty.toFixed(1)}`);

  if (item.profit <= 0) {
    score -= 35;
    hardCaps.push(20);
    notes.push("negative profit -35 / cap 20");
  }

  if (!item.buyOffer || !item.sellOffer) {
    score -= 50;
    hardCaps.push(0);
    notes.push("missing offer -50 / cap 0");
  }

  if (item.daySold === 0) {
    score -= 40;
    hardCaps.push(15);
    notes.push("no sales today -40 / cap 15");
  } else if (item.daySold <= 2) {
    score -= 20;
    hardCaps.push(25);
    notes.push("very low day sales -20 / cap 25");
  }

  if (item.monthSold < 30) {
    score -= 35;
    hardCaps.push(25);
    notes.push("very low month sales -35 / cap 25");
  } else if (item.monthSold < 100) {
    score -= 15;
    hardCaps.push(45);
    notes.push("low month sales -15 / cap 45");
  }

  if (item.fakeSpreadRisk >= 80) {
    hardCaps.push(35);
    notes.push("risk >=80 / cap 35");
  }

  if (item.profitPercent > 80 && item.monthSold < 250) {
    hardCaps.push(30);
    notes.push("huge spread + weak liquidity / cap 30");
  }

  const cap = hardCaps.length ? Math.min(...hardCaps) : 100;
  const scannerScore = Math.round(clamp(Math.min(score, cap), 0, 100));

  return {
    scannerScore,
    scannerNotes: notes.join(" | "),
    exitConfidence: getExitConfidence(item),
    marketClass: getMarketClass(item),
    undervaluedPercent,
  };
}

function scannerSortValue(item) {
  const confidenceRank = { HIGH: 4, MEDIUM: 3, LOW: 2, "VERY LOW": 1 };
  const classRank = {
    "FAST FLIP": 6,
    "SAFE FLIP": 5,
    "SLOW FLIP": 4,
    RISKY: 3,
    "FAKE SPREAD": 2,
    "DEAD MARKET": 1,
    "NO PROFIT AFTER TAX": 0,
    "NO MARKET": 0,
  };

  return (
    item.scannerScore * 1000000 +
    (confidenceRank[item.exitConfidence] || 0) * 100000 +
    (classRank[item.marketClass] || 0) * 10000 +
    item.monthSold * 10 +
    Math.max(item.profit, 0) / 1000
  );
}

function buildScannerReportItems(analyzedItems) {
  return analyzedItems
    .map((item) => {
      const scannerData = calculateScannerScore(item);
      const withScanner = {
        ...item,
        ...scannerData,
      };

      return {
        ...withScanner,
        scannerTier: getScannerTier(withScanner),
      };
    })
    .sort((a, b) => scannerSortValue(b) - scannerSortValue(a));
}

function getScannerColor(tier) {
  if (tier === "SAFE") return 0x00ff00;
  if (tier === "WATCH") return 0xffff00;
  if (tier === "SPECULATIVE") return 0xff9900;
  return 0xff0000;
}

async function sendDiscordScannerReport(analyzedItems, volatility, runAdvice) {
  const rankedItems = buildScannerReportItems(analyzedItems);
  const topItems = rankedItems.slice(0, SCANNER_TOP_LIMIT);

  if (topItems.length === 0) {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `🔎 Tibia Flipper scanner checked **${SERVER}** but found no items.`,
    });
    return;
  }

  const embeds = topItems.slice(0, 10).map((item, index) => ({
    title: `#${index + 1} ${item.name} — ${item.scannerTier} / ${item.marketClass}`,
    color: getScannerColor(item.scannerTier),
    fields: [
      {
        name: "🧠 Scanner",
        value:
          `Score: **${item.scannerScore}/100**\n` +
          `Brain: **${item.brainScore}/100**\n` +
          `Risk: **${item.fakeSpreadRisk}/100**\n` +
          `Exit confidence: **${item.exitConfidence}**`,
        inline: true,
      },
      {
        name: "💰 Profit",
        value:
          `Expected: **${formatGp(item.profit)} gp**\n` +
          `Percent: **${item.profitPercent.toFixed(2)}%**\n` +
          `Buy/Sell: **${formatGp(item.buyOffer)} → ${formatGp(item.sellOffer)}**`,
        inline: true,
      },
      {
        name: "📊 Liquidity / Volume",
        value:
          `Today sold: **${formatGp(item.daySold)}**\n` +
          `Month sold: **${formatGp(item.monthSold)}**\n` +
          `Volume ratio: **${item.volumeRatio.toFixed(2)}x**`,
        inline: true,
      },
      {
        name: "📈 Stability / Value",
        value:
          `Day vs month avg: **${item.dayVsMonthSell.toFixed(2)}%**\n` +
          `Undervalued vs month avg: **${item.undervaluedPercent.toFixed(2)}%**\n` +
          `History: **${item.historySignal}**`,
        inline: false,
      },
      {
        name: "📝 Notes",
        value: item.scannerNotes.slice(0, 900),
        inline: false,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included | Scanner mode only`,
    },
  }));

  const tierCounts = topItems.reduce(
    (acc, item) => {
      acc[item.scannerTier] = (acc[item.scannerTier] || 0) + 1;
      return acc;
    },
    { SAFE: 0, WATCH: 0, SPECULATIVE: 0, AVOID: 0 },
  );

  await axios.post(DISCORD_WEBHOOK_URL, {
    content:
      `🔎 **Top Flippable Items Scanner** on **${SERVER}**\n` +
      `Mode: research only — no BUY/SELL alerts sent.\n` +
      `Pool: **${SCANNER_POOL}** | Checked: **${analyzedItems.length}** items\n` +
      `Market: **${runAdvice.level}** | Volatility: **${volatility}**\n` +
      `Top ${topItems.length}: 🟢 SAFE ${tierCounts.SAFE || 0} | 🟡 WATCH ${tierCounts.WATCH || 0} | 🟠 SPECULATIVE ${tierCounts.SPECULATIVE || 0} | 🔴 AVOID ${tierCounts.AVOID || 0}`,
    embeds,
  });

  console.log("Discord scanner report sent.");
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("Missing TIBIA_SCANNER_WEBHOOK_URL");
    process.exit(1);
  }

  const items = await getMarketValues(ITEM_IDS);
  const itemMap = getItemMap();
  const state = loadState();

  const analyzedItems = items.map((item) => {
    const result = calculateProfit(item.buy_offer, item.sell_offer);

    updateItemHistory(state, item, result);

    const history = state.items[String(item.id)];
    const historyData = analyzeHistory(history);
    const sellMomentumData = analyzeSellMomentum(history);
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
      ...sellMomentumData,
      ...fakeRiskData,
      daySold: item.day_sold || 0,
      monthSold: item.month_sold || 0,
      dayAverageSell: item.day_average_sell || 0,
      monthAverageSell: item.month_average_sell || 0,
    };

    const withBrain = {
      ...analyzedItem,
      ...calculateBrainScore(analyzedItem),
    };

    const sellDecisionData = getSellDecision(withBrain, state);

    return {
      ...withBrain,
      ...sellDecisionData,
    };
  });

  const volatility = calculateMarketVolatility(analyzedItems, state);
  const runAdvice = getNextRunRecommendation(volatility);

  state.market = {
    lastRun: new Date().toISOString(),
    volatility,
    level: runAdvice.level,
    nextRunHours: runAdvice.nextRunHours,
    message: runAdvice.message,
  };

  console.log(
    `
TIBIA FLIPPER SCANNER MODE
` +
      `Market volatility: ${volatility} (${runAdvice.level})
` +
      `Items checked: ${analyzedItems.length}
`,
  );

  await sendDiscordScannerReport(analyzedItems, volatility, runAdvice);
  saveState(state);
}

main().catch(async (err) => {
  console.error("Bot crashed:", err);
  await sendDiscordErrorAlert(err);
  process.exit(1);
});
