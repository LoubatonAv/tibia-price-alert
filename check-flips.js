
// Quiet normal output: rejected item dumps are shown only in debug mode.
const FLIPPER_DEBUG_REJECTIONS = ["1", "true", "yes", "y"].includes(
  String(process.env.FLIPPER_DEBUG_REJECTIONS || "").toLowerCase(),
);

const originalFlipperConsoleLog = console.log.bind(console);

console.log = (...args) => {
  const message = args.map((arg) => String(arg)).join(" ");

  if (!FLIPPER_DEBUG_REJECTIONS && /^\s*REJECTED:/m.test(message)) {
    return;
  }

  originalFlipperConsoleLog(...args);
};

import axios from "axios";
import fs from "fs";
import "dotenv/config";
import { clamp, formatGp } from "./lib/utils.js";
import {
  sendDiscordErrorAlert,
  getColor,
  getSellColor,
  getScannerColor,
} from "./lib/discord.js";
import { calculateProfit } from "./lib/profit.js";
import { buildBuyPricingPlan } from "./lib/pricing.js";
import { buildMoneyPlan } from "./lib/edge.js";

import { loadState, saveState, updateItemHistory } from "./lib/state.js";
import { getTrackedItemIds } from "./lib/trackedItems.js";
import { getItemMap, getMarketValues } from "./lib/market.js";
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
  ENABLE_LOW_CONVICTION_CANDIDATES,
  LOW_CONVICTION_MIN_BRAIN_SCORE,
  LOW_CONVICTION_MIN_TRADEABILITY,
  LOW_CONVICTION_MIN_VOLUME_RATIO,
  LOW_CONVICTION_MAX_FAKE_SPREAD_RISK,
  VOLATILITY_HISTORY_WINDOW,
  VOLATILITY_ITEM_SPIKE_CAP,
  VOLATILITY_HIGH_THRESHOLD,
  VOLATILITY_MEDIUM_THRESHOLD,
  FLIPS_DEBUG_REJECTIONS,
  EMPTY_SUMMARY_TOP_REJECTIONS,
  SCORE_DROP_WARNING,
  SCORE_DROP_PANIC,
  BATCH_SIZE,
} from "./lib/constants.js";
import { loadPositions, getOpenPositionForItem } from "./lib/positions.js";

const DISCORD_WEBHOOK_URL = process.env.TIBIA_FLIPS_WEBHOOK_URL;

const ITEM_IDS = getTrackedItemIds();

function getNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getExpectedFillSpeed(item) {
  const daySold = getNumber(item.daySold);
  const monthSold = getNumber(item.monthSold);
  const avgDaily = monthSold > 0 ? monthSold / 30 : 0;
  const pace = Math.max(daySold, avgDaily);

  if (pace >= 60) return { label: "VERY FAST", days: "<1", score: 95 };
  if (pace >= 25) return { label: "FAST", days: "1–2", score: 82 };
  if (pace >= 8) return { label: "NORMAL", days: "2–4", score: 65 };
  if (pace >= 3) return { label: "SLOW", days: "4–8", score: 42 };
  if (pace > 0) return { label: "VERY SLOW", days: "8+", score: 20 };
  return { label: "UNKNOWN", days: "?", score: 0 };
}

function calculateSignalConfidence(item, checks = {}) {
  let confidence = 50;

  confidence += clamp((getNumber(item.brainScore) - 70) * 0.7, -20, 20);
  confidence += clamp((getNumber(item.tradeabilityScore) - 55) * 0.6, -18, 18);
  confidence += clamp((getNumber(item.volumeRatio) - 0.7) * 18, -14, 18);
  confidence += clamp((getNumber(item.profitPercent) - 4) * 2, -10, 16);
  confidence -= clamp(getNumber(item.fakeSpreadRisk) * 0.45, 0, 35);
  confidence -= clamp(getNumber(item.marketPressure) * 0.25, 0, 25);

  if (item.conviction === "HIGH CONVICTION TRADE") confidence += 12;
  if (item.conviction === "MEDIUM CONVICTION TRADE") confidence += 5;
  if (item.conviction === "LOW CONVICTION") confidence -= 8;
  if (item.conviction === "AVOID / TRAP RISK") confidence -= 35;
  if (item.fallingHard) confidence -= 18;
  if (checks.isResearchCandidate) confidence = Math.min(confidence, 74);
  if (checks.isCleanBuy) confidence = Math.max(confidence, 76);

  return Math.round(clamp(confidence, 0, 100));
}

function getSignalClass(item, checks = {}) {
  if (checks.isCleanBuy) return "CLEAN_BUY";
  if (checks.isResearchCandidate) return "BUY_CANDIDATE";
  if (
    item.conviction === "AVOID / TRAP RISK" ||
    getNumber(item.fakeSpreadRisk) >= 55
  ) {
    return "AVOID";
  }
  return "WATCH";
}

function getRejectionReasons(item, checks) {
  const reasons = [];

  if (!checks.hasGoodLiquidity) reasons.push("liquidity too weak");
  if (!checks.hasSafeSpread) reasons.push("fake/spiky spread risk");
  if (!checks.hasHealthyVolume) reasons.push("volume below threshold");
  if (!checks.hasGoodProfit) reasons.push("profit too small");
  if (!checks.hasGoodBrain) reasons.push("Brain Score too low");
  if (!checks.hasGoodConviction && !checks.isResearchCandidate) {
    reasons.push("conviction too low");
  }
  if (!checks.notFalling) reasons.push("price is falling");
  if (!["BUY", "WATCH"].includes(item.decision))
    reasons.push(`decision is ${item.decision}`);
  if (["HIGH", "EXTREME"].includes(item.marketPressureLevel)) {
    reasons.push(`market pressure ${item.marketPressureLevel}`);
  }
  if (item.hasOpenPosition) reasons.push("already has open position");

  return reasons;
}

