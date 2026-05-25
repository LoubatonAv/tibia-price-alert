import fs from "fs";
import "dotenv/config";
import readline from "readline";
import { TAX_RATE } from "./lib/constants.js";
import { getItemMap, getMarketValues, getMarketBoard } from "./lib/market.js";
import { addTrackedItem } from "./lib/trackedItemsWriter.js";

const INVENTORY_FILE = "./inventory.json";
const ITEM_DATA_PATHS = ["./data/items.json", "./items.json"];

function safeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function parseAdvisorArgs(args) {
  const positional = [];
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];

    if (
      value === "--live-sell" ||
      value === "--live-lowest-sell" ||
      value === "--lowest-sell"
    ) {
      options.liveSellOffer = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--lowest-sell-qty" ||
      value === "--qty-at-lowest" ||
      value === "--live-lowest-sell-qty"
    ) {
      options.liveLowestSellQty = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--entry-price" ||
      value === "--actual-entry" ||
      value === "--cost"
    ) {
      options.entryPrice = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (value === "--live-buy" || value === "--live-highest-buy") {
      options.liveBuyOffer = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--buy-ahead" ||
      value === "--queue-ahead" ||
      value === "--live-buy-ahead"
    ) {
      options.liveBuyQueueAhead = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--buy-range-low" ||
      value === "--lowest-buy-above" ||
      value === "--live-buy-low"
    ) {
      options.liveBuyRangeLow = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--sell-ahead" ||
      value === "--listing-ahead" ||
      value === "--live-sell-ahead"
    ) {
      options.liveSellQueueAhead = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (
      value === "--buy-available" ||
      value === "--instant-available" ||
      value === "--live-buy-available"
    ) {
      options.liveBuyAvailable = safeNumber(args[i + 1], 0);
      i += 1;
      continue;
    }

    if (value === "--buy-ladder" || value === "--live-buy-ladder") {
      options.liveBuyLadder = args[i + 1] || "";
      i += 1;
      continue;
    }

    positional.push(value);
  }

  return { positional, options };
}

function hasLiveQueue(check) {
  return (
    safeNumber(check.liveSellOffer) > 0 || safeNumber(check.liveBuyOffer) > 0
  );
}

function effectiveBuyOffer(check) {
  return safeNumber(check.liveBuyOffer) || safeNumber(check.currentBuyOffer);
}

function effectiveSellOffer(check) {
  return safeNumber(check.liveSellOffer) || safeNumber(check.currentSellOffer);
}

function formatApiDelayNote(check) {
  if (check.marketBoardAvailable) {
    return "Live market board was fetched automatically; history/liquidity still comes from API averages.";
  }

  return hasLiveQueue(check)
    ? "Live queue was provided manually; API data is used mostly for history/liquidity."
    : "No live queue was provided; API data may be delayed, so verify the live market before acting.";
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function normalizeName(value = "") {
  return String(value).trim().toLowerCase();
}

function loadInventory() {
  if (!fs.existsSync(INVENTORY_FILE)) return { items: [], checks: [] };

  const raw = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
  if (Array.isArray(raw)) return { items: raw, checks: [] };

  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    checks: Array.isArray(raw.checks) ? raw.checks : [],
  };
}

function saveInventory(inventory) {
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventory, null, 2));
}

function loadItemDatabase() {
  const filePath = ITEM_DATA_PATHS.find((path) => fs.existsSync(path));
  if (!filePath) return [];

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function findItemId(input, itemMap) {
  const asNumber = Number(input);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

  const wanted = normalizeName(input);
  for (const [id, name] of Object.entries(itemMap)) {
    if (normalizeName(name) === wanted) return Number(id);
  }

  return null;
}

function findItemInfo(itemId, itemDb) {
  return itemDb.find((item) => Number(item.id) === Number(itemId)) || null;
}

function getBestNpcBuy(itemInfo) {
  const offers = Array.isArray(itemInfo?.npc_buy) ? itemInfo.npc_buy : [];
  const validOffers = offers
    .map((offer) => ({
      name: offer.name || "Unknown NPC",
      location: offer.location || "Unknown location",
      price: safeNumber(offer.price),
    }))
    .filter((offer) => offer.price > 0)
    .sort((a, b) => b.price - a.price);

  return validOffers[0] || null;
}

async function getApiDataSafe(itemId) {
  try {
    const values = await getMarketValues([itemId]);
    return values[0] || null;
  } catch {
    return null;
  }
}

async function getMarketBoardSafe(itemId) {
  try {
    return await getMarketBoard(itemId);
  } catch {
    return null;
  }
}

function getBoardSellers(board) {
  return Array.isArray(board?.sellers) ? board.sellers : [];
}

function getBoardBuyers(board) {
  return Array.isArray(board?.buyers) ? board.buyers : [];
}

function getBuyLadder(board) {
  return getBoardBuyers(board)
    .map((offer) => ({
      price: safeNumber(offer.price, 0),
      amount: safeNumber(offer.amount, 0),
    }))
    .filter((offer) => offer.price > 0 && offer.amount > 0)
    .sort((a, b) => b.price - a.price);
}

function getBuyQueueAheadFromLadder(ladder, targetPrice) {
  const price = safeNumber(targetPrice, 0);
  if (!price || !Array.isArray(ladder) || ladder.length === 0) return 0;

  return ladder.reduce((sum, offer) => {
    return offer.price >= price ? sum + safeNumber(offer.amount, 0) : sum;
  }, 0);
}

function analyzeBuyLadderStructure(ladder, plannedBuyPrice) {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    return {
      source: "API/board fallback",
      summary: "No manual buy ladder was provided.",
      visibleQuantity: 0,
      topPrice: 0,
      topAmount: 0,
      queueAhead: 0,
      whaleWalls: 0,
      recommendation: "Use the live market screen if the API looks delayed.",
    };
  }

  const sorted = [...ladder].sort((a, b) => b.price - a.price);
  const top = sorted[0];
  const visibleQuantity = sorted.reduce(
    (sum, row) => sum + safeNumber(row.amount, 0),
    0,
  );
  const whaleWalls = sorted.filter(
    (row) => safeNumber(row.amount, 0) >= 75,
  ).length;
  const queueAhead = getBuyQueueAheadFromLadder(sorted, plannedBuyPrice);

  let recommendation = "Balanced market structure.";
  if (plannedBuyPrice > top.price) {
    recommendation =
      "You are above the visible top buy. This is fast, but it can start a +1gp war.";
  } else if (plannedBuyPrice === top.price) {
    recommendation =
      "You are matching the visible top buy. Good balance if you are patient.";
  } else if (queueAhead > visibleQuantity * 0.7) {
    recommendation =
      "You are deep below the visible buy ladder. Good value, but fill may take patience.";
  }

  return {
    source: "Manual live ladder",
    summary: `${sorted.length} visible buy levels, ${formatGp(visibleQuantity)} total visible quantity`,
    visibleQuantity,
    topPrice: top.price,
    topAmount: top.amount,
    queueAhead,
    whaleWalls,
    recommendation,
  };
}

function getTopSeller(board) {
  return getBoardSellers(board)[0] || null;
}

function getTopBuyer(board) {
  return getBoardBuyers(board)[0] || null;
}

function getSellQueueAhead(board, targetPrice) {
  const price = safeNumber(targetPrice, 0);
  if (!price) return 0;

  return getBoardSellers(board).reduce((sum, offer) => {
    return offer.price <= price ? sum + safeNumber(offer.amount, 0) : sum;
  }, 0);
}

function getBuyQueueAhead(board, targetPrice) {
  const price = safeNumber(targetPrice, 0);
  if (!price) return 0;

  return getBoardBuyers(board).reduce((sum, offer) => {
    return offer.price >= price ? sum + safeNumber(offer.amount, 0) : sum;
  }, 0);
}

function getTopBuyAvailable(board) {
  const top = getTopBuyer(board);
  if (!top?.price) return 0;

  return getBoardBuyers(board).reduce((sum, offer) => {
    return offer.price === top.price ? sum + safeNumber(offer.amount, 0) : sum;
  }, 0);
}

