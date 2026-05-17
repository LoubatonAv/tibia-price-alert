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

  const desiredMargin = 0.06;

  // price needed so that AFTER 2% sell tax you still make 6%
  const targetSell = Math.ceil((maxBuy * (1 + desiredMargin)) / 0.98);

  const stopLoss = Math.floor(item.buyOffer * 0.96);

  const realisticProfit = targetSell * 0.98 - maxBuy;

  const realisticProfitPercent =
    maxBuy > 0 ? (realisticProfit / maxBuy) * 100 : 0;

  return {
    brainScore: score,
    strength,
    riskLevel,

    maxBuy,
    targetSell,
    stopLoss,

    realisticProfit,
    realisticProfitPercent,
    desiredMargin,

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

export function calculateMarketPressure(item) {
  let pressure = 0;
  const reasons = [];

  // Current sell much higher than average
  const sellVsAverage =
    item.monthAverageSell > 0
      ? ((item.sellOffer - item.monthAverageSell) / item.monthAverageSell) * 100
      : 0;

  if (sellVsAverage >= 5) {
    pressure += 35;
    reasons.push("Current sell price heavily above monthly average.");
  } else if (sellVsAverage >= 2) {
    pressure += 20;
    reasons.push("Current sell price above monthly average.");
  }

  // Weak realistic margin
  if (item.realisticProfitPercent <= 4) {
    pressure += 25;
    reasons.push("Realistic margin is weak.");
  } else if (item.realisticProfitPercent <= 6) {
    pressure += 10;
    reasons.push("Realistic margin is narrow.");
  }

  // Weak volume ratio
  if (item.volumeRatio < 0.7) {
    pressure += 25;
    reasons.push("Volume ratio is weak.");
  } else if (item.volumeRatio < 1) {
    pressure += 10;
    reasons.push("Volume ratio slightly weak.");
  }

  // Existing fake spread logic
  pressure += Math.floor(item.fakeSpreadRisk * 0.5);

  pressure = Math.min(100, pressure);

  let level = "LOW";

  if (pressure >= 70) {
    level = "EXTREME";
  } else if (pressure >= 45) {
    level = "HIGH";
  } else if (pressure >= 25) {
    level = "MEDIUM";
  }

  return {
    marketPressure: pressure,
    marketPressureLevel: level,
    marketPressureReasons: reasons,
  };
}

function analyzeSpreadSustainability(history, item) {
  if (!history || history.length < 4) {
    return {
      sustainabilityScore: 0,
      sustainabilityLabel: "NOT ENOUGH MEMORY",
      sustainabilityAdvice:
        "Historical spread persistence data is still building.",
      collapsingSpread: false,
      stableSpread: false,
      spikeRisk: false,
    };
  }

  const recent = history.slice(-5);
  const spreads = recent.map((h) => {
    const buyOffer = Number(h.buyOffer || 0);
    const sellOffer = Number(h.sellOffer || 0);
    return buyOffer > 0 ? ((sellOffer - buyOffer) / buyOffer) * 100 : 0;
  });

  const sellPrices = recent.map((h) => Number(h.sellOffer || 0));
  const profitPercents = recent.map((h) => Number(h.profitPercent || 0));

  const lastSpread = spreads[spreads.length - 1];
  const prevSpread = spreads[spreads.length - 2];
  const firstSpread = spreads[0];

  const spreadDownFor3 =
    spreads.length >= 4 &&
    spreads[spreads.length - 4] > spreads[spreads.length - 3] &&
    spreads[spreads.length - 3] > spreads[spreads.length - 2] &&
    spreads[spreads.length - 2] > spreads[spreads.length - 1];

  const sellDownFor3 =
    sellPrices.length >= 4 &&
    sellPrices[sellPrices.length - 4] > sellPrices[sellPrices.length - 3] &&
    sellPrices[sellPrices.length - 3] > sellPrices[sellPrices.length - 2] &&
    sellPrices[sellPrices.length - 2] > sellPrices[sellPrices.length - 1];

  const profitDownFor3 =
    profitPercents.length >= 4 &&
    profitPercents[profitPercents.length - 4] >
      profitPercents[profitPercents.length - 3] &&
    profitPercents[profitPercents.length - 3] >
      profitPercents[profitPercents.length - 2] &&
    profitPercents[profitPercents.length - 2] >
      profitPercents[profitPercents.length - 1];

  const spreadCompression =
    firstSpread > 0 ? ((firstSpread - lastSpread) / firstSpread) * 100 : 0;
  const stableSpread =
    spreads.length >= 4 &&
    Math.max(...spreads) - Math.min(...spreads) <= 4 &&
    lastSpread >= 5;

  const monthAverageSell = Number(
    item.monthAverageSell || item.month_average_sell || 0,
  );
  const sellOffer = Number(item.sellOffer || item.sell_offer || 0);
  const volumeRatio = Number(item.volumeRatio || 0);
  const spikeRisk =
    monthAverageSell > 0 &&
    sellOffer > monthAverageSell * 1.08 &&
    volumeRatio < 0.9;

  if (spreadDownFor3 || profitDownFor3 || spreadCompression >= 35) {
    return {
      sustainabilityScore: -16,
      sustainabilityLabel: "SPREAD COLLAPSING",
      sustainabilityAdvice:
        "Spread has been shrinking across recent runs; sellers may already be eating the margin.",
      collapsingSpread: true,
      stableSpread: false,
      spikeRisk,
    };
  }

  if (sellDownFor3 && volumeRatio < 0.8) {
    return {
      sustainabilityScore: -13,
      sustainabilityLabel: "EXIT WEAKENING",
      sustainabilityAdvice:
        "Sell price is falling while volume is not strong enough to absorb sellers.",
      collapsingSpread: true,
      stableSpread: false,
      spikeRisk,
    };
  }

  if (spikeRisk) {
    return {
      sustainabilityScore: -9,
      sustainabilityLabel: "SPIKE MAY FADE",
      sustainabilityAdvice:
        "Current price is above normal without strong volume confirmation.",
      collapsingSpread: false,
      stableSpread: false,
      spikeRisk: true,
    };
  }

  if (stableSpread && volumeRatio >= 0.75) {
    return {
      sustainabilityScore: 9,
      sustainabilityLabel: "SPREAD HOLDING",
      sustainabilityAdvice:
        "Spread has stayed fairly stable across recent runs.",
      collapsingSpread: false,
      stableSpread: true,
      spikeRisk: false,
    };
  }

  if (lastSpread >= prevSpread && volumeRatio >= 1) {
    return {
      sustainabilityScore: 5,
      sustainabilityLabel: "SPREAD STABLE",
      sustainabilityAdvice:
        "Spread is not collapsing and today's demand is acceptable.",
      collapsingSpread: false,
      stableSpread: true,
      spikeRisk: false,
    };
  }

  return {
    sustainabilityScore: 0,
    sustainabilityLabel: "SPREAD UNPROVEN",
    sustainabilityAdvice:
      "No clear proof yet that the spread will survive or collapse.",
    collapsingSpread: false,
    stableSpread: false,
    spikeRisk: false,
  };
}

function pickTraderLine(seed, lines) {
  if (!lines.length) return "";
  const n = Math.abs(Number(seed || 0));
  return lines[n % lines.length];
}

export function calculateTradeabilityConviction(item) {
  const notes = [];
  const warnings = [];
  const labels = [];

  let score = 46;

  const monthSold = Number(item.monthSold || 0);
  const daySold = Number(item.daySold || 0);
  const volumeRatio = Number(item.volumeRatio || 0);
  const fakeSpreadRisk = Number(item.fakeSpreadRisk || 0);
  const marketPressure = Number(item.marketPressure || 0);
  const marketPressureLevel = item.marketPressureLevel || "LOW";
  const profit = Number(item.profit || 0);
  const profitPercent = Number(item.profitPercent || 0);
  const brainScore = Number(item.brainScore || 0);
  const dayVsMonthSell = Number(item.dayVsMonthSell || 0);
  const undervaluedPercent = getUndervaluedPercent(item);
  const rawSpreadPercent = Number(item.rawSpreadPercent || 0);
  const buyOffer = Number(item.buyOffer || item.buy_offer || 0);
  const sellOffer = Number(item.sellOffer || item.sell_offer || 0);
  const dayAverageSell = Number(
    item.dayAverageSell || item.day_average_sell || 0,
  );
  const monthAverageSell = Number(
    item.monthAverageSell || item.month_average_sell || 0,
  );

  const avgDailyVolume = monthSold > 0 ? monthSold / 30 : 0;
  const expectedExitDays =
    daySold > 0 ? 1 : avgDailyVolume > 0 ? 1 / avgDailyVolume : 99;
  const stableEnough = Math.abs(dayVsMonthSell) <= 5;
  const stretchedVsDay =
    dayAverageSell > 0 && sellOffer > dayAverageSell * 1.05;
  const stretchedVsMonth =
    monthAverageSell > 0 && sellOffer > monthAverageSell * 1.08;

  const sustainability = analyzeSpreadSustainability(item.history, item);
  score += sustainability.sustainabilityScore;

  if (sustainability.sustainabilityLabel === "SPREAD COLLAPSING") {
    labels.push("SPREAD COLLAPSING");
    warnings.push(sustainability.sustainabilityAdvice);
  } else if (sustainability.sustainabilityLabel === "EXIT WEAKENING") {
    labels.push("EXIT WEAKENING");
    warnings.push(sustainability.sustainabilityAdvice);
  } else if (sustainability.sustainabilityLabel === "SPIKE MAY FADE") {
    labels.push("SPIKE MAY FADE");
    warnings.push(sustainability.sustainabilityAdvice);
  } else if (
    ["SPREAD HOLDING", "SPREAD STABLE"].includes(
      sustainability.sustainabilityLabel,
    )
  ) {
    labels.push(sustainability.sustainabilityLabel);
    notes.push(sustainability.sustainabilityAdvice);
  }

  let exitScore = 0;
  if (daySold >= 45 && monthSold >= 1200 && volumeRatio >= 0.95) {
    exitScore = 24;
    labels.push("EASY EXIT");
    notes.push(
      "Exit looks clean: strong daily sales, deep monthly demand, and normal-or-better volume today.",
    );
  } else if (daySold >= 20 && monthSold >= 500 && volumeRatio >= 0.7) {
    exitScore = 20;
    labels.push("GOOD EXIT");
    notes.push(
      "Enough buyers exist for a realistic resale, but still use a patient listing.",
    );
  } else if (daySold >= 8 && monthSold >= 220 && volumeRatio >= 0.45) {
    exitScore = 12;
    labels.push("MODERATE EXIT");
    notes.push(
      "Exit is realistic, but not instant. Be ready to price competitively.",
    );
  } else if (daySold >= 5 && monthSold >= 180) {
    exitScore = 5;
    labels.push("SLOW EXIT");
    notes.push("Trade can work, but the exit may require patience.");
  } else if (monthSold >= 50) {
    exitScore = -6;
    labels.push("HARD TO EXIT");
    warnings.push("Thin daily demand. You may need to undercut or wait.");
  } else {
    exitScore = -24;
    labels.push("LOW LIQUIDITY");
    warnings.push(
      "Very thin market. The visible spread may be mostly theoretical.",
    );
  }
  score += exitScore;

  let spreadQualityScore = 0;
  if (profit <= 0) {
    spreadQualityScore -= 35;
    labels.push("NO REAL EDGE");
    warnings.push("No profit after tax.");
  } else if (
    fakeSpreadRisk >= 75 ||
    (rawSpreadPercent >= 45 && monthSold < 300)
  ) {
    spreadQualityScore -= 32;
    labels.push("TRAP SPREAD");
    warnings.push(
      "Spread is too large relative to liquidity. The exit price may not be real.",
    );
  } else if (fakeSpreadRisk >= 50) {
    spreadQualityScore -= 18;
    labels.push("SUSPICIOUS SPREAD");
    warnings.push("Spread needs confirmation before buying.");
  } else if (fakeSpreadRisk <= 15 && profitPercent >= 6 && stableEnough) {
    spreadQualityScore += 14;
    labels.push("TRUSTWORTHY SPREAD");
    notes.push(
      "Spread looks realistic: low fake-spread risk and enough margin.",
    );
  } else if (fakeSpreadRisk <= 30 && profitPercent >= 4) {
    spreadQualityScore += 6;
    notes.push("Spread is usable, but not elite.");
  }
  score += spreadQualityScore;

  let pressureScore = 0;
  if (marketPressure >= 70 || marketPressureLevel === "EXTREME") {
    pressureScore -= 28;
    labels.push("CROWDED MARKET");
    warnings.push(
      "Sell-side pressure is extreme. Avoid chasing the visible sell price.",
    );
  } else if (marketPressure >= 45 || marketPressureLevel === "HIGH") {
    pressureScore -= 17;
    labels.push("CROWDED MARKET");
    warnings.push("Market pressure is high. The exit price may be fragile.");
  } else if (marketPressure <= 15) {
    pressureScore += 7;
    notes.push("Low market pressure.");
  }
  score += pressureScore;

  let timingScore = 0;
  if (item.fallingHard) {
    timingScore -= 20;
    labels.push("FALLING KNIFE");
    warnings.push(
      "Price has been falling for several runs. Wait for stabilization.",
    );
  } else if (item.firstGreenSignal) {
    timingScore += 10;
    labels.push("BOUNCE SETUP");
    notes.push("First green after a drop. Better timing than chasing highs.");
  } else if (item.bottomSignal) {
    timingScore += 7;
    labels.push("BOTTOMING");
    notes.push("Price stopped falling or may be recovering.");
  }

  if (dayVsMonthSell > 12 || stretchedVsMonth) {
    timingScore -= 17;
    labels.push("OVEREXTENDED");
    warnings.push(
      "Current price is stretched above normal. You may be buying late.",
    );
  } else if (dayVsMonthSell > 5 || stretchedVsDay) {
    timingScore -= 9;
    labels.push("HOT MARKET");
    warnings.push("Price is above normal. Do not overpay.");
  } else if (undervaluedPercent >= 10 && daySold >= 5) {
    timingScore += 8;
    labels.push("VALUE DISCOUNT");
    notes.push(
      "Current sell price is below monthly average while demand still exists.",
    );
  }
  score += timingScore;

  let competitionScore = 0;
  const possibleUndercutWar =
    (rawSpreadPercent >= 18 && volumeRatio < 0.75 && dayVsMonthSell <= -2) ||
    (item.momentumDropping && rawSpreadPercent >= 14) ||
    (stretchedVsDay && volumeRatio < 0.8 && daySold < 15);

  if (possibleUndercutWar) {
    competitionScore -= 18;
    labels.push("UNDERCUT WAR");
    warnings.push(
      "Sellers may be fighting lower. The exit can collapse quickly.",
    );
  } else if (rawSpreadPercent > 25 && fakeSpreadRisk >= 35) {
    competitionScore -= 10;
    labels.push("UNDERCUT RISK");
    warnings.push(
      "Large spread plus risk means other sellers can easily undercut you.",
    );
  }

  if (volumeRatio >= 1.6 && daySold >= 15) {
    competitionScore += 8;
    labels.push("ACTIVE DEMAND");
    notes.push("Demand is stronger than the normal monthly pace.");
  } else if (volumeRatio < 0.35) {
    competitionScore -= 14;
    labels.push("QUIET MARKET");
    warnings.push("Today's sales are weak compared to the monthly pace.");
  } else if (volumeRatio < 0.7) {
    competitionScore -= 7;
    warnings.push("Volume is below normal. Exit may be slower.");
  }
  score += competitionScore;

  let qualityPenalty = 0;
  if (brainScore < 75) {
    qualityPenalty -= 10;
    warnings.push(
      "Brain Score is not strong enough for a top-tier conviction label.",
    );
  }
  if (brainScore < 65) {
    qualityPenalty -= 10;
  }
  if (profit < 500) {
    qualityPenalty -= 8;
    warnings.push(
      "Raw profit is small, so the trade may not justify attention.",
    );
  }
  if (profit < 250) {
    qualityPenalty -= 7;
  }
  if (profitPercent < 4) {
    qualityPenalty -= 8;
    warnings.push("Percent margin is thin after tax.");
  }
  if (buyOffer > 0 && profit / buyOffer < 0.04) {
    qualityPenalty -= 5;
  }
  score += qualityPenalty;

  const finalScore = Math.round(clamp(score, 0, 100));

  const hasHardWarning = labels.some((label) =>
    [
      "TRAP SPREAD",
      "LOW LIQUIDITY",
      "HARD TO EXIT",
      "CROWDED MARKET",
      "FALLING KNIFE",
      "UNDERCUT WAR",
      "SPREAD COLLAPSING",
      "EXIT WEAKENING",
      "SPIKE MAY FADE",
      "NO REAL EDGE",
    ].includes(label),
  );

  let conviction = "LOW CONVICTION";
  if (
    finalScore >= 73 &&
    brainScore >= 84 &&
    profit >= 650 &&
    profitPercent >= 5.5 &&
    fakeSpreadRisk <= 18 &&
    marketPressure < 30 &&
    daySold >= 20 &&
    monthSold >= 500 &&
    !sustainability.collapsingSpread &&
    !sustainability.spikeRisk &&
    !hasHardWarning
  ) {
    conviction = "HIGH CONVICTION TRADE";
  } else if (
    finalScore >= 72 &&
    brainScore >= 72 &&
    profit >= 350 &&
    profitPercent >= 4.5 &&
    fakeSpreadRisk <= 35 &&
    marketPressure < 45 &&
    monthSold >= 120 &&
    !labels.includes("TRAP SPREAD") &&
    !labels.includes("UNDERCUT WAR") &&
    !labels.includes("SPREAD COLLAPSING") &&
    !labels.includes("EXIT WEAKENING")
  ) {
    conviction = "MEDIUM CONVICTION TRADE";
  } else if (
    finalScore <= 38 ||
    fakeSpreadRisk >= 70 ||
    monthSold < 50 ||
    profit <= 0
  ) {
    conviction = "AVOID / TRAP RISK";
  }

  let qualityTier = "WEAK";
  if (conviction === "HIGH CONVICTION TRADE" && finalScore >= 74) {
    qualityTier = "ELITE";
  } else if (
    ["HIGH CONVICTION TRADE", "MEDIUM CONVICTION TRADE"].includes(conviction) &&
    finalScore >= 68
  ) {
    qualityTier = "STRONG";
  } else if (finalScore >= 60 && conviction !== "AVOID / TRAP RISK") {
    qualityTier = "DECENT";
  }

  const recommendation = (() => {
    if (conviction === "HIGH CONVICTION TRADE") {
      if (qualityTier === "ELITE") {
        return "Elite setup. Enter only with a patient buy offer; do not chase if the market moves away.";
      }
      return "Strong candidate. Use a patient buy offer and keep the position size reasonable.";
    }

    if (conviction === "MEDIUM CONVICTION TRADE") {
      return pickTraderLine(item.id, [
        "Tradable, but entry discipline matters. Buy only with a discount and stay ready to undercut on exit.",
        "Looks tradable, but not a free buy. The entry price matters more than the visible spread.",
        "Market supports the trade, but the margin for error is smaller. Be strict with max buy.",
        "Trade is viable, but exit execution matters. Do not chase the sell price upward.",
      ]);
    }

    if (labels.includes("UNDERCUT WAR")) {
      return "Avoid chasing. Sellers may already be fighting lower, so the visible spread can disappear fast.";
    }

    if (labels.includes("HARD TO EXIT") || labels.includes("LOW LIQUIDITY")) {
      return "Only consider a tiny position or skip. The exit is the main risk.";
    }

    if (labels.includes("TRAP SPREAD") || labels.includes("CROWDED MARKET")) {
      return "Do not trust the visible spread. Wait for better confirmation.";
    }

    return "Looks promising, but current pricing may be risky.";
  })();

  return {
    tradeabilityScore: finalScore,
    conviction,
    qualityTier,
    tradeLabels: [...new Set(labels)].slice(0, 6),
    tradeNotes: [...new Set(notes)].slice(0, 4),
    tradeWarnings: [...new Set(warnings)].slice(0, 5),
    expectedExitDays,
    spreadSustainability: sustainability.sustainabilityLabel,
    spreadSustainabilityAdvice: sustainability.sustainabilityAdvice,
    recommendation,
  };
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

  if (Number.isFinite(item.tradeabilityScore)) {
    const tradeabilityAdjustment = clamp(
      (item.tradeabilityScore - 50) * 0.35,
      -18,
      18,
    );
    score += tradeabilityAdjustment;
    notes.push(
      `tradeability ${tradeabilityAdjustment >= 0 ? "+" : ""}${tradeabilityAdjustment.toFixed(1)}`,
    );
  }

  if (["AVOID / TRAP RISK"].includes(item.conviction)) {
    hardCaps.push(45);
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
