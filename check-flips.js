import axios from "axios";
import fs from "fs";
import "dotenv/config";

const API_URL = "https://api.tibiamarket.top";
const SERVER = "Harmonia";

const TAX_RATE = 0.02;

const MIN_PROFIT = 5000;
const MIN_PROFIT_PERCENT = 3;

const ITEM_IDS = "22118,22516,22721";

const STATE_FILE = "./state.json";
const MAX_HISTORY = 20;

const ALERT_COOLDOWN_HOURS = 6;
const SCORE_IMPROVEMENT_TO_REALERT = 10;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getItemMap() {
  const raw = fs.readFileSync("./data/items.json");
  const items = JSON.parse(raw);

  const map = {};
  items.forEach((item) => {
    map[item.id] = item.name;
  });

  return map;
}

function calculateProfit(buyPrice, sellPrice) {
  const realBuyCost = buyPrice * (1 + TAX_RATE);
  const realSellIncome = sellPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: (profit / realBuyCost) * 100,
  };
}

async function getMarketValues() {
  const res = await axios.get(`${API_URL}/market_values`, {
    params: {
      server: SERVER,
      item_ids: ITEM_IDS,
    },
  });

  return res.data;
}

function getColor(score) {
  if (score >= 80) return 0x00ff00;
  if (score >= 65) return 0xffff00;
  if (score >= 50) return 0xff9900;
  return 0xff0000;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { items: {}, alerts: {}, market: {} };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!state.items) state.items = {};
  if (!state.alerts) state.alerts = {};
  if (!state.market) state.market = {};

  return state;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateItemHistory(state, item, calculated) {
  const id = String(item.id);

  if (!state.items[id]) state.items[id] = [];

  state.items[id].push({
    time: new Date().toISOString(),
    sellOffer: item.sell_offer,
    profitPercent: calculated.profitPercent,
  });

  state.items[id] = state.items[id].slice(-MAX_HISTORY);
}

function analyzeHistory(history) {
  if (!history || history.length < 3) {
    return { historyScore: 0, bottomSignal: false, firstGreenSignal: false };
  }

  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  let score = 0;

  if (last.sellOffer > prev.sellOffer) score += 5;
  if (last.sellOffer < prev.sellOffer) score -= 5;

  return {
    historyScore: score,
    bottomSignal: score > 0,
    firstGreenSignal: score > 3,
  };
}

function getFakeSpreadRisk(item) {
  let risk = 0;

  const spread =
    item.buy_offer > 0
      ? ((item.sell_offer - item.buy_offer) / item.buy_offer) * 100
      : 0;

  if (spread > 40) risk += 25;

  return { fakeSpreadRisk: risk };
}

function calculateBrainScore(item) {
  let score = 50;

  score += clamp(item.profitPercent * 2, 0, 35);
  score += clamp(item.profit / 1000, 0, 20);

  score += item.historyScore;
  score -= item.fakeSpreadRisk;

  score = clamp(score, 0, 100);

  let confidence = "LOW";
  if (score >= 80) confidence = "HIGH";
  else if (score >= 65) confidence = "MEDIUM-HIGH";
  else if (score >= 50) confidence = "MEDIUM";

  let positionSize = "WATCH";
  if (score >= 80) positionSize = "LARGE";
  else if (score >= 65) positionSize = "MEDIUM";
  else if (score >= 50) positionSize = "SMALL";

  return {
    brainScore: Math.round(score),
    confidence,
    positionSize,
  };
}

function calculateMarketVolatility(opportunities, state) {
  let volatility = 0;

  opportunities.forEach((item) => {
    const history = state.items[String(item.id)];
    if (!history || history.length < 2) return;

    const last = history[history.length - 1];
    const prev = history[history.length - 2];

    const change =
      prev.sellOffer > 0
        ? Math.abs((last.sellOffer - prev.sellOffer) / prev.sellOffer) * 100
        : 0;

    volatility += change;
  });

  return Math.round(volatility);
}

function getNextRun(volatility) {
  if (volatility >= 25) return { level: "HIGH", hours: 1 };
  if (volatility >= 10) return { level: "MEDIUM", hours: 3 };
  return { level: "LOW", hours: 6 };
}

function shouldSendAlert(state, item) {
  const last = state.alerts[item.id];

  if (!last) return true;

  const hours = (Date.now() - new Date(last.time)) / 1000 / 60 / 60;

  return (
    hours >= ALERT_COOLDOWN_HOURS ||
    item.brainScore >= last.brainScore + SCORE_IMPROVEMENT_TO_REALERT
  );
}

function markAlert(state, item) {
  state.alerts[item.id] = {
    time: new Date().toISOString(),
    brainScore: item.brainScore,
  };
}

async function sendDiscordAlert(opportunities, state) {
  const filtered = opportunities.filter((item) => shouldSendAlert(state, item));

  if (filtered.length === 0) {
    console.log("No new alerts.");
    return;
  }

  const embeds = filtered.slice(0, 5).map((item) => ({
    title: `${item.name} (${item.brainScore}/100)`,
    color: getColor(item.brainScore),
    fields: [
      {
        name: "🧠 Brain",
        value: `Score: ${item.brainScore}\nConfidence: ${item.confidence}\nSize: ${item.positionSize}`,
      },
      {
        name: "💰 Profit",
        value: `${Math.round(item.profit)} (${item.profitPercent.toFixed(2)}%)`,
      },
      {
        name: "🌍 Market",
        value: `Volatility: ${state.market.volatility}\nLevel: ${state.market.level}`,
      },
    ],
  }));

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: `🧠 Tibia Brain`,
    embeds,
  });

  filtered.forEach((i) => markAlert(state, i));
}

async function main() {
  const items = await getMarketValues();
  const itemMap = getItemMap();
  const state = loadState();

  const opportunities = items.map((item) => {
    const calc = calculateProfit(item.buy_offer, item.sell_offer);

    updateItemHistory(state, item, calc);

    const history = state.items[String(item.id)];
    const historyData = analyzeHistory(history);
    const fake = getFakeSpreadRisk(item);

    const base = {
      id: item.id,
      name: itemMap[item.id],
      buyOffer: item.buy_offer,
      sellOffer: item.sell_offer,
      ...calc,
      ...historyData,
      ...fake,
    };

    return {
      ...base,
      ...calculateBrainScore(base),
    };
  });

  const volatility = calculateMarketVolatility(opportunities, state);
  const run = getNextRun(volatility);

  state.market = {
    volatility,
    level: run.level,
    nextRunHours: run.hours,
  };

  console.log("Market:", state.market);

  await sendDiscordAlert(opportunities, state);

  saveState(state);
}

main().catch(console.error);