function simulateInstantSell(board, quantity) {
  let remaining = safeNumber(quantity, 0);
  let total = 0;
  let sold = 0;

  if (!remaining) {
    return { quantity: 0, total: 0, averagePrice: 0, fullyCovered: false };
  }

  for (const offer of getBoardBuyers(board)) {
    if (remaining <= 0) break;

    const take = Math.min(remaining, safeNumber(offer.amount, 0));
    total += take * safeNumber(offer.price, 0);
    sold += take;
    remaining -= take;
  }

  return {
    quantity: sold,
    total,
    averagePrice: sold > 0 ? total / sold : 0,
    fullyCovered: sold >= safeNumber(quantity, 0),
  };
}

function normalizeMarketData(apiData = {}) {
  return {
    currentSellOffer: safeNumber(apiData.sell_offer ?? apiData.sellOffer),
    currentBuyOffer: safeNumber(apiData.buy_offer ?? apiData.buyOffer),
    daySold: safeNumber(apiData.day_sold ?? apiData.daySold),
    monthSold: safeNumber(apiData.month_sold ?? apiData.monthSold),
    dayAverageSell: safeNumber(
      apiData.day_average_sell ?? apiData.dayAverageSell,
    ),
    monthAverageSell: safeNumber(
      apiData.month_average_sell ?? apiData.monthAverageSell,
    ),
  };
}

function getVolumeRatio(daySold, monthSold) {
  const avgDailyVolume = monthSold > 0 ? monthSold / 30 : 0;
  return avgDailyVolume > 0 ? daySold / avgDailyVolume : 0;
}

function getTrendPercent(dayAverageSell, monthAverageSell) {
  if (!dayAverageSell || !monthAverageSell) return 0;
  return ((dayAverageSell - monthAverageSell) / monthAverageSell) * 100;
}

function getSpreadPercent(currentBuyOffer, currentSellOffer) {
  if (!currentBuyOffer || !currentSellOffer) return 0;
  return ((currentSellOffer - currentBuyOffer) / currentBuyOffer) * 100;
}

function getDemandLabel(daySold, monthSold) {
  const volumeRatio = getVolumeRatio(daySold, monthSold);

  if (monthSold >= 500 && daySold >= 10) return "STRONG";
  if (monthSold >= 150 && daySold >= 3) return "GOOD";
  if (monthSold >= 30) return "OK";
  if (monthSold > 0) return "SLOW";
  return "UNKNOWN";
}

function getExitLabel(daySold, monthSold) {
  const volumeRatio = getVolumeRatio(daySold, monthSold);

  if (monthSold >= 500 && volumeRatio >= 0.6) return "Fast / repeatable";
  if (monthSold >= 150) return "Should sell, but may need patience";
  if (monthSold >= 30) return "Slow but possible";
  if (monthSold > 0) return "Very slow / risky";
  return "Unknown exit";
}

function getTrendLabel(trendPercent) {
  if (trendPercent >= 6) return "Price looks hot right now";
  if (trendPercent >= 2) return "Slightly stronger than usual";
  if (trendPercent <= -6) return "Price may be cooling down";
  if (trendPercent <= -2) return "Slightly weaker than usual";
  return "Stable";
}

function getMarketConfidence({
  daySold,
  monthSold,
  currentBuyOffer,
  currentSellOffer,
}) {
  if (monthSold >= 500 && currentBuyOffer > 0) return "HIGH";
  if (monthSold >= 150 && currentBuyOffer > 0) return "GOOD";
  if (monthSold >= 30) return "MEDIUM";
  if (currentBuyOffer > 0 || currentSellOffer > 0) return "LOW";
  return "VERY LOW";
}

function isCreatureProduct(itemInfo) {
  const category = normalizeName(itemInfo?.category);
  return category.includes("creature") || category.includes("product");
}

function getItemBehaviorLabel(itemInfo, monthSold) {
  if (isCreatureProduct(itemInfo)) {
    return monthSold >= 30
      ? "Creature product: often slow, but repeatable"
      : "Creature product: niche / check manually";
  }

  if (monthSold >= 500) return "High-volume item";
  if (monthSold >= 150) return "Tradable item";
  if (monthSold >= 30) return "Patient item";
  return "Niche item";
}

function getUndercutRisk(check) {
  const buyOffer = effectiveBuyOffer(check);
  const sellOffer = effectiveSellOffer(check);
  const spreadPercent = getSpreadPercent(buyOffer, sellOffer);
  const volumeRatio = getVolumeRatio(check.daySold, check.monthSold);

  if (!buyOffer || !sellOffer) {
    return {
      level: "UNKNOWN",
      message: "Not enough buy/sell offer data to judge undercut risk.",
    };
  }

  if (spreadPercent >= 80) {
    return {
      level: "HIGH",
      message:
        "Listed sell prices are far above real buy demand. This may be a stale-listing or undercut trap.",
    };
  }

  if (spreadPercent >= 35 && (check.monthSold < 150 || volumeRatio < 0.5)) {
    return {
      level: "MEDIUM",
      message:
        "The gap between buy offers and sell listings is large. Do not trust the listed sell price too much.",
    };
  }

  if (spreadPercent >= 35) {
    return {
      level: "LOW-MEDIUM",
      message: "Spread is wide, but volume helps. Still avoid overpricing.",
    };
  }

  return {
    level: "LOW",
    message: "No major undercut trap signal from the current offers.",
  };
}

function getRealisticListPrice(check) {
  const instantSell = effectiveBuyOffer(check);
  const liveBuy = safeNumber(check.liveBuyOffer, 0);
  const apiSell = safeNumber(check.currentSellOffer, 0);
  const avg = check.dayAverageSell || check.monthAverageSell || 0;
  const undercutRisk = getUndercutRisk(check);

  let listedSell = apiSell;

  if (check.liveSellOffer > 0) {
    const liveSellLooksValid = !liveBuy || check.liveSellOffer >= liveBuy * 0.9;

    if (liveSellLooksValid) {
      listedSell = check.liveSellOffer;
    }
  }

  if (instantSell > 0 && listedSell > 0) {
    if (undercutRisk.level === "HIGH") return Math.round(instantSell * 1.08);
    if (undercutRisk.level === "MEDIUM") {
      return Math.round(Math.min(listedSell, instantSell * 1.25));
    }
    return listedSell;
  }

  return listedSell || avg || instantSell || 0;
}

function getSafeMarketValue(check) {
  return (
    effectiveBuyOffer(check) ||
    check.dayAverageSell ||
    check.monthAverageSell ||
    effectiveSellOffer(check) ||
    0
  );
}

function calculateNpcArbitrage(check) {
  if (!check.bestNpcBuy?.price || !check.plannedBuyPrice) {
    return null;
  }

  const buyOfferFeePerItem = check.plannedBuyPrice * TAX_RATE;
  const profitPerItem =
    check.bestNpcBuy.price - check.plannedBuyPrice - buyOfferFeePerItem;
  const roi =
    check.plannedBuyPrice > 0
      ? (profitPerItem / check.plannedBuyPrice) * 100
      : 0;

  let action = "NO NPC EDGE";
  if (profitPerItem >= 1000 || roi >= 8) action = "✅ NPC ARBITRAGE";
  else if (profitPerItem > 0) action = "Small NPC edge";
  else action = "NPC not worth it";

  return {
    ...check.bestNpcBuy,
    buyOfferFeePerItem,
    profitPerItem,
    roi,
    action,
  };
}

function getDailyMovement(check) {
  if (check.daySold > 0) return check.daySold;
  if (check.monthSold > 0) return check.monthSold / 30;
  return 0;
}

