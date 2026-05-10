import { TAX_RATE } from "./constants.js";

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundGp(value) {
  return Math.max(0, Math.floor(safeNumber(value)));
}

function netAfterSellOffer(price) {
  return price * (1 - TAX_RATE);
}

function profitForTarget(entryPrice, targetSell, quantity = 1) {
  const qty = Math.max(1, safeNumber(quantity, 1));
  const cost = safeNumber(entryPrice) * qty;
  const net = netAfterSellOffer(targetSell) * qty;
  const profit = net - cost;

  return {
    cost,
    net,
    profit,
    profitPercent: cost > 0 ? (profit / cost) * 100 : 0,
  };
}

export function calculateRealisticProfit(entryPrice, realisticSellPrice) {
  const realSellIncome = realisticSellPrice * 0.98;

  const profit = realSellIncome - entryPrice;

  return {
    realisticSellPrice,
    realisticSellIncome,
    realisticProfit: profit,
    realisticProfitPercent: entryPrice > 0 ? (profit / entryPrice) * 100 : 0,
  };
}

export function calculateUndercutPressure(item) {
  const sellOffer = safeNumber(item.sellOffer ?? item.sell_offer);
  const dayAverageSell = safeNumber(
    item.dayAverageSell ?? item.day_average_sell,
  );
  const monthAverageSell = safeNumber(
    item.monthAverageSell ?? item.month_average_sell,
  );
  const volumeRatio = safeNumber(item.volumeRatio);
  const fakeSpreadRisk = safeNumber(item.fakeSpreadRisk);

  let score = 0;
  const notes = [];

  if (!sellOffer) {
    return {
      undercutPressure: 100,
      undercutPressureLevel: "VERY HIGH",
      undercutNotes: "No current sell offer.",
    };
  }

  if (dayAverageSell > 0 && sellOffer > dayAverageSell * 1.05) {
    score += 25;
    notes.push("Current sell is above daily average.");
  }

  if (monthAverageSell > 0 && sellOffer > monthAverageSell * 1.08) {
    score += 25;
    notes.push("Current sell is above monthly average.");
  }

  if (volumeRatio < 0.5) {
    score += 25;
    notes.push("Today volume is weak versus monthly pace.");
  } else if (volumeRatio < 0.8) {
    score += 12;
    notes.push("Volume is slightly weak.");
  }

  if (fakeSpreadRisk >= 40) {
    score += 20;
    notes.push("Fake spread risk is elevated.");
  }

  score = Math.min(100, Math.round(score));

  let level = "LOW";
  if (score >= 70) level = "VERY HIGH";
  else if (score >= 45) level = "HIGH";
  else if (score >= 25) level = "MEDIUM";

  return {
    undercutPressure: score,
    undercutPressureLevel: level,
    undercutNotes: notes.length
      ? notes.join("\n")
      : "No major undercut pressure.",
  };
}

export function buildSellPricingPlan(item, entryPrice, quantity = 1) {
  const sellOffer = safeNumber(item.sellOffer ?? item.sell_offer);
  const dayAverageSell = safeNumber(
    item.dayAverageSell ?? item.day_average_sell,
  );
  const monthAverageSell = safeNumber(
    item.monthAverageSell ?? item.month_average_sell,
  );
  const pressureData = calculateUndercutPressure(item);

  const usableAverages = [dayAverageSell, monthAverageSell].filter(
    (v) => v > 0,
  );
  const averageAnchor = usableAverages.length
    ? Math.min(...usableAverages)
    : sellOffer;

  const fastAnchor = sellOffer || averageAnchor;
  const balancedAnchor = averageAnchor || sellOffer;
  const greedyAnchor = Math.max(sellOffer, dayAverageSell, monthAverageSell);

  const fastSell = roundGp(fastAnchor * 0.995);
  const balancedSell = roundGp(
    Math.min(sellOffer || balancedAnchor, balancedAnchor * 1.01),
  );
  const greedySell = roundGp(greedyAnchor * 1.03);

  const minimumProfitSell = roundGp(
    (safeNumber(entryPrice) * 1.04) / (1 - TAX_RATE),
  );
  const breakEvenSell = roundGp(safeNumber(entryPrice) / (1 - TAX_RATE));

  const finalFastSell = Math.max(fastSell, breakEvenSell);
  const finalBalancedSell = Math.max(balancedSell, minimumProfitSell);
  const finalGreedySell = Math.max(greedySell, finalBalancedSell);

  return {
    ...pressureData,
    breakEvenSell,
    fastSell: finalFastSell,
    balancedSell: finalBalancedSell,
    greedySell: finalGreedySell,
    fastProfit: profitForTarget(entryPrice, finalFastSell, quantity),
    balancedProfit: profitForTarget(entryPrice, finalBalancedSell, quantity),
    greedyProfit: profitForTarget(entryPrice, finalGreedySell, quantity),
  };
}

export function buildBuyPricingPlan(item) {
  const buyOffer = safeNumber(item.buyOffer ?? item.buy_offer);
  const sellOffer = safeNumber(item.sellOffer ?? item.sell_offer);
  const dayAverageSell = safeNumber(
    item.dayAverageSell ?? item.day_average_sell,
  );
  const monthAverageSell = safeNumber(
    item.monthAverageSell ?? item.month_average_sell,
  );

  const exitAnchor = Math.min(
    ...[sellOffer, dayAverageSell, monthAverageSell].filter((v) => v > 0),
  );

  const realisticExit = exitAnchor || sellOffer;
  const desiredMargin = item.monthSold >= 500 ? 0.06 : 0.09;
  const maxRealisticBuy = realisticExit
    ? roundGp((realisticExit * (1 - TAX_RATE)) / (1 + desiredMargin))
    : buyOffer;

  return {
    realisticExit,
    maxRealisticBuy: Math.min(buyOffer || maxRealisticBuy, maxRealisticBuy),
    desiredMarginPercent: desiredMargin * 100,
  };
}
