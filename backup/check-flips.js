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
const SELL_ALERT_COOLDOWN_HOURS = 6;

const MIN_SIMPLE_BUY_BRAIN_SCORE = 70;
const MIN_SIMPLE_BUY_PROFIT_PERCENT = 5;
const MIN_SIMPLE_BUY_VOLUME_RATIO = 0.7;
const MAX_SIMPLE_BUY_FAKE_SPREAD_RISK = 30;

const SEND_EMPTY_SUMMARY = true;
const SCORE_DROP_WARNING = 15;
const SCORE_DROP_PANIC = 25;

function getTrackedItemIds() {
  const tracked = JSON.parse(
    fs.readFileSync("./data/tracked-items.json", "utf8"),
  );

  return [...tracked.core, ...tracked.watch].join(",");
}

const ITEM_IDS = getTrackedItemIds();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatGp(value) {
  return Math.round(value || 0).toLocaleString();
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
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
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

function analyzeHistory(history) {
  if (!history || history.length < 3) {
    return {
      historySignal: "NOT ENOUGH HISTORY",
      historyAdvice: "Need more bot runs before making a timing call.",
      historyScore: 0,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: false,
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
      historySignal: "FIRST GREEN AFTER DROP",
      historyAdvice: "Price dropped and just bounced.",
      historyScore: 25,
      bottomSignal: true,
      firstGreenSignal: true,
      fallingHard: false,
    };
  }

  if (stoppedFalling) {
    return {
      historySignal: "FALLING STOPPED",
      historyAdvice: "Price stopped falling.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  if (falling) {
    return {
      historySignal: "FALLING FOR 3 RUNS",
      historyAdvice: "Price is still dropping.",
      historyScore: -20,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: true,
    };
  }

  if (recovering) {
    return {
      historySignal: "POSSIBLE BOTTOM",
      historyAdvice: "Price may be recovering.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  if (rising) {
    return {
      historySignal: "RISING FOR 3 RUNS",
      historyAdvice: "Good momentum, but avoid chasing inflated prices.",
      historyScore: 10,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  return {
    historySignal: "UNCERTAIN",
    historyAdvice: "No clear direction.",
    historyScore: 0,
    bottomSignal: false,
    firstGreenSignal: false,
    fallingHard: false,
  };
}

function analyzeSellMomentum(history) {
  if (!history || history.length < 4) {
    return {
      sellMomentumSignal: "NOT ENOUGH SELL HISTORY",
      sellMomentumAdvice: "Need more runs before judging exit momentum.",
      momentumDropping: false,
      momentumBad: false,
    };
  }

  const last4 = history.slice(-4);
  const prices = last4.map((h) => h.sellOffer);
  const profits = last4.map((h) => h.profitPercent || 0);

  const wasRisingThenDropped =
    prices[0] < prices[1] && prices[1] <= prices[2] && prices[3] < prices[2];

  const fallingFor3 = prices[1] > prices[2] && prices[2] > prices[3];
  const profitFallingFor3 = profits[1] > profits[2] && profits[2] > profits[3];

  if (fallingFor3 || profitFallingFor3) {
    return {
      sellMomentumSignal: "MOMENTUM FALLING HARD",
      sellMomentumAdvice: "Sell pressure is increasing.",
      momentumDropping: true,
      momentumBad: true,
    };
  }

  if (wasRisingThenDropped) {
    return {
      sellMomentumSignal: "MOMENTUM STARTED DROPPING",
      sellMomentumAdvice: "Price was rising and now pulled back.",
      momentumDropping: true,
      momentumBad: false,
    };
  }

  return {
    sellMomentumSignal: "SELL MOMENTUM OK",
    sellMomentumAdvice: "No strong exit signal.",
    momentumDropping: false,
    momentumBad: false,
  };
}

function getFakeSpreadRisk(item) {
  const buyOffer = item.buy_offer || 0;
  const sellOffer = item.sell_offer || 0;

  const dayAvgSell = item.day_average_sell || 0;
  const monthAvgSell = item.month_average_sell || 0;

  const daySold = item.day_sold || 0;
  const monthSold = item.month_sold || 0;

  let risk = 0;
  const warnings = [];

  if (!buyOffer || !sellOffer) {
    risk += 60;
    warnings.push("Missing buy or sell offer.");
  }

  const rawSpreadPercent =
    buyOffer > 0 ? ((sellOffer - buyOffer) / buyOffer) * 100 : 0;

  if (rawSpreadPercent > 20) {
    risk += 15;
    warnings.push("Spread is getting large.");
  }

  if (rawSpreadPercent > 30) {
    risk += 20;
    warnings.push("Very large spread.");
  }

  if (rawSpreadPercent > 45) {
    risk += 30;
    warnings.push("Extreme spread. Likely unrealistic.");
  }

  if (monthAvgSell > 0 && sellOffer > monthAvgSell * 1.12) {
    risk += 25;
    warnings.push("Sell price is above monthly average.");
  }

  if (dayAvgSell > 0 && sellOffer > dayAvgSell * 1.08) {
    risk += 20;
    warnings.push("Sell price is above today's average.");
  }

  const avgDailyVolume = monthSold / 30;

  const volumeRatio = avgDailyVolume > 0 ? daySold / avgDailyVolume : 0;

  if (monthSold < 10) {
    risk += 50;
    warnings.push("Very low monthly liquidity.");
  } else if (monthSold < 30) {
    risk += 35;
    warnings.push("Low monthly liquidity.");
  } else if (monthSold < 100) {
    risk += 15;
    warnings.push("Moderate liquidity.");
  }

  if (avgDailyVolume > 0 && daySold < avgDailyVolume * 0.5) {
    risk += 20;
    warnings.push("Today's volume is weak.");
  }

  if (daySold === 0) {
    risk += 25;
    warnings.push("No sales today.");
  }

  risk = clamp(risk, 0, 100);

  return {
    fakeSpreadRisk: risk,
    fakeSpreadWarnings: warnings.length
      ? warnings.join("\n")
      : "No major warning.",
    rawSpreadPercent,
    liquidityScore: volumeRatio,
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

function calculateBrainScore(item) {
  let score = 50;

  const notes = [];

  // ================= PROFIT =================

  const profitScore = clamp(item.profitPercent * 1.5, 0, 25);

  score += profitScore;

  notes.push(`Profit score: +${profitScore.toFixed(1)}`);

  const rawProfitScore = clamp(item.profit / 2000, 0, 12);

  score += rawProfitScore;

  notes.push(`Raw profit score: +${rawProfitScore.toFixed(1)}`);

  // ================= TREND =================

  if (item.dayVsMonthSell > 5) {
    score += 10;
    notes.push("Strong rising trend: +10");
  } else if (item.dayVsMonthSell > 2) {
    score += 5;
    notes.push("Rising trend: +5");
  } else if (item.dayVsMonthSell < -5) {
    score -= 20;
    notes.push("Strong falling trend: -20");
  } else if (item.dayVsMonthSell < -2) {
    score -= 10;
    notes.push("Falling trend: -10");
  }

  // ================= LIQUIDITY =================

  if (item.monthSold >= 1000) {
    score += 25;
    notes.push("Extremely liquid item: +25");
  } else if (item.monthSold >= 300) {
    score += 18;
    notes.push("High liquidity: +18");
  } else if (item.monthSold >= 100) {
    score += 10;
    notes.push("Good liquidity: +10");
  } else if (item.monthSold >= 30) {
    score += 2;
    notes.push("Average liquidity: +2");
  } else if (item.monthSold >= 10) {
    score -= 15;
    notes.push("Low liquidity: -15");
  } else {
    score -= 30;
    notes.push("Very low liquidity: -30");
  }

  // ================= VOLUME =================

  if (item.volumeRatio >= 2) {
    score += 10;
    notes.push("Very strong volume: +10");
  } else if (item.volumeRatio >= 1) {
    score += 6;
    notes.push("Healthy volume: +6");
  } else if (item.volumeRatio < 0.5) {
    score -= 20;
    notes.push("Weak volume: -20");
  }

  // ================= HISTORY =================

  score += item.historyScore;

  notes.push(
    `History score: ${item.historyScore >= 0 ? "+" : ""}${item.historyScore}`,
  );

  // ================= RISK =================

  score -= item.fakeSpreadRisk;

  notes.push(`Fake spread risk: -${item.fakeSpreadRisk}`);

  // ================= BOTTOM SIGNALS =================

  if (item.firstGreenSignal) {
    score += 8;
    notes.push("First green after drop bonus: +8");
  } else if (item.bottomSignal) {
    score += 4;
    notes.push("Bottom forming bonus: +4");
  }

  score = Math.round(clamp(score, 0, 100));

  // ================= STRENGTH =================

  let strength = "WEAK";

  if (score >= 90) {
    strength = "ELITE";
  } else if (score >= 80) {
    strength = "VERY STRONG";
  } else if (score >= 70) {
    strength = "STRONG";
  } else if (score >= 60) {
    strength = "DECENT";
  }

  // ================= RISK LEVEL =================

  let riskLevel = "HIGH";

  if (item.fakeSpreadRisk < 20 && item.monthSold >= 300) {
    riskLevel = "LOW";
  } else if (item.fakeSpreadRisk < 35 && item.monthSold >= 100) {
    riskLevel = "LOW-MEDIUM";
  } else if (score >= 60) {
    riskLevel = "MEDIUM";
  }

  // ================= TARGETS =================

  const maxBuy = Math.floor(item.buyOffer);

  const targetSell = Math.floor(item.sellOffer * 0.985);

  const stopLoss = Math.floor(item.buyOffer * 0.96);

  return {
    brainScore: score,
    strength,
    riskLevel,

    maxBuy,
    targetSell,
    stopLoss,

    brainNotes: notes,
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

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
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

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: `🔴 Tibia Flipper SELL signals on **${SERVER}**`,
    embeds,
  });

  alertable.forEach((item) => markSellAlertSent(state, item));

  console.log("Discord simple SELL alert sent.");
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
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.error("Missing DISCORD_WEBHOOK_URL");
    process.exit(1);
  }

  const items = await getMarketValues();
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

  const buySignals = analyzedItems
    .filter(isSimpleBuySignal)
    .sort((a, b) => b.brainScore - a.brainScore || b.profit - a.profit);

  const sellSignals = analyzedItems
    .filter((item) => item.hasPreviousBuyAlert && item.sellLevel)
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

  buySignals.forEach((item) => {
    console.log(
      `BUY ${item.name} (ID: ${item.id})\n` +
        `Brain: ${item.brainScore}/100 (${item.strength}) | Risk: ${item.riskLevel}\n` +
        `Buy around: ${item.maxBuy} | Sell target: ${item.targetSell}\n` +
        `Profit: ${item.profit.toFixed(0)} (${item.profitPercent.toFixed(2)}%)\n` +
        `Reason: ${item.reason}\n`,
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

  if (
    SEND_EMPTY_SUMMARY &&
    buySignals.length === 0 &&
    sellSignals.length === 0
  ) {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      content:
        `⚪ Tibia Flipper checked **${SERVER}**\n` +
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