function getBuyQueueAnalysis(check) {
  const plannedBuy = safeNumber(check.plannedBuyPrice);
  const liveTopBuy = effectiveBuyOffer(check);
  const rangeLow = safeNumber(check.liveBuyRangeLow, 0);
  const queueAhead = safeNumber(check.liveBuyQueueAhead, 0);
  const dailyMovement = getDailyMovement(check);

  const advisorMode = plannedBuy <= 0 && liveTopBuy > 0 && rangeLow > 0;

  const estimatedDays =
    queueAhead > 0 && dailyMovement > 0 ? queueAhead / dailyMovement : null;

  if (advisorMode) {
    let pressure = "UNKNOWN";
    let recommendation = "Not enough movement data to estimate queue pressure.";

    if (estimatedDays !== null) {
      if (estimatedDays <= 1) {
        pressure = "LOW";
        recommendation =
          "Queue is light compared to daily movement. You can use a patient price.";
      } else if (estimatedDays <= 3) {
        pressure = "MEDIUM";
        recommendation =
          "Queue is reasonable. Use a balanced price, not the very top.";
      } else if (estimatedDays <= 7) {
        pressure = "HIGH";
        recommendation =
          "Queue is heavy compared to daily movement. A low offer may take too long.";
      } else {
        pressure = "VERY HIGH";
        recommendation =
          "Queue is very heavy. Stay near the top or skip if the margin is not worth it.";
      }
    }

    return {
      status: "ADVISOR MODE",
      pressure,
      recommendation,
      queueAhead,
      dailyMovement,
      estimatedDays,
      fastFillPrice: liveTopBuy + 1,
      notes: [],
    };
  }

  if (!plannedBuy || !liveTopBuy) {
    return {
      status: "UNKNOWN",
      pressure: "UNKNOWN",
      recommendation: "No live buy queue data was provided.",
      queueAhead,
      dailyMovement,
      estimatedDays: null,
      fastFillPrice: liveTopBuy > 0 ? liveTopBuy + 1 : 0,
      notes: [],
    };
  }

  let status = "UNKNOWN";

  if (plannedBuy > liveTopBuy) {
    status = "TOP OF QUEUE";
  } else if (plannedBuy === liveTopBuy) {
    status = "MATCHING TOP BUY";
  } else {
    status = "BELOW TOP BUY";
  }

  let pressure = "UNKNOWN";
  let recommendation = "";
  const notes = [];

  if (status === "TOP OF QUEUE") {
    pressure = "LOW";
    recommendation =
      "You are above the current top buy offer. This may fill faster, but it is aggressive.";
  } else if (status === "MATCHING TOP BUY") {
    pressure = queueAhead > 0 ? "MEDIUM" : "LOW";
    recommendation =
      "You are matching the current top buy. You may fill, but other buyers can outbid by 1 gp.";
  } else {
    if (!queueAhead || !dailyMovement) {
      pressure = "UNKNOWN";
      recommendation =
        "Your offer is below the current top buy. Add estimated quantity above your price to estimate wait.";
    } else if (estimatedDays <= 1) {
      pressure = "LOW";
      recommendation =
        "Your offer is below top buy, but the queue ahead is light compared to daily movement.";
    } else if (estimatedDays <= 3) {
      pressure = "MEDIUM";
      recommendation =
        "This is a patient buy. It can work, but do not expect instant fills.";
    } else if (estimatedDays <= 7) {
      pressure = "HIGH";
      recommendation =
        "Large queue ahead. This may take a while unless you move closer to the top.";
    } else {
      pressure = "VERY HIGH";
      recommendation =
        "Very large queue ahead. This price may lock your capital for too long.";
    }
  }

  notes.push(`Outbid price: ~${formatGp(liveTopBuy + 1)} gp`);

  return {
    status,
    pressure,
    recommendation,
    queueAhead,
    dailyMovement,
    estimatedDays,
    fastFillPrice: liveTopBuy + 1,
    notes,
  };
}

function getSellQueueAnalysis(check) {
  const queueAhead = safeNumber(check.liveSellQueueAhead, 0);
  const dailyMovement = getDailyMovement(check);

  if (!queueAhead || !dailyMovement) {
    return {
      label: "Unknown",
      estimatedDays: null,
      queueAhead,
      dailyMovement,
    };
  }

  const estimatedDays = queueAhead / dailyMovement;

  let label = "Normal";
  if (estimatedDays > 2) label = "Crowded";
  else if (estimatedDays > 0.75) label = "Busy";

  return {
    label,
    estimatedDays,
    queueAhead,
    dailyMovement,
  };
}

function getSellProfitPerItem({ sellPrice, entryPrice }) {
  const price = safeNumber(sellPrice, 0);
  const entry = safeNumber(entryPrice, 0);

  if (!price || !entry) {
    return null;
  }

  const buyFeePerItem = entry * TAX_RATE;
  const sellFeePerItem = price * TAX_RATE;
  const netSellPerItem = price - sellFeePerItem;
  const profitPerItem = netSellPerItem - entry - buyFeePerItem;
  const roi = entry > 0 ? (profitPerItem / entry) * 100 : 0;

  return {
    sellPrice: price,
    entryPrice: entry,
    buyFeePerItem,
    sellFeePerItem,
    netSellPerItem,
    profitPerItem,
    roi,
  };
}

function getBreakEvenSellPrice(entryPrice) {
  const entry = safeNumber(entryPrice, 0);
  if (!entry) return 0;

  const totalCostPerItem = entry + entry * TAX_RATE;
  return Math.ceil(totalCostPerItem / (1 - TAX_RATE));
}

function suggestSellPrices(check) {
  const currentLowestSell = safeNumber(check.liveSellOffer, 0);
  const plannedPrice = safeNumber(check.yourSellPrice, 0);
  const entryPrice = safeNumber(check.entryPrice, 0);
  const lowestQty = safeNumber(check.liveLowestSellQty, 0);
  const dailyMovement = getDailyMovement(check);
  const breakEvenSellPrice = getBreakEvenSellPrice(entryPrice);

  if (!currentLowestSell && !plannedPrice) {
    return null;
  }

  const baseLowest = currentLowestSell || plannedPrice;
  const fastPrice = baseLowest > 1 ? baseLowest - 1 : baseLowest;
  const matchPrice = baseLowest;
  const patientPrice = Math.round(baseLowest * 1.01);

  const options = [];

  function addOption(label, price, queueAhead, note) {
    const profit = getSellProfitPerItem({
      sellPrice: price,
      entryPrice,
    });

    const estimatedDays =
      queueAhead > 0 && dailyMovement > 0 ? queueAhead / dailyMovement : 0;

    options.push({
      label,
      price,
      queueAhead,
      estimatedDays,
      note,
      profit,
      isProfitable: !entryPrice || !profit ? true : profit.profitPerItem > 0,
    });
  }

  addOption(
    "⚡ Fast / undercut",
    fastPrice,
    0,
    `Undercut current lowest by 1 gp to avoid the ${formatGp(lowestQty)} item wall.`,
  );

  addOption(
    "⚖️ Match current lowest",
    matchPrice,
    lowestQty,
    "Same as current lowest price. You may wait behind the current wall.",
  );

  addOption(
    "🧠 Patient",
    patientPrice,
    lowestQty,
    "Higher profit, but slower. Use only if you are willing to wait.",
  );

  let recommended = options.find(
    (option) => option.label.includes("Fast") && option.isProfitable,
  );

  if (!recommended) {
    recommended = options.find((option) => option.isProfitable) || options[0];
  }

  return {
    currentLowestSell,
    plannedPrice,
    entryPrice,
    lowestQty,
    dailyMovement,
    breakEvenSellPrice,
    options,
    recommended,
  };
}

