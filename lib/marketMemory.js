import { ensureMarketMemory } from "./state.js";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function updateAverage(currentAverage, currentCount, nextValue) {
  const value = safeNumber(nextValue, 0);
  return (safeNumber(currentAverage, 0) * (currentCount - 1) + value) / currentCount;
}

export function updateMarketMemory(state, items = []) {
  const memory = ensureMarketMemory(state);

  for (const item of items) {
    const itemId = String(item.id);
    if (!itemId || itemId === "undefined") continue;

    if (!memory[itemId]) {
      memory[itemId] = {
        timesSeen: 0,
        avgBrainScore: 0,
        avgProfitPercent: 0,
        avgVolumeRatio: 0,
        avgTradeability: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        avgRealProfit: 0,
        avgRealRoi: 0,
        lastSeen: null,
        lastTradeAt: null,
      };
    }

    const entry = memory[itemId];
    entry.timesSeen += 1;

    entry.avgBrainScore = updateAverage(entry.avgBrainScore, entry.timesSeen, item.brainScore);
    entry.avgProfitPercent = updateAverage(
      entry.avgProfitPercent,
      entry.timesSeen,
      item.realisticProfitPercent || item.profitPercent,
    );
    entry.avgVolumeRatio = updateAverage(entry.avgVolumeRatio, entry.timesSeen, item.volumeRatio);
    entry.avgTradeability = updateAverage(entry.avgTradeability, entry.timesSeen, item.tradeabilityScore);
    entry.lastSeen = new Date().toISOString();
  }
}

export function updateMarketMemoryFromTrades(state) {
  const memory = ensureMarketMemory(state);
  const trades = Array.isArray(state.tradeHistory) ? state.tradeHistory : [];

  for (const trade of trades) {
    const itemId = String(trade.id);
    if (!itemId || itemId === "undefined") continue;

    if (!memory[itemId]) {
      memory[itemId] = {
        timesSeen: 0,
        avgBrainScore: 0,
        avgProfitPercent: 0,
        avgVolumeRatio: 0,
        avgTradeability: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        avgRealProfit: 0,
        avgRealRoi: 0,
        lastSeen: null,
        lastTradeAt: null,
      };
    }

    if (trade.memoryApplied) continue;

    const entry = memory[itemId];
    const profit = safeNumber(trade.netProfit, 0);
    const roi = safeNumber(trade.roiPercent, 0);

    entry.tradeCount += 1;
    if (profit >= 0) entry.wins += 1;
    else entry.losses += 1;

    entry.avgRealProfit = updateAverage(entry.avgRealProfit, entry.tradeCount, profit);
    entry.avgRealRoi = updateAverage(entry.avgRealRoi, entry.tradeCount, roi);
    entry.lastTradeAt = trade.closedAt || new Date().toISOString();

    trade.memoryApplied = true;
  }
}

export function getPersonalTradeConfidence(state, itemId) {
  const memory = ensureMarketMemory(state);
  const entry = memory[String(itemId)];

  if (!entry || safeNumber(entry.tradeCount, 0) < 3) {
    return {
      label: "BUILDING",
      scoreAdjust: 0,
      summary: "Personal trade memory is still building.",
    };
  }

  const winrate = entry.tradeCount > 0 ? entry.wins / entry.tradeCount : 0;
  const avgRoi = safeNumber(entry.avgRealRoi, 0);

  if (winrate >= 0.7 && avgRoi > 0) {
    return {
      label: "HIGH",
      scoreAdjust: 5,
      summary: `Personal confidence HIGH: ${entry.wins}/${entry.tradeCount} wins, avg ROI ${avgRoi.toFixed(2)}%.`,
    };
  }

  if (winrate < 0.45 || avgRoi < 0) {
    return {
      label: "LOW",
      scoreAdjust: -7,
      summary: `Personal confidence LOW: ${entry.wins}/${entry.tradeCount} wins, avg ROI ${avgRoi.toFixed(2)}%.`,
    };
  }

  return {
    label: "MEDIUM",
    scoreAdjust: 0,
    summary: `Personal confidence MEDIUM: ${entry.wins}/${entry.tradeCount} wins, avg ROI ${avgRoi.toFixed(2)}%.`,
  };
}
