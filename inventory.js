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

    positional.push(value);
  }

  return { positional, options };
}

function hasLiveQueue(check) {
  return safeNumber(check.liveSellOffer) > 0 || safeNumber(check.liveBuyOffer) > 0;
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
    dayAverageSell: safeNumber(apiData.day_average_sell ?? apiData.dayAverageSell),
    monthAverageSell: safeNumber(apiData.month_average_sell ?? apiData.monthAverageSell),
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

function getMarketConfidence({ daySold, monthSold, currentBuyOffer, currentSellOffer }) {
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
    return monthSold >= 30 ? "Creature product: often slow, but repeatable" : "Creature product: niche / check manually";
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
      message: "Listed sell prices are far above real buy demand. This may be a stale-listing or undercut trap.",
    };
  }

  if (spreadPercent >= 35 && (check.monthSold < 150 || volumeRatio < 0.5)) {
    return {
      level: "MEDIUM",
      message: "The gap between buy offers and sell listings is large. Do not trust the listed sell price too much.",
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
  const listedSell = effectiveSellOffer(check);
  const avg = check.dayAverageSell || check.monthAverageSell || 0;
  const undercutRisk = getUndercutRisk(check);

  // Live sell offer is execution truth: if user provides the current lowest listing,
  // suggest around that queue instead of a delayed API/historical average.
  if (check.liveSellOffer > 0) return check.liveSellOffer;

  if (instantSell > 0 && listedSell > 0) {
    if (undercutRisk.level === "HIGH") return Math.round(instantSell * 1.08);
    if (undercutRisk.level === "MEDIUM") return Math.round(Math.min(listedSell, instantSell * 1.25));
    return listedSell;
  }

  return listedSell || avg || instantSell || 0;
}

function getSafeMarketValue(check) {
  return effectiveBuyOffer(check) || check.dayAverageSell || check.monthAverageSell || effectiveSellOffer(check) || 0;
}

function calculateNpcArbitrage(check) {
  if (!check.bestNpcBuy?.price || !check.plannedBuyPrice) {
    return null;
  }

  const buyOfferFeePerItem = check.plannedBuyPrice * TAX_RATE;
  const profitPerItem = check.bestNpcBuy.price - check.plannedBuyPrice - buyOfferFeePerItem;
  const roi = check.plannedBuyPrice > 0 ? (profitPerItem / check.plannedBuyPrice) * 100 : 0;

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

function buildSellAdvice(check) {
  const realisticListPrice = getRealisticListPrice(check);
  const undercutRisk = getUndercutRisk(check);
  const trendPercent = getTrendPercent(check.dayAverageSell, check.monthAverageSell);
  const spreadPercent = getSpreadPercent(effectiveBuyOffer(check), effectiveSellOffer(check));
  const demand = getDemandLabel(check.daySold, check.monthSold);
  const exit = getExitLabel(check.daySold, check.monthSold);
  const trend = getTrendLabel(trendPercent);
  const confidence = getMarketConfidence(check);
  const behavior = getItemBehaviorLabel(check.itemInfo, check.monthSold);

  const yourPrice = check.yourSellPrice;
  const quantity = check.quantity;
  const minSellPrice = check.minSellPrice;
  const entryPrice = check.entryPrice;

  const sellOfferFeePerItem = yourPrice * TAX_RATE;
  const netPerItem = yourPrice - sellOfferFeePerItem;
  const netTotal = netPerItem * quantity;
  const profitPerItem = entryPrice > 0 ? netPerItem - entryPrice : 0;
  const roi = entryPrice > 0 ? (profitPerItem / entryPrice) * 100 : 0;

  let action = "WAIT";
  let suggestedPrice = yourPrice || realisticListPrice || check.currentSellOffer || 0;
  let minRecommended = minSellPrice || 0;
  const reasons = [];
  const warnings = [];

  if (!yourPrice) {
    action = "MISSING PRICE";
    reasons.push("Enter the price you are thinking of listing for.");
  } else if (!realisticListPrice && !check.currentBuyOffer) {
    action = "LIMITED DATA";
    suggestedPrice = yourPrice;
    reasons.push("I do not have enough market data to judge this listing.");
  } else {
    const goodDemand = ["STRONG", "GOOD"].includes(demand);
    const slowDemand = ["SLOW", "UNKNOWN"].includes(demand);
    const referencePrice = realisticListPrice || check.currentBuyOffer;

    const tooCheap = yourPrice < referencePrice * 0.97;
    const fairPrice = yourPrice >= referencePrice * 0.97 && yourPrice <= referencePrice * 1.07;
    const highButPossible = yourPrice > referencePrice * 1.07 && yourPrice <= referencePrice * 1.18;
    const tooHigh = yourPrice > referencePrice * 1.18;

    if (minSellPrice > 0 && yourPrice < minSellPrice) {
      action = "WAIT";
      suggestedPrice = minSellPrice;
      reasons.push("Your price is below your own minimum.");
    } else if (tooCheap) {
      action = "DO NOT UNDERCUT";
      suggestedPrice = Math.max(referencePrice, minSellPrice);
      reasons.push("You are listing below the realistic market area.");
    } else if (goodDemand && fairPrice && undercutRisk.level !== "HIGH") {
      action = "✅ LIST / SELL";
      suggestedPrice = yourPrice;
      reasons.push("Your price is realistic and the item should move.");
    } else if (fairPrice) {
      action = "LIST NORMAL / PATIENT";
      suggestedPrice = yourPrice;
      reasons.push("Your price is fair, but expect some waiting.");
    } else if (highButPossible && !slowDemand && undercutRisk.level !== "HIGH") {
      action = "LIST HIGH / PATIENT";
      suggestedPrice = yourPrice;
      reasons.push("You can try this price, but watch for undercuts.");
    } else if (tooHigh || undercutRisk.level === "HIGH") {
      action = "⚠️ PRICE MAY BE TOO HIGH";
      suggestedPrice = referencePrice;
      reasons.push("The listing price may look good on paper, but the real buyer demand is lower.");
    } else {
      action = "LIST NORMAL";
      suggestedPrice = yourPrice;
      reasons.push("This is within a reasonable market range.");
    }

    if (trendPercent < -6) warnings.push("Price looks weaker today than usual.");
    if (spreadPercent > 35) warnings.push(undercutRisk.message);
    if (entryPrice > 0 && roi < 3 && action.includes("SELL")) {
      warnings.push("Profit after market fee is low compared with your cost.");
    }

    minRecommended = Math.max(minSellPrice, Math.floor(referencePrice * 0.97), effectiveBuyOffer(check) || 0);
  }

  return {
    action,
    suggestedPrice: Math.round(suggestedPrice),
    minRecommended: Math.round(minRecommended),
    realisticListPrice: Math.round(realisticListPrice),
    fastSellPrice: Math.round(effectiveBuyOffer(check) || 0),
    sellOfferFeePerItem,
    netTotal,
    profitPerItem,
    roi,
    demand,
    exit,
    trend,
    confidence,
    behavior,
    undercutRisk,
    reasons,
    warnings,
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
  const trendPercent = getTrendPercent(check.dayAverageSell, check.monthAverageSell);
  const demand = getDemandLabel(check.daySold, check.monthSold);
  const exit = getExitLabel(check.daySold, check.monthSold);
  const trend = getTrendLabel(trendPercent);
  const confidence = getMarketConfidence(check);
  const behavior = getItemBehaviorLabel(check.itemInfo, check.monthSold);
  const npcArbitrage = calculateNpcArbitrage(check);

  const buyOfferFeePerItem = buyPrice * TAX_RATE;
  const instantProfitPerItem = instantSellPrice > 0 ? instantSellPrice - buyPrice - buyOfferFeePerItem : 0;
  const resaleNetSell = realisticListPrice * (1 - TAX_RATE);
  const resaleProfitPerItem = realisticListPrice > 0 ? resaleNetSell - buyPrice - buyOfferFeePerItem : 0;
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
    if (npcArbitrage?.profitPerItem > 0 && (npcArbitrage.profitPerItem >= 500 || npcArbitrage.roi >= 5)) {
      action = npcArbitrage.profitPerItem >= 1000 || npcArbitrage.roi >= 8
        ? "✅ Cheap Buy + NPC Edge"
        : "✅ Cheap Buy + Small NPC Edge";
      reasons.push("Even if the market is slow, the NPC value gives this item a real floor.");
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 0.7) {
      action = "✅ Cheap Buy";
      reasons.push("This looks like a cheap buy. You are paying much less than normal market value.");
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 0.9) {
      action = "✅ Good Price";
      reasons.push("Your price is below the current instant-sell value.");
    } else if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 1.05) {
      action = "👍 Fair Price";
      reasons.push("Your price is close to the current real market value.");
    } else if (lowestSellOffer > 0 && buyPrice < lowestSellOffer) {
      action = "🙂 Okay Price";
      reasons.push("Your price is below the cheapest listed sell offer, but not clearly cheap.");
    } else {
      action = "⚠️ Expensive / Wait";
      reasons.push("Your price looks high compared to the current market.");
    }

    if (undercutRisk.level === "HIGH" || undercutRisk.level === "MEDIUM") warnings.push(undercutRisk.message);
    if (demand === "SLOW" || demand === "UNKNOWN") warnings.push("This item may be slow to resell.");
    if (trendPercent < -6) warnings.push("Price looks weaker today than usual.");
    if (confidence === "LOW" || confidence === "VERY LOW") warnings.push("Market confidence is low; use smaller quantities.");
  }

  const resaleLooksGood =
    buyPrice > 0 &&
    resaleProfitPerItem > 0 &&
    resaleRoi >= 8 &&
    ["STRONG", "GOOD", "OK"].includes(demand) &&
    undercutRisk.level !== "HIGH";

  const npcLooksGood = Boolean(npcArbitrage && npcArbitrage.profitPerItem > 0 && npcArbitrage.roi >= 3);
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
  };
}