function buildSellAdvice(check) {
  const quantity = check.quantity;

  const instantSellPrice = effectiveBuyOffer(check);
  const lowestSellOffer =
    safeNumber(check.yourSellPrice, 0) ||
    safeNumber(check.liveSellOffer, 0) ||
    getRealisticListPrice(check);

  const bestNpcBuy = check.bestNpcBuy;
  const npcPrice = bestNpcBuy?.price || 0;

  const demand = getDemandLabel(check.daySold, check.monthSold);
  const undercutRisk = getUndercutRisk(check);

  const marketStability =
    undercutRisk.level === "LOW"
      ? "STABLE"
      : undercutRisk.level === "LOW-MEDIUM" || undercutRisk.level === "MEDIUM"
        ? "WATCH"
        : "UNSTABLE";

  const sellQueue = getSellQueueAnalysis(check);

  const listingFeePerItem = lowestSellOffer * TAX_RATE;
  const listingNetPerItem = lowestSellOffer - listingFeePerItem;
  const listingTotalNet = listingNetPerItem * quantity;

  const buyAvailable = safeNumber(check.liveBuyAvailable, 0);

  const topBuyCoveredQty =
    buyAvailable > 0 ? Math.min(quantity, buyAvailable) : 0;

  const boardInstantQty = safeNumber(check.instantSellQuantity, 0);
  const boardInstantTotal = safeNumber(check.instantSellTotal, 0);
  const boardInstantAverage = safeNumber(check.instantSellAveragePrice, 0);

  const instantQty =
    boardInstantQty ||
    (buyAvailable > 0 ? Math.min(quantity, buyAvailable) : quantity);
  const instantTotalNet = boardInstantTotal || instantSellPrice * instantQty;
  const instantAveragePrice =
    instantQty > 0 ? instantTotalNet / instantQty : instantSellPrice;
  const npcTotalNet = npcPrice * quantity;

  const listingExtraVsInstant = listingNetPerItem - instantSellPrice;
  const listingExtraVsNpc = listingNetPerItem - npcPrice;
  const instantExtraVsNpc = instantAveragePrice - npcPrice;

  const listingLooksSuspicious =
    lowestSellOffer > 0 &&
    instantSellPrice > 0 &&
    lowestSellOffer < instantSellPrice * 0.9;

  let action = "UNKNOWN";
  let bestRoute = "UNKNOWN";
  const reasons = [];
  const warnings = [];

  if (!lowestSellOffer && !instantSellPrice && !npcPrice) {
    action = "LIMITED DATA";
    bestRoute = "UNKNOWN";
    reasons.push("Not enough data to compare selling options.");
  } else if (
    npcPrice > 0 &&
    npcPrice >= listingNetPerItem &&
    npcPrice >= instantSellPrice
  ) {
    action = "🔵 SELL TO NPC";
    bestRoute = "NPC";
    reasons.push(
      "NPC pays more than market listing after fee and instant sell.",
    );
  } else if (
    instantSellPrice > 0 &&
    instantAveragePrice >= listingNetPerItem * 0.98 &&
    (instantQty >= quantity || buyAvailable === 0)
  ) {
    action = "🟢 INSTANT SELL";
    bestRoute = "INSTANT_SELL";
    reasons.push(
      "Instant sell is close to market listing after fee and avoids waiting.",
    );
  } else if (
    lowestSellOffer > 0 &&
    listingExtraVsInstant >= Math.max(250, instantSellPrice * 0.04) &&
    marketStability !== "UNSTABLE" &&
    !["SLOW", "UNKNOWN"].includes(demand)
  ) {
    action = "🟡 LIST ON MARKET";
    bestRoute = "MARKET_LISTING";
    reasons.push(
      "Market listing pays meaningfully more and the market looks stable enough.",
    );
  } else if (instantSellPrice > 0) {
    action = "🟢 INSTANT SELL";
    bestRoute = "INSTANT_SELL";
    reasons.push(
      "The extra profit from listing does not look worth the waiting risk.",
    );
  } else if (npcPrice > 0) {
    action = "🔵 SELL TO NPC";
    bestRoute = "NPC";
    reasons.push("NPC gives a guaranteed sale.");
  } else {
    action = "🟡 LIST ON MARKET";
    bestRoute = "MARKET_LISTING";
    reasons.push("Market listing is the only useful route found.");
  }

  if (buyAvailable > 0 && buyAvailable < quantity) {
    warnings.push(
      `Only ${formatGp(buyAvailable)} of your ${formatGp(quantity)} items can instant-sell at the top buy price.`,
    );
  }

  if (listingLooksSuspicious) {
    warnings.push(
      "Lowest listing is below highest buy. Verify the live market before placing a large order.",
    );
  }

  if (sellQueue.label === "Crowded") {
    warnings.push(
      "Market listing queue looks crowded, so selling may take time.",
    );
  }

  return {
    action,
    bestRoute,
    lowestSellOffer: Math.round(lowestSellOffer),
    instantSellPrice: Math.round(instantSellPrice),
    npcPrice: Math.round(npcPrice),
    listingNetPerItem,
    listingTotalNet,
    instantQty,
    instantTotalNet,
    npcTotalNet,
    listingExtraVsInstant,
    listingExtraVsNpc,
    instantExtraVsNpc,
    demand,
    marketStability,
    sellQueue,
    reasons,
    warnings,
    topBuyCoveredQty,
  };
}

