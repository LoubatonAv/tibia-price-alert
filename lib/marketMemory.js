import { ensureMarketMemory } from "./state.js";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function updateMarketMemory(state, items = []) {
  const memory = ensureMarketMemory(state);

  for (const item of items) {
    const itemId = String(item.id);

    if (!memory[itemId]) {
      memory[itemId] = {
        timesSeen: 0,
        avgBrainScore: 0,
        avgProfitPercent: 0,
        avgVolumeRatio: 0,
        avgTradeability: 0,
        lastSeen: null,
      };
    }

    const entry = memory[itemId];

    entry.timesSeen += 1;

    entry.avgBrainScore =
      (entry.avgBrainScore * (entry.timesSeen - 1) +
        safeNumber(item.brainScore)) /
      entry.timesSeen;

    entry.avgProfitPercent =
      (entry.avgProfitPercent * (entry.timesSeen - 1) +
        safeNumber(item.realisticProfitPercent || item.profitPercent)) /
      entry.timesSeen;

    entry.avgVolumeRatio =
      (entry.avgVolumeRatio * (entry.timesSeen - 1) +
        safeNumber(item.volumeRatio)) /
      entry.timesSeen;

    entry.avgTradeability =
      (entry.avgTradeability * (entry.timesSeen - 1) +
        safeNumber(item.tradeabilityScore)) /
      entry.timesSeen;

    entry.lastSeen = new Date().toISOString();
  }
}
