import { TAX_RATE } from "./constants.js";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveQuantity(value, fallback = 1) {
  return Math.max(1, safeNumber(value, fallback));
}

function calculateOfferFee(price, quantity) {
  return safeNumber(price) * safeNumber(quantity) * TAX_RATE;
}

export function normalizePosition(position) {
  if (!position.openedAt && position.createdAt)
    position.openedAt = position.createdAt;
  if (!position.createdAt && position.openedAt)
    position.createdAt = position.openedAt;

  if (!position.flow) position.flow = "LEGACY";

  if (!position.originalQuantity) {
    position.originalQuantity = positiveQuantity(position.quantity, 1);
  }

  position.quantity = Math.max(
    0,
    safeNumber(position.quantity, position.originalQuantity),
  );
  position.receivedQuantity = safeNumber(
    position.receivedQuantity,
    position.quantity,
  );
  position.listedQuantity = safeNumber(position.listedQuantity, 0);
  position.soldQuantity = safeNumber(position.soldQuantity, 0);

  position.orderedQuantity = safeNumber(
    position.orderedQuantity,
    position.originalQuantity,
  );
  position.totalListedQuantity = safeNumber(
    position.totalListedQuantity,
    position.listedQuantity,
  );

  position.buyOfferFeePaid = safeNumber(position.buyOfferFeePaid, 0);
  position.sellOfferFeePaid = safeNumber(position.sellOfferFeePaid, 0);

  if (!position.events) position.events = [];

  return position;
}

export function calculateBuyOfferFee(entryPrice, quantity) {
  return calculateOfferFee(entryPrice, quantity);
}

export function calculateSellOfferFee(listPrice, quantity) {
  return calculateOfferFee(listPrice, quantity);
}

export function calculateClosedTrade(
  position,
  sellPrice,
  exitReason = "MANUAL_EXIT",
  quantityOverride = null,
) {
  normalizePosition(position);

  const quantity = positiveQuantity(
    quantityOverride ?? position.quantity ?? 1,
    1,
  );
  const entryPrice = safeNumber(
    position.entryPrice || position.averageEntryPrice || 0,
  );
  const finalSellPrice = safeNumber(sellPrice || 0);

  const grossBuy = entryPrice * quantity;
  const grossSell = finalSellPrice * quantity;

  const buyFeeBaseQty = Math.max(
    1,
    safeNumber(position.orderedQuantity, 0) ||
      safeNumber(position.originalQuantity, 0) ||
      quantity,
  );

  const sellFeeBaseQty = Math.max(
    1,
    safeNumber(position.totalListedQuantity, 0) ||
      safeNumber(position.listedQuantity, 0) ||
      quantity,
  );

  const allocatedBuyOfferFee =
    (safeNumber(position.buyOfferFeePaid, 0) / buyFeeBaseQty) * quantity;

  const allocatedSellOfferFee =
    (safeNumber(position.sellOfferFeePaid, 0) / sellFeeBaseQty) * quantity;

  const totalFees = allocatedBuyOfferFee + allocatedSellOfferFee;

  const netProfit = grossSell - grossBuy - totalFees;
  const realCost = grossBuy + totalFees;
  const roiPercent = realCost > 0 ? (netProfit / realCost) * 100 : 0;

  return {
    id: position.id,
    name: position.name,
    openedAt: position.openedAt || position.createdAt || null,
    closedAt: new Date().toISOString(),
    entryPrice,
    sellPrice: finalSellPrice,
    quantity,
    grossBuy,
    grossSell,

    // New accurate fee model:
    buyOfferFeePaid: allocatedBuyOfferFee,
    sellOfferFeePaid: allocatedSellOfferFee,
    totalFees,

    // Kept for backward compatibility with old stats/UI:
    taxPaid: totalFees,

    netProfit,
    roiPercent,
    entryBrainScore: position.entryBrainScore ?? null,
    flow: position.flow || null,
    source: position.source || null,
    isExternal: String(position.flow || "").includes("EXTERNAL") || entryPrice <= 0,
    exitReason,
  };
}

export function addTradeToHistory(state, trade) {
  if (!state.tradeHistory) state.tradeHistory = [];

  const alreadyExists = state.tradeHistory.some(
    (oldTrade) =>
      oldTrade.id === trade.id &&
      oldTrade.closedAt === trade.closedAt &&
      oldTrade.entryPrice === trade.entryPrice &&
      oldTrade.sellPrice === trade.sellPrice &&
      oldTrade.quantity === trade.quantity,
  );

  if (!alreadyExists) {
    state.tradeHistory.push(trade);
  }

  return trade;
}

export function updateTradeStats(state, trade) {
  if (!state.tradeStats) {
    state.tradeStats = {
      totalTrades: 0,
      totalProfit: 0,
      wins: 0,
      losses: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }

  state.tradeStats.totalTrades += 1;
  state.tradeStats.totalProfit += trade.netProfit;

  if (trade.netProfit >= 0) {
    state.tradeStats.wins += 1;
  } else {
    state.tradeStats.losses += 1;
  }

  if (
    !state.tradeStats.bestTrade ||
    trade.netProfit > state.tradeStats.bestTrade.netProfit
  ) {
    state.tradeStats.bestTrade = trade;
  }

  if (
    !state.tradeStats.worstTrade ||
    trade.netProfit < state.tradeStats.worstTrade.netProfit
  ) {
    state.tradeStats.worstTrade = trade;
  }
}

export function closeTrade({
  state,
  position,
  sellPrice,
  exitReason = "MANUAL_EXIT",
  quantity = null,
}) {
  normalizePosition(position);

  if (position.status === "CLOSED") {
    throw new Error("Position is already CLOSED.");
  }

  const closeQuantity = positiveQuantity(quantity ?? position.quantity, 1);

  if (closeQuantity > position.quantity) {
    throw new Error(
      `Cannot sell ${closeQuantity}; only ${position.quantity} remaining.`,
    );
  }

  const trade = calculateClosedTrade(
    position,
    sellPrice,
    exitReason,
    closeQuantity,
  );

  addTradeToHistory(state, trade);
  updateTradeStats(state, trade);

  position.quantity -= closeQuantity;
  position.soldQuantity += closeQuantity;
  position.listedQuantity = Math.max(
    0,
    position.listedQuantity - closeQuantity,
  );
  position.lastSoldAt = trade.closedAt;
  position.lastSellPrice = Number(sellPrice);

  position.events.push({
    type: "SOLD_ITEMS",
    at: trade.closedAt,
    quantity: closeQuantity,
    sellPrice: Number(sellPrice),
    grossSell: trade.grossSell,
    buyOfferFeePaid: trade.buyOfferFeePaid,
    sellOfferFeePaid: trade.sellOfferFeePaid,
    totalFees: trade.totalFees,
    netProfit: trade.netProfit,
    roiPercent: trade.roiPercent,
    exitReason,
  });

  if (position.quantity <= 0) {
    position.quantity = 0;
    position.status = "CLOSED";
    position.closedAt = trade.closedAt;
    position.finalSellPrice = Number(sellPrice);
  } else {
    position.status =
      position.listedQuantity > 0 ? "PARTIALLY_LISTED" : "PARTIALLY_SOLD";
  }

  return trade;
}