function suggestBuyPrices(check) {
  const ladder = Array.isArray(check.liveBuyLadder) ? check.liveBuyLadder : [];

  const highestBuy = effectiveBuyOffer(check);
  const lowestSell = effectiveSellOffer(check);
  const realisticListPrice = getRealisticListPrice(check);

  const rangeLow = safeNumber(check.liveBuyRangeLow, 0);
  const queueAhead = safeNumber(check.liveBuyQueueAhead, 0);
  const dailyMovement = getDailyMovement(check);
  const volumeRatio = getVolumeRatio(check.daySold, check.monthSold);
  const trendPercent = getTrendPercent(
    check.dayAverageSell,
    check.monthAverageSell,
  );

  if (!highestBuy) return null;

  if (highestBuy > 0 && rangeLow > 0 && rangeLow <= highestBuy) {
    const gap = highestBuy - rangeLow;
    const queueDays =
      queueAhead > 0 && dailyMovement > 0 ? queueAhead / dailyMovement : null;

    let pressureLevel = "UNKNOWN";
    let aggression = 0.55;
    let read =
      "Using buy queue range and market movement to choose an entry price.";

    if (queueDays !== null) {
      if (queueDays <= 1) {
        pressureLevel = "LOW";
        aggression = 0.35;
        read = "Queue is light compared to daily movement. You can be patient.";
      } else if (queueDays <= 3) {
        pressureLevel = "MEDIUM";
        aggression = 0.55;
        read =
          "Queue is reasonable. Balanced entry is better than chasing top.";
      } else if (queueDays <= 7) {
        pressureLevel = "HIGH";
        aggression = 0.78;
        read =
          "Queue is heavy compared to daily movement. Low offers may take too long.";
      } else {
        pressureLevel = "VERY HIGH";
        aggression = 0.9;
        read =
          "Queue is very heavy. Only a near-top offer has a realistic chance soon.";
      }
    }

    if (volumeRatio >= 1.3) aggression += 0.05;
    if (trendPercent >= 2) aggression += 0.05;

    if (volumeRatio < 0.7) aggression -= 0.1;
    if (trendPercent <= -2) aggression -= 0.1;

    aggression = Math.max(0.2, Math.min(0.95, aggression));

    let fastPrice = highestBuy + 1;
    let balancedPrice = Math.round(rangeLow + gap * aggression);
    let patientPrice = Math.round(
      rangeLow + gap * Math.max(0.15, aggression - 0.25),
    );

    let maxReasonableBuy = 0;
    if (realisticListPrice > 0) {
      maxReasonableBuy = Math.floor(
        (realisticListPrice * (1 - TAX_RATE)) / 1.08,
      );

      if (maxReasonableBuy > 0) {
        fastPrice = Math.min(fastPrice, maxReasonableBuy);
        balancedPrice = Math.min(balancedPrice, maxReasonableBuy);
        patientPrice = Math.min(patientPrice, maxReasonableBuy);
      }
    }

    balancedPrice = Math.max(rangeLow, Math.min(highestBuy + 1, balancedPrice));
    patientPrice = Math.max(rangeLow, Math.min(balancedPrice, patientPrice));

    let recommendedLow = balancedPrice;
    let recommendedHigh = balancedPrice;

    if (pressureLevel === "LOW") {
      recommendedLow = patientPrice;
      recommendedHigh = balancedPrice;
    } else if (pressureLevel === "MEDIUM") {
      recommendedLow = Math.min(patientPrice, balancedPrice);
      recommendedHigh = balancedPrice;
    } else if (pressureLevel === "HIGH" || pressureLevel === "VERY HIGH") {
      recommendedLow = balancedPrice;
      recommendedHigh = Math.min(fastPrice, highestBuy + 1);
    }

    const shouldSkip =
      maxReasonableBuy > 0 &&
      balancedPrice >= maxReasonableBuy &&
      maxReasonableBuy <= highestBuy;

    return {
      mode: "queue-velocity",
      fastLow: Math.round(fastPrice),
      fastHigh: Math.round(fastPrice),
      balancedLow: Math.round(balancedPrice),
      balancedHigh: Math.round(balancedPrice),
      patientLow: Math.round(patientPrice),
      patientHigh: Math.round(patientPrice),
      recommendedLow: Math.round(recommendedLow),
      recommendedHigh: Math.round(recommendedHigh),
      highestBuy,
      rangeLow,
      queueAhead,
      dailyMovement,
      queueDays,
      pressureLevel,
      volumeRatio,
      trendPercent,
      aggression,
      maxReasonableBuy,
      shouldSkip,
      read,
    };
  }

  if (ladder.length >= 3) {
    const prices = ladder.map((row) => row.price);

    const fastLow = prices[1] || highestBuy;
    const fastHigh = highestBuy;

    const balancedLow =
      prices[Math.min(5, prices.length - 1)] || highestBuy * 0.997;
    const balancedHigh = prices[2] || highestBuy;

    const visibleBottom = prices[prices.length - 1];
    const patientLow = Math.min(visibleBottom, highestBuy * 0.998);
    const patientHigh =
      prices[Math.min(7, prices.length - 1)] || highestBuy * 0.995;

    return {
      mode: "ladder",
      fastLow: Math.round(fastLow),
      fastHigh: Math.round(fastHigh),
      balancedLow: Math.round(balancedLow),
      balancedHigh: Math.round(balancedHigh),
      patientLow: Math.round(patientLow),
      patientHigh: Math.round(patientHigh),
      recommendedLow: Math.round(balancedLow),
      recommendedHigh: Math.round(balancedHigh),
    };
  }

  if (!lowestSell) return null;

  const spreadPercent = getSpreadPercent(highestBuy, lowestSell);

  let normalLow = highestBuy * 0.997;
  let normalHigh = highestBuy;

  let patientLow = highestBuy * 0.985;
  let patientHigh = highestBuy * 0.995;

  let sniperLow = highestBuy * 0.96;
  let sniperHigh = highestBuy * 0.98;

  if (spreadPercent >= 6) {
    normalLow = highestBuy * 0.994;
    normalHigh = highestBuy * 0.998;
    patientLow = highestBuy * 0.975;
    patientHigh = highestBuy * 0.99;
    sniperLow = highestBuy * 0.94;
    sniperHigh = highestBuy * 0.965;
  }

  return {
    mode: "api",
    fastLow: Math.round(highestBuy + 1),
    fastHigh: Math.round(highestBuy + 1),
    balancedLow: Math.round(normalLow),
    balancedHigh: Math.round(normalHigh),
    patientLow: Math.round(patientLow),
    patientHigh: Math.round(patientHigh),
    sniperLow: Math.round(sniperLow),
    sniperHigh: Math.round(sniperHigh),
    recommendedLow: Math.round(patientLow),
    recommendedHigh: Math.round(patientHigh),
  };
}

function buildBuyAdvice(check) {
  const buyPrice = safeNumber(check.plannedBuyPrice, 0);
  const quantity = check.quantity;
  const instantSellPrice = effectiveBuyOffer(check);
  const lowestSellOffer = effectiveSellOffer(check);
  const safeMarketValue = getSafeMarketValue(check);
  const realisticListPrice = getRealisticListPrice(check);
  const undercutRisk = getUndercutRisk(check);
  const trendPercent = getTrendPercent(
    check.dayAverageSell,
    check.monthAverageSell,
  );
  const demand = getDemandLabel(check.daySold, check.monthSold);
  const exit = getExitLabel(check.daySold, check.monthSold);
  const trend = getTrendLabel(trendPercent);
  const confidence = getMarketConfidence(check);
  const behavior = getItemBehaviorLabel(check.itemInfo, check.monthSold);
  const npcArbitrage = calculateNpcArbitrage(check);
  const queueAnalysis = getBuyQueueAnalysis(check);
  const priceSuggestions = suggestBuyPrices(check);
  const wantsSuggestionOnly = !buyPrice && priceSuggestions;

  const buyOfferFeePerItem = buyPrice * TAX_RATE;
  const instantProfitPerItem =
    instantSellPrice > 0 && buyPrice > 0
      ? instantSellPrice - buyPrice - buyOfferFeePerItem
      : 0;
  const resaleNetSell = realisticListPrice * (1 - TAX_RATE);
  const resaleProfitPerItem =
    realisticListPrice > 0 && buyPrice > 0
      ? resaleNetSell - buyPrice - buyOfferFeePerItem
      : 0;
  const resaleRoi = buyPrice > 0 ? (resaleProfitPerItem / buyPrice) * 100 : 0;

  let action = "UNKNOWN";
  const reasons = [];
  const warnings = [];

  if (wantsSuggestionOnly) {
    action = priceSuggestions.shouldSkip
      ? "⚠️ Skip / Margin Too Tight"
      : "🧠 Buy Offer Suggestion";

    reasons.push(
      priceSuggestions.read ||
        "No buy price was entered, so I am suggesting a price based on queue movement and market data.",
    );
  } else if (!buyPrice) {
    action = "MISSING PRICE";
    reasons.push(
      "Enter a buy price, or use advisor mode with live buy-offer range data.",
    );
  } else if (!safeMarketValue) {
    action = "LIMITED DATA";
    reasons.push("I do not have enough market data to judge this price.");
  } else {
    if (
      npcArbitrage?.profitPerItem > 0 &&
      (npcArbitrage.profitPerItem >= 500 || npcArbitrage.roi >= 5)
    ) {
      action =
        npcArbitrage.profitPerItem >= 1000 || npcArbitrage.roi >= 8
          ? "✅ Cheap Buy + NPC Edge"
          : "✅ Cheap Buy + Small NPC Edge";
      reasons.push(
        "Even if the market is slow, the NPC value gives this item a real floor.",
      );
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 0.7) {
      action = "✅ Cheap Buy";
      reasons.push(
        "This looks like a cheap buy. You are paying much less than normal market value.",
      );
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 0.9) {
      action = "✅ Good Price";
      reasons.push("Your price is below the current instant-sell value.");
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 1.05) {
      action = "👍 Fair Price";
      reasons.push("Your price is close to the current real market value.");
    } else if (lowestSellOffer > 0 && buyPrice < lowestSellOffer) {
      action = "🙂 Okay Price";
      reasons.push(
        "Your price is below the lowest current listing, but not clearly cheap.",
      );
    } else {
      action = "⚠️ Expensive / Wait";
      reasons.push("Your price looks high compared to the current market.");
    }

    if (undercutRisk.level === "HIGH" || undercutRisk.level === "MEDIUM") {
      warnings.push(undercutRisk.message);
    }

    if (demand === "SLOW" || demand === "UNKNOWN") {
      warnings.push("This item may be slow to resell.");
    }

    if (trendPercent < -6) {
      warnings.push("Price looks weaker today than usual.");
    }

    if (confidence === "LOW" || confidence === "VERY LOW") {
      warnings.push("Market confidence is low; use smaller quantities.");
    }
  }

  const resaleLooksGood =
    buyPrice > 0 &&
    resaleProfitPerItem > 0 &&
    resaleRoi >= 8 &&
    ["STRONG", "GOOD", "OK"].includes(demand) &&
    undercutRisk.level !== "HIGH";

  const npcLooksGood = Boolean(
    npcArbitrage && npcArbitrage.profitPerItem > 0 && npcArbitrage.roi >= 3,
  );

  const trackable = resaleLooksGood && check.monthSold >= 30;

  return {
    action,
    safeMarketValue: Math.round(safeMarketValue),
    instantSellPrice: Math.round(instantSellPrice),
    lowestSellOffer: Math.round(lowestSellOffer),
    realisticListPrice: Math.round(realisticListPrice),
    buyOfferFeePerItem,
    instantProfitPerItem: Math.round(instantProfitPerItem),
    resaleProfitPerItem: Math.round(resaleProfitPerItem),
    resaleRoi,
    demand,
    exit,
    trend,
    confidence,
    behavior,
    undercutRisk,
    npcArbitrage,
    reasons,
    warnings,
    flipLooksGood: resaleLooksGood,
    npcLooksGood,
    trackable,
    queueAnalysis,
    priceSuggestions,
  };
}

