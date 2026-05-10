import axios from "axios";
import fs from "fs";
import "dotenv/config";
import {
  sendDiscordErrorAlert,
  getColor,
  getSellColor,
  getScannerColor,
} from "./lib/discord.js";
import { getItemMap, getMarketValues } from "./lib/market.js";
import { getTrackedItemIds } from "./lib/trackedItems.js";
import {
  analyzeHistory,
  analyzeSellMomentum,
  getFakeSpreadRisk,
  calculateBrainScore,
  getDecision,
  calculateScannerScore,
  calculateMarketPressure,
  calculateTradeabilityConviction,
} from "./lib/scoring.js";
import {
  SERVER,
  TAX_RATE,
  MIN_PROFIT,
  MIN_PROFIT_PERCENT,
  ALERT_COOLDOWN_HOURS,
  SELL_ALERT_COOLDOWN_HOURS,
  MIN_SIMPLE_BUY_BRAIN_SCORE,
  MIN_SIMPLE_BUY_PROFIT_PERCENT,
  MIN_SIMPLE_BUY_VOLUME_RATIO,
  MAX_SIMPLE_BUY_FAKE_SPREAD_RISK,
  SEND_EMPTY_SUMMARY,
  SCORE_DROP_WARNING,
  SCORE_DROP_PANIC,
  SCANNER_TOP_LIMIT,
  SCANNER_POOL,
} from "./lib/constants.js";
import { loadState, saveState, updateItemHistory } from "./lib/state.js";

const DISCORD_WEBHOOK_URL = process.env.TIBIA_SCANNER_WEBHOOK_URL;
const ITEM_IDS = getTrackedItemIds();
const SCANNER_DEBUG_DETAILS =
  String(process.env.SCANNER_DEBUG_DETAILS || "false").toLowerCase() === "true";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatGp(value) {
  return Math.round(value || 0).toLocaleString();
}

function roundToNiceGp(value) {
  const number = Math.max(0, Number(value || 0));

  if (number >= 100000) return Math.round(number / 1000) * 1000;
  if (number >= 10000) return Math.round(number / 100) * 100;
  if (number >= 1000) return Math.round(number / 50) * 50;
  if (number >= 100) return Math.round(number / 10) * 10;
  return Math.round(number);
}

function formatGpRange(low, high) {
  const cleanLow = roundToNiceGp(low);
  const cleanHigh = roundToNiceGp(high);

  if (cleanLow === cleanHigh) return `${formatGp(cleanLow)} gp`;
  return `${formatGp(cleanLow)}–${formatGp(cleanHigh)} gp`;
}

