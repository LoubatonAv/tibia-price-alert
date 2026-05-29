function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundGp(value) {
  return Math.max(0, Math.round(safeNumber(value)));
}

function getRiskLimit(item) {
  const scannerTier = String(item.scannerTier || "").toUpperCase();
  const conviction = String(item.conviction || "").toUpperCase();
  const qualityTier = String(item.qualityTier || "").toUpperCase();

  if (scannerTier === "AVOID" || conviction.includes("TRAP")) {
    return { maxQty: 1, action: "AVOID", reason: "Avoid for now; risk is too high." };
  }

  if (scannerTier === "SPECULATIVE" || conviction === "LOW CONVICTION") {
    return {
      maxQty: qualityTier === "DECENT" ? 3 : 1,
      action: "WATCH ONLY",
      reason: "Research only. Do not open a normal buy offer from this signal.",
    };
  }

  if (scannerTier === "WATCH") {
    return {
      maxQty: 5,
      action: "BUY ONLY CHEAP",
      reason: "Reasonable, but only enter with a discounted price and smaller quantity.",
    };
  }

  return null;
}

export function calculateEdgeScore(item) {
  const profit = safeNumber(item.realisticProfit ?? item.profit, 0);
  const profitPercent = safeNumber(
    item.realisticProfitPercent ?? item.profitPercent,
    0,
  );
  const fakeSpreadRisk = safeNumber(item.fakeSpreadRisk, 0);
  const marketPressure = safeNumber(
    item.marketPressure ?? item.undercutPressure,
    0,
  );
  const tradeabilityScore = safeNumber(item.tradeabilityScore, 0);
  const brainScore = safeNumber(item.brainScore, 0);
  const monthSold = safeNumber(item.monthSold ?? item.month_sold, 0);
  const daySold = safeNumber(item.daySold ?? item.day_sold, 0);
  const volumeRatio = safeNumber(item.volumeRatio, 0);

  let score = 0;
  const reasons = [];

  if (profit >= 1500) {
    score += 25;
    reasons.push("good profit");
  } else if (profit >= 700) {
    score += 16;
    reasons.push("decent profit");
  } else if (profit >= 300) {
    score += 8;
    reasons.push("small profit");
  } else {
    score -= 15;
    reasons.push("profit is thin");
  }

  if (profitPercent >= 8) {
    score += 18;
    reasons.push("strong ROI");
  } else if (profitPercent >= 5) {
    score += 12;
    reasons.push("healthy ROI");
  } else if (profitPercent >= 3) {
    score += 5;
    reasons.push("thin ROI");
  } else {
    score -= 18;
    reasons.push("ROI too low");
  }

  if (tradeabilityScore >= 75) {
    score += 18;
    reasons.push("easy exit");
  } else if (tradeabilityScore >= 60) {
    score += 10;
    reasons.push("reasonable exit");
  } else {
    score -= 18;
    reasons.push("harder exit");
  }

  if (brainScore >= 82) score += 14;
  else if (brainScore >= 70) score += 7;
  else score -= 12;

  if (monthSold >= 350 && daySold >= 8) {
    score += 14;
    reasons.push("good demand");
  } else if (monthSold >= 120) {
    score += 7;
    reasons.push("okay demand");
  } else {
    score -= 20;
    reasons.push("low demand");
  }

  if (volumeRatio >= 1.1) score += 8;
  else if (volumeRatio > 0 && volumeRatio < 0.5) score -= 15;

  if (fakeSpreadRisk >= 60) {
    score -= 35;
    reasons.push("fake spread risk");
  } else if (fakeSpreadRisk >= 40) {
    score -= 22;
    reasons.push("spread risk");
  } else if (fakeSpreadRisk <= 20) {
    score += 8;
    reasons.push("cleaner spread");
  }

  if (marketPressure >= 70) {
    score -= 28;
    reasons.push("heavy undercut pressure");
  } else if (marketPressure >= 45) {
    score -= 14;
    reasons.push("some undercut pressure");
  } else if (marketPressure <= 25) {
    score += 8;
    reasons.push("low undercut pressure");
  }

  const edgeScore = clamp(Math.round(score), 0, 100);

  let edgeLabel = "BAD EDGE";
  if (edgeScore >= 78) edgeLabel = "ELITE EDGE";
  else if (edgeScore >= 65) edgeLabel = "GOOD EDGE";
  else if (edgeScore >= 50) edgeLabel = "THIN EDGE";
  else if (edgeScore >= 35) edgeLabel = "WEAK EDGE";

  return {
    edgeScore,
    edgeLabel,
    edgeReasons: [...new Set(reasons)].slice(0, 5),
  };
}

