import fs from "fs";
import "dotenv/config";
import readline from "readline";
import { TAX_RATE } from "./lib/constants.js";
import { getItemMap, getMarketValues } from "./lib/market.js";
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

    if (value === "--live-sell" || value === "--live-lowest-sell") {
      options.liveSellOffer = safeNumber(args[i + 1], 0);
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

function normalizeMarketData(apiData = {}) {
  return {
    // currentBuyOffer = highest buy offer from players; if you own the item, this is the fast-sell price.
    // currentSellOffer = cheapest/representative listed sell offer; useful, but less reliable due to undercuts/stale listings.
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
  const queueAhead = safeNumber(check.liveBuyQueueAhead, 0);
  const dailyMovement = getDailyMovement(check);

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

  const estimatedDays =
    queueAhead > 0 && dailyMovement > 0 ? queueAhead / dailyMovement : null;

  let pressure = "UNKNOWN";
  let recommendation = "";
  const notes = [];

  if (status === "TOP OF QUEUE") {
    pressure = "LOW";
    recommendation =
      "You are above the current top buy offer, so you should fill faster, but you are paying aggressively.";
  } else if (status === "MATCHING TOP BUY") {
    pressure = queueAhead > 0 ? "MEDIUM" : "LOW";
    recommendation =
      "You are matching the current top buy. You may fill, but other buyers can still outbid you by 1 gp.";
  } else {
    if (!queueAhead || !dailyMovement) {
      pressure = "UNKNOWN";
      recommendation =
        "Your offer is below the current top buy. Add queue-ahead quantity to estimate how long it may take.";
    } else if (estimatedDays <= 0.5) {
      pressure = "LOW";
      recommendation =
        "Your offer is below top buy, but the queue ahead looks small compared to daily movement.";
    } else if (estimatedDays <= 2) {
      pressure = "MEDIUM";
      recommendation =
        "This is a patient buy. It can work, but do not expect instant fills.";
    } else {
      pressure = "HIGH";
      recommendation =
        "Large queue ahead. This may take a while unless you outbid.";
    }
  }

  notes.push(`Outbid price: ~${formatGp(liveTopBuy + 1)} gp`);

  if (effectiveSellOffer(check) > 0 && effectiveSellOffer(check) < liveTopBuy) {
    notes.push(
      "Lowest listing is below top buy. Verify the live market before placing a large order.",
    );
  }

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
  };
}

function buildSellAdvice(check) {
  const quantity = check.quantity;

  const instantSellPrice = effectiveBuyOffer(check);
  const lowestSellOffer =
    safeNumber(check.liveSellOffer, 0) ||
    safeNumber(check.yourSellPrice, 0) ||
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
  const instantQty =
    buyAvailable > 0 ? Math.min(quantity, buyAvailable) : quantity;

  const instantTotalNet = instantSellPrice * instantQty;
  const npcTotalNet = npcPrice * quantity;

  const listingExtraVsInstant = listingNetPerItem - instantSellPrice;
  const listingExtraVsNpc = listingNetPerItem - npcPrice;
  const instantExtraVsNpc = instantSellPrice - npcPrice;

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
    instantSellPrice >= listingNetPerItem * 0.98 &&
    (buyAvailable === 0 || buyAvailable >= quantity)
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
  };
}