function buildScannerActionPlan(item) {
  const hasHardTrap =
    item.scannerTier === "AVOID" ||
    item.conviction === "AVOID / TRAP RISK" ||
    ["TRAP SPREAD", "HARD TO EXIT", "LOW LIQUIDITY", "UNDERCUT WAR"].some(
      (label) => item.tradeLabels?.includes(label),
    );

  const isStrongCandidate =
    item.scannerTier === "SAFE" &&
    item.conviction === "HIGH CONVICTION TRADE" &&
    ["ELITE", "STRONG"].includes(item.qualityTier) &&
    item.brainScore >= 82 &&
    item.fakeSpreadRisk <= 25 &&
    item.marketPressure < 35 &&
    item.profit >= 500;

  const isWorthTrying =
    !hasHardTrap &&
    ["SAFE", "WATCH"].includes(item.scannerTier) &&
    ["HIGH CONVICTION TRADE", "MEDIUM CONVICTION TRADE"].includes(
      item.conviction,
    ) &&
    item.tradeabilityScore >= 60 &&
    item.fakeSpreadRisk <= 40 &&
    item.profit >= 300;

  const buyAroundLow = item.buyOffer * (isStrongCandidate ? 0.992 : 0.985);
  const buyAroundHigh = item.buyOffer * (isStrongCandidate ? 1.004 : 0.998);
  const maxChase = item.buyOffer * (isStrongCandidate ? 1.018 : 1.008);

  const sellLow = item.sellOffer * 0.995;
  const sellHigh = item.sellOffer * 1.005;

  let headline = "🔎 Research only — not an automatic BUY.";
  let instruction =
    "Monitor it, but do not open a Buy Offer purely because of the spread.";

  if (hasHardTrap) {
    headline = "❌ AVOID FOR NOW";
    instruction = "Exit quality or spread structure looks too dangerous.";
  } else if (isStrongCandidate) {
    headline = "✅ WORTH BUY OFFER";
    instruction =
      "This looks like a relatively clean trade — enter patiently, not aggressively.";
  } else if (isWorthTrying) {
    headline = "🟡 BUY ONLY IF DISCOUNTED";
    instruction =
      "The trade is reasonable, but do not fight for an expensive entry.";
  }

  let exitNote =
    "If aggressive undercuts begin, exit quickly or lower your price.";

  if (item.tradeLabels?.includes("EASY EXIT")) {
    exitNote = "Exit should be relatively smooth, but do not get greedy.";
  } else if (item.tradeLabels?.includes("GOOD EXIT")) {
    exitNote = "Exit is reasonable, but expect possible small undercuts.";
  } else if (item.tradeLabels?.includes("MODERATE EXIT")) {
    exitNote = "Exit is not instant — only enter if your buy price is strong.";
  }

  if (item.tradeLabels?.includes("UNDERCUT WAR")) {
    exitNote = "Undercut pressure detected — avoid holding too aggressively.";
  }

  const whyParts = [];

  if (item.tradeLabels?.includes("ACTIVE DEMAND")) {
    whyParts.push("strong demand today");
  }

  if (
    ["EASY EXIT", "GOOD EXIT"].some((label) =>
      item.tradeLabels?.includes(label),
    )
  ) {
    whyParts.push("reasonable resale potential");
  }

  if (item.tradeLabels?.includes("TRUSTWORTHY SPREAD")) {
    whyParts.push("spread looks realistic");
  }

  if (item.fakeSpreadRisk > 25) {
    whyParts.push("some fake-spread risk exists");
  }

  if (item.profit < 500) {
    whyParts.push("raw profit is relatively small");
  }

  if (item.brainScore < 70) {
    whyParts.push("Brain Score is weaker than ideal");
  }

  const why = whyParts.length
    ? whyParts.join(" • ")
    : "No strong reason to treat this as an automatic BUY.";

  return {
    actionHeadline: headline,
    actionInstruction: instruction,
    buyRange: formatGpRange(buyAroundLow, buyAroundHigh),
    maxChase: `${formatGp(roundToNiceGp(maxChase))} gp`,
    sellRange: formatGpRange(sellLow, sellHigh),
    exitNote,
    why,
  };
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
    return `🟢 SELL — ${item.name} — TARGET HIT`;
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
        name: "👉 Action",
        value:
          `Place a BUY offer around **${formatGp(item.maxBuy)} gp** or lower. ` +
          `Do not chase above that price. ` +
          `Expect to sell around **${formatGp(item.targetSell)} gp**.`,
        inline: false,
      },
      {
        name: "🧠 Why",
        value:
          `${item.reason}\n` +
          `Brain: **${item.brainScore}/100** | Strength: **${item.strength}** | Risk: **${item.riskLevel}**`,
        inline: false,
      },
      {
        name: "💰 Profit",
        value:
          `Expected: **${formatGp(item.profit)} gp**\n` +
          `Percent: **${item.profitPercent.toFixed(2)}%**`,
        inline: true,
      },
      {
        name: "🛑 Safety",
        value: `If price drops hard, consider exiting around **${formatGp(
          item.stopLoss,
        )} gp**.`,
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

function getScannerTier(item) {
  if (
    item.conviction === "AVOID / TRAP RISK" ||
    item.marketPressureLevel === "EXTREME" ||
    ["DEAD MARKET", "FAKE SPREAD", "NO MARKET", "NO PROFIT AFTER TAX"].includes(
      item.marketClass,
    )
  ) {
    return "AVOID";
  }

  if (
    item.marketPressureLevel === "HIGH" ||
    item.tradeabilityScore < 48 ||
    ["UNDERCUT WAR", "TRAP SPREAD", "LOW LIQUIDITY"].some((label) =>
      item.tradeLabels?.includes(label),
    )
  ) {
    return "SPECULATIVE";
  }

  if (
    item.conviction === "HIGH CONVICTION TRADE" &&
    ["ELITE", "STRONG"].includes(item.qualityTier) &&
    item.scannerScore >= 72 &&
    item.tradeabilityScore >= 73 &&
    item.brainScore >= 82 &&
    ["HIGH", "MEDIUM"].includes(item.exitConfidence) &&
    item.fakeSpreadRisk <= 22 &&
    item.marketPressure < 35 &&
    item.daySold >= 12 &&
    item.monthSold >= 350 &&
    item.profit >= 700 &&
    item.profitPercent >= 5.5
  ) {
    return "SAFE";
  }

  if (
    ["HIGH CONVICTION TRADE", "MEDIUM CONVICTION TRADE"].includes(
      item.conviction,
    ) &&
    ["ELITE", "STRONG", "DECENT"].includes(item.qualityTier) &&
    item.scannerScore >= 54 &&
    item.tradeabilityScore >= 62 &&
    ["HIGH", "MEDIUM", "LOW"].includes(item.exitConfidence) &&
    item.monthSold >= 120 &&
    item.fakeSpreadRisk <= 40 &&
    item.profit >= 300 &&
    item.profitPercent >= 4
  ) {
    return "WATCH";
  }

  return "SPECULATIVE";
}

function scannerSortValue(item) {
  const confidenceRank = { HIGH: 4, MEDIUM: 3, LOW: 2, "VERY LOW": 1 };
  const convictionRank = {
    "HIGH CONVICTION TRADE": 5,
    "MEDIUM CONVICTION TRADE": 3,
    "LOW CONVICTION": 1,
    "AVOID / TRAP RISK": -4,
  };
  const qualityRank = {
    ELITE: 5,
    STRONG: 4,
    DECENT: 2,
    WEAK: 0,
  };
  const classRank = {
    "FAST FLIP": 6,
    "SAFE FLIP": 5,
    "SLOW FLIP": 4,
    RISKY: 2,
    "FAKE SPREAD": -3,
    "DEAD MARKET": -4,
    "NO PROFIT AFTER TAX": -5,
    "NO MARKET": -5,
  };

  const hardLabelPenalty = [
    "UNDERCUT WAR",
    "TRAP SPREAD",
    "LOW LIQUIDITY",
    "CROWDED MARKET",
  ].filter((label) => item.tradeLabels?.includes(label)).length;

  return (
    item.tradeabilityScore * 1400000 +
    item.scannerScore * 700000 +
    (qualityRank[item.qualityTier] || 0) * 350000 +
    (convictionRank[item.conviction] || 0) * 260000 +
    (confidenceRank[item.exitConfidence] || 0) * 100000 +
    (classRank[item.marketClass] || 0) * 20000 +
    item.monthSold * 12 +
    Math.max(item.realisticProfit ?? item.profit, 0) / 400 -
    (item.marketPressure || 0) * 80000 -
    (item.fakeSpreadRisk || 0) * 55000 -
    hardLabelPenalty * 350000
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

async function sendDiscordScannerReport(analyzedItems, volatility, runAdvice) {
  const rankedItems = buildScannerReportItems(analyzedItems);
  const topItems = rankedItems.slice(0, SCANNER_TOP_LIMIT);

  if (topItems.length === 0) {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `🔎 Tibia Flipper scanner checked **${SERVER}** but found no items.`,
    });
    return;
  }

  const embeds = topItems.slice(0, 5).map((item, index) => {
    const actionPlan = buildScannerActionPlan(item);

    const fields = [
      {
        name: "🎯 Action Plan",
        value:
          `**${actionPlan.actionHeadline}**\n` +
          `${actionPlan.actionInstruction}\n\n` +
          `Place a Buy Offer between **${actionPlan.buyRange}**. ` +
          `Do not put anything above **${actionPlan.maxChase}**. ` +
          `Expect to sell around **${actionPlan.sellRange}**.\n\n` +
          `⚠️ ${actionPlan.exitNote}`,
        inline: false,
      },
      {
        name: "🧠 Quick Read",
        value:
          `${actionPlan.why}\n\n` +
          `Read: **${item.conviction}** / **${item.qualityTier || "WEAK"}**\n` +
          `Exit: **${
            item.tradeLabels?.find((label) => label.includes("EXIT")) ||
            item.exitConfidence
          }** | Sustainability: **${
            item.spreadSustainability || "BUILDING MEMORY"
          }**`,
        inline: false,
      },
      {
        name: "⚠️ Warnings",
        value:
          `${
            (item.tradeWarnings || []).join(" ").slice(0, 260) ||
            "No major warnings right now."
          }\n` +
          `${
            item.spreadSustainabilityAdvice ||
            "Historical spread persistence data is still building."
          }`,
        inline: false,
      },
    ];

    if (SCANNER_DEBUG_DETAILS) {
      fields.push(
        {
          name: "🧪 Debug — Scores",
          value:
            `Scanner: **${item.scannerScore}/100** | Brain: **${item.brainScore}/100** | Tradeability: **${item.tradeabilityScore}/100**\n` +
            `Risk: **${item.fakeSpreadRisk}/100** | Pressure: **${
              item.marketPressureLevel || "UNKNOWN"
            }** (${Number(item.marketPressure || 0).toFixed(0)}/100)`,
          inline: false,
        },
        {
          name: "🧪 Debug — Market Data",
          value:
            `Profit: **${formatGp(item.profit)} gp** (${item.profitPercent.toFixed(
              2,
            )}%)\n` +
            `Buy/Sell: **${formatGp(item.buyOffer)} → ${formatGp(
              item.sellOffer,
            )}**\n` +
            `Today/month sold: **${formatGp(item.daySold)} / ${formatGp(
              item.monthSold,
            )}** | Volume: **${item.volumeRatio.toFixed(2)}x**\n` +
            `History: **${item.historySignal}**`,
          inline: false,
        },
        {
          name: "🧪 Debug — Score Notes",
          value: item.scannerNotes.slice(0, 500),
          inline: false,
        },
      );
    }

    return {
      title: `#${index + 1} ${item.name} — ${item.scannerTier} / ${
        item.qualityTier || "WEAK"
      } / ${item.conviction}`,
      color: getScannerColor(item.scannerTier),
      fields,
      footer: {
        text: `Item ID: ${item.id} | Tax included | Scanner mode only${
          SCANNER_DEBUG_DETAILS ? " | Debug details ON" : ""
        }`,
      },
    };
  });

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
      `Shown: **${embeds.length}** / ${topItems.length}: 🟢 SAFE ${tierCounts.SAFE || 0} | 🟡 WATCH ${tierCounts.WATCH || 0} | 🟠 SPECULATIVE ${tierCounts.SPECULATIVE || 0} | 🔴 AVOID ${tierCounts.AVOID || 0}`,
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

    const withPressure = {
      ...withBrain,
      ...calculateMarketPressure(withBrain),
    };

    const withConviction = {
      ...withPressure,
      ...calculateTradeabilityConviction(withPressure),
    };

    const sellDecisionData = getSellDecision(withConviction, state);

    return {
      ...withConviction,
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
