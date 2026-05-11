import { TAX_RATE } from "./constants.js";

export function calculateClosedTrade(
  position,
  sellPrice,
  exitReason = "MANUAL_EXIT",
) {
  const quantity = Number(position.quantity || 1);
  const entryPrice = Number(position.entryPrice || 0);
  const finalSellPrice = Number(sellPrice || 0);

  const grossBuy = entryPrice * quantity;
  const grossSell = finalSellPrice * quantity;
  const taxPaid = grossSell * TAX_RATE;
  const netProfit = grossSell - taxPaid - grossBuy;
  const roiPercent = grossBuy > 0 ? (netProfit / grossBuy) * 100 : 0;

  return {
    id: position.id,
    name: position.name,
    openedAt: position.openedAt || null,
    closedAt: new Date().toISOString(),
    entryPrice,
    sellPrice: finalSellPrice,
    quantity,
    grossBuy,
    grossSell,
    taxPaid,
    netProfit,
    roiPercent,
    entryBrainScore: position.entryBrainScore ?? null,
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
      oldTrade.sellPrice === trade.sellPrice,
  );

  if (!alreadyExists) {
    state.tradeHistory.push(trade);
  }

  return trade;
}

export function closeTrade({
  state,
  position,
  sellPrice,
  exitReason = "MANUAL_EXIT",
}) {
  if (position.status === "CLOSED") {
    throw new Error("Position is already CLOSED.");
  }
  const trade = calculateClosedTrade(position, sellPrice, exitReason);

  addTradeToHistory(state, trade);

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

  return trade;
}