function suggestBuyPrices(check) {
  const ladder = Array.isArray(check.liveBuyLadder) ? check.liveBuyLadder : [];

  const highestBuy = ladder[0]?.price || effectiveBuyOffer(check);
  const lowestSell = effectiveSellOffer(check);

  if (!highestBuy) return null;

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
      recommendedLow: Math.round(patientLow),
      recommendedHigh: Math.round(patientHigh),
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
  const buyPrice = check.plannedBuyPrice;
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

  const buyOfferFeePerItem = buyPrice * TAX_RATE;
  const instantProfitPerItem =
    instantSellPrice > 0 ? instantSellPrice - buyPrice - buyOfferFeePerItem : 0;
  const resaleNetSell = realisticListPrice * (1 - TAX_RATE);
  const resaleProfitPerItem =
    realisticListPrice > 0 ? resaleNetSell - buyPrice - buyOfferFeePerItem : 0;
  const resaleRoi = buyPrice > 0 ? (resaleProfitPerItem / buyPrice) * 100 : 0;

  let action = "UNKNOWN";
  const reasons = [];
  const warnings = [];

  if (!buyPrice) {
    action = "MISSING PRICE";
    reasons.push("Enter the price you are thinking of paying.");
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
        "Your price is below the Lowest current listing, but not clearly cheap.",
      );
    } else {
      action = "⚠️ Expensive / Wait";
      reasons.push("Your price looks high compared to the current market.");
    }

    if (undercutRisk.level === "HIGH" || undercutRisk.level === "MEDIUM")
      warnings.push(undercutRisk.message);
    if (demand === "SLOW" || demand === "UNKNOWN")
      warnings.push("This item may be slow to resell.");
    if (trendPercent < -6)
      warnings.push("Price looks weaker today than usual.");
    if (confidence === "LOW" || confidence === "VERY LOW")
      warnings.push("Market confidence is low; use smaller quantities.");
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
  const [mode, itemInput, quantityArg, priceArg, optionalA, optionalB] =
    positional;

  if (
    !mode ||
    !["sell", "buy"].includes(mode) ||
    !itemInput ||
    !quantityArg ||
    !priceArg
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
  const itemInfo = findItemInfo(itemId, itemDb);
  const itemName =
    itemMap[itemId] || apiData?.name || itemInfo?.name || itemInput;
  const bestNpcBuy = getBestNpcBuy(itemInfo);

  const base = {
    checkedAt: new Date().toISOString(),
    mode,
    id: itemId,
    name: itemName,
    quantity: Math.max(1, safeNumber(quantityArg, 1)),
    itemInfo,
    bestNpcBuy,
    ...market,
    liveSellOffer: safeNumber(options.liveSellOffer, 0),
    liveBuyOffer: safeNumber(options.liveBuyOffer, 0),
    liveBuyQueueAhead: safeNumber(options.liveBuyQueueAhead, 0),
    liveSellQueueAhead: safeNumber(options.liveSellQueueAhead, 0),
    liveBuyAvailable: safeNumber(options.liveBuyAvailable, 0),
    apiDataAvailable: Boolean(apiData),
    liveBuyLadder: parseBuyLadder(options.liveBuyLadder),
  };

  if (mode === "sell") {
    return {
      ...base,
      yourSellPrice: safeNumber(priceArg, 0),
      minSellPrice: safeNumber(optionalA, 0),
      entryPrice: safeNumber(optionalB, 0),
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

  if (advice.lowestSellOffer > 0) {
    console.log(`Lowest sell offer: ${formatGp(advice.lowestSellOffer)} gp`);
  }

  if (check.liveSellQueueAhead > 0) {
    console.log(
      `Items listed at/below that price: ${formatGp(check.liveSellQueueAhead)}`,
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

  console.log("");
  console.log(`Decision: ${advice.action}`);
  if (advice.priceSuggestions) {
    const s = advice.priceSuggestions;

    console.log("");
    console.log("Suggested buy prices:");
    console.log(`⚡ Fast fill: ${formatGp(s.fast)}+ gp`);
    console.log(
      `🙂 Normal fill: ${formatGp(s.normalLow)}–${formatGp(s.normalHigh)} gp`,
    );
    console.log(
      `🧠 Patient / value entry: ${formatGp(s.patientLow)}–${formatGp(s.patientHigh)} gp`,
    );
    console.log(
      `🎯 Sniper price: ${formatGp(s.sniperLow)}–${formatGp(s.sniperHigh)} gp`,
    );
    console.log(
      `Recommended for you: ${formatGp(s.recommendedLow)}–${formatGp(s.recommendedHigh)} gp`,
    );
  }
  console.log("");
  console.log("Options:");

  if (advice.lowestSellOffer > 0) {
    console.log(
      `Market listing: ${formatGp(advice.lowestSellOffer)} gp each → ~${formatGp(advice.listingNetPerItem)} gp after fee`,
    );

    if (advice.sellQueue.queueAhead > 0) {
      console.log(`Listing queue: ${advice.sellQueue.label}`);

      if (advice.sellQueue.estimatedDays !== null) {
        console.log(
          `Estimated wait: ~${Math.round(advice.sellQueue.estimatedDays)} days`,
        );
      }
    }
  }

  if (advice.instantSellPrice > 0) {
    console.log(`Instant sell: ${formatGp(advice.instantSellPrice)} gp each`);

    if (check.liveBuyAvailable > 0) {
      console.log(
        `Can instant-sell now: ${formatGp(advice.instantQty)} / ${formatGp(check.quantity)} items`,
      );
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
  console.log(`Buy price: ${formatGp(check.plannedBuyPrice)} gp`);
  if (check.liveBuyOffer > 0)
    console.log(`Live highest buy offer: ${formatGp(check.liveBuyOffer)} gp`);
  if (check.liveSellOffer > 0)
    console.log(
      `Live lowest sell listing: ${formatGp(check.liveSellOffer)} gp`,
    );
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
  }
  if (advice.instantSellPrice > 0)
    console.log(
      `People are buying now at: ${formatGp(advice.instantSellPrice)} gp`,
    );
  if (advice.lowestSellOffer > 0)
    console.log(
      `Lowest current listing: ${formatGp(advice.lowestSellOffer)} gp`,
    );

  if (advice.buyOfferFeePerItem > 0)
    console.log(
      `Buy offer fee at your price: ${formatGp(advice.buyOfferFeePerItem)} gp each`,
    );
  if (advice.queueAnalysis) {
    console.log("");
    console.log("Buy queue:");
    let queueState = "Normal";

    if (advice.queueAnalysis.pressure === "HIGH") {
      queueState = "Crowded";
    } else if (advice.queueAnalysis.pressure === "MEDIUM") {
      queueState = "Busy";
    }

    console.log(`Queue: ${queueState}`);

    if (advice.queueAnalysis.queueAhead > 0) {
      console.log(
        `Items ahead of your offer: ${formatGp(advice.queueAnalysis.queueAhead)}`,
      );
    }

    if (advice.queueAnalysis.estimatedDays !== null) {
      console.log(
        `Estimated wait: ~${Math.round(advice.queueAnalysis.estimatedDays)} days`,
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

  if (existingIndex >= 0)
    inventory.items[existingIndex] = {
      ...inventory.items[existingIndex],
      ...itemSnapshot,
    };
  else inventory.items.push(itemSnapshot);

  saveInventory(inventory);
}

function printUsage() {
  console.log(`
Usage:

Sell advisor:
  node inventory.js sell ITEM_ID_OR_NAME QUANTITY YOUR_SELL_PRICE [MIN_SELL_PRICE] [YOUR_COST] [--live-sell PRICE] [--live-buy PRICE]

Buy price check:
  node inventory.js buy ITEM_ID_OR_NAME QUANTITY BUY_PRICE [--live-sell PRICE] [--live-buy PRICE] [--buy-ahead QUANTITY]

Examples:
  node inventory.js sell 3081 5 9200
  node inventory.js sell 3081 5 9200 8900 8150 --live-sell 9233 --live-buy 8222
  node inventory.js buy 3081 15 8150 --live-sell 9233 --live-buy 8222
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
  } else {
    const advice = printBuyReport(check);
    await maybeAddGoodBuyToTracked(check, advice);
  }
}

main().catch((error) => {
  console.error("\nInventory advisor failed:");
  console.error(error.message || error);
  process.exit(1);
});
