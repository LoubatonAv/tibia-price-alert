import fs from "fs";
import "dotenv/config";
import { TAX_RATE } from "./lib/constants.js";
import { getItemMap, getMarketValues } from "./lib/market.js";
import readline from "readline";
import { addTrackedItem } from "./lib/trackedItemsWriter.js";

const INVENTORY_FILE = "./inventory.json";

function safeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : fallback;
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

function findItemId(input, itemMap) {
  const asNumber = Number(input);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

  const wanted = normalizeName(input);
  for (const [id, name] of Object.entries(itemMap)) {
    if (normalizeName(name) === wanted) return Number(id);
  }

  return null;
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

function getRealisticSellPrice(check) {
  const values = [
    check.currentSellOffer,
    check.dayAverageSell,
    check.monthAverageSell,
  ].filter((value) => value > 0);

  if (!values.length) return 0;

  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function getDemandLabel(daySold, monthSold) {
  const volumeRatio = getVolumeRatio(daySold, monthSold);

  if (monthSold >= 300 && daySold >= 10) return "STRONG";
  if (monthSold >= 100 && daySold >= 3) return "GOOD";
  if (monthSold >= 30) return "OK";
  if (monthSold > 0) return "SLOW";
  return "UNKNOWN";
}

function getExitLabel(daySold, monthSold) {
  const volumeRatio = getVolumeRatio(daySold, monthSold);

  if (monthSold >= 300 && volumeRatio >= 0.7) return "Easy to sell";
  if (monthSold >= 100) return "Should sell, but may need patience";
  if (monthSold >= 30) return "Slow exit";
  if (monthSold > 0) return "Very slow / risky exit";
  return "Unknown exit";
}

function getTrendLabel(trendPercent) {
  if (trendPercent >= 6) return "Price looks hot right now";
  if (trendPercent >= 2) return "Slightly stronger than usual";
  if (trendPercent <= -6) return "Price may be cooling down";
  if (trendPercent <= -2) return "Slightly weaker than usual";
  return "Stable";
}

function buildSellAdvice(check) {
  const realisticSell = getRealisticSellPrice(check);
  const trendPercent = getTrendPercent(
    check.dayAverageSell,
    check.monthAverageSell,
  );
  const spreadPercent = getSpreadPercent(
    check.currentBuyOffer,
    check.currentSellOffer,
  );
  const demand = getDemandLabel(check.daySold, check.monthSold);
  const exit = getExitLabel(check.daySold, check.monthSold);
  const trend = getTrendLabel(trendPercent);

  const yourPrice = check.yourSellPrice;
  const quantity = check.quantity;
  const minSellPrice = check.minSellPrice;
  const entryPrice = check.entryPrice;

  const netPerItem = yourPrice * (1 - TAX_RATE);
  const netTotal = netPerItem * quantity;
  const profitPerItem = entryPrice > 0 ? netPerItem - entryPrice : 0;
  const roi = entryPrice > 0 ? (profitPerItem / entryPrice) * 100 : 0;

  let action = "WAIT";
  let suggestedPrice =
    yourPrice || realisticSell || check.currentSellOffer || 0;
  let minRecommended = minSellPrice || 0;
  const reasons = [];
  const warnings = [];

  const strongData = realisticSell > 0;
  const volumeRatio = getVolumeRatio(check.daySold, check.monthSold);

  if (!yourPrice) {
    action = "MISSING PRICE";
    reasons.push(
      "You need to enter the price you are thinking of selling for.",
    );
  } else if (!strongData) {
    action = "LIMITED DATA";
    suggestedPrice = yourPrice;
    reasons.push(
      "I could not get enough market data, so I cannot judge the market properly.",
    );
  } else {
    const goodDemand = ["STRONG", "GOOD"].includes(demand);
    const weakDemand = ["SLOW", "UNKNOWN"].includes(demand);

    const tooCheap = yourPrice < realisticSell * 0.97;
    const fairPrice =
      yourPrice >= realisticSell * 0.97 && yourPrice <= realisticSell * 1.05;
    const highButPossible =
      yourPrice > realisticSell * 1.05 && yourPrice <= realisticSell * 1.15;
    const tooHigh = yourPrice > realisticSell * 1.15;

    if (minSellPrice > 0 && yourPrice < minSellPrice) {
      action = "WAIT";
      suggestedPrice = minSellPrice;
      reasons.push("Your price is below your own minimum.");
    } else if (tooCheap) {
      action = "DO NOT UNDERCUT";
      suggestedPrice = Math.max(realisticSell, minSellPrice);
      reasons.push("Your price looks too low compared to the market.");
    } else if (goodDemand && fairPrice) {
      action = "SELL NOW";
      suggestedPrice = yourPrice;
      reasons.push("Your price is realistic and demand looks good.");
    } else if (goodDemand && highButPossible) {
      action = "LIST HIGH";
      suggestedPrice = yourPrice;
      reasons.push(
        "Demand looks good, so you can try a slightly higher price.",
      );
    } else if (goodDemand && tooHigh) {
      action = "LIST HIGH / PATIENT";
      suggestedPrice = yourPrice;
      reasons.push(
        "Your price is high, but the item has enough demand to try patiently.",
      );
    } else if (weakDemand && fairPrice) {
      action = "LIST NORMAL / WAIT";
      suggestedPrice = yourPrice;
      reasons.push("The price is fine, but the item may take time to sell.");
    } else if (weakDemand && highButPossible) {
      action = "WAIT OR LIST HIGH";
      suggestedPrice = yourPrice;
      reasons.push(
        "The price is okay, but demand is slow. Do not expect a fast sale.",
      );
    } else {
      action = "LIST NORMAL";
      suggestedPrice = yourPrice;
      reasons.push("Your price is within a reasonable market range.");
    }

    if (trendPercent < -6) {
      warnings.push("Price looks weaker today than usual.");
    }

    if (spreadPercent > 35) {
      warnings.push(
        "Market gap is large, so the current sell price may be optimistic.",
      );
    }

    if (volumeRatio < 0.45 && check.monthSold >= 30) {
      warnings.push("Today looks slower than usual.");
    }

    if (entryPrice > 0 && roi < 3 && action.includes("SELL")) {
      warnings.push("Profit after tax is low compared with your cost.");
    }

    minRecommended = Math.max(
      minSellPrice,
      Math.floor(realisticSell * 0.97),
      check.currentBuyOffer || 0,
    );
  }

  return {
    action,
    suggestedPrice: Math.round(suggestedPrice),
    minRecommended: Math.round(minRecommended),
    realisticSell: Math.round(realisticSell),
    netTotal,
    profitPerItem,
    roi,
    demand,
    exit,
    trend,
    reasons,
    warnings,
  };
}

function buildBuyAdvice(check) {
  const buyPrice = check.plannedBuyPrice;
  const quantity = check.quantity;

  // Important:
  // currentBuyOffer = highest price someone is willing to pay now
  // currentSellOffer = lowest/realistic listed sell offer, if API has it
  const instantSellPrice = check.currentBuyOffer;
  const lowestSellOffer = check.currentSellOffer;
  const avgBuyPrice = check.dayAverageSell || check.monthAverageSell || 0;

  const trendPercent = getTrendPercent(
    check.dayAverageSell,
    check.monthAverageSell,
  );
  const demand = getDemandLabel(check.daySold, check.monthSold);
  const exit = getExitLabel(check.daySold, check.monthSold);
  const trend = getTrendLabel(trendPercent);

  const safeMarketValue =
    instantSellPrice > 0
      ? instantSellPrice
      : avgBuyPrice > 0
        ? avgBuyPrice
        : lowestSellOffer > 0
          ? lowestSellOffer
          : 0;

  const optimisticListPrice =
    lowestSellOffer > 0
      ? lowestSellOffer
      : avgBuyPrice > 0
        ? avgBuyPrice
        : instantSellPrice;

  const instantProfitPerItem =
    instantSellPrice > 0 ? instantSellPrice - buyPrice : 0;

  const optimisticNetSell = optimisticListPrice * (1 - TAX_RATE);
  const optimisticProfitPerItem =
    optimisticListPrice > 0 ? optimisticNetSell - buyPrice : 0;

  const totalOptimisticProfit = optimisticProfitPerItem * quantity;
  const optimisticRoi =
    buyPrice > 0 ? (optimisticProfitPerItem / buyPrice) * 100 : 0;

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
    if (instantSellPrice > 0 && buyPrice <= instantSellPrice * 0.7) {
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
        "Your price is below the cheapest listed sell offer, but not clearly cheap.",
      );
    } else {
      action = "⚠️ Expensive / Wait";
      reasons.push("Your price looks high compared to the current market.");
    }

    if (
      lowestSellOffer > 0 &&
      instantSellPrice > 0 &&
      lowestSellOffer > instantSellPrice * 2
    ) {
      warnings.push(
        "Listed sell prices look much higher than real instant-buy demand, so do not trust high listings too much.",
      );
    }

    if (demand === "SLOW" || demand === "UNKNOWN") {
      warnings.push("This item may be slow to resell.");
    }

    if (trendPercent < -6) {
      warnings.push("Price looks weaker today than usual.");
    }
  }

  const flipLooksGood =
    buyPrice > 0 &&
    optimisticProfitPerItem > 0 &&
    optimisticRoi >= 8 &&
    ["STRONG", "GOOD", "OK"].includes(demand);

  return {
    action,
    safeMarketValue: Math.round(safeMarketValue),
    instantSellPrice: Math.round(instantSellPrice),
    lowestSellOffer: Math.round(lowestSellOffer),
    optimisticListPrice: Math.round(optimisticListPrice),
    instantProfitPerItem: Math.round(instantProfitPerItem),
    optimisticProfitPerItem: Math.round(optimisticProfitPerItem),
    totalOptimisticProfit: Math.round(totalOptimisticProfit),
    optimisticRoi,
    demand,
    exit,
    trend,
    reasons,
    warnings,
    flipLooksGood,
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

  const shouldSuggestTracking = advice.flipLooksGood && check.monthSold >= 30;

  if (!shouldSuggestTracking) return;

  const shouldAdd = await askYesNo(
    "\nThis may be a good repeat-flip item. Track it for future scanner checks? Y/N",
  );

  if (!shouldAdd) return;

  let section = "watch";

  if (check.monthSold >= 300) {
    section = "safe";
  } else if (check.monthSold >= 100) {
    section = "watch";
  } else {
    section = "experimental";
  }

  const result = addTrackedItem(check.id, section);

  if (result.added) {
    console.log(
      `\n✅ Added ${check.name} (${check.id}) to tracked-items.json under scanner.${result.section}`,
    );
  } else {
    console.log(`\nℹ️ Not added: ${result.reason}`);
  }
}

async function buildCheck(args, itemMap) {
  const [mode, itemInput, quantityArg, priceArg, optionalA, optionalB] = args;

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
  const itemName = itemMap[itemId] || apiData?.name || itemInput;

  const base = {
    checkedAt: new Date().toISOString(),
    mode,
    id: itemId,
    name: itemName,
    quantity: Math.max(1, safeNumber(quantityArg, 1)),
    ...market,
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
  console.log(`Your price: ${formatGp(check.yourSellPrice)} gp`);
  console.log("");

  console.log(`Decision: ${advice.action}`);
  console.log(`Suggested list price: ${formatGp(advice.suggestedPrice)} gp`);
  console.log(`Do not list below: ${formatGp(advice.minRecommended)} gp`);

  if (check.currentBuyOffer > 0) {
    console.log(`Fast sell now: ${formatGp(check.currentBuyOffer)} gp each`);
  }

  console.log("");

  console.log("Market read:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Exit: ${advice.exit}`);
  console.log(`Trend: ${advice.trend}`);
  console.log(
    `Realistic sell area: around ${formatGp(advice.realisticSell)} gp`,
  );

  if (check.entryPrice > 0) {
    console.log("");
    console.log("Profit:");
    console.log(
      `Profit per item after tax: ${formatGp(advice.profitPerItem)} gp`,
    );
    console.log(`ROI: ${formatPercent(advice.roi)}`);
    console.log(`Net total if sold: ${formatGp(advice.netTotal)} gp`);
  }

  console.log("");
  console.log(`Why: ${advice.reasons.join(" ")}`);

  if (advice.warnings.length) {
    console.log("");
    console.log(`Careful: ${advice.warnings.join(" ")}`);
  }

  console.log("");
  console.log(`Item ID: ${check.id}`);
  console.log("");
}

function printBuyReport(check) {
  const advice = buildBuyAdvice(check);

  console.log("\n==============================");
  console.log("       BUY PRICE CHECK");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);
  console.log(`Your buy price: ${formatGp(check.plannedBuyPrice)} gp`);
  console.log("");

  console.log(`Decision: ${advice.action}`);
  printBuyReport;

  if (advice.instantSellPrice > 0) {
    console.log(
      `People are buying now at: ${formatGp(advice.instantSellPrice)} gp`,
    );
  }

  if (advice.lowestSellOffer > 0) {
    console.log(
      `Cheapest listed sell offer: ${formatGp(advice.lowestSellOffer)} gp`,
    );
  }

  if (advice.safeMarketValue > 0) {
    console.log(
      `Safe market reference: around ${formatGp(advice.safeMarketValue)} gp`,
    );
  }

  console.log("");

  console.log("Simple read:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Resell speed: ${advice.exit}`);
  console.log(`Price direction: ${advice.trend}`);

  if (advice.flipLooksGood) {
    console.log("");
    console.log("Flip potential:");
    console.log(
      `Possible list target: ${formatGp(advice.optimisticListPrice)} gp`,
    );
    console.log(
      `Possible profit per item after sell fee: ${formatGp(advice.optimisticProfitPerItem)} gp`,
    );

    console.log(`Estimated ROI: ${formatPercent(advice.optimisticRoi)}`);
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

  inventory.checks.unshift(check);
  inventory.checks = inventory.checks.slice(0, 100);

  const existingIndex = inventory.items.findIndex(
    (item) => Number(item.id) === Number(check.id),
  );

  const itemSnapshot = {
    id: check.id,
    name: check.name,
    quantity: check.quantity,
    lastMode: check.mode,
    lastCheckedAt: check.checkedAt,
    lastAdvisorInput: {
      yourSellPrice: check.yourSellPrice,
      plannedBuyPrice: check.plannedBuyPrice,
      minSellPrice: check.minSellPrice,
      entryPrice: check.entryPrice,
    },
    lastMarketData: {
      currentSellOffer: check.currentSellOffer,
      currentBuyOffer: check.currentBuyOffer,
      daySold: check.daySold,
      monthSold: check.monthSold,
      dayAverageSell: check.dayAverageSell,
      monthAverageSell: check.monthAverageSell,
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

Sell advisor:
  node inventory.js sell ITEM_ID_OR_NAME QUANTITY YOUR_SELL_PRICE [MIN_SELL_PRICE] [YOUR_COST]

Buy advisor:
  node inventory.js buy ITEM_ID_OR_NAME QUANTITY PLANNED_BUY_PRICE

Examples:
  node inventory.js sell 3081 5 9200
  node inventory.js sell 3081 5 9200 8900 8150
  node inventory.js buy 3081 15 8150
`);
}

async function main() {
  const args = process.argv.slice(2);
  const itemMap = getItemMap();

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    printUsage();
    return;
  }

  const check = await buildCheck(args, itemMap);
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