function askYesNo(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(
        ["y", "yes", "כן", "כ"].includes(String(answer).trim().toLowerCase()),
      );
    });
  });
}

async function maybeAddGoodBuyToTracked(check, advice) {
  if (check.mode !== "buy") return;
  if (!advice.trackable) return;

  const shouldAdd = await askYesNo(
    "\nThis may be a good repeat-flip item. Track it for future scanner checks? Y/N",
  );

  if (!shouldAdd) return;

  let section = "watch";
  if (check.monthSold >= 500 && advice.confidence !== "LOW") section = "safe";
  else if (check.monthSold >= 100) section = "watch";
  else section = "experimental";

  const result = addTrackedItem(check.id, section);

  if (result.added) {
    console.log(
      `\n✅ Added ${check.name} (${check.id}) to tracked-items.json under scanner.${result.section}`,
    );
  } else {
    console.log(`\nℹ️ Not added: ${result.reason}`);
  }
}

function parseBuyLadder(value = "") {
  return String(value)
    .split(",")
    .map((part) => {
      const [price, amount] = part.split(":");
      return {
        price: safeNumber(price, 0),
        amount: safeNumber(amount, 0),
      };
    })
    .filter((row) => row.price > 0 && row.amount > 0)
    .sort((a, b) => b.price - a.price);
}

async function buildCheck(args, itemMap, itemDb) {
  const { positional, options } = parseAdvisorArgs(args);
  const [mode, itemInput, quantityArg, rawPriceArg, optionalA, optionalB] =
    positional;

  const priceArg = rawPriceArg ?? "0";

  if (
    !mode ||
    !["sell", "buy"].includes(mode) ||
    !itemInput ||
    !quantityArg ||
    (mode === "sell" && rawPriceArg === undefined)
  ) {
    printUsage();
    process.exit(1);
  }

  const itemId = findItemId(itemInput, itemMap);
  if (!itemId) {
    console.log(`\n❌ Could not find item: ${itemInput}`);
    console.log(
      "Use item ID, or make sure data/items.json exists if using item names.\n",
    );
    process.exit(1);
  }

  const apiData = await getApiDataSafe(itemId);
  const market = normalizeMarketData(apiData || {});
  const marketBoard = await getMarketBoardSafe(itemId);
  const topSeller = getTopSeller(marketBoard);
  const topBuyer = getTopBuyer(marketBoard);
  const itemInfo = findItemInfo(itemId, itemDb);
  const itemName =
    itemMap[itemId] || apiData?.name || itemInfo?.name || itemInput;
  const bestNpcBuy = getBestNpcBuy(itemInfo);
  const quantity = Math.max(1, safeNumber(quantityArg, 1));
  const plannedOrListingPrice = safeNumber(priceArg, 0);

  const parsedBuyLadder = parseBuyLadder(options.liveBuyLadder);
  const boardBuyLadder = getBuyLadder(marketBoard);
  const effectiveBuyLadder = parsedBuyLadder.length
    ? parsedBuyLadder
    : boardBuyLadder;

  const manualTopBuy = parsedBuyLadder[0]?.price || 0;
  const manualTopBuyAmount = parsedBuyLadder[0]?.amount || 0;

  const liveBuyOffer =
    manualTopBuy ||
    safeNumber(options.liveBuyOffer, 0) ||
    boardBuyLadder[0]?.price ||
    safeNumber(topBuyer?.price, 0) ||
    market.currentBuyOffer ||
    0;

  const boardBuyAvailable =
    manualTopBuyAmount ||
    boardBuyLadder[0]?.amount ||
    safeNumber(topBuyer?.amount, 0) ||
    0;

  const manualLiveSellOffer = safeNumber(options.liveSellOffer, 0);

  const liveSellOffer =
    manualLiveSellOffer ||
    safeNumber(topSeller?.price, 0) ||
    market.currentSellOffer ||
    0;

  const liveSellOfferSource = manualLiveSellOffer
    ? "manual live input"
    : marketBoard
      ? "API market board snapshot"
      : "API average/snapshot";

  const sellQueueTargetPrice = plannedOrListingPrice || liveSellOffer;

  const liveLowestSellQty = safeNumber(options.liveLowestSellQty, 0);
  const manualExactSellAhead = safeNumber(options.liveSellQueueAhead, 0);

  let manualLowestBasedSellAhead = null;

  if (liveSellOffer > 0 && liveLowestSellQty > 0 && plannedOrListingPrice > 0) {
    if (plannedOrListingPrice < liveSellOffer) {
      // Example:
      // You list at 59,999 while current lowest is 60,000.
      // The 60,000 wall is NOT ahead of you.
      manualLowestBasedSellAhead = 0;
    } else if (plannedOrListingPrice === liveSellOffer) {
      // Same price as current lowest.
      // Existing quantity at that price is ahead of you.
      manualLowestBasedSellAhead = liveLowestSellQty;
    } else {
      // You list above current lowest.
      // At minimum, the current lowest wall is ahead of you.
      manualLowestBasedSellAhead = liveLowestSellQty;
    }
  }

  const apiSellQueueAhead = getSellQueueAhead(
    marketBoard,
    sellQueueTargetPrice,
  );

  const finalSellQueueAhead =
    manualExactSellAhead > 0
      ? manualExactSellAhead
      : manualLowestBasedSellAhead !== null
        ? manualLowestBasedSellAhead
        : apiSellQueueAhead;

  const buyQueueTargetPrice =
    plannedOrListingPrice ||
    safeNumber(options.liveBuyRangeLow, 0) ||
    liveBuyOffer;

  const manualQueueAhead = getBuyQueueAheadFromLadder(
    effectiveBuyLadder,
    buyQueueTargetPrice,
  );

  const buyLadderStructure = analyzeBuyLadderStructure(
    effectiveBuyLadder,
    buyQueueTargetPrice,
  );

  const instantSellSimulation = simulateInstantSell(marketBoard, quantity);

  const base = {
    checkedAt: new Date().toISOString(),
    mode,
    id: itemId,
    name: itemName,
    quantity,
    itemInfo,
    bestNpcBuy,
    ...market,
    marketBoardAvailable: Boolean(marketBoard),
    manualBuyLadderProvided: parsedBuyLadder.length > 0,

    liveSellOffer,
    liveSellOfferSource,
    liveLowestSellQty,

    liveBuyOffer,
    liveBuyRangeLow: safeNumber(options.liveBuyRangeLow, 0),

    liveBuyQueueAhead:
      safeNumber(options.liveBuyQueueAhead, 0) ||
      manualQueueAhead ||
      getBuyQueueAhead(marketBoard, buyQueueTargetPrice),

    liveSellQueueAhead: finalSellQueueAhead,

    instantSellQuantity: instantSellSimulation.quantity,
    instantSellTotal: instantSellSimulation.total,
    instantSellAveragePrice: instantSellSimulation.averagePrice,
    instantSellFullyCovered: instantSellSimulation.fullyCovered,

    apiDataAvailable: Boolean(apiData),

    liveBuyAvailable:
      safeNumber(options.liveBuyAvailable, 0) || boardBuyAvailable,

    liveBuyLadder: effectiveBuyLadder,
    buyLadderStructure,
  };

  if (mode === "sell") {
    return {
      ...base,
      yourSellPrice: safeNumber(priceArg, 0),
      minSellPrice: safeNumber(optionalA, 0),
      entryPrice: safeNumber(options.entryPrice, 0) || safeNumber(optionalB, 0),
      plannedBuyPrice: 0,
    };
  }

  return {
    ...base,
    plannedBuyPrice: safeNumber(priceArg, 0),
    yourSellPrice: 0,
    minSellPrice: 0,
    entryPrice: 0,
  };
}