export function getRecommendedQuantity(item, desiredQty = 10) {
  const monthSold = safeNumber(item.monthSold ?? item.month_sold, 0);
  const daySold = safeNumber(item.daySold ?? item.day_sold, 0);
  const fakeSpreadRisk = safeNumber(item.fakeSpreadRisk, 0);
  const marketPressure = safeNumber(
    item.marketPressure ?? item.undercutPressure,
    0,
  );

  const avgDailySold = monthSold > 0 ? monthSold / 30 : 0;
  const demandAnchor = Math.max(daySold, avgDailySold);

  let maxQty;

  if (monthSold < 30) {
    maxQty = 1;
  } else if (monthSold < 100) {
    maxQty = 2;
  } else if (monthSold < 350) {
    maxQty = Math.max(2, Math.floor(demandAnchor * 0.5));
  } else {
    maxQty = Math.max(3, Math.floor(demandAnchor * 0.75));
  }

  if (fakeSpreadRisk >= 40) {
    maxQty = Math.max(1, Math.floor(maxQty * 0.5));
  }

  if (marketPressure >= 45) {
    maxQty = Math.max(1, Math.floor(maxQty * 0.7));
  }

  const riskLimit = getRiskLimit(item);
  if (riskLimit?.maxQty) {
    maxQty = Math.min(maxQty, riskLimit.maxQty);
  }

  maxQty = Math.max(1, Math.min(Math.max(1, desiredQty), maxQty));

  let quantityLabel = "TEST ONLY";
  if (maxQty >= 10) quantityLabel = "CAN SCALE";
  else if (maxQty >= 5) quantityLabel = "MEDIUM SIZE";
  else if (maxQty >= 2) quantityLabel = "SMALL SIZE";

  return {
    recommendedQty: maxQty,
    quantityLabel,
    avgDailySold,
  };
}

export function getTradeStyle(item) {
  const monthSold = safeNumber(item.monthSold ?? item.month_sold, 0);
  const daySold = safeNumber(item.daySold ?? item.day_sold, 0);
  const profitPercent = safeNumber(item.realisticProfitPercent ?? item.profitPercent, 0);
  const fakeSpreadRisk = safeNumber(item.fakeSpreadRisk, 0);
  const marketPressure = safeNumber(item.marketPressure, 0);

  if (fakeSpreadRisk >= 45 || marketPressure >= 55) {
    return {
      tradeStyle: "CAREFUL / DISCOUNT ONLY",
      tradeStyleNote: "Only enter if the buy price is clearly discounted.",
    };
  }

  if (monthSold >= 350 && daySold >= 8 && profitPercent >= 4) {
    return {
      tradeStyle: "FAST FLIP",
      tradeStyleNote: "Prefer quick resale over greed.",
    };
  }

  if (profitPercent >= 8 && monthSold >= 100) {
    return {
      tradeStyle: "PATIENT FLIP",
      tradeStyleNote: "Can be good, but do not overbuy quantity.",
    };
  }

  return {
    tradeStyle: "WATCH FIRST",
    tradeStyleNote: "Numbers are not clean enough for aggressive entry.",
  };
}

export function buildMoneyPlan(item, desiredQty = 10) {
  const edge = calculateEdgeScore(item);
  const quantity = getRecommendedQuantity(item, desiredQty);
  const style = getTradeStyle(item);

  const buyOffer = safeNumber(item.buyOffer ?? item.buy_offer, 0);
  const maxRealisticBuy = safeNumber(item.maxRealisticBuy, 0);
  const realisticExit = safeNumber(item.realisticExit ?? item.sellOffer ?? item.sell_offer, 0);
  const hardMaxBuy = maxRealisticBuy || buyOffer;

  let directAction = "WAIT";
  let directReason = "Not enough clean edge.";

  if (edge.edgeScore >= 70 && buyOffer > 0 && hardMaxBuy > 0 && buyOffer <= hardMaxBuy) {
    directAction = "BUY OFFER OK";
    directReason = "Good edge and current buy price is still acceptable.";
  } else if (edge.edgeScore >= 55 && buyOffer > 0 && hardMaxBuy > 0 && buyOffer <= hardMaxBuy) {
    directAction = "BUY ONLY CHEAP";
    directReason = "Usable, but keep quantity small and do not chase.";
  } else if (buyOffer > hardMaxBuy && hardMaxBuy > 0) {
    directAction = "DO NOT CHASE";
    directReason = "Current buy offer is too close to the realistic exit.";
  }

  const riskLimit = getRiskLimit(item);
  if (riskLimit) {
    if (riskLimit.action === "AVOID") {
      directAction = "AVOID";
      directReason = riskLimit.reason;
    } else if (riskLimit.action === "WATCH ONLY") {
      directAction = "WATCH ONLY";
      directReason = riskLimit.reason;
    } else if (riskLimit.action === "BUY ONLY CHEAP" && directAction === "BUY OFFER OK") {
      directAction = "BUY ONLY CHEAP";
      directReason = riskLimit.reason;
    }
  }

  return {
    ...edge,
    ...quantity,
    ...style,
    directAction,
    directReason,
    hardMaxBuy: roundGp(hardMaxBuy),
    realisticExit: roundGp(realisticExit),
  };
}
