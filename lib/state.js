import fs from "fs";
import { MAX_HISTORY } from "./constants.js";
const STATE_FILE = "./state.json";

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      items: {},
      alerts: {},
      sellAlerts: {},
      market: {},
      tradeHistory: [],
      tradeStats: {
        totalTrades: 0,
        totalProfit: 0,
        wins: 0,
        losses: 0,
        bestTrade: null,
        worstTrade: null,
      },
    };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!state.items) state.items = {};
  if (!state.alerts) state.alerts = {};
  if (!state.sellAlerts) state.sellAlerts = {};
  if (!state.market) state.market = {};
  if (!state.discovery) state.discovery = {};
  if (!state.discovery.cursor) state.discovery.cursor = 0;
  if (!state.discovery.history) state.discovery.history = {};
  if (!state.discovery.cache) state.discovery.cache = {};
  if (!state.discovery.cache.marketValues) state.discovery.cache.marketValues = {};
  if (!state.tradeHistory) state.tradeHistory = [];

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
  return state;
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function updateItemHistory(state, item, calculated) {
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

export function ensureMarketMemory(state) {
  if (!state.marketMemory) state.marketMemory = {};
  return state.marketMemory;
}