function printSellReport(check) {
  const advice = buildSellAdvice(check);

  console.log("\n==============================");
  console.log("         SELL CHECK");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);
  if (check.entryPrice > 0) {
    console.log(`Entry price: ${formatGp(check.entryPrice)} gp`);
  }
  if (advice.lowestSellOffer > 0) {
    console.log(`Lowest sell offer: ${formatGp(advice.lowestSellOffer)} gp`);
  }

  if (check.yourSellPrice > 0) {
    console.log(`Your planned list price: ${formatGp(check.yourSellPrice)} gp`);
  }

  if (check.liveSellOffer > 0) {
    console.log(
      `Current lowest live sell offer: ${formatGp(check.liveSellOffer)} gp`,
    );
  }

  if (check.liveSellOfferSource) {
    console.log(`Live sell source: ${check.liveSellOfferSource}`);
  }

  if (check.liveSellQueueAhead > 0) {
    console.log(
      `Items ahead of your planned price: ${formatGp(check.liveSellQueueAhead)}`,
    );
  }

  if (advice.instantSellPrice > 0) {
    console.log(`Highest buy offer: ${formatGp(advice.instantSellPrice)} gp`);
  }

  if (check.liveBuyAvailable > 0) {
    console.log(
      `Instant-buy quantity available: ${formatGp(check.liveBuyAvailable)}`,
    );
  }
  const sellSuggestions = suggestSellPrices(check);

  if (sellSuggestions) {
    console.log("");
    console.log("Suggested sell prices:");

    if (sellSuggestions.breakEvenSellPrice > 0) {
      console.log(
        `Break-even sell price: ~${formatGp(sellSuggestions.breakEvenSellPrice)} gp`,
      );
    }

    sellSuggestions.options.forEach((option) => {
      const profitText = option.profit
        ? ` | profit: ~${formatGp(option.profit.profitPerItem)} gp each (${formatPercent(option.profit.roi)})`
        : "";

      const waitText =
        option.queueAhead > 0 && option.estimatedDays > 0
          ? ` | wait: ~${option.estimatedDays.toFixed(1)} days`
          : "";

      console.log(
        `${option.label}: ${formatGp(option.price)} gp${profitText}${waitText}`,
      );
      console.log(`  ${option.note}`);
    });

    console.log("");
    console.log(
      `Recommended sell price: ${formatGp(sellSuggestions.recommended.price)} gp`,
    );
    console.log(`Reason: ${sellSuggestions.recommended.note}`);
  }
  console.log("");
  console.log(`Decision: ${advice.action}`);
  console.log("");
  console.log("Options:");

  if (advice.lowestSellOffer > 0) {
    console.log(
      `Market listing: ${formatGp(advice.lowestSellOffer)} gp each → ~${formatGp(advice.listingNetPerItem)} gp after fee`,
    );

    if (advice.sellQueue.queueAhead > 0) {
      console.log(`Listing queue: ${advice.sellQueue.label}`);

      if (advice.sellQueue.dailyMovement > 0) {
        console.log(
          `Estimated daily movement from API: ${formatGp(advice.sellQueue.dailyMovement)} items/day`,
        );
      }

      if (advice.sellQueue.estimatedDays !== null) {
        console.log(
          `Estimated wait: ~${Math.round(advice.sellQueue.estimatedDays)} days`,
        );
      } else {
        console.log(
          "Estimated wait: unknown because API daily movement was not available.",
        );
      }
    }
  }

  if (advice.instantSellPrice > 0) {
    console.log(
      `Instant sell top price: ${formatGp(advice.instantSellPrice)} gp each`,
    );

    if (advice.instantQty > 0) {
      console.log(
        `Top buy offer covers: ${formatGp(advice.topBuyCoveredQty)} / ${formatGp(check.quantity)} items`,
      );

      if (advice.instantAveragePrice > 0 && advice.instantQty > 1) {
        console.log(
          `Average instant-sell price: ~${formatGp(advice.instantAveragePrice)} gp`,
        );
      }
    }
  }

  if (advice.npcPrice > 0) {
    console.log(`NPC: ${formatGp(advice.npcPrice)} gp each guaranteed`);
  }

  console.log("");
  console.log("Market:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Market stability: ${advice.marketStability}`);

  console.log("");
  console.log(`Meaning: ${advice.reasons.join(" ")}`);

  if (advice.warnings.length) {
    console.log("");
    advice.warnings.forEach((warning) => {
      console.log(`Careful: ${warning}`);
    });
  }

  console.log("");
  console.log(`Item ID: ${check.id}`);
  console.log("");

  return advice;
}

