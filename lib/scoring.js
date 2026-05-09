import { clamp } from "./utils.js";

export function analyzeHistory(history) {
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

export function analyzeSellMomentum(history) {
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

export function getFakeSpreadRisk(item) {
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

export function calculateBrainScore(item) {
  let score = 50;

  const notes = [];

  const profitScore = clamp(item.profitPercent * 1.5, 0, 25);

  score += profitScore;

  notes.push(`Profit score: +${profitScore.toFixed(1)}`);

  const rawProfitScore = clamp(item.profit / 2000, 0, 12);

  score += rawProfitScore;

  notes.push(`Raw profit score: +${rawProfitScore.toFixed(1)}`);

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

  score += item.historyScore;

  notes.push(
    `History score: ${item.historyScore >= 0 ? "+" : ""}${item.historyScore}`,
  );

  score -= item.fakeSpreadRisk;

  notes.push(`Fake spread risk: -${item.fakeSpreadRisk}`);

  if (item.firstGreenSignal) {
    score += 8;
    notes.push("First green after drop bonus: +8");
  } else if (item.bottomSignal) {
    score += 4;
    notes.push("Bottom forming bonus: +4");
  }

  score = Math.round(clamp(score, 0, 100));

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

  let riskLevel = "HIGH";

  if (item.fakeSpreadRisk < 20 && item.monthSold >= 300) {
    riskLevel = "LOW";
  } else if (item.fakeSpreadRisk < 35 && item.monthSold >= 100) {
    riskLevel = "LOW-MEDIUM";
  } else if (score >= 60) {
    riskLevel = "MEDIUM";
  }

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

export function getDecision(
  item,
  profit,
  profitPercent,
  fakeSpreadRisk,
  historyData,
) {
  const daySell = item.day_average_sell || 0;

  const monthSell = item.month_average_sell || 0;

  const daySold = item.day_sold || 0;

  const monthSold = item.month_sold || 0;

  const dayVsMonthSell =
    monthSell > 0 ? ((daySell - monthSell) / monthSell) * 100 : 0;

  const averageDailyVolume = monthSold / 30;

  const volumeRatio = averageDailyVolume > 0 ? daySold / averageDailyVolume : 0;

  const isGoodProfit = profit >= 5000 && profitPercent >= 3;

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

export function getExitConfidence(item) {
  if (!item.buyOffer || !item.sellOffer || item.profit <= 0) {
    return "VERY LOW";
  }

  if (
    item.daySold >= 30 &&
    item.monthSold >= 500 &&
    item.fakeSpreadRisk <= 20
  ) {
    return "HIGH";
  }

  if (
    item.daySold >= 10 &&
    item.monthSold >= 250 &&
    item.fakeSpreadRisk <= 35
  ) {
    return "MEDIUM";
  }

  if (item.daySold >= 3 && item.monthSold >= 100 && item.fakeSpreadRisk <= 55) {
    return "LOW";
  }

  return "VERY LOW";
}

export function getMarketClass(item) {
  if (!item.buyOffer || !item.sellOffer) {
    return "NO MARKET";
  }

  if (item.profit <= 0) {
    return "NO PROFIT AFTER TAX";
  }

  if (item.daySold === 0 || item.monthSold < 30) {
    return "DEAD MARKET";
  }

  if (item.profitPercent > 80 && item.monthSold < 250) {
    return "FAKE SPREAD";
  }

  if (item.fakeSpreadRisk >= 80) {
    return "FAKE SPREAD";
  }

  if (
    item.daySold >= 30 &&
    item.monthSold >= 500 &&
    item.fakeSpreadRisk <= 25
  ) {
    return "FAST FLIP";
  }

  if (item.daySold >= 8 && item.monthSold >= 250) {
    return "SAFE FLIP";
  }

  if (item.daySold >= 3 && item.monthSold >= 100) {
    return "SLOW FLIP";
  }

  return "RISKY";
}

export function getUndervaluedPercent(item) {
  if (!item.monthAverageSell || !item.sellOffer) {
    return 0;
  }

  return (
    ((item.monthAverageSell - item.sellOffer) / item.monthAverageSell) * 100
  );
}

export function calculateScannerScore(item) {
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

  if (item.monthSold >= 1500) {
    liquidityScore = 28;
  } else if (item.monthSold >= 700) {
    liquidityScore = 25;
  } else if (item.monthSold >= 300) {
    liquidityScore = 21;
  } else if (item.monthSold >= 150) {
    liquidityScore = 15;
  } else if (item.monthSold >= 75) {
    liquidityScore = 9;
  } else if (item.monthSold >= 30) {
    liquidityScore = 4;
  }

  score += liquidityScore;

  notes.push(`liquidity +${liquidityScore}`);

  const cappedVolumeRatio = clamp(item.volumeRatio, 0, 2.5);

  const volumeScore = clamp(cappedVolumeRatio * 5, 0, 12);

  score += volumeScore;

  notes.push(`volume +${volumeScore.toFixed(1)}`);

  let stabilityScore = 8;

  if (Math.abs(item.dayVsMonthSell) <= 2) {
    stabilityScore = 15;
  } else if (Math.abs(item.dayVsMonthSell) <= 5) {
    stabilityScore = 11;
  } else if (Math.abs(item.dayVsMonthSell) <= 10) {
    stabilityScore = 6;
  } else {
    stabilityScore = 2;
  }

  score += stabilityScore;

  notes.push(`stability +${stabilityScore}`);

  const undervaluedPercent = getUndervaluedPercent(item);

  let undervaluedScore = 0;

  if (item.profit > 0 && item.monthSold >= 100 && item.daySold >= 3) {
    if (undervaluedPercent >= 20) {
      undervaluedScore = 12;
    } else if (undervaluedPercent >= 12) {
      undervaluedScore = 8;
    } else if (undervaluedPercent >= 6) {
      undervaluedScore = 4;
    }
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
