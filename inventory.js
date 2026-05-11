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

  const plannedBuyPrice = check.plannedBuyPrice;
  const quantity = check.quantity;

  const netSell = realisticSell * (1 - TAX_RATE);
  const profitPerItem =
    plannedBuyPrice > 0 && realisticSell > 0 ? netSell - plannedBuyPrice : 0;
  const totalProfit = profitPerItem * quantity;
  const roi = plannedBuyPrice > 0 ? (profitPerItem / plannedBuyPrice) * 100 : 0;

  let action = "AVOID BUY";
  const reasons = [];
  const warnings = [];

  let suggestedMaxBuy = 0;
  let suggestedSellPrice = realisticSell || check.currentSellOffer || 0;

  if (realisticSell > 0) {
    const wantedRoi =
      check.monthSold >= 300 ? 0.06 : check.monthSold >= 100 ? 0.08 : 0.12;
    suggestedMaxBuy = Math.floor(
      (realisticSell * (1 - TAX_RATE)) / (1 + wantedRoi),
    );
  }

  if (!plannedBuyPrice) {
    action = "MISSING PRICE";
    reasons.push("You need to enter the buy price you are considering.");
  } else if (!realisticSell) {
    action = "NO MARKET DATA";
    reasons.push(
      "I could not get a realistic sell price from the market data.",
    );
  } else {
    const goodDemand = ["STRONG", "GOOD"].includes(demand);
    const okayDemand = demand === "OK";
    const slowDemand = ["SLOW", "UNKNOWN"].includes(demand);

    if (profitPerItem <= 0) {
      action = "AVOID BUY";
      reasons.push("After market tax, this does not look profitable.");
    } else if (
      plannedBuyPrice <= suggestedMaxBuy &&
      roi >= 8 &&
      goodDemand &&
      spreadPercent <= 35
    ) {
      action = "WORTH BUY OFFER";
      reasons.push("Good profit, good demand, and a realistic exit price.");
    } else if (
      plannedBuyPrice <= suggestedMaxBuy &&
      roi >= 5 &&
      (goodDemand || okayDemand)
    ) {
      action = "SMALL BUY ONLY";
      reasons.push("This can work, but the margin is not amazing.");
    } else if (roi >= 10 && slowDemand) {
      action = "SPECULATIVE BUY";
      reasons.push("Profit looks good, but selling may be slow.");
    } else {
      action = "AVOID / LOWER BUY PRICE";
      reasons.push("The buy price is too high for the expected profit.");
    }

    if (plannedBuyPrice > suggestedMaxBuy) {
      warnings.push("Your buy price is above my suggested max buy.");
    }

    if (trendPercent < -6) {
      warnings.push("Price may be cooling down, so buying now is riskier.");
    }

    if (spreadPercent > 35) {
      warnings.push(
        "The market gap is large, so the sell price may not be realistic.",
      );
    }
  }

  return {
    action,
    suggestedMaxBuy: Math.round(suggestedMaxBuy),
    suggestedSellPrice: Math.round(suggestedSellPrice),
    realisticSell: Math.round(realisticSell),
    profitPerItem,
    totalProfit,
    roi,
    demand,
    exit,
    trend,
    reasons,
    warnings,
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
  const goodActions = ["WORTH BUY OFFER", "SMALL BUY ONLY"];

  if (check.mode !== "buy") return;
  if (!goodActions.includes(advice.action)) return;

  const shouldAdd = await askYesNo(
    "\nThis looks like a good flipping item. Add it to tracked-items for future scanner runs? Y/N",
  );

  if (!shouldAdd) return;

  const result = addTrackedItem(
    check.id,
    advice.action === "WORTH BUY OFFER" ? "safe" : "watch",
  );

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
  console.log("         BUY ADVISOR");
  console.log("==============================\n");

  console.log(`${check.name}`);
  console.log(`Quantity: ${check.quantity}`);
  console.log(`Your buy price: ${formatGp(check.plannedBuyPrice)} gp`);
  console.log("");

  console.log(`Decision: ${advice.action}`);
  console.log(`Suggested max buy: ${formatGp(advice.suggestedMaxBuy)} gp`);
  console.log(
    `Suggested sell/list target: ${formatGp(advice.suggestedSellPrice)} gp`,
  );

  console.log("");

  console.log("Expected profit:");
  console.log(
    `Profit per item after tax: ${formatGp(advice.profitPerItem)} gp`,
  );
  console.log(`Total profit: ${formatGp(advice.totalProfit)} gp`);
  console.log(`ROI: ${formatPercent(advice.roi)}`);

  console.log("");

  console.log("Market read:");
  console.log(`Demand: ${advice.demand}`);
  console.log(`Exit: ${advice.exit}`);
  console.log(`Trend: ${advice.trend}`);
  console.log(
    `Realistic sell area: around ${formatGp(advice.realisticSell)} gp`,
  );

  console.log("");
  console.log(`Why: ${advice.reasons.join(" ")}`);

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