function printBuyReport(check) {
  const advice = buildBuyAdvice(check);

  console.log("\n==============================");
  console.log("       BUY PRICE CHECK");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);

  if (check.plannedBuyPrice > 0) {
    console.log(`Buy price: ${formatGp(check.plannedBuyPrice)} gp`);
  } else {
    console.log("Buy price: advisor mode");
  }

  if (check.liveBuyOffer > 0) {
    console.log(`Live highest buy offer: ${formatGp(check.liveBuyOffer)} gp`);
  }

  if (check.plannedBuyPrice > 0 && check.liveSellOffer > 0) {
    console.log(
      `Live lowest sell listing: ${formatGp(check.liveSellOffer)} gp`,
    );
  }

  console.log("");
  console.log(`Decision: ${advice.action}`);

  if (advice.priceSuggestions) {
    const s = advice.priceSuggestions;

    console.log("");
    console.log("Suggested buy prices:");
    console.log(
      `⚡ Fast fills: ${formatGp(s.fastLow)}–${formatGp(s.fastHigh)} gp`,
    );
    console.log(
      `⚖️ Balanced: ${formatGp(s.balancedLow)}–${formatGp(s.balancedHigh)} gp`,
    );
    console.log(
      `🧠 Value / patient: ${formatGp(s.patientLow)}–${formatGp(s.patientHigh)} gp`,
    );

    if (s.sniperLow && s.sniperHigh) {
      console.log(
        `🎯 Sniper: ${formatGp(s.sniperLow)}–${formatGp(s.sniperHigh)} gp`,
      );
    }

    console.log(
      `Recommended for you: ${formatGp(s.recommendedLow)}–${formatGp(s.recommendedHigh)} gp`,
    );

    if (s.mode === "queue-velocity") {
      console.log("");
      console.log("Buy queue intelligence:");
      console.log(`Highest buy: ${formatGp(s.highestBuy)} gp`);
      console.log(`Lowest relevant buy: ${formatGp(s.rangeLow)} gp`);

      if (s.queueAhead > 0) {
        console.log(`Estimated quantity in range: ${formatGp(s.queueAhead)}`);
      }

      if (s.dailyMovement > 0) {
        console.log(
          `Estimated daily movement: ${formatGp(s.dailyMovement)} items/day`,
        );
      }

      if (s.queueDays !== null && s.queueDays !== undefined) {
        console.log(
          `Queue pressure: ${s.pressureLevel} (~${Math.round(s.queueDays)} days of movement)`,
        );
      } else {
        console.log(`Queue pressure: ${s.pressureLevel}`);
      }

      console.log(`Market read: ${s.read}`);

      if (s.maxReasonableBuy > 0) {
        console.log(`Profit-safe ceiling: ~${formatGp(s.maxReasonableBuy)} gp`);
      }

      if (s.shouldSkip) {
        console.log(
          "Warning: queue requires aggressive pricing, but profit margin looks too tight.",
        );
      }
    }
  }

  if (advice.instantSellPrice > 0) {
    console.log(
      `People are buying now at: ${formatGp(advice.instantSellPrice)} gp`,
    );
  }

  if (advice.lowestSellOffer > 0) {
    console.log(
      `Lowest current listing: ${formatGp(advice.lowestSellOffer)} gp`,
    );
  }

  if (advice.buyOfferFeePerItem > 0) {
    console.log(
      `Buy offer fee at your price: ${formatGp(advice.buyOfferFeePerItem)} gp each`,
    );
  }

  if (
    advice.priceSuggestions?.mode === "ladder" &&
    check.buyLadderStructure?.visibleQuantity > 0
  ) {
    console.log("");
    console.log("Live buy ladder:");
    console.log(`Source: ${check.buyLadderStructure.source}`);
    console.log(
      `Visible quantity: ${formatGp(check.buyLadderStructure.visibleQuantity)}`,
    );
    console.log(
      `Top buy wall: ${formatGp(check.buyLadderStructure.topAmount)} @ ${formatGp(check.buyLadderStructure.topPrice)} gp`,
    );
    if (check.buyLadderStructure.whaleWalls > 0) {
      console.log(`Large buy walls: ${check.buyLadderStructure.whaleWalls}`);
    }
    console.log(`Read: ${check.buyLadderStructure.recommendation}`);
  }

  if (advice.queueAnalysis) {
    console.log("");
    console.log("Buy queue:");

    let queueState = "Normal";
    if (
      advice.queueAnalysis.pressure === "HIGH" ||
      advice.queueAnalysis.pressure === "VERY HIGH"
    ) {
      queueState = "Crowded";
    } else if (advice.queueAnalysis.pressure === "MEDIUM") {
      queueState = "Busy";
    }

    console.log(`Queue: ${queueState}`);

    if (advice.queueAnalysis.queueAhead > 0) {
      console.log(
        `Items ahead / in range: ${formatGp(advice.queueAnalysis.queueAhead)}`,
      );
    }

    if (advice.queueAnalysis.dailyMovement > 0) {
      console.log(
        `Estimated daily movement: ${formatGp(advice.queueAnalysis.dailyMovement)} items/day`,
      );
    }

    if (advice.queueAnalysis.estimatedDays !== null) {
      console.log(
        `Estimated wait pressure: ~${Math.round(advice.queueAnalysis.estimatedDays)} days of movement`,
      );
    }

    console.log(`Queue advice: ${advice.queueAnalysis.recommendation}`);

    advice.queueAnalysis.notes.forEach((note) => {
      console.log(note);
    });
  }

  console.log("");
  console.log("Resell:");
  let marketStability = "UNSTABLE";

  if (advice.undercutRisk.level === "LOW") {
    marketStability = "STABLE";
  } else if (
    advice.undercutRisk.level === "LOW-MEDIUM" ||
    advice.undercutRisk.level === "MEDIUM"
  ) {
    marketStability = "WATCH";
  }

  console.log(`Expected resale: ~${formatGp(advice.realisticListPrice)} gp`);
  console.log(`Demand: ${advice.demand}`);
  console.log(`Market stability: ${marketStability}`);

  if (advice.npcArbitrage && advice.npcArbitrage.profitPerItem > 0) {
    console.log("");
    console.log("NPC check:");
    console.log(
      `NPC buys for: ${formatGp(advice.npcArbitrage.price)} gp (${advice.npcArbitrage.name}, ${advice.npcArbitrage.location})`,
    );
    console.log(
      `Profit vs NPC after buy-offer fee: ${formatGp(advice.npcArbitrage.profitPerItem)} gp each`,
    );
    console.log(`NPC ROI: ${formatPercent(advice.npcArbitrage.roi)}`);
  }

  console.log("");
  console.log(`Meaning: ${advice.reasons.join(" ")}`);

  if (advice.warnings.length) {
    console.log("");
    console.log(`Careful: ${advice.warnings.join(" ")}`);
  }

  console.log("");
  console.log(`Item ID: ${check.id}`);
  console.log("");

  return advice;
}

function rememberCheck(check) {
  const inventory = loadInventory();

  const checkToSave = {
    ...check,
    itemInfo: check.itemInfo
      ? {
          id: check.itemInfo.id,
          category: check.itemInfo.category,
          tier: check.itemInfo.tier,
          wiki_name: check.itemInfo.wiki_name,
        }
      : null,
  };

  inventory.checks.unshift(checkToSave);
  inventory.checks = inventory.checks.slice(0, 100);

  const existingIndex = inventory.items.findIndex(
    (item) => Number(item.id) === Number(check.id),
  );

  const itemSnapshot = {
    id: check.id,
    name: check.name,
    quantity: check.quantity,
    category: check.itemInfo?.category || null,
    lastMode: check.mode,
    lastCheckedAt: check.checkedAt,
    bestNpcBuy: check.bestNpcBuy,
    lastAdvisorInput: {
      yourSellPrice: check.yourSellPrice,
      plannedBuyPrice: check.plannedBuyPrice,
      minSellPrice: check.minSellPrice,
      entryPrice: check.entryPrice,
      liveSellOffer: check.liveSellOffer,
      liveBuyOffer: check.liveBuyOffer,
      liveBuyRangeLow: check.liveBuyRangeLow,
      liveBuyQueueAhead: check.liveBuyQueueAhead,
      liveSellQueueAhead: check.liveSellQueueAhead,
    },
    lastMarketData: {
      currentSellOffer: check.currentSellOffer,
      currentBuyOffer: check.currentBuyOffer,
      daySold: check.daySold,
      monthSold: check.monthSold,
      dayAverageSell: check.dayAverageSell,
      monthAverageSell: check.monthAverageSell,
      liveSellOffer: check.liveSellOffer,
      liveBuyOffer: check.liveBuyOffer,
      apiDataAvailable: check.apiDataAvailable,
    },
  };

  if (existingIndex >= 0) {
    inventory.items[existingIndex] = {
      ...inventory.items[existingIndex],
      ...itemSnapshot,
    };
  } else {
    inventory.items.push(itemSnapshot);
  }

  saveInventory(inventory);
}

function printUsage() {
  console.log(`
Usage:

Sell check:
  node inventory.js sell ITEM_ID_OR_NAME QUANTITY YOUR_LIST_PRICE --lowest-sell LOWEST_SELL --sell-ahead QUANTITY_AHEAD

Buy offer advisor:
  node inventory.js buy ITEM_ID_OR_NAME QUANTITY 0 --live-buy HIGHEST_BUY --buy-range-low LOWEST_RELEVANT_BUY --buy-ahead QUANTITY_IN_RANGE

Buy price check:
  node inventory.js buy ITEM_ID_OR_NAME QUANTITY BUY_PRICE --live-buy HIGHEST_BUY --buy-range-low LOWEST_RELEVANT_BUY --buy-ahead QUANTITY_IN_RANGE

Manual fallback options still work:
  --live-sell PRICE --live-buy PRICE --sell-ahead QUANTITY --buy-available QUANTITY --buy-ahead QUANTITY

Examples:
  node inventory.js sell "silver token" 10 59999 --lowest-sell 60000 --sell-ahead 150
  node inventory.js sell 3081 14 0
  node inventory.js buy "stone skin amulet" 100 0 --live-buy 8215 --buy-range-low 8107 --buy-ahead 860
  node inventory.js buy 9633 10 10100
`);
}

async function main() {
  const args = process.argv.slice(2);
  const itemMap = getItemMap();
  const itemDb = loadItemDatabase();

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    printUsage();
    return;
  }

  const check = await buildCheck(args, itemMap, itemDb);

  rememberCheck(check);

  if (check.mode === "sell") {
    printSellReport(check);
    return;
  }

  const advice = printBuyReport(check);
  await maybeAddGoodBuyToTracked(check, advice);
}

main().catch((error) => {
  console.error("\nInventory advisor failed:");
  console.error(error.message || error);
  process.exit(1);
});
