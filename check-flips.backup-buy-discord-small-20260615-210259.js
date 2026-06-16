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
  FLIPPER_MAX_ITEM_CAPITAL,
} from "./lib/constants.js";
import { loadPositions, getOpenPositionForItem } from "./lib/positions.js";

const DISCORD_WEBHOOK_URL = process.env.TIBIA_FLIPS_WEBHOOK_URL;

const ITEM_IDS = getTrackedItemIds();

function getNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


const PENDING_BUY_SIGNALS_FILE = "./pending-buy-signals.json";

function quotePowerShellArg(value) {
  const text = String(value ?? "");
  return `"${text.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function getSignalQuantity(item) {
  return Math.max(1, Math.round(getNumber(item.recommendedQty, 1)));
}

function getSignalBuyPrice(item) {
  return Math.max(1, Math.round(getNumber(item.maxRealisticBuy || item.maxBuy || item.buyOffer, 0)));
}

function getSignalTargetSell(item) {
  return Math.max(0, Math.round(getNumber(item.realisticExit || item.targetSell || item.sellOffer, 0)));
}

function getQualityLabel(item) {
  if (item.signalClass === "BUY_CANDIDATE") return "WATCH ONLY";
  if (getNumber(item.signalConfidence) >= 88 || getNumber(item.brainScore) >= 90) return "STRONG BUY";
  if (getNumber(item.signalConfidence) >= 76 || getNumber(item.brainScore) >= 75) return "BUY";
  return "CAREFUL BUY";
}

function getAcceptBuyCommand(item) {
  const qty = getSignalQuantity(item);
  const buy = getSignalBuyPrice(item);
  const target = getSignalTargetSell(item);
  const profitTotal = Math.round(getNumber(item.realisticProfit, item.profit) * qty);
  const roi = getNumber(item.realisticProfitPercent, item.profitPercent).toFixed(2);
  const quality = getQualityLabel(item);
  const qualityScore = getNumber(item.signalConfidence, item.brainScore);

  return [
    "npm run accept-buy --",
    "--item-id", String(item.id),
    "--name", quotePowerShellArg(item.name),
    "--qty", String(qty),
    "--buy", String(buy),
    "--target", String(target),
    "--profit-total", String(profitTotal),
    "--roi", String(roi),
    "--quality", quotePowerShellArg(quality),
    "--quality-score", String(qualityScore),
    "--confidence", String(getNumber(item.signalConfidence, 0)),
    "--brain", String(getNumber(item.brainScore, 0)),
  ].join(" ");
}

function getAcceptBuyDiscordValue(item) {
  const projectPath =
    process.env.ACCEPT_BUY_PROJECT_PATH ||
    "C:\\Users\\Avner\\Desktop\\Projects\\tibia-price-alert";

  return (
    "After you actually place this Buy Offer in Tibia Market, paste this in PowerShell/CMD:\n" +
    "```powershell\n" +
    "cd " + quotePowerShellArg(projectPath) + "\n" +
    getAcceptBuyCommand(item) +
    "\n```\n" +
    "**Do not run it before placing the offer in Tibia.**"
  );
}

function loadPendingBuySignals() {
  if (!fs.existsSync(PENDING_BUY_SIGNALS_FILE)) return { signals: [] };

  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_BUY_SIGNALS_FILE, "utf8"));
    if (Array.isArray(raw)) return { signals: raw };
    if (!Array.isArray(raw.signals)) raw.signals = [];
    return raw;
  } catch {
    return { signals: [] };
  }
}