function calculateMarketVolatility(items, state) {
  const itemScores = [];

  items.forEach((item) => {
    const history = state.items[String(item.id)];
    if (!history || history.length < 3) return;

    const recent = history.slice(-VOLATILITY_HISTORY_WINDOW);
    const moves = [];

    for (let i = 1; i < recent.length; i++) {
      const previous = recent[i - 1];
      const current = recent[i];

      const previousSell = getNumber(previous.sellOffer);
      const currentSell = getNumber(current.sellOffer);
      const previousBuy = getNumber(previous.buyOffer);
      const currentBuy = getNumber(current.buyOffer);
      const previousProfitPercent = getNumber(previous.profitPercent);
      const currentProfitPercent = getNumber(current.profitPercent);

      const sellMove =
        previousSell > 0
          ? Math.abs((currentSell - previousSell) / previousSell) * 100
          : 0;
      const buyMove =
        previousBuy > 0
          ? Math.abs((currentBuy - previousBuy) / previousBuy) * 100
          : 0;
      const profitMove = Math.abs(currentProfitPercent - previousProfitPercent);

      moves.push(sellMove * 0.45 + buyMove * 0.25 + profitMove * 0.3);
    }

    if (moves.length === 0) return;

    const averageMove =
      moves.reduce((sum, value) => sum + value, 0) / moves.length;
    const cappedMove = Math.min(averageMove, VOLATILITY_ITEM_SPIKE_CAP);
    const liquidityWeight =
      getNumber(item.monthSold) >= 500
        ? 1.15
        : getNumber(item.monthSold) >= 100
          ? 1
          : 0.75;

    itemScores.push(cappedMove * liquidityWeight);
  });

  if (itemScores.length === 0) return 0;

  const average =
    itemScores.reduce((sum, value) => sum + value, 0) / itemScores.length;
  return Math.round(average);
}