function askYesNo(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(["y", "yes", "כן", "כ"].includes(String(answer).trim().toLowerCase()));
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
    console.log(`\n✅ Added ${check.name} (${check.id}) to tracked-items.json under scanner.${result.section}`);
  } else {
    console.log(`\nℹ️ Not added: ${result.reason}`);
  }
}

async function buildCheck(args, itemMap, itemDb) {
  const { positional, options } = parseAdvisorArgs(args);
  const [mode, itemInput, quantityArg, priceArg, optionalA, optionalB] = positional;

  if (!mode || !["sell", "buy"].includes(mode) || !itemInput || !quantityArg || !priceArg) {
    printUsage();
    process.exit(1);
  }

  const itemId = findItemId(itemInput, itemMap);
  if (!itemId) {
    console.log(`\n❌ Could not find item: ${itemInput}`);
    console.log("Use item ID, or make sure data/items.json exists if using item names.\n");
    process.exit(1);
  }

  const apiData = await getApiDataSafe(itemId);
  const market = normalizeMarketData(apiData || {});
  const itemInfo = findItemInfo(itemId, itemDb);
  const itemName = itemMap[itemId] || apiData?.name || itemInfo?.name || itemInput;
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
    apiDataAvailable: Boolean(apiData),
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
  console.log("        SELL ADVISOR");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);
  console.log(`Your list price: ${formatGp(check.yourSellPrice)} gp`);
  if (check.liveSellOffer > 0) console.log(`Live lowest sell listing: ${formatGp(check.liveSellOffer)} gp`);
  if (check.liveBuyOffer > 0) console.log(`Live highest buy offer: ${formatGp(check.liveBuyOffer)} gp`);
  console.log("");

  console.log(`Decision: ${advice.action}`);
  console.log(`Competitive list price: ${formatGp(advice.suggestedPrice)} gp`);
  console.log(`Do not list below: ${formatGp(advice.minRecommended)} gp`);

  if (advice.fastSellPrice > 0) console.log(`Fast sell now: ${formatGp(advice.fastSellPrice)} gp each`);
  if (advice.sellOfferFeePerItem > 0) console.log(`Market fee if listed: ${formatGp(advice.sellOfferFeePerItem)} gp each`);

  console.log("");
  console.log("Market read:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Resell speed: ${advice.exit}`);
  console.log(`Confidence: ${advice.confidence}`);
  console.log(`Item behavior: ${advice.behavior}`);
  console.log(`Price direction: ${advice.trend}`);
  console.log(`${hasLiveQueue(check) ? "Live competitive area" : "API/historical value area"}: around ${formatGp(advice.realisticListPrice)} gp`);
  console.log(`Undercut risk: ${advice.undercutRisk.level}`);
  console.log(`Execution note: ${formatApiDelayNote(check)}`);
  console.log(`Execution note: ${formatApiDelayNote(check)}`);

  if (check.entryPrice > 0) {
    console.log("");
    console.log("Profit:");
    console.log(`Profit per item after listing fee: ${formatGp(advice.profitPerItem)} gp`);
    console.log(`ROI: ${formatPercent(advice.roi)}`);
    console.log(`Net total if sold: ${formatGp(advice.netTotal)} gp`);
  }

  if (check.bestNpcBuy?.price) {
    console.log("");
    console.log("NPC floor:");
    console.log(`NPC buys for: ${formatGp(check.bestNpcBuy.price)} gp (${check.bestNpcBuy.name}, ${check.bestNpcBuy.location})`);
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

function printBuyReport(check) {
  const advice = buildBuyAdvice(check);

  console.log("\n==============================");
  console.log("       BUY PRICE CHECK");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);
  console.log(`Your buy price: ${formatGp(check.plannedBuyPrice)} gp`);
  if (check.liveBuyOffer > 0) console.log(`Live highest buy offer: ${formatGp(check.liveBuyOffer)} gp`);
  if (check.liveSellOffer > 0) console.log(`Live lowest sell listing: ${formatGp(check.liveSellOffer)} gp`);
  console.log("");

  console.log(`Decision: ${advice.action}`);

  if (advice.instantSellPrice > 0) console.log(`People are buying now at: ${formatGp(advice.instantSellPrice)} gp`);
  if (advice.lowestSellOffer > 0) console.log(`Cheapest listed sell offer: ${formatGp(advice.lowestSellOffer)} gp`);
  if (advice.safeMarketValue > 0) console.log(`Safe market reference: around ${formatGp(advice.safeMarketValue)} gp`);
  if (advice.buyOfferFeePerItem > 0) console.log(`Buy offer fee at your price: ${formatGp(advice.buyOfferFeePerItem)} gp each`);

  console.log("");
  console.log("Simple read:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Resell speed: ${advice.exit}`);
  console.log(`Confidence: ${advice.confidence}`);
  console.log(`Item behavior: ${advice.behavior}`);
  console.log(`Price direction: ${advice.trend}`);
  console.log(`Undercut risk: ${advice.undercutRisk.level}`);
  console.log(`Execution note: ${formatApiDelayNote(check)}`);

  if (advice.npcArbitrage) {
    console.log("");
    console.log("NPC check:");
    console.log(`NPC buys for: ${formatGp(advice.npcArbitrage.price)} gp (${advice.npcArbitrage.name}, ${advice.npcArbitrage.location})`);
    console.log(`Profit vs NPC after buy-offer fee: ${formatGp(advice.npcArbitrage.profitPerItem)} gp each`);
    console.log(`NPC ROI: ${formatPercent(advice.npcArbitrage.roi)}`);
  }

  if (advice.flipLooksGood) {
    console.log("");
    console.log("Possible resale:");
    console.log(`Possible list target: ${formatGp(advice.realisticListPrice)} gp`);
    console.log(`Possible profit per item after fees: ${formatGp(advice.resaleProfitPerItem)} gp`);
    console.log(`Estimated ROI: ${formatPercent(advice.resaleRoi)}`);
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
      ? { id: check.itemInfo.id, category: check.itemInfo.category, tier: check.itemInfo.tier, wiki_name: check.itemInfo.wiki_name }
      : null,
  };

  inventory.checks.unshift(checkToSave);
  inventory.checks = inventory.checks.slice(0, 100);

  const existingIndex = inventory.items.findIndex((item) => Number(item.id) === Number(check.id));

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

  if (existingIndex >= 0) inventory.items[existingIndex] = { ...inventory.items[existingIndex], ...itemSnapshot };
  else inventory.items.push(itemSnapshot);

  saveInventory(inventory);
}

function printUsage() {
  console.log(`
Usage:

Sell advisor:
  node inventory.js sell ITEM_ID_OR_NAME QUANTITY YOUR_SELL_PRICE [MIN_SELL_PRICE] [YOUR_COST] [--live-sell PRICE] [--live-buy PRICE]

Buy price check:
  node inventory.js buy ITEM_ID_OR_NAME QUANTITY PLANNED_BUY_PRICE [--live-sell PRICE] [--live-buy PRICE]

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