function savePendingBuySignals(buySignals) {
  const data = loadPendingBuySignals();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  data.signals = data.signals.filter((signal) => {
    const status = String(signal.status || "PENDING").toUpperCase();
    if (status !== "PENDING") return true;
    const seen = new Date(signal.seenAt || signal.createdAt || 0).getTime();
    return !Number.isFinite(seen) || seen <= 0 || seen >= cutoff;
  });

  for (const item of buySignals) {
    const qty = getSignalQuantity(item);
    const buyPrice = getSignalBuyPrice(item);
    const targetSell = getSignalTargetSell(item);
    const signature = `${item.id}:${qty}:${buyPrice}:${targetSell}`;
    const existing = data.signals.find((signal) => signal.signature === signature);

    if (existing) {
      existing.lastSeenAt = now;
      existing.acceptBuyCommand = getAcceptBuyCommand(item);
      if (!existing.status) existing.status = "PENDING";
      continue;
    }

    data.signals.push({
      signature,
      status: "PENDING",
      seenAt: now,
      lastSeenAt: now,
      itemId: item.id,
      name: item.name,
      qty,
      buyPrice,
      targetSell,
      profitTotal: Math.round(getNumber(item.realisticProfit, item.profit) * qty),
      roi: Number(getNumber(item.realisticProfitPercent, item.profitPercent).toFixed(2)),
      quality: getQualityLabel(item),
      qualityScore: getNumber(item.signalConfidence, item.brainScore),
      confidence: getNumber(item.signalConfidence, 0),
      brain: getNumber(item.brainScore, 0),
      signalClass: item.signalClass,
      acceptBuyCommand: getAcceptBuyCommand(item),
    });
  }

  const tempFile = `${PENDING_BUY_SIGNALS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, PENDING_BUY_SIGNALS_FILE);
}

function getOpenExposureSummary(item) {
  const positionsData = loadPositions();
  const active = positionsData.positions.filter((position) => {
    const status = String(position.status || "OPEN").toUpperCase();
    const isClosed = [
      "CLOSED",
      "CANCELED",
      "CANCELLED",
      "BUY_ORDER_CANCELLED",
      "BUY_ORDER_CANCELED",
      "BUY_ORDER_EXPIRED",
      "EXPIRED",
    ].includes(status);
    return String(position.id) === String(item.id) && !isClosed;
  });

  const newCapital = getSignalBuyPrice(item) * getSignalQuantity(item) * 1.02;

  if (active.length === 0) {
    return {
      hasExposure: false,
      text: `No open exposure found. New capital: ~${formatGp(newCapital)} gp.`,
    };
  }

  const waiting = active.reduce((sum, position) => {
    return sum + Math.max(0, getNumber(position.orderedQuantity) - getNumber(position.receivedQuantity));
  }, 0);
  const owned = active.reduce((sum, position) => sum + getNumber(position.quantity), 0);
  const listed = active.reduce((sum, position) => sum + getNumber(position.listedQuantity), 0);
  const existingCapital = active.reduce((sum, position) => {
    const qty = Math.max(
      getNumber(position.orderedQuantity),
      getNumber(position.originalQuantity),
      getNumber(position.quantity),
      0,
    );
    return sum + getNumber(position.entryPrice) * qty;
  }, 0);
  const combined = existingCapital + newCapital;
  const capWarning = combined > FLIPPER_MAX_ITEM_CAPITAL
    ? `\nâš ï¸ Combined item capital is above cap (${formatGp(FLIPPER_MAX_ITEM_CAPITAL)} gp).`
    : "";

  return {
    hasExposure: true,
    text:
      `Open exposure already exists. Waiting: ${waiting}, owned: ${owned}, listed: ${listed}.\n` +
      `Existing capital: ~${formatGp(existingCapital)} gp | New: ~${formatGp(newCapital)} gp | Combined: ~${formatGp(combined)} gp.${capWarning}`,
  };
}

function buildBuyActionText(item) {
  const buy = getSignalBuyPrice(item);
  const topBuy = getNumber(item.maxBuy || item.buyOffer, 0);
  const lower = Math.max(1, Math.round(buy * 0.985));

  if (item.signalClass === "BUY_CANDIDATE") {
    return (
      "**RESEARCH / SMALL TEST ONLY**\n" +
      `Entry range: **${formatGp(lower)}â€“${formatGp(buy)} gp**\n` +
      `Hard max: **${formatGp(buy)} gp**\n` +
      "Do not chase. Use tiny quantity only after manual market check."
    );
  }

  return (
    "**WORTH BUY OFFER**\n" +
    `Entry range: **${formatGp(lower)}â€“${formatGp(buy)} gp**\n` +
    `Hard max: **${formatGp(buy)} gp**\n` +
    `Current top buy/reference: ${formatGp(topBuy)} gp.`
  );
}

function buildQualityPlanText(item) {
  const fill = item.fillSpeed || getExpectedFillSpeed(item);
  return (
    `Quality: **${getQualityLabel(item)} (${getNumber(item.signalConfidence, item.brainScore)}/100)**\n` +
    `Exit speed: **${fill.label} / ${fill.days} days**\n` +
    "Manual check: Check that the lowest sell offer is real and not only 1 overpriced item."
  );
}

function buildCapitalText(item) {
  const qty = getSignalQuantity(item);
  const buy = getSignalBuyPrice(item);
  const locked = buy * qty * 1.02;
  const profitTotal = Math.round(getNumber(item.realisticProfit, item.profit) * qty);

  return (
    `Qty: **${qty}**\n` +
    `Locked: ~**${formatGp(locked)} gp**\n` +
    `Expected total profit: ~**${formatGp(profitTotal)} gp**`
  );
}


function getExpectedFillSpeed(item) {
  const daySold = getNumber(item.daySold);
  const monthSold = getNumber(item.monthSold);
  const avgDaily = monthSold > 0 ? monthSold / 30 : 0;
  const pace = Math.max(daySold, avgDaily);

  if (pace >= 60) return { label: "VERY FAST", days: "<1", score: 95 };
  if (pace >= 25) return { label: "FAST", days: "1â€“2", score: 82 };
  if (pace >= 8) return { label: "NORMAL", days: "2â€“4", score: 65 };
  if (pace >= 3) return { label: "SLOW", days: "4â€“8", score: 42 };
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
      sellAlertReason: `SELL became more urgent: ${lastSellAlert.sellLevel} â†’ ${item.sellLevel}.`,
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
    return `ðŸŸ¡ BUY CANDIDATE â€” ${item.name} â€” RESEARCH`;
  }

  if (item.signalConfidence >= 88 || item.brainScore >= 90) {
    return `ðŸŸ¢ BUY â€” ${item.name} â€” VERY STRONG`;
  }

  if (item.signalConfidence >= 76 || item.brainScore >= 75) {
    return `ðŸŸ¢ BUY â€” ${item.name} â€” STRONG`;
  }

  return `ðŸŸ¡ BUY â€” ${item.name} â€” GOOD`;
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
  if (item.sellLevel === "PANIC") return `ðŸš¨ SELL â€” ${item.name} â€” EXIT`;
  if (item.sellLevel === "SELL_NOW")
    return `ðŸŸ¢ SELL â€” ${item.name} â€” TARGET HIT`;
  if (item.sellLevel === "TAKE_PROFIT") {
    return `ðŸŸ  SELL â€” ${item.name} â€” TAKE PROFIT`;
  }
  return `ðŸŸ  SELL â€” ${item.name} â€” WARNING`;
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
      return `${index + 1}. **${item.name}** â€” Brain ${item.brainScore}, Tradeability ${item.tradeabilityScore}, Profit ${formatGp(item.profit)} gp (${item.profitPercent.toFixed(2)}%) â€” ${reasons}`;
    })
    .join("\n");
}


function printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals) {
  const buyIds = new Set(buySignals.map((item) => Number(item.id)));
  const sellIds = new Set(sellSignals.map((item) => Number(item.id)));

  const showAvoided = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.FLIPPER_SHOW_AVOIDED || "").toLowerCase(),
  );

  const limit = Number(process.env.FLIPPER_NOT_ACTIONABLE_LIMIT || 10);
  const avoidedLimit = Number(process.env.FLIPPER_AVOIDED_LIMIT || 10);

  function isAvoided(item) {
    const decision = String(item.decision || "").toUpperCase();
    const signalClass = String(item.signalClass || "").toUpperCase();

    if (decision === "AVOID" || signalClass === "AVOID") return true;

    return (
      getNumber(item.brainScore) <= 0 &&
      getNumber(item.tradeabilityScore) <= 0 &&
      getNumber(item.fakeSpreadRisk) >= 80
    );
  }

  function getNoBuyReasons(item) {
    if (Array.isArray(item.rejectionReasons) && item.rejectionReasons.length) {
      return item.rejectionReasons.slice(0, 3).join(", ");
    }

    if (Array.isArray(item.tradeWarnings) && item.tradeWarnings.length) {
      return item.tradeWarnings.slice(0, 3).join(", ");
    }

    if (item.reason) return item.reason;

    const decision = String(item.decision || "").toUpperCase();
    if (decision === "WAIT") return "Waiting for a better entry price.";
    if (decision === "WATCH") return "Interesting, but not strong enough for BUY.";
    if (decision === "RESEARCH") return "Research only; needs manual confirmation.";

    return "No BUY signal right now.";
  }

  function usefulScore(item) {
    const decision = String(item.decision || "").toUpperCase();
    const signalClass = String(item.signalClass || "").toUpperCase();

    let bonus = 0;
    if (["BUY_CANDIDATE", "WATCH", "WAIT", "RESEARCH"].includes(signalClass)) bonus += 40;
    if (["BUY_CANDIDATE", "WATCH", "WAIT", "RESEARCH"].includes(decision)) bonus += 30;

    return (
      bonus +
      getNumber(item.brainScore) * 3 +
      getNumber(item.tradeabilityScore) * 2 +
      Math.min(getNumber(item.profitPercent), 30) * 2 +
      Math.min(getNumber(item.profit) / 1000, 20) -
      getNumber(item.fakeSpreadRisk) * 1.5 -
      getNumber(item.marketPressure || item.pressureScore || 0) * 0.5
    );
  }

  const baseRows = analyzedItems
    .filter((item) => !buyIds.has(Number(item.id)))
    .filter((item) => !sellIds.has(Number(item.id)))
    .map((item) => ({
      item,
      avoided: isAvoided(item),
      score: usefulScore(item),
      reasons: getNoBuyReasons(item),
    }));

  const usefulRows = baseRows
    .filter((row) => !row.avoided)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const avoidedRows = baseRows
    .filter((row) => row.avoided)
    .sort((a, b) => b.score - a.score);

  if (usefulRows.length === 0 && avoidedRows.length === 0) return;

  console.log("\nTRACKED BUT NOT ACTIONABLE / NEAR MISSES");
  console.log("----------------------------------------");

  if (usefulRows.length === 0) {
    console.log("No non-AVOID tracked items were close to BUY right now.");
  } else {
    usefulRows.forEach(({ item, reasons }, index) => {
      const decision = item.decision || "UNKNOWN";
      const signalClass = item.signalClass || "REJECTED";
      const profit = formatGp(item.profit || 0);
      const roi = Number(item.profitPercent || 0).toFixed(2);

      console.log(
        index + 1 + ") " + item.name + " (" + item.id + ")\n" +
          "   Decision: " + decision + " | Signal: " + signalClass + "\n" +
          "   Brain: " + (item.brainScore ?? "?") + "/100 | Tradeability: " + (item.tradeabilityScore ?? "?") + "/100\n" +
          "   Profit: ~" + profit + " gp ea | ROI: " + roi + "%\n" +
          "   Why no BUY: " + reasons + "\n",
      );
    });
  }

  if (avoidedRows.length > 0 && !showAvoided) {
    console.log(
      "Hidden " +
        avoidedRows.length +
        " AVOID tracked items. To show them: $env:FLIPPER_SHOW_AVOIDED=\"1\"",
    );
  }

  if (showAvoided && avoidedRows.length > 0) {
    console.log("\nTRACKED AVOIDED ITEMS");
    console.log("---------------------");

    avoidedRows.slice(0, avoidedLimit).forEach(({ item, reasons }, index) => {
      console.log(
        index + 1 + ") " + item.name + " (" + item.id + ")\n" +
          "   Decision: " + (item.decision || "AVOID") + " | Signal: " + (item.signalClass || "AVOID") + "\n" +
          "   Brain: " + (item.brainScore ?? "?") + "/100 | Tradeability: " + (item.tradeabilityScore ?? "?") + "/100\n" +
          "   Why avoided: " + reasons + "\n",
      );
    });
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

  const embeds = alertable.slice(0, 5).map((item) => {
    const exposure = getOpenExposureSummary(item);

    return {
      title: buildSimpleBuyTitle(item),
      color: getColor(item.brainScore),
      fields: [
        {
          name: "ðŸ‘‰ ACTION",
          value: buildBuyActionText(item),
          inline: false,
        },
        {
          name: "ðŸŽšï¸ QUALITY PLAN",
          value: buildQualityPlanText(item),
          inline: false,
        },
        {
          name: "ðŸ’¼ CAPITAL",
          value: buildCapitalText(item),
          inline: true,
        },
        {
          name: "ðŸ§¯ EXPOSURE GUARD",
          value: exposure.text,
          inline: false,
        },
        {
          name: "ðŸ“‹ COPY-PASTE ACCEPT COMMAND",
          value: getAcceptBuyDiscordValue(item),
          inline: false,
        },
        {
          name: "ðŸŽ¯ SELL TARGET",
          value: `Realistic exit around **${formatGp(item.realisticExit || item.targetSell)} gp**. Desired margin: ${item.desiredMarginPercent?.toFixed?.(1) || "?"}%.`,
          inline: false,
        },
        {
          name: "ðŸ§  BRAIN",
          value:
            `Score: **${item.brainScore}/100**\n` +
            `Strength: **${item.strength}**\n` +
            `Risk: **${item.riskLevel}**`,
          inline: true,
        },
        {
          name: "ðŸ“ˆ TRADE READ",
          value: getHumanTradeRead(item),
          inline: false,
        },
        {
          name: "ðŸ’° REALISTIC PROFIT",
          value:
            `Expected: **${formatGp(item.realisticProfit)} gp** each\n` +
            `Percent: **${item.realisticProfitPercent.toFixed(2)}%**`,
          inline: true,
        },
        {
          name: "ðŸ“Š WHY",
          value:
            `${item.reason}\n` +
            `${item.recommendation}\n` +
            `Trend: ${item.dayVsMonthSell.toFixed(2)}% | Volume: ${item.volumeRatio.toFixed(2)}x\n` +
            `Fake spread risk: ${item.fakeSpreadRisk}/100`,
          inline: false,
        },
        {
          name: "ðŸŒŠ MARKET PRESSURE",
          value:
            `Level: **${item.marketPressureLevel}**\n` +
            `Score: **${item.marketPressure}/100**\n` +
            `${item.marketPressureReasons.slice(0, 2).join("\n") || "No major pressure detected."}\n` +
            `${(item.tradeWarnings || []).slice(0, 2).join("\n")}`,
          inline: false,
        },
        {
          name: "ðŸ›‘ SAFETY",
          value: `If price drops hard, consider exiting around **${formatGp(item.stopLoss)} gp**.`,
          inline: false,
        },
      ],
      footer: {
        text: `Item ID: ${item.id} | Tax included | Simple BUY/SELL mode`,
      },
    };
  });

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: `ðŸŸ¢ Tibia Flipper BUY signals on **${SERVER}** (${alertable.length} alert${alertable.length === 1 ? "" : "s"})`,
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
        name: "ðŸ‘‰ ACTION",
        value: `**${item.sellAction}**`,
        inline: false,
      },
      {
        name: "ðŸŽ¯ TARGET",
        value:
          `Target: **${formatGp(item.trackedTargetSell)} gp**\n` +
          `Current sell price: **${formatGp(item.sellOffer)} gp**`,
        inline: true,
      },
      {
        name: "ðŸ§  BRAIN",
        value:
          `Previous: **${item.previousBrainScore}/100**\n` +
          `Now: **${item.brainScore}/100**\n` +
          `Drop: **${item.scoreDrop}**`,
        inline: true,
      },
      {
        name: "ðŸ“Š WHY",
        value:
          `${item.sellReason}\n` +
          `Momentum: ${item.sellMomentumSignal}\n` +
          `Volume: ${item.volumeRatio.toFixed(2)}x\n` +
          `Fake spread risk: ${item.fakeSpreadRisk}/100`,
        inline: false,
      },
      {
        name: "ðŸ“¦ POSITION",
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
    content: `ðŸ”´ Tibia Flipper SELL signals on **${SERVER}**`,
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
      content: `ðŸ”Ž Tibia Flipper scanner checked **${SERVER}** but found no items.`,
    });
    return;
  }

  const embeds = topItems.slice(0, 10).map((item, index) => ({
    title: `#${index + 1} ${item.name} â€” ${item.scannerTier} / ${item.marketClass}`,
    color: getScannerColor(item.scannerTier),
    fields: [
      {
        name: "ðŸ§  Scanner",
        value:
          `Score: **${item.scannerScore}/100**\n` +
          `Brain: **${item.brainScore}/100**\n` +
          `Risk: **${item.fakeSpreadRisk}/100**\n` +
          `Exit confidence: **${item.exitConfidence}**`,
        inline: true,
      },
      {
        name: "ðŸ’° Profit",
        value:
          `Expected: **${formatGp(item.profit)} gp**\n` +
          `Percent: **${item.profitPercent.toFixed(2)}%**\n` +
          `Buy/Sell: **${formatGp(item.buyOffer)} â†’ ${formatGp(item.sellOffer)}**`,
        inline: true,
      },
      {
        name: "ðŸ“Š Liquidity / Volume",
        value:
          `Today sold: **${formatGp(item.daySold)}**\n` +
          `Month sold: **${formatGp(item.monthSold)}**\n` +
          `Volume ratio: **${item.volumeRatio.toFixed(2)}x**`,
        inline: true,
      },
      {
        name: "ðŸ“ˆ Stability / Value",
        value:
          `Day vs month avg: **${item.dayVsMonthSell.toFixed(2)}%**\n` +
          `Undervalued vs month avg: **${item.undervaluedPercent.toFixed(2)}%**\n` +
          `History: **${item.historySignal}**`,
        inline: false,
      },
      {
        name: "ðŸ“ Notes",
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
      `ðŸ”Ž **Top Flippable Items Scanner** on **${SERVER}**\n` +
      `Mode: research only â€” no BUY/SELL alerts sent.\n` +
      `Pool: **${SCANNER_POOL}** | Checked: **${analyzedItems.length}** items\n` +
      `Market: **${runAdvice.level}** | Volatility: **${volatility}**\n` +
      `Top ${topItems.length}: ðŸŸ¢ SAFE ${tierCounts.SAFE || 0} | ðŸŸ¡ WATCH ${tierCounts.WATCH || 0} | ðŸŸ  SPECULATIVE ${tierCounts.SPECULATIVE || 0} | ðŸ”´ AVOID ${tierCounts.AVOID || 0}`,
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

  savePendingBuySignals(buySignals);

  console.log(
    `\nTIBIA FLIPPER SIMPLE MODE\n` +
      `Market volatility: ${volatility} (${runAdvice.level})\n` +
      `BUY signals: ${buySignals.length}\n` +
      `SELL signals: ${sellSignals.length}\n`,
  );

  buySignals.forEach((item) => {
    const exposure = getOpenExposureSummary(item);
    const label = item.signalClass === "BUY_CANDIDATE" ? "BUY CANDIDATE / RESEARCH" : "BUY SIGNAL";
    console.log(
      `${label} ${item.name} (ID: ${item.id})\n` +
        `Quality: ${getQualityLabel(item)} | Confidence: ${item.signalConfidence}/100\n` +
        `Brain: ${item.brainScore}/100 (${item.strength}) | Risk: ${item.riskLevel}\n` +
        `Action: ${item.signalClass === "BUY_CANDIDATE" ? "RESEARCH / SMALL TEST ONLY" : item.directAction || "CHECK"} | Qty: ${getSignalQuantity(item)}\n` +
        `Hard max buy: ${formatGp(getSignalBuyPrice(item))} | Sell target: ${formatGp(getSignalTargetSell(item))}\n` +
        `Expected profit total: ${formatGp(getNumber(item.realisticProfit, item.profit) * getSignalQuantity(item))} gp\n` +
        `Exposure: ${exposure.text.replace(/\n/g, " ")}\n` +
        `Reason: ${item.reason}\n` +
        `Accept command saved to pending-buy-signals.json. Use npm run pending-buy to view it.\n`,
    );
  });

  sellSignals.forEach((item) => {
    console.log(
      `SELL ${item.name} (ID: ${item.id})\n` +
        `Level: ${item.sellLevel}\n` +
        `Current sell: ${item.sellOffer} | Target: ${item.trackedTargetSell}\n` +
        `Brain: ${item.previousBrainScore} -> ${item.brainScore} | Drop: ${item.scoreDrop}\n` +
        `Reason: ${item.sellReason}\n`,
    );
  });

  printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals);

  if (
    SEND_EMPTY_SUMMARY &&
    buySignals.length === 0 &&
    sellSignals.length === 0
  ) {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content:
        `âšª Tibia Flipper checked **${SERVER}**\n` +
        `No BUY or SELL signal right now.\n` +
        `Market: ${runAdvice.level} | Volatility: ${volatility}`,
    });
  }

  await sendDiscordBuyAlerts(buySignals, state);
  await sendDiscordSellAlerts(sellSignals, state);

  saveState(state);
}

main().catch(async (err) => {
  console.error("Bot crashed:", err);
  await sendDiscordErrorAlert(err);
  process.exit(1);
});