function getNextRunRecommendation(volatility) {
  if (volatility >= VOLATILITY_HIGH_THRESHOLD) {
    return {
      level: "HIGH",
      nextRunHours: 1,
      message: "Market is active. Check frequently, but avoid chasing spikes.",
    };
  }

  if (volatility >= VOLATILITY_MEDIUM_THRESHOLD) {
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
  const hasSafeSpread = item.fakeSpreadRisk < MAX_SIMPLE_BUY_FAKE_SPREAD_RISK;
  const hasHealthyVolume = item.volumeRatio >= MIN_SIMPLE_BUY_VOLUME_RATIO;
  const hasGoodProfit =
    item.profit >= MIN_PROFIT &&
    item.profitPercent >= MIN_SIMPLE_BUY_PROFIT_PERCENT;
  const hasGoodBrain = item.brainScore >= MIN_SIMPLE_BUY_BRAIN_SCORE;
  const hasGoodConviction =
    ["HIGH CONVICTION TRADE", "MEDIUM CONVICTION TRADE"].includes(
      item.conviction,
    ) && item.tradeabilityScore >= 60;
  const isResearchCandidate =
    ENABLE_LOW_CONVICTION_CANDIDATES &&
    item.conviction === "LOW CONVICTION" &&
    item.brainScore >= LOW_CONVICTION_MIN_BRAIN_SCORE &&
    item.tradeabilityScore >= LOW_CONVICTION_MIN_TRADEABILITY &&
    item.fakeSpreadRisk <= LOW_CONVICTION_MAX_FAKE_SPREAD_RISK &&
    item.volumeRatio >= LOW_CONVICTION_MIN_VOLUME_RATIO;
  const notFalling = !item.fallingHard;

  const checks = {
    hasGoodLiquidity,
    hasSafeSpread,
    hasHealthyVolume,
    hasGoodProfit,
    hasGoodBrain,
    hasGoodConviction,
    isResearchCandidate,
    notFalling,
  };

  const basePass =
    ["BUY", "WATCH"].includes(item.decision) &&
    hasGoodLiquidity &&
    hasSafeSpread &&
    hasHealthyVolume &&
    hasGoodProfit &&
    hasGoodBrain &&
    notFalling &&
    !item.hasOpenPosition &&
    !["HIGH", "EXTREME"].includes(item.marketPressureLevel);

  const isCleanBuy = basePass && hasGoodConviction;
  const isCandidate = basePass && isResearchCandidate;

  item.signalClass = getSignalClass(item, {
    isCleanBuy,
    isResearchCandidate: isCandidate,
  });
  item.signalConfidence = calculateSignalConfidence(item, {
    isCleanBuy,
    isResearchCandidate: isCandidate,
  });
  item.fillSpeed = getExpectedFillSpeed(item);
  item.rejectionReasons = getRejectionReasons(item, checks);

  if (isCleanBuy) {
    item.reason =
      "Clean BUY: strong conviction, healthy liquidity, safe spread, and acceptable profit.";
  } else if (isCandidate) {
    item.reason =
      "Numbers look good, but this is not safe enough for an automatic BUY.";
  } else if (!item.reason) {
    item.reason = item.rejectionReasons.length
      ? `Rejected: ${item.rejectionReasons.join(", ")}.`
      : "Rejected by conservative BUY filter.";
  }

  if (FLIPS_DEBUG_REJECTIONS && !isCleanBuy && !isCandidate) {
    console.log(`
REJECTED: ${item.name}
------------------------
Decision: ${item.decision}
Brain: ${item.brainScore}
Liquidity: day=${item.daySold} month=${item.monthSold}
Volume ratio: ${item.volumeRatio}
Fake spread: ${item.fakeSpreadRisk}
Profit: ${item.profit}
Profit %: ${item.profitPercent}
Min profit needed: ${MIN_PROFIT}
Tradeability: ${item.tradeabilityScore}
Conviction: ${item.conviction}
Pressure: ${item.marketPressureLevel}
Falling: ${item.fallingHard}
Reasons: ${item.rejectionReasons.join(" | ") || "unknown"}
`);
  }

  return isCleanBuy || isCandidate;
}

function getSellDecision(item, state) {
  const position = getOpenPositionForItem(item.id);

  if (!position) {
    return {
      hasOpenPosition: false,
      trackedTargetSell: item.targetSell,
      previousBrainScore: item.brainScore,
      scoreDrop: 0,
      sellLevel: null,
      sellDecision: "HOLD",
      sellAction: "No sell signal.",
      sellReason: "No open position in positions.json.",
    };
  }

  const entryPrice = Number(position.entryPrice || 0);
  const quantity = Number(position.quantity || 1);

  const desiredMargin = Number(position.desiredMargin ?? 0.06);

  const trackedTargetSell =
    Number(position.targetSell) ||
    Math.ceil((entryPrice * (1 + desiredMargin)) / (1 - TAX_RATE));

  const previousBrainScore =
    Number(position.entryBrainScore) || item.brainScore;

  const scoreDrop = previousBrainScore - item.brainScore;

  const currentNetSell = item.sellOffer * (1 - TAX_RATE);
  const currentProfitEach = currentNetSell - entryPrice;
  const currentProfitTotal = currentProfitEach * quantity;
  const currentProfitPercent =
    entryPrice > 0 ? (currentProfitEach / entryPrice) * 100 : 0;

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
  let sellReason = "Open position exists, but no strong exit signal.";

  if (exitRisk && (scorePanic || momentumBad)) {
    sellLevel = "PANIC";
    sellDecision = "SELL";
    sellAction = "SELL / EXIT. Position got dangerous.";
    sellReason = "Risk got bad and momentum/Brain Score collapsed.";
  } else if (targetHit) {
    sellLevel = "SELL_NOW";
    sellDecision = "SELL";
    sellAction = `SELL / LIST now around ${formatGp(item.sellOffer)} gp.`;
    sellReason = `Target reached: ${formatGp(trackedTargetSell)} gp.`;
  } else if (momentumDropping && currentProfitPercent > 0) {
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
    hasOpenPosition: true,
    position,
    entryPrice,
    quantity,
    trackedTargetSell,
    previousBrainScore,
    scoreDrop,
    currentProfitEach,
    currentProfitTotal,
    currentProfitPercent,
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
    maxBuy: item.maxRealisticBuy || item.maxBuy,
    targetSell: item.realisticExit || item.targetSell,
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
  if (item.signalClass === "BUY_CANDIDATE") {
    return `🟡 BUY CANDIDATE — ${item.name} — RESEARCH`;
  }

  if (item.signalConfidence >= 88 || item.brainScore >= 90) {
    return `🟢 BUY — ${item.name} — VERY STRONG`;
  }

  if (item.signalConfidence >= 76 || item.brainScore >= 75) {
    return `🟢 BUY — ${item.name} — STRONG`;
  }

  return `🟡 BUY — ${item.name} — GOOD`;
}

function getReadableTradeQuality(conviction) {
  if (conviction === "HIGH CONVICTION TRADE") {
    return "Very reliable";
  }

  if (conviction === "MEDIUM CONVICTION TRADE") {
    return "Reasonable setup";
  }

  if (conviction === "LOW CONVICTION") {
    return "Needs caution";
  }

  if (conviction === "AVOID / TRAP RISK") {
    return "Likely dangerous";
  }

  return conviction || "Unknown";
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

function buildRejectionSummary(items) {
  const rejected = items
    .filter(
      (item) => !["CLEAN_BUY", "BUY_CANDIDATE"].includes(item.signalClass),
    )
    .map((item) => ({
      item,
      sortScore:
        getNumber(item.brainScore) * 2 +
        getNumber(item.tradeabilityScore) * 2 +
        getNumber(item.profitPercent) * 3 +
        getNumber(item.profit) / 1000 -
        getNumber(item.fakeSpreadRisk) * 2,
    }))
    .sort((a, b) => b.sortScore - a.sortScore)
    .slice(0, EMPTY_SUMMARY_TOP_REJECTIONS);

  if (rejected.length === 0) return "No near-misses found.";

  return rejected
    .map(({ item }, index) => {
      const reasons = (item.rejectionReasons || ["unknown"])
        .slice(0, 3)
        .join(", ");
      return `${index + 1}. **${item.name}** — Brain ${item.brainScore}, Tradeability ${item.tradeabilityScore}, Profit ${formatGp(item.profit)} gp (${item.profitPercent.toFixed(2)}%) — ${reasons}`;
    })
    .join("\n");
}



let positionExposureCache = null;

function getPositionExposureMap() {
  if (positionExposureCache) return positionExposureCache;

  const map = new Map();

  if (!fs.existsSync("positions.json")) {
    positionExposureCache = map;
    return map;
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync("positions.json", "utf8"));
  } catch {
    positionExposureCache = map;
    return map;
  }

  for (const position of data.positions || []) {
    const status = String(position.status || "").toUpperCase();

    if (
      status === "CLOSED" ||
      status === "SOLD" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "BUY_ORDER_CANCELLED" ||
      status === "BUY_ORDER_EXPIRED"
    ) {
      continue;
    }

    const id = String(position.id || "");
    if (!id) continue;

    const entryPrice = getNumber(position.entryPrice || position.averageEntryPrice);
    const ordered = getNumber(position.orderedQuantity || position.originalQuantity);
    const received = getNumber(position.receivedQuantity);
    const owned = getNumber(position.quantity);
    const listed = getNumber(position.listedQuantity);
    const buyFee = getNumber(position.buyOfferFeePaid);
    const sellFee = getNumber(position.sellOfferFeePaid);
    const lastListPrice = getNumber(position.lastListPrice || position.targetSell);

    let waiting = getNumber(position.waitingQuantity || position.waiting);

    if (!waiting && status.includes("BUY_ORDER")) {
      waiting = Math.max(0, ordered - received);
    }

    const capitalLocked =
      waiting * entryPrice +
      owned * entryPrice +
      buyFee +
      sellFee;

    const listedValue = listed * lastListPrice;

    if (!map.has(id)) {
      map.set(id, {
        id,
        name: position.name,
        positions: 0,
        waiting: 0,
        owned: 0,
        listed: 0,
        capitalLocked: 0,
        listedValue: 0,
        hasOpenBuyOrder: false,
        statuses: new Set(),
      });
    }

    const exposure = map.get(id);

    exposure.positions += 1;
    exposure.waiting += waiting;
    exposure.owned += owned;
    exposure.listed += listed;
    exposure.capitalLocked += capitalLocked;
    exposure.listedValue += listedValue;
    exposure.hasOpenBuyOrder = exposure.hasOpenBuyOrder || status.includes("BUY_ORDER");
    exposure.statuses.add(status);
  }

  positionExposureCache = map;
  return map;
}

function getItemExposure(itemId) {
  return getPositionExposureMap().get(String(itemId)) || {
    positions: 0,
    waiting: 0,
    owned: 0,
    listed: 0,
    capitalLocked: 0,
    listedValue: 0,
    hasOpenBuyOrder: false,
    statuses: new Set(),
  };
}

function getExposureGuard(item, plan) {
  const exposure = getItemExposure(item.id);
  const maxItemCapital = Number(process.env.FLIPPER_MAX_ITEM_CAPITAL || 300000);
  const newCapital = getNumber(plan?.capital?.capitalLocked);
  const combinedCapital = exposure.capitalLocked + newCapital;
  const totalQty = exposure.waiting + exposure.owned + exposure.listed;

  const warnings = [];

  if (totalQty > 0 || exposure.positions > 0 || exposure.capitalLocked > 0) {
    warnings.push(
      "Already exposed: waiting " +
        exposure.waiting +
        ", owned " +
        exposure.owned +
        ", listed " +
        exposure.listed +
        "."
    );
  }

  if (exposure.hasOpenBuyOrder) {
    warnings.push("You already have an open buy order for this item.");
  }

  if (totalQty >= getNumber(plan?.capital?.qty)) {
    warnings.push("Do not add more unless intentional.");
  }

  if (combinedCapital >= maxItemCapital) {
    warnings.push(
      "Combined capital would be ~" +
        formatGp(combinedCapital) +
        " gp, above item cap " +
        formatGp(maxItemCapital) +
        " gp."
    );
  }

  return {
    exposure,
    maxItemCapital,
    newCapital,
    combinedCapital,
    totalQty,
    warnings,
    hasWarning: warnings.length > 0,
  };
}

function getExposureConsoleText(item, plan) {
  const guard = getExposureGuard(item, plan);

  if (!guard.hasWarning) {
    return (
      "Exposure guard: no open exposure found for this item. New capital: ~" +
      formatGp(guard.newCapital) +
      " gp.\n"
    );
  }

  return (
    "Exposure guard: ⚠️ CHECK BEFORE ADDING MORE\n" +
    "- " +
    guard.warnings.join("\n- ") +
    "\nCapital already locked: ~" +
    formatGp(guard.exposure.capitalLocked) +
    " gp | New capital: ~" +
    formatGp(guard.newCapital) +
    " gp | Combined: ~" +
    formatGp(guard.combinedCapital) +
    " gp\n"
  );
}

function getExposureDiscordText(item, plan) {
  const guard = getExposureGuard(item, plan);

  if (!guard.hasWarning) {
    return (
      "No open exposure found. New capital: **~" +
      formatGp(guard.newCapital) +
      " gp**."
    );
  }

  return (
    "⚠️ **CHECK BEFORE ADDING MORE**\n" +
    guard.warnings.map((warning) => "• " + warning).join("\n") +
    "\nCapital already locked: **~" +
    formatGp(guard.exposure.capitalLocked) +
    " gp**\nNew capital: **~" +
    formatGp(guard.newCapital) +
    " gp**\nCombined: **~" +
    formatGp(guard.combinedCapital) +
    " gp**"
  );
}

function getBuyFee(price, qty) {
  return Math.ceil(Number(price || 0) * Number(qty || 0) * TAX_RATE);
}

function getFlipperQualityScore(item) {
  return Math.round(
    clamp(
      getNumber(item.brainScore) * 0.32 +
        getNumber(item.tradeabilityScore) * 0.28 +
        getNumber(item.volumeRatio) * 10 +
        getNumber(item.realisticProfitPercent || item.profitPercent) * 2.2 -
        getNumber(item.fakeSpreadRisk) * 0.35 -
        getNumber(item.marketPressure) * 0.18,
      0,
      100,
    ),
  );
}

function getFlipperQualityLabel(item) {
  const score = getFlipperQualityScore(item);

  if (score >= 85 && item.signalConfidence >= 85) return "ELITE";
  if (score >= 74) return "STRONG";
  if (score >= 62) return "DECENT";
  if (score >= 48) return "WATCH ONLY";
  return "WEAK";
}

function getCapitalPlan(item) {
  const qty = Number(item.recommendedQty || 1);
  const maxBuy = Number(item.maxRealisticBuy || item.maxBuy || item.buyOffer || 0);
  const sellTarget = Number(item.realisticExit || item.targetSell || item.sellOffer || 0);
  const buyFee = getBuyFee(maxBuy, qty);
  const capitalLocked = maxBuy * qty + buyFee;
  const expectedProfitTotal = Number(item.realisticProfit || item.profit || 0) * qty;

  return {
    qty,
    maxBuy,
    sellTarget,
    buyFee,
    capitalLocked,
    expectedProfitTotal,
  };
}

function getEntryRange(item) {
  const maxBuy = Number(item.maxRealisticBuy || item.maxBuy || item.buyOffer || 0);

  if (!maxBuy) {
    return {
      low: 0,
      high: 0,
      text: "unknown",
    };
  }

  const low = Math.max(1, Math.floor(maxBuy * 0.985));
  const high = maxBuy;

  return {
    low,
    high,
    text: low === high ? formatGp(high) + " gp" : formatGp(low) + "–" + formatGp(high) + " gp",
  };
}

function getManualChecks(item) {
  const checks = [];

  checks.push("Check that the lowest sell offer is real and not only 1 overpriced item.");
  checks.push("Check how many items are ahead of your buy offer.");

  if (getNumber(item.fakeSpreadRisk) >= 25) {
    checks.push("Fake spread risk is not tiny — verify manually before buying.");
  }

  if (getNumber(item.volumeRatio) < 1) {
    checks.push("Volume is below ideal — do not buy too much.");
  }

  if (["HIGH", "EXTREME"].includes(item.marketPressureLevel)) {
    checks.push("Seller pressure is high — be extra patient.");
  }

  if (item.fillSpeed?.label && !["VERY FAST", "FAST"].includes(item.fillSpeed.label)) {
    checks.push("Exit may not be fast — avoid overstock.");
  }

  return checks;
}

function buildQualityActionPlan(item) {
  const capital = getCapitalPlan(item);
  const entry = getEntryRange(item);
  const quality = getFlipperQualityLabel(item);
  const score = getFlipperQualityScore(item);
  const checks = getManualChecks(item);

  let action = "BUY OFFER OK";

  if (quality === "ELITE") action = "BUY OFFER OK — HIGH PRIORITY";
  else if (quality === "STRONG") action = "BUY OFFER OK — PATIENT";
  else if (quality === "DECENT") action = "SMALL TEST ONLY";
  else action = "WATCH ONLY";

  if (item.signalClass === "BUY_CANDIDATE") {
    action = "RESEARCH / SMALL TEST ONLY";
  }

  return {
    quality,
    score,
    action,
    entry,
    capital,
    checks,
  };
}

function getNearMissScore(item) {
  return (
    getNumber(item.brainScore) * 2 +
    getNumber(item.tradeabilityScore) * 1.8 +
    getNumber(item.realisticProfitPercent || item.profitPercent) * 3 +
    getNumber(item.realisticProfit || item.profit) / 600 -
    getNumber(item.fakeSpreadRisk) * 1.8 -
    getNumber(item.marketPressure) * 0.8
  );
}

function getNearMisses(analyzedItems, buySignals) {
  const buyIds = new Set(buySignals.map((item) => String(item.id)));

  return analyzedItems
    .filter((item) => !buyIds.has(String(item.id)))
    .filter((item) => Number(item.profit || 0) > 0)
    .filter((item) => Number(item.sellOffer || 0) > 0)
    .map((item) => ({
      item,
      score: getNearMissScore(item),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => item);
}

function printQualityBuySignal(item) {
  const plan = buildQualityActionPlan(item);
  const exposureText = getExposureConsoleText(item, plan);

  console.log(
    "BUY " + item.name + " (ID: " + item.id + ")\n" +
      "Quality: " + plan.quality + " / " + plan.score + "/100 | Confidence: " + item.signalConfidence + "/100\n" +
      "Action: " + plan.action + "\n" +
      "Entry range: " + plan.entry.text + " | Hard max: " + formatGp(plan.capital.maxBuy) + " gp\n" +
      "Sell target: " + formatGp(plan.capital.sellTarget) + " gp | Qty: " + plan.capital.qty + "\n" +
      "Capital locked: ~" + formatGp(plan.capital.capitalLocked) + " gp including buy fee\n" +
      "Expected profit total: ~" + formatGp(plan.capital.expectedProfitTotal) + " gp\n" +
      "Profit each: " + formatGp(item.realisticProfit || item.profit) + " gp (" +
        Number(item.realisticProfitPercent || item.profitPercent || 0).toFixed(2) + "%)\n" +
      "Exit speed: " + (item.fillSpeed?.label || "UNKNOWN") + " | expected days: " + (item.fillSpeed?.days || "?") + "\n" +
      "Brain: " + item.brainScore + "/100 | Tradeability: " + item.tradeabilityScore + "/100 | Fake spread: " + item.fakeSpreadRisk + "/100\n" +
      "Reason: " + item.reason + "\n" +
      "Manual checks:\n- " + plan.checks.slice(0, 4).join("\n- ") + "\n" +
      exposureText,
  );
}


function getManualSnipeChecks(analyzedItems, buySignals) {
  const buyIds = new Set(buySignals.map((item) => String(item.id)));

  const minProfit = Number(process.env.FLIPPER_SNIPE_MIN_PROFIT || 50000);
  const minSellPrice = Number(
    process.env.FLIPPER_SNIPE_MIN_SELL ||
      process.env.SNIPE_MIN_SELL_PRICE ||
      100000,
  );

  return analyzedItems
    .filter((item) => !buyIds.has(String(item.id)))
    .filter((item) => {
      const profit = getNumber(item.realisticProfit || item.profit);
      const sellPrice = getNumber(item.sellOffer || item.realisticExit || item.targetSell);
      const risk = getNumber(item.fakeSpreadRisk);
      const volume = getNumber(item.volumeRatio);
      const pressure = String(item.marketPressureLevel || "").toUpperCase();

      const expensiveEnough = sellPrice >= minSellPrice || profit >= minProfit;
      const meaningfulProfit = profit >= minProfit;
      const needsManualReview =
        risk >= 60 ||
        volume <= 0.25 ||
        pressure === "HIGH" ||
        pressure === "EXTREME" ||
        getNumber(item.brainScore) <= 25;

      return expensiveEnough && meaningfulProfit && needsManualReview;
    })
    .sort((a, b) => {
      const aProfit = getNumber(a.realisticProfit || a.profit);
      const bProfit = getNumber(b.realisticProfit || b.profit);
      return bProfit - aProfit;
    })
    .slice(0, 5);
}

function printManualSnipeChecks(analyzedItems, buySignals) {
  const items = getManualSnipeChecks(analyzedItems, buySignals);

  if (items.length === 0) return;

  console.log("\nMANUAL SNIPE CHECK / HIGH VALUE BUT RISKY");
  console.log("----------------------------------------");
  console.log("These are NOT automatic BUY signals. Open Tibia Market and verify manually.\n");

  items.forEach((item, index) => {
    const profit = getNumber(item.realisticProfit || item.profit);
    const profitPercent = getNumber(item.realisticProfitPercent || item.profitPercent);
    const sellPrice = getNumber(item.sellOffer || item.realisticExit || item.targetSell);

    const reasons = (item.rejectionReasons || ["manual verification required"])
      .slice(0, 4)
      .join(" | ");

    console.log(
      "#" + (index + 1) + " " + item.name + " (ID: " + item.id + ")\n" +
        "Possible profit: ~" + formatGp(profit) + " gp (" + profitPercent.toFixed(2) + "%)\n" +
        "Observed sell/reference: " + formatGp(sellPrice) + " gp\n" +
        "Risk: " + item.fakeSpreadRisk + "/100 | Volume: " + Number(item.volumeRatio || 0).toFixed(2) + "x" +
        " | Pressure: " + item.marketPressureLevel + "\n" +
        "Why manual only: " + reasons + "\n" +
        "Manual action: check real lowest sell, quantity, recent market history, and whether you can actually exit.\n",
    );
  });
}

function printNearMisses(analyzedItems, buySignals) {
  const manualSnipeIds = new Set(
    getManualSnipeChecks(analyzedItems, buySignals).map((item) => String(item.id)),
  );

  const nearMisses = getNearMisses(analyzedItems, buySignals)
    .filter((item) => !manualSnipeIds.has(String(item.id)));

  if (nearMisses.length === 0) return;

  console.log("\nNEAR MISSES / WATCHLIST");
  console.log("-----------------------");

  nearMisses.forEach((item, index) => {
    const reasons = (item.rejectionReasons || ["unknown"])
      .slice(0, 3)
      .join(" | ");

    console.log(
      "#" + (index + 1) + " " + item.name + " (ID: " + item.id + ")\n" +
        "Brain: " + item.brainScore + " | Tradeability: " + item.tradeabilityScore +
        " | Profit: " + formatGp(item.realisticProfit || item.profit) + " gp (" +
        Number(item.realisticProfitPercent || item.profitPercent || 0).toFixed(2) + "%)\n" +
        "Risk: " + item.fakeSpreadRisk + " | Volume: " + Number(item.volumeRatio || 0).toFixed(2) + "x" +
        " | Pressure: " + item.marketPressureLevel + "\n" +
        "Why not BUY: " + reasons + "\n",
    );
  });
}


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
  const projectPath =
    process.env.ACCEPT_BUY_PROJECT_PATH ||
    "C:\\Users\\Avner\\Desktop\\Projects\\tibia-price-alert";

  return (
    "After you actually place this Buy Offer in Tibia Market, paste this in PowerShell/CMD:\n" +
    "```powershell\n" +
    "cd " + quotePowerShellArg(projectPath) + "\n" +
    command +
    "\n```\n" +
    "**Do not run it before placing the offer in Tibia.**"
  );
}

function readPendingBuySignals() {
  if (!fs.existsSync("pending-buy-signals.json")) {
    return {
      version: 1,
      signals: [],
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync("pending-buy-signals.json", "utf8"));

    if (Array.isArray(data)) {
      return {
        version: 1,
        signals: data,
      };
    }

    return {
      version: 1,
      signals: Array.isArray(data.signals) ? data.signals : [],
    };
  } catch {
    return {
      version: 1,
      signals: [],
    };
  }
}

function writePendingBuySignals(data) {
  fs.writeFileSync("pending-buy-signals.json", JSON.stringify(data, null, 2) + "\n");
}

function makePendingBuySignal(item) {
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
  const expectedProfitTotal =
    Number(plan?.capital?.expectedProfitTotal || expectedProfitEach * qty || 0);

  return {
    id: String(item.id),
    itemId: Number(item.id),
    name: item.name,
    source: "FLIPPER",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),

    qty,
    buyPrice,
    hardMaxBuy: buyPrice,
    targetSell,

    expectedProfitEach,
    expectedProfitTotal,
    expectedRoiPercent: Number(item.realisticProfitPercent || item.profitPercent || 0),

    quality: plan?.quality || null,
    qualityScore: plan?.score || null,
    confidence: Number(item.signalConfidence || 0),
    brainScore: Number(item.brainScore || 0),
    tradeabilityScore: Number(item.tradeabilityScore || 0),
    fakeSpreadRisk: Number(item.fakeSpreadRisk || 0),
    marketPressureLevel: item.marketPressureLevel || null,
    reason: item.reason || null,

    commandHint:
      "After placing this in Tibia Market: BAT -> Accept BUY Signal",
    acceptBuyCommand: getAcceptBuyCommand(item),
  };
}

function savePendingBuySignals(buySignals) {
  if (!Array.isArray(buySignals) || buySignals.length === 0) return;

  const data = readPendingBuySignals();
  data.version = 1;
  data.signals = Array.isArray(data.signals) ? data.signals : [];

  let added = 0;
  let updated = 0;

  for (const item of buySignals) {
    const next = makePendingBuySignal(item);

    if (!next.itemId || !next.name || !next.buyPrice || !next.qty) {
      continue;
    }

    const existing = data.signals.find((signal) => {
      return (
        String(signal.itemId || signal.id) === String(next.itemId) &&
        String(signal.status || "PENDING").toUpperCase() === "PENDING"
      );
    });

    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...next,
        createdAt: existing.createdAt || next.createdAt,
        updatedAt: new Date().toISOString(),
      });
      updated++;
    } else {
      data.signals.push(next);
      added++;
    }
  }

  data.signals.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  writePendingBuySignals(data);

  if (added || updated) {
    console.log(
      "Saved pending BUY signals: " +
        added +
        " added, " +
        updated +
        " updated. Use BAT -> Accept BUY Signal after placing the offer in Tibia.",
    );
  }
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

  function getHumanTradeRead(item) {
    if (
      item.tradeLabels?.includes("OVEREXTENDED") &&
      item.tradeLabels?.includes("EASY EXIT")
    ) {
      return "Easy to resell, but current price already looks high.";
    }

    if (
      item.tradeLabels?.includes("UNDERCUT WAR") ||
      item.marketPressureLevel === "HIGH"
    ) {
      return "Too much seller pressure right now.";
    }

    if (
      item.tradeLabels?.includes("TRUSTWORTHY SPREAD") &&
      item.volumeRatio >= 1
    ) {
      return "Market looks healthy and active.";
    }

    if (item.fakeSpreadRisk >= 40) {
      return "Spread may be misleading or unstable.";
    }

    if (item.volumeRatio < 0.6) {
      return "Could be hard to resell quickly.";
    }

    if (item.brainScore >= 85) {
      return "Strong setup overall, but still watch the market closely.";
    }

    return "Mixed signals. Worth watching carefully.";
  }

  const embeds = alertable.slice(0, 5).map((item) => ({
    title: buildSimpleBuyTitle(item),
    color: getColor(item.brainScore),
    fields: [
      {
        name: "👉 ACTION",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "**" + plan.action + "**\n" +
            "Entry range: **" + plan.entry.text + "**\n" +
            "Hard max: **" + formatGp(plan.capital.maxBuy) + " gp**"
          );
        })(),
        inline: false,
      },
      {
        name: "🎚️ QUALITY PLAN",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "Quality: **" + plan.quality + "** (" + plan.score + "/100)\n" +
            "Exit speed: **" + (item.fillSpeed?.label || "UNKNOWN") + "** / " + (item.fillSpeed?.days || "?") + " days\n" +
            "Manual check: " + plan.checks[0]
          );
        })(),
        inline: false,
      },
      {
        name: "💼 CAPITAL",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return (
            "Qty: **" + plan.capital.qty + "**\n" +
            "Locked: **~" + formatGp(plan.capital.capitalLocked) + " gp**\n" +
            "Expected total profit: **~" + formatGp(plan.capital.expectedProfitTotal) + " gp**"
          );
        })(),
        inline: true,
      },
      {
        name: "🧯 EXPOSURE GUARD",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return getExposureDiscordText(item, plan);
        })(),
        inline: false,
      },
      {
        name: "📋 COPY-PASTE ACCEPT COMMAND",
        value: getAcceptBuyDiscordValue(item),
        inline: false,
      },
      {
        name: "🎯 SELL TARGET",
        value: `Realistic exit around **${formatGp(item.realisticExit || item.targetSell)} gp**. Desired margin: ${item.desiredMarginPercent?.toFixed?.(1) || "?"}%.`,
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
        name: "📈 TRADE READ",
        value: getHumanTradeRead(item),
        inline: false,
      },
      {
        name: "💰 REALISTIC PROFIT",
        value:
          `Expected: **${formatGp(item.realisticProfit)} gp**\n` +
          `Percent: **${item.realisticProfitPercent.toFixed(2)}%**`,
        inline: true,
      },
      {
        name: "📊 WHY",
        value:
          `${item.reason}\n` +
          `${item.recommendation}\n` +
          `Trend: ${item.dayVsMonthSell.toFixed(2)}% | Volume: ${item.volumeRatio.toFixed(2)}x\n` +
          `Fake spread risk: ${item.fakeSpreadRisk}/100`,
        inline: false,
      },
      {
        name: "🌊 MARKET PRESSURE",
        value:
          `Level: **${item.marketPressureLevel}**\n` +
          `Score: **${item.marketPressure}/100**\n` +
          `${item.marketPressureReasons.slice(0, 2).join("\n") || "No major pressure detected."}\n` +
          `${(item.tradeWarnings || []).slice(0, 2).join("\n")}`,
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
    content: `🟢 Tibia Flipper BUY signals on **${SERVER}** (${alertable.length} alert${alertable.length === 1 ? "" : "s"})`,
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
        name: "📦 POSITION",
        value:
          `Based on OPEN position in positions.json.\n` +
          `Entry: **${formatGp(item.entryPrice)} gp**\n` +
          `Quantity: **${item.quantity}**\n` +
          `Current net profit: **${formatGp(item.currentProfitEach)} gp each** ` +
          `(**${item.currentProfitPercent.toFixed(2)}%**)`,
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
    (item.edgeScore || 0) * 1200000 +
    item.scannerScore * 1000000 +
    (confidenceRank[item.exitConfidence] || 0) * 100000 +
    (classRank[item.marketClass] || 0) * 10000 +
    item.monthSold * 10 +
    Math.max(item.profit, 0) / 1000 -
    (item.marketPressure || 0) * 50000
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

      const moneyPlan = buildMoneyPlan(withScanner);

      return {
        ...withScanner,
        ...moneyPlan,
        scannerTier: getScannerTier({ ...withScanner, ...moneyPlan }),
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
    console.error("Missing TIBIA_FLIPS_WEBHOOK_URL");
    process.exit(1);
  }

  const items = await getMarketValues(ITEM_IDS);
  const itemMap = getItemMap();
  const state = loadState();
  const positionsData = loadPositions();

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

    const buyPricingPlan = buildBuyPricingPlan({
      ...item,
      ...decisionData,
      ...fakeRiskData,
      buyOffer: item.buy_offer,
      sellOffer: item.sell_offer,
      dayAverageSell: item.day_average_sell || 0,
      monthAverageSell: item.month_average_sell || 0,
      monthSold: item.month_sold || 0,
    });

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
      ...buyPricingPlan,
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

    const withMoneyPlan = {
      ...withConviction,
      ...buildMoneyPlan(withConviction),
    };

    const openPosition = getOpenPositionForItem(item.id);

    const withPosition = openPosition
      ? {
          ...withMoneyPlan,
          position: {
            ...openPosition,

            currentSellOffer: withPressure.sellOffer,
            currentBuyOffer: withPressure.buyOffer,

            currentProfitEach:
              withPressure.sellOffer * (1 - TAX_RATE) - openPosition.entryPrice,

            currentProfitPercent:
              openPosition.entryPrice > 0
                ? ((withPressure.sellOffer * (1 - TAX_RATE) -
                    openPosition.entryPrice) /
                    openPosition.entryPrice) *
                  100
                : 0,
          },
        }
      : withMoneyPlan;

    const sellDecisionData = getSellDecision(withPosition, state);

    return {
      ...withPosition,
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

  const buySignals = analyzedItems
    .filter(isSimpleBuySignal)
    .sort(
      (a, b) =>
        b.tradeabilityScore - a.tradeabilityScore ||
        b.brainScore - a.brainScore ||
        b.profit - a.profit,
    );

  const sellSignals = analyzedItems
    .filter((item) => item.hasOpenPosition && item.sellLevel)
    .sort(
      (a, b) =>
        urgencyRank(b.sellLevel) - urgencyRank(a.sellLevel) ||
        b.scoreDrop - a.scoreDrop,
    );

  console.log(
    `\nTIBIA FLIPPER SIMPLE MODE\n` +
      `Market volatility: ${volatility} (${runAdvice.level})\n` +
      `BUY signals: ${buySignals.length}\n` +
      `SELL signals: ${sellSignals.length}\n`,
  );

  buySignals.forEach((item) => printQualityBuySignal(item));

  sellSignals.forEach((item) => {
    console.log(
      `SELL ${item.name} (ID: ${item.id})\n` +
        `Level: ${item.sellLevel}\n` +
        `Current sell: ${item.sellOffer} | Target: ${item.trackedTargetSell}\n` +
        `Brain: ${item.previousBrainScore} -> ${item.brainScore} | Drop: ${item.scoreDrop}\n` +
        `Reason: ${item.sellReason}\n`,
    );
  });

  printManualSnipeChecks(analyzedItems, buySignals);
  printNearMisses(analyzedItems, buySignals);

  if (
    SEND_EMPTY_SUMMARY &&
    buySignals.length === 0 &&
    sellSignals.length === 0 &&
    getManualSnipeChecks(analyzedItems, buySignals).length === 0
  ) {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content:
        `⚪ Tibia Flipper checked **${SERVER}**\n` +
        `No BUY or SELL signal right now.\n` +
        `Market: ${runAdvice.level} | Volatility: ${volatility}`,
    });
  }

  savePendingBuySignals(buySignals);
  await sendDiscordManualSnipeAlerts(analyzedItems, buySignals, state);
  await sendDiscordBuyAlerts(buySignals, state);
  await sendDiscordSellAlerts(sellSignals, state);

  saveState(state);
}

main().catch(async (err) => {
  console.error("Bot crashed:", err);
  await sendDiscordErrorAlert(err);
  process.exit(1);
});
