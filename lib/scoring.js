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

import { clamp } from "./utils.js";

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
