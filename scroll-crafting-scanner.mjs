import fs from "fs";
import axios from "axios";
import "dotenv/config";
import { getMarketValues } from "./lib/market.js";
import { API_URL, TAX_RATE, SERVER } from "./lib/constants.js";

const RECIPES_FILE = "./data/scroll-recipes.json";
const ITEMS_PATHS = ["./data/items.json", "./items.json"];
const RESULTS_FILE = "./scroll-crafting-results.json";
const AUDIT_JSON_FILE = "./scroll-crafting-audit.json";
const AUDIT_CSV_FILE = "./scroll-crafting-audit.csv";
const MANUAL_TEMPLATE_FILE = "./scroll-sales-manual-template.csv";
const POWERFUL_FIXED_COST = 250000;
const BLANK_SCROLL_NPC_PRICE = 25000;
const DEFAULT_LOCAL_TRADE_BAT = "C:\\Users\\Avner\\Desktop\\Projects\\tibia-price-alert\\trade-manager.bat";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMarketValuesWithRetry(ids, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 2);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getMarketValues(ids);
    } catch (error) {
      const status = error?.response?.status;
      const retryAfterHeader = error?.response?.headers?.["retry-after"];
      const resetHeader = error?.response?.headers?.["x-ratelimit-reset"];

      let waitMs = 5500;

      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        waitMs = Math.max(waitMs, retryAfterSeconds * 1000 + 500);
      }

      const resetEpochSeconds = Number(resetHeader);
      if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
        const untilResetMs = resetEpochSeconds * 1000 - Date.now() + 500;
        if (untilResetMs > 0 && untilResetMs < 60000) {
          waitMs = Math.max(waitMs, untilResetMs);
        }
      }

      if (status !== 429 || attempt >= maxAttempts) {
        console.log("");
        console.log("Market request failed.");
        console.log("Status:", status || "unknown");
        console.log("Tip: wait 30-60 seconds, then run npm run scrolls again.");
        throw error;
      }

      console.log(
        "Market API rate limit hit. Waiting " +
          Math.ceil(waitMs / 1000) +
          "s before retry " +
          (attempt + 1) +
          "/" +
          maxAttempts +
          "..."
      );

      await sleep(waitMs);
    }
  }

  return [];
}

async function getMarketBoardWithRetry(itemId, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(`${API_URL}/market_board`, {
        params: { server: SERVER, item_id: itemId },
        timeout: 15000,
      });
      return response.data || null;
    } catch (error) {
      const status = error?.response?.status;
      const retryable = status === 429 || status >= 500 || !status;
      if (!retryable || attempt >= maxAttempts) return null;
      await sleep(5500);
    }
  }

  return null;
}

function simulateIngredientFill(board, requiredQty, fallbackUnitPrice) {
  const quantity = Math.max(0, Number(requiredQty || 0));
  const fallbackPrice = Math.max(0, Number(fallbackUnitPrice || 0));
  const sellers = Array.isArray(board?.sellers)
    ? [...board.sellers]
        .map((seller) => ({
          amount: Math.max(0, Number(seller.amount || 0)),
          price: Math.max(0, Number(seller.price || 0)),
        }))
        .filter((seller) => seller.amount > 0 && seller.price > 0)
        .sort((a, b) => a.price - b.price)
    : [];
  const fills = [];
  let remaining = quantity;
  let boardFillCost = 0;

  for (const seller of sellers) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, seller.amount);
    fills.push({ quantity: fillQty, price: seller.price, cost: fillQty * seller.price });
    boardFillCost += fillQty * seller.price;
    remaining -= fillQty;
  }

  const boardAvailable = sellers.length > 0;
  const fillQtyAvailable = quantity - remaining;
  const fillComplete = boardAvailable ? remaining === 0 && quantity > 0 : quantity > 0 && fallbackPrice > 0;
  const missingQty = Math.max(0, remaining);
  const fallbackCost = missingQty * fallbackPrice;
  const fillCost = boardFillCost + fallbackCost;
  const bestUnitPrice = sellers[0]?.price || fallbackPrice;
  const worstFilledUnitPrice = fills.length ? fills[fills.length - 1].price : fallbackPrice;
  const lowestSellEstimate = fallbackPrice * quantity;
  const fillSlippagePercent = lowestSellEstimate > 0
    ? Math.max(0, ((fillCost - lowestSellEstimate) / lowestSellEstimate) * 100)
    : 0;

  return {
    sellers,
    fills,
    fillCost,
    fillAvgUnitPrice: quantity > 0 ? fillCost / quantity : 0,
    fillQtyAvailable: boardAvailable ? fillQtyAvailable : quantity,
    fillComplete,
    missingQty: boardAvailable ? missingQty : 0,
    bestUnitPrice,
    lowestSell: bestUnitPrice,
    worstFilledUnitPrice,
    fillSlippagePercent,
    ingredientCostSource: !boardAvailable
      ? "market_values_fallback"
      : "market_board",
    marketBoardFillComplete: boardAvailable && fillComplete,
    marketBoardAvailable: boardAvailable,
  };
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function formatPercent(value) {
  return Number(value || 0).toFixed(2) + "%";
}

function formatCompactGp(value, options = {}) {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (absolute >= 1000000) {
    return sign + Number((absolute / 1000000).toFixed(2)) + "kk";
  }

  if (absolute >= 1000) {
    const compact = options.round ? Math.round(absolute / 1000) : Math.floor(absolute / 1000);
    return sign + compact + "k";
  }

  return sign + Math.round(absolute);
}

function cleanScrollName(name) {
  return String(name)
    .replace(/^Powerful\s+/i, "")
    .replace(/\s+Scroll$/i, "");
}

function quoteCmdArg(value) {
  return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
}

function formatRecipeText(row) {
  const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
  const parts = ingredients.map((ingredient) => ingredient.qty + "x " + ingredient.name);
  parts.push("Blank x1");
  return parts.join(" | ");
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/s$/, "");
}

function loadItems() {
  for (const path of ITEMS_PATHS) {
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, "utf8"));
    }
  }

  throw new Error("Missing items data. Expected ./data/items.json or ./items.json");
}

function loadRecipes() {
  if (!fs.existsSync(RECIPES_FILE)) {
    throw new Error("Missing ./data/scroll-recipes.json");
  }

  const raw = JSON.parse(fs.readFileSync(RECIPES_FILE, "utf8"));
  return Array.isArray(raw) ? raw : raw.recipes || [];
}

function createResolver(items) {
  const byName = new Map();

  for (const item of items) {
    const names = [item.name, item.wiki_name].filter(Boolean);

    for (const name of names) {
      byName.set(String(name).trim().toLowerCase(), item);
      byName.set(normalizeName(name), item);
    }
  }

  return function resolveItem(name) {
    const exact = byName.get(String(name).trim().toLowerCase());
    if (exact) return exact;

    const normalized = byName.get(normalizeName(name));
    if (normalized) return normalized;

    throw new Error("Could not resolve item: " + name);
  };
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }

  return { flags, positional };
}

function getSellPrice(row) {
  return Number(row?.sell_offer || row?.lowest_sell || row?.day_average_sell || row?.month_average_sell || 0);
}

function getSellPriceSource(row) {
  if (row?.sell_offer) return "sell_offer";
  if (row?.lowest_sell) return "lowest_sell";
  if (row?.day_average_sell) return "day_average_sell";
  if (row?.month_average_sell) return "month_average_sell";
  return "missing (0)";
}

function getBuyPrice(row) {
  return Number(row?.buy_offer || row?.highest_buy || 0);
}

function getBuyPriceSource(row) {
  if (row?.buy_offer) return "buy_offer";
  if (row?.highest_buy) return "highest_buy";
  return "missing (0)";
}

function getDaySold(row) {
  return Number(row?.day_sold || 0);
}

function getMonthSold(row) {
  return Number(row?.month_sold || 0);
}

function getDayBought(row) {
  return Number(row?.day_bought || 0);
}

function getMonthBought(row) {
  return Number(row?.month_bought || 0);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(path, columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  fs.writeFileSync(path, "\uFEFF" + lines.join("\r\n") + "\r\n");
}

function buildAuditRow(row) {
  const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
  const ingredient = (index) => ingredients[index] || {};
  const priceSource = row.hasSellStats ? "LIVE_SELL_STATS" : "CURRENT_SELL_ESTIMATE";

  return {
    scrollName: row.outputName,
    shortName: cleanScrollName(row.outputName),
    action: row.action,
    currentLowestSell: row.currentLowestSell,
    highestBuy: row.outputBuy,
    sellVolumeToday: row.daySold,
    sellVolumeMonth: row.monthSold,
    buyVolumeToday: row.dayBought,
    buyVolumeMonth: row.monthBought,
    totalCraftCost: row.totalCraftCost,
    oldIngredientsCost: row.oldIngredientsCost,
    ingredientsCost: row.ingredientsCost,
    oldProfitNow: row.oldProfitNow,
    oldSafe: row.oldSafeScore,
    fixedCraftFee: row.fixedGoldCost,
    blankScrollCost: row.blankCost,
    ingredientsText: ingredients.map((item) => item.qty + "x " + item.name).join(" · "),
    ingredient1Name: ingredient(0).name,
    ingredient1Qty: ingredient(0).qty,
    ingredient1UnitPrice: ingredient(0).unitPrice,
    ingredient1Total: ingredient(0).cost,
    ingredient1FillCost: ingredient(0).fillCost,
    ingredient1FillAvgUnitPrice: ingredient(0).fillAvgUnitPrice,
    ingredient1FillComplete: ingredient(0).fillComplete,
    ingredient1FillQtyAvailable: ingredient(0).fillQtyAvailable,
    ingredient1MissingQty: ingredient(0).missingQty,
    ingredient1FillSlippagePercent: ingredient(0).fillSlippagePercent,
    ingredient1CostSource: ingredient(0).ingredientCostSource,
    ingredient2Name: ingredient(1).name,
    ingredient2Qty: ingredient(1).qty,
    ingredient2UnitPrice: ingredient(1).unitPrice,
    ingredient2Total: ingredient(1).cost,
    ingredient2FillCost: ingredient(1).fillCost,
    ingredient2FillAvgUnitPrice: ingredient(1).fillAvgUnitPrice,
    ingredient2FillComplete: ingredient(1).fillComplete,
    ingredient2FillQtyAvailable: ingredient(1).fillQtyAvailable,
    ingredient2MissingQty: ingredient(1).missingQty,
    ingredient2FillSlippagePercent: ingredient(1).fillSlippagePercent,
    ingredient2CostSource: ingredient(1).ingredientCostSource,
    ingredient3Name: ingredient(2).name,
    ingredient3Qty: ingredient(2).qty,
    ingredient3UnitPrice: ingredient(2).unitPrice,
    ingredient3Total: ingredient(2).cost,
    ingredient3FillCost: ingredient(2).fillCost,
    ingredient3FillAvgUnitPrice: ingredient(2).fillAvgUnitPrice,
    ingredient3FillComplete: ingredient(2).fillComplete,
    ingredient3FillQtyAvailable: ingredient(2).fillQtyAvailable,
    ingredient3MissingQty: ingredient(2).missingQty,
    ingredient3FillSlippagePercent: ingredient(2).fillSlippagePercent,
    ingredient3CostSource: ingredient(2).ingredientCostSource,
    ingredientFillRisk: row.ingredientFillRisk,
    allIngredientsFillComplete: row.allIngredientsFillComplete,
    totalIngredientFillSlippagePercent: row.totalIngredientFillSlippagePercent,
    ingredientFillWarnings: (row.ingredientFillWarnings || []).join("; "),
    netSellAfterTax: row.outputNetSell,
    profitNow: row.profitNow,
    roiNow: row.roiNow,
    avgProfit: row.avgProfit,
    priceSpikeRisk: row.priceSpikeRisk,
    priceSpikeReason: row.priceSpikeReason,
    avgSellPrice: row.avgSellPrice,
    priceRealismFactor: row.priceRealismFactor,
    liquidityFactor: row.liquidityFactor,
    exitSafetyFactor: row.exitSafetyFactor,
    queueFactor: row.queueFactor,
    estimatedQueueDays: row.estimatedQueueDays,
    dataConfidence: row.dataConfidence,
    sellOffers: row.sellOffers,
    buyOffers: row.buyOffers,
    activeTraders: row.activeTraders,
    rawProfit: row.profitNow,
    rawRoi: row.roiNow,
    breakEvenSell: row.breakEvenSell,
    demand: row.demand,
    buySupport: row.buySupport,
    risk: row.risk,
    safeEV: row.safeScore,
    volumeMultiplier: row.volumeMultiplier,
    supportMultiplier: row.buySupportMultiplier,
    riskMultiplier: row.riskMultiplier,
    priceSource,
    hasManualSellStats: false,
    manualAverageSell: null,
    manualTransactions: null,
    manualPeriodDays: null,
    realisticProfit: row.realisticProfit,
    realisticRoi: row.realisticRoi,
    notes: [
      row.missing.length > 0 ? "Missing: " + row.missing.join("; ") : "",
      ...(row.ingredientFillWarnings || []),
      row.hasSellStats ? "Live 30-day sell statistics" : "Safe EV includes estimate confidence penalty",
    ].filter(Boolean).join("; "),
  };
}

function exportAudit(rows) {
  const auditColumns = [
    "scrollName", "shortName", "action", "currentLowestSell", "highestBuy",
    "sellVolumeToday", "sellVolumeMonth", "buyVolumeToday", "buyVolumeMonth",
    "totalCraftCost", "oldIngredientsCost", "ingredientsCost", "oldProfitNow", "oldSafe", "fixedCraftFee", "blankScrollCost", "ingredientsText",
    "ingredient1Name", "ingredient1Qty", "ingredient1UnitPrice", "ingredient1Total",
    "ingredient1FillCost", "ingredient1FillAvgUnitPrice", "ingredient1FillComplete", "ingredient1FillQtyAvailable", "ingredient1MissingQty", "ingredient1FillSlippagePercent", "ingredient1CostSource",
    "ingredient2Name", "ingredient2Qty", "ingredient2UnitPrice", "ingredient2Total",
    "ingredient2FillCost", "ingredient2FillAvgUnitPrice", "ingredient2FillComplete", "ingredient2FillQtyAvailable", "ingredient2MissingQty", "ingredient2FillSlippagePercent", "ingredient2CostSource",
    "ingredient3Name", "ingredient3Qty", "ingredient3UnitPrice", "ingredient3Total",
    "ingredient3FillCost", "ingredient3FillAvgUnitPrice", "ingredient3FillComplete", "ingredient3FillQtyAvailable", "ingredient3MissingQty", "ingredient3FillSlippagePercent", "ingredient3CostSource",
    "ingredientFillRisk", "allIngredientsFillComplete", "totalIngredientFillSlippagePercent", "ingredientFillWarnings",
    "netSellAfterTax", "profitNow", "roiNow", "avgProfit", "avgSellPrice", "priceSpikeRisk", "priceSpikeReason",
    "priceRealismFactor", "liquidityFactor", "exitSafetyFactor", "queueFactor",
    "estimatedQueueDays", "dataConfidence", "sellOffers", "buyOffers", "activeTraders",
    "rawProfit", "rawRoi", "breakEvenSell", "demand",
    "buySupport", "risk", "safeEV", "volumeMultiplier", "supportMultiplier",
    "riskMultiplier", "priceSource", "hasManualSellStats", "manualAverageSell",
    "manualTransactions", "manualPeriodDays", "realisticProfit", "realisticRoi", "notes",
  ];
  const auditRows = rows.map(buildAuditRow);
  const manualColumns = [
    "scrollName", "currentLowestSell", "currentProfit", "totalCraftCost",
    "sellVolumeMonth", "highestBuy", "manualSellTransactions", "manualAverageSell",
    "manualNotes",
  ];
  const manualRows = rows.map((row) => ({
    scrollName: row.outputName,
    currentLowestSell: row.currentLowestSell,
    currentProfit: row.currentProfit,
    totalCraftCost: row.totalCraftCost,
    sellVolumeMonth: row.monthSold,
    highestBuy: row.outputBuy,
    manualSellTransactions: null,
    manualAverageSell: null,
    manualNotes: null,
  }));

  fs.writeFileSync(AUDIT_JSON_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    server: SERVER,
    tier: "powerful",
    rows,
  }, null, 2));
  writeCsv(AUDIT_CSV_FILE, auditColumns, auditRows);
  writeCsv(MANUAL_TEMPLATE_FILE, manualColumns, manualRows);
}

function printAuditTable(rows) {
  const cell = (value, width) => String(value).slice(0, width).padEnd(width);
  console.log([
    cell("Name", 20), cell("ProfitNow", 11), cell("AvgProfit", 11), cell("Safe", 11), cell("Sold/mo", 8),
    cell("Realism", 8), cell("Queue", 8), cell("FillRisk", 9), cell("SpikeRisk", 9), cell("Action", 12),
  ].join(" | "));
  console.log("-".repeat(132));
  rows.forEach((row) => {
    console.log([
      cell(cleanScrollName(row.outputName), 20), cell(Math.round(row.profitNow), 11), cell(Math.round(row.avgProfit), 11), cell(Math.round(row.safeScore), 11),
      cell(row.monthSold, 8), cell((row.priceRealismFactor * 100).toFixed(0) + "%", 8),
      cell(Number.isFinite(row.estimatedQueueDays) ? row.estimatedQueueDays.toFixed(1) + "d" : "Inf", 8),
      cell(row.ingredientFillRisk, 9), cell(row.priceSpikeRisk, 9), cell(row.action, 12),
    ].join(" | "));
  });
}

function printPriceTrace(row) {
  console.log("PRICE TRACE: " + row.outputName);
  console.log("Output:");
  console.log("- itemId: " + row.outputItemId + " (resolved from data/items.json)");
  console.log("- currentLowestSell: " + row.currentLowestSell);
  console.log("- source field: " + row.outputSellSource);
  console.log("- highestBuy: " + row.outputBuy);
  console.log("- source field: " + row.outputBuySource);
  console.log("- monthSold: " + row.monthSold);
  console.log("- source field: month_sold");
  console.log("- sellStatsAveragePrice: " + row.sellStatsAveragePrice);
  console.log("- source field: month_average_sell");
  console.log("- realisticSellPrice: " + row.realisticSellPrice);
  console.log("- source field: " + (row.hasSellStats ? "month_average_sell" : row.outputSellSource));
  console.log("");
  console.log("Blank Scroll:");
  console.log("- itemId: " + row.blankScrollItemId + " (resolved from data/items.json)");
  console.log("- marketLowestSell: " + row.blankMarketSell);
  console.log("- source field: " + row.blankMarketPriceSource);
  console.log("- npcCap: " + row.blankScrollNpcCap);
  console.log("- usedPrice: " + row.blankCost);
  console.log("");
  console.log("Ingredients:");
  row.ingredients.forEach((ingredient) => {
    console.log("Ingredient Fill: " + ingredient.name + " x" + ingredient.qty);
    console.log("  itemId: " + ingredient.itemId + " (resolved from data/items.json)");
    console.log("- market_values lowest sell: " + formatGp(ingredient.unitPriceEstimate));
    console.log("- market_board sellers:");
    if (ingredient.sellers.length === 0) console.log("  unavailable");
    ingredient.sellers.forEach((seller) => {
      console.log("  " + seller.amount + "x " + formatGp(seller.price));
    });
    console.log("- fill cost:");
    if (ingredient.fills.length === 0) console.log("  market_values fallback");
    ingredient.fills.forEach((fill) => {
      console.log("  " + fill.quantity + " * " + formatGp(fill.price) + " = " + formatGp(fill.cost));
    });
    if (ingredient.missingQty > 0) {
      console.log("  " + ingredient.missingQty + " * " + formatGp(ingredient.unitPriceEstimate) + " fallback");
    }
    console.log("- total fill cost: " + formatGp(ingredient.fillCost));
    console.log("- average unit cost: " + formatGp(ingredient.fillAvgUnitPrice));
    console.log("- fill quantity available: " + ingredient.fillQtyAvailable);
    console.log("- missing quantity: " + ingredient.missingQty);
    console.log("- lowest sell unit price: " + formatGp(ingredient.lowestSellUnitPrice));
    console.log("- worst filled unit price: " + formatGp(ingredient.worstFilledUnitPrice));
    console.log("- slippage vs lowest sell estimate: " + formatPercent(ingredient.fillSlippagePercent));
    console.log("- fill complete: " + ingredient.fillComplete);
    console.log("- cost source: " + ingredient.ingredientCostSource);
  });
  console.log("");
  console.log("Final:");
  console.log("- fixedFee: " + row.fixedGoldCost);
  console.log("- blankScrollCost: " + row.blankCost);
  console.log("- ingredientsCost: " + row.ingredientsCost);
  console.log("- totalCraftCost: " + row.totalCraftCost);
  console.log("- currentLowestSell: " + row.currentLowestSell);
  console.log("- outputNetSell / netSellAfterTax: " + row.outputNetSell);
  console.log("- profitNow: " + row.profitNow);
  console.log("- avgSellPrice: " + row.avgSellPrice);
  console.log("- avgNetSellAfterTax: " + (row.avgSellPrice * (1 - TAX_RATE)));
  console.log("- avgProfit: " + row.avgProfit);
  console.log("");
}

function effectiveBlankCost(blankMarketSell, npcCap) {
  const cap = Number(npcCap || 25000);
  const market = Number(blankMarketSell || 0);

  if (market > 0) return Math.min(market, cap);
  return cap;
}

function decide(row) {
  if (row.missing.length > 0) return "MISSING DATA";
  if (row.outputSell <= 0 && !row.hasSellStats) return "NO SCROLL SELL PRICE";
  const rawProfit = Number(row.profitNow ?? row.rawProfit ?? row.profit ?? 0);
  const craftEV = Number(row.safeScore ?? row.craftEV ?? 0);
  const avgProfit = Number(row.avgProfit || 0);
  const monthSold = Number(row.monthSold || 0);
  const estimatedQueueDays = Number(row.estimatedQueueDays);
  const priceRealismFactor = Number(row.priceRealismFactor || 0);

  if (rawProfit <= 0) return "AVOID";
  if (row.priceSpikeRisk === "HIGH") return "SPECULATIVE";
  if (priceRealismFactor < 0.7) {
    if (rawProfit >= 100000 && craftEV >= 50000) return "SPECULATIVE";
    return "WATCH";
  }

  if (
    rawProfit >= 100000 &&
    craftEV >= 100000 &&
    monthSold >= 50 &&
    row.priceSpikeRisk === "LOW" &&
    row.ingredientFillRisk === "LOW" &&
    Number.isFinite(estimatedQueueDays) &&
    estimatedQueueDays <= 3
  ) {
    return "CRAFT";
  }

  if (
    rawProfit >= 100000 &&
    craftEV >= 60000 &&
    monthSold >= 40 &&
    row.priceSpikeRisk === "LOW" &&
    ["LOW", "MEDIUM"].includes(row.ingredientFillRisk)
  ) {
    return "TEST 1x";
  }

  if (rawProfit < 100000 && monthSold >= 100 && craftEV > 0) return "LOW MARGIN";
  return "WATCH";
}
















function classifyDemand(row) {
  const daySold = Number(row.daySold || 0);
  const monthSold = Number(row.monthSold || 0);

  if (daySold >= 2 || monthSold >= 20) return "HIGH";
  if (daySold >= 1 || monthSold >= 7) return "MEDIUM";
  if (monthSold > 0) return "LOW";
  return "UNKNOWN";
}

function classifyBuySupport(row) {
  const highestBuy = Number(row.outputBuy || 0);
  const breakEvenSell = Number(row.breakEvenSell || 0);

  if (highestBuy <= 0) return "NONE";
  if (breakEvenSell <= 0) return "UNKNOWN";

  const ratio = highestBuy / breakEvenSell;

  if (ratio >= 1) return "STRONG";
  if (ratio >= 0.9) return "GOOD";
  if (ratio >= 0.7) return "WEAK";
  return "BAD";
}

function classifyRisk(row) {
  const daySold = Number(row.daySold || 0);
  const monthSold = Number(row.monthSold || 0);
  const highestBuy = Number(row.outputBuy || 0);
  const breakEvenSell = Number(row.breakEvenSell || 0);

  if (row.missing?.length > 0) return "UNKNOWN";
  if (monthSold <= 0 && daySold <= 0 && highestBuy <= 0) return "HIGH";

  const buySupportRatio =
    breakEvenSell > 0 && highestBuy > 0 ? highestBuy / breakEvenSell : 0;

  if (highestBuy <= 0 && monthSold >= 7) return "MEDIUM";
  if (highestBuy <= 0) return "HIGH";

  if (monthSold < 3 && buySupportRatio < 0.7) return "HIGH";
  if (monthSold < 10 && buySupportRatio < 0.9) return "MEDIUM";

  return "LOW";
}

function enrichScrollLiquidity(row) {
  return {
    ...row,
    demand: classifyDemand(row),
    buySupport: classifyBuySupport(row),
    risk: classifyRisk(row),
  };
}

function enrichExpectedCraftValue(row) {
  const profitNow = Number(row.profitNow || 0);
  const monthSold = Math.max(0, Number(row.monthSold || 0));
  const dailyVelocity = monthSold / 30;
  const sellChance7d = 1 - Math.exp(-dailyVelocity * 7);
  const highestBuyAfterTax = Number(row.outputBuy || 0) * (1 - TAX_RATE);
  const instantExitProfit = highestBuyAfterTax - Number(row.totalCraftCost || 0);
  const buySupportScore =
    Number(row.outputBuy || 0) <= 0 || Number(row.totalCraftCost || 0) <= 0
      ? 0
      : highestBuyAfterTax / Number(row.totalCraftCost);

  const liquidityFactor = 1 - Math.exp(-monthSold / 30);
  const priceRealismFactor =
    row.avgSellPrice > 0 && row.currentLowestSell > 0
      ? Math.pow(Math.min(1, row.avgSellPrice / row.currentLowestSell), 1.5)
      : 0.65;
  const avgProfit = Number(row.avgProfit || 0);
  let priceSpikeRisk = "LOW";
  let priceSpikeReason = "Current profit is consistent with the average-price reference";
  if (profitNow > 0 && avgProfit <= 0 && priceRealismFactor < 0.6) {
    priceSpikeRisk = "HIGH";
    priceSpikeReason = "Current sell is far above average and average-price profit is non-positive";
  } else if (profitNow > 0 && avgProfit < profitNow * 0.25 && priceRealismFactor < 0.75) {
    priceSpikeRisk = "MEDIUM";
    priceSpikeReason = "Average-price profit is below 25% of current profit with weak price realism";
  }

  const calculateExitSafetyFactor = (craftCost) => {
    if (highestBuyAfterTax >= craftCost) return 1;
    if (highestBuyAfterTax >= craftCost * 0.9) return 0.9;
    if (row.outputBuy > 0) return 0.75;
    if (monthSold >= 50) return 0.8;
    if (monthSold >= 20) return 0.65;
    return 0.45;
  };
  const exitSafetyFactor = calculateExitSafetyFactor(row.totalCraftCost);
  /* The remaining score formula is intentionally unchanged; only ingredient cost and fill risk are new. */

  const estimatedQueueDays = dailyVelocity > 0
    ? (row.sellOffers + 1) / dailyVelocity
    : Infinity;
  const queueFactor = dailyVelocity > 0
    ? 1 / (1 + Math.max(0, estimatedQueueDays - 1) / 7)
    : 0.25;
  const discountedProfit = profitNow * liquidityFactor * priceRealismFactor * exitSafetyFactor * queueFactor;
  const ingredientFillFactors = { LOW: 1, MEDIUM: 0.85, HIGH: 0.6 };
  const ingredientFillFactor = ingredientFillFactors[row.ingredientFillRisk] ?? ingredientFillFactors.HIGH;
  const safeScoreBeforeIngredientFill = profitNow <= 0
    ? profitNow
    : Math.min(profitNow, discountedProfit);
  const uncappedSafeScore = profitNow <= 0
    ? profitNow
    : Math.min(profitNow, safeScoreBeforeIngredientFill * ingredientFillFactor);
  const spikeSafeCap = priceSpikeRisk === "HIGH"
    ? Math.min(profitNow * 0.15, 100000)
    : priceSpikeRisk === "MEDIUM"
      ? profitNow * 0.4
      : profitNow;
  const safeScore = profitNow <= 0
    ? profitNow
    : Math.min(profitNow, uncappedSafeScore, spikeSafeCap);
  const oldProfitNow = Number(row.oldProfitNow || 0);
  const oldExitSafetyFactor = calculateExitSafetyFactor(row.oldTotalCraftCost);
  const oldDiscountedProfit = oldProfitNow * liquidityFactor * priceRealismFactor * oldExitSafetyFactor * queueFactor;
  const oldSafeBeforeIngredientFill = oldProfitNow <= 0
    ? oldProfitNow
    : Math.min(oldProfitNow, oldDiscountedProfit);
  const oldSafeScore = oldProfitNow <= 0
    ? oldProfitNow
    : Math.min(oldProfitNow, oldSafeBeforeIngredientFill * ingredientFillFactor);
  const action = decide({ ...row, safeScore, priceSpikeRisk });

  return {
    ...row,
    rawProfit: profitNow,
    profit: profitNow,
    action,
    dailyVelocity,
    sellChance7d,
    highestBuyAfterTax,
    instantExitProfit,
    buySupportScore,
    priceRealismFactor,
    priceSpikeRisk,
    priceSpikeReason,
    liquidityFactor,
    exitSafetyFactor,
    queueFactor,
    estimatedQueueDays,
    ingredientFillFactor,
    safeScoreBeforeIngredientFill,
    safeScore,
    oldSafeScore,
    volumeMultiplier: liquidityFactor,
    buySupportMultiplier: exitSafetyFactor,
    riskMultiplier: priceRealismFactor * queueFactor,
    expectedCraftScore: safeScore,
    craftScore: safeScore,
    craftEV: safeScore,
  };
}

function comparePracticalRank(a, b) {
  const aProfitable = Number(a.profitNow || 0) > 0;
  const bProfitable = Number(b.profitNow || 0) > 0;
  if (aProfitable !== bProfitable) return aProfitable ? -1 : 1;
  if (a.allIngredientsFillComplete !== b.allIngredientsFillComplete) {
    return a.allIngredientsFillComplete ? -1 : 1;
  }
  return Number(b.safeScore || 0) - Number(a.safeScore || 0);
}

function buildDiscordPayloadLegacy(rows) {
  const top = [...rows]
    .sort(comparePracticalRank)
    .slice(0, 8);
  const riskIcons = {
    LOW: "🟢",
    MEDIUM: "🟡",
    HIGH: "🔴",
    UNKNOWN: "⚪",
  };

  return {
    embeds: [
      {
        title: "📜 Powerful Scroll Crafting",
        description: SERVER + " · Best expected Powerful crafts · tax included",
        color: 0x9966ff,
        fields: top.map((row, index) => {
          const outputName = cleanScrollName(row.outputName);
          const displayProfit = Number(row.profitNow);
          const displayRoi = Number(row.roiNow);
          const profit = (displayProfit >= 0 ? "+" : "") + formatCompactGp(displayProfit);
          const score = (row.safeScore >= 0 ? "+" : "") + formatCompactGp(row.safeScore);
          const queueDisplay = Number.isFinite(row.estimatedQueueDays)
            ? "~" + row.estimatedQueueDays.toFixed(1) + "d"
            : "Inf";
          const sellDisplay = "Sell " + formatCompactGp(row.currentLowestSell, { round: true });
          const volumeDisplay = formatCompactGp(row.monthSold) + "/mo";
          const details = [];
          const riskIcon = riskIcons[row.risk] || riskIcons.UNKNOWN;
          const recipe = formatRecipeText(row);

          if (row.risk === "HIGH" || row.action !== "CRAFT" || row.profit < 100000) {
            details.push("⚖️ Break-even " + formatCompactGp(row.breakEvenSell, { round: true }));
          }
          if (row.missing.length > 0) {
            details.push("Missing " + row.missing.length);
          }

          return {
            name: "#" + (index + 1) + " " + riskIcon + " " + outputName + " — " + row.action,
            value:
              "💰 " + profit + " | Safe EV " + score + " | ROI " + displayRoi.toFixed(1) + "% | " + sellDisplay + " | Cost " + formatCompactGp(row.totalCraftCost, { round: true }) + "\n" +
              "📊 " + volumeDisplay + " | ~" + Math.min(99, Math.floor(row.sellChance7d * 100)) + "%/7d | Support " + row.buySupport + " | Risk " + row.risk +
              (details.length > 0 ? "\n" + details.join(" | ") : "") +
              "\n\nRecipe: " + recipe +
              "\n\n```cmd\n" +
              buildDiscordAcceptCommand(row) + "\n" +
              "```" +
              "\n\u200B",
            inline: false,
          };
        }),
        footer: {
          text: "Tax included · Blank scroll capped at NPC 25k · Avg = live sell statistics · Sell est = current market estimate",
        },
      },
    ],
  };
}

function buildDiscordPayloadVerboseLegacy(rows) {
  const top = [...rows]
    .sort(comparePracticalRank);

  return {
    embeds: [{
      title: "Powerful Scroll Crafting",
      description: SERVER + " - practical ranking - tax included",
      color: 0x9966ff,
      fields: top.map((row, index) => {
        const profit = (row.profitNow >= 0 ? "+" : "") + formatCompactGp(row.profitNow);
        const avgProfit = (row.avgProfit >= 0 ? "+" : "") + formatCompactGp(row.avgProfit);
        const safe = (row.safeScore >= 0 ? "+" : "") + formatCompactGp(row.safeScore);
        const queue = Number.isFinite(row.estimatedQueueDays)
          ? "~" + row.estimatedQueueDays.toFixed(1) + "d"
          : "Inf";
        const details = [];
        if (row.risk === "HIGH" || row.action !== "CRAFT" || row.profitNow < 100000) {
          details.push("Break-even " + formatCompactGp(row.breakEvenSell, { round: true }));
        }
        if (row.missing.length > 0) details.push("Missing " + row.missing.length);
        if (row.priceSpikeRisk === "HIGH") {
          details.push("⚠ Current sell is far above average. This is speculative.");
        }
        if (row.avgProfit < 0) details.push("Avg profit negative at monthly average price.");

        return {
          name: "#" + (index + 1) + " " + cleanScrollName(row.outputName) + " — " + row.action,
          value:
            "Action **" + row.action + "** | ProfitNow " + profit + " | AvgProfit " + avgProfit + " | SafeScore " + safe + "\n" +
            "Sold " + formatCompactGp(row.monthSold) + "/mo | Realism " + (row.priceRealismFactor * 100).toFixed(0) + "% | Queue " + queue + "\n" +
            "FillRisk " + row.ingredientFillRisk + " | SpikeRisk " + row.priceSpikeRisk +
            (details.length > 0 ? "\n" + details.join("\n") : ""),
          inline: false,
        };
      }),
      footer: {
        text: "Profit = current lowest sell; Avg is reference only; blank scroll capped at NPC 25k",
      },
    }],
  };
}

function buildDiscordAcceptCommand(row) {
  const tradeBat = process.env.TIBIA_LOCAL_TRADE_BAT || DEFAULT_LOCAL_TRADE_BAT;
  return quoteCmdArg(tradeBat) + " sell-scroll " + quoteCmdArg(row.outputName) + " 1";
}

function buildDiscordPayload(rows, flags = {}) {
  const includeAvoid = Boolean(flags["include-avoid"]);
  const includeWatchCommands = Boolean(flags["include-watch-commands"]);
  const maxRows = includeAvoid ? 999 : 6;

  const bySafeScore = (a, b) => Number(b.safeScore || 0) - Number(a.safeScore || 0);
  const displayAction = (row) => row.action === "TEST 1x" ? "TRY 1x" : row.action;
  const isStrongSpeculative = (row) =>
    row.action === "SPECULATIVE" &&
    (Number(row.profitNow || 0) >= 100000 || Number(row.safeScore || 0) >= 50000);

  const testRows = rows.filter((row) => row.action === "TEST 1x").sort(bySafeScore);
  const speculativeRows = rows.filter(isStrongSpeculative).sort(bySafeScore);
  const watchRows = rows.filter((row) => row.action === "WATCH").sort(bySafeScore);
  const avoidRows = rows.filter((row) => row.action === "AVOID").sort(bySafeScore);

  const visibleRows = includeAvoid
    ? [...testRows, ...speculativeRows, ...watchRows, ...avoidRows]
    : [...testRows, ...speculativeRows, ...watchRows].slice(0, maxRows);

  const visibleSet = new Set(visibleRows);
  const hiddenAvoidCount = includeAvoid ? 0 : avoidRows.length;
  const hiddenWeakSpeculativeCount = rows.filter((row) => row.action === "SPECULATIVE" && !isStrongSpeculative(row)).length;
  const hiddenLowPriorityWatchCount = includeAvoid ? 0 : watchRows.filter((row) => !visibleSet.has(row)).length;

  const rowTitle = (row, index) =>
    "#" + (index + 1) + " " + cleanScrollName(row.outputName) + " - " + displayAction(row);

  const profitLine = (row) => {
    const profit = (row.profitNow >= 0 ? "+" : "") + formatCompactGp(row.profitNow);
    const avgProfit = (row.avgProfit >= 0 ? "+" : "") + formatCompactGp(row.avgProfit);
    const safe = (row.safeScore >= 0 ? "+" : "") + formatCompactGp(row.safeScore);
    return "Profit " + profit + " | Avg " + avgProfit + " | Safe " + safe +
      " | Sold " + formatCompactGp(row.monthSold) + "/mo | Realism " +
      (row.priceRealismFactor * 100).toFixed(0) + "%";
  };

  const riskLines = (row) => {
    const risks = [];
    const realism = Number(row.priceRealismFactor || 0);
    const queueDays = Number(row.estimatedQueueDays);

    if (realism < 0.7) risks.push("low realism, current price may be inflated");
    if (row.priceSpikeRisk === "HIGH") risks.push("price spike HIGH, current sell is far above average");
    if (row.ingredientFillRisk === "HIGH") risks.push("Fill HIGH, ingredients may be hard or expensive to buy");
    if (!Number.isFinite(queueDays) || queueDays > 14) risks.push("Queue unusually bad");
    if (row.avgProfit < 0) risks.push("Avg profit negative at monthly average price");

    return risks.map((risk) => "Risk: " + risk).join("\n");
  };

  const commandText = (row) => {
    return "\nCMD:\n" + buildDiscordAcceptCommand(row);
  };

  const fullValue = (row) => {
    const riskText = riskLines(row);
    return profitLine(row) + "\n" +
      (riskText ? riskText + "\n" : "") +
      "Recipe: " + formatRecipeText(row) +
      commandText(row);
  };

  const compactValue = (row) =>
    fullValue(row);

  const addSection = (fields, title, sectionRows, compact = false) => {
    if (sectionRows.length === 0) return;
    const maxFieldValueLength = 1000;
    const values = sectionRows
      .map((row, index) => rowTitle(row, index) + "\n" + (compact ? compactValue(row) : fullValue(row)));
    let chunk = "";
    let chunkIndex = 1;

    const pushChunk = () => {
      if (!chunk) return;
      fields.push({
        name: title,
        value: chunk,
        inline: false,
      });
      chunk = "";
      chunkIndex++;
    };

    for (const value of values) {
      const separator = chunk ? "\n\n" : "";
      if (chunk && chunk.length + separator.length + value.length > maxFieldValueLength) {
        pushChunk();
      }
      chunk += (chunk ? "\n\n" : "") + value;
    }

    pushChunk();
  };

  const fields = [];
  addSection(fields, "TRY 1x", visibleRows.filter((row) => row.action === "TEST 1x"));
  addSection(fields, "SPECULATIVE", visibleRows.filter((row) => row.action === "SPECULATIVE"));
  addSection(fields, "WATCH", visibleRows.filter((row) => row.action === "WATCH"), true);
  if (includeAvoid) addSection(fields, "AVOID", visibleRows.filter((row) => row.action === "AVOID"), true);

  if (fields.length === 0) {
    fields.push({
      name: "No actionable scrolls",
      value: "No TRY 1x, SPECULATIVE, or WATCH rows passed the default Discord filter.",
      inline: false,
    });
  }

  void hiddenAvoidCount;
  void hiddenWeakSpeculativeCount;
  void hiddenLowPriorityWatchCount;
  return {
    embeds: [{
      title: "Powerful Scroll Crafting - " + SERVER,
      color: 0x9966ff,
      fields,
      footer: {
        text: "Profit = current sell | Avg = monthly avg | Safe = risk-adjusted",
      },
    }],
  };
}

async function maybeSendDiscord(rows, flags) {
  if (!flags.discord) return;

  const webhook =
    process.env.TIBIA_SCROLLS_WEBHOOK_URL ||
    process.env.TIBIA_SCANNER_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    console.log("Discord skipped: missing TIBIA_SCROLLS_WEBHOOK_URL / TIBIA_SCANNER_WEBHOOK_URL / DISCORD_WEBHOOK_URL");
    return;
  }

  await axios.post(webhook, buildDiscordPayload(rows, flags));
  console.log("Discord scroll crafting report sent.");
}

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const tierFilter = String(flags.tier || "powerful").toLowerCase();
  if (tierFilter !== "powerful") {
    throw new Error("Only --tier powerful is supported.");
  }
  const onlyFilter = String(flags.only || flags.imbuement || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const limit = Number(flags.limit || 15);
  const minProfit = flags["min-profit"] === undefined
    ? Number.NEGATIVE_INFINITY
    : Number(flags["min-profit"]);

  const items = loadItems();
  const resolveItem = createResolver(items);
  const recipes = loadRecipes();

  const resolvedRecipes = recipes
    .filter((recipe) => {
      if (recipe.enabled === false) {
        return false;
      }

      if (tierFilter && String(recipe.tier).toLowerCase() !== tierFilter) {
        return false;
      }

      if (onlyFilter.length > 0) {
        const haystack = [
          recipe.outputName,
          recipe.imbuement,
          recipe.category,
          recipe.tier,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return onlyFilter.some((token) => haystack.includes(token));
      }

      return true;
    })
    .map((recipe) => {
      const outputItem = resolveItem(recipe.outputName);
      const blankItem = resolveItem(recipe.blankScrollName || "Blank Imbuement Scroll");
      const ingredients = recipe.ingredients.map((ingredient) => {
        const item = resolveItem(ingredient.name);
        return {
          ...ingredient,
          itemId: Number(item.id),
          name: item.wiki_name || item.name,
        };
      });

      return {
        ...recipe,
        outputItemId: Number(outputItem.id),
        outputName: outputItem.wiki_name || recipe.outputName,
        blankScrollItemId: Number(blankItem.id),
        blankScrollName: blankItem.wiki_name || recipe.blankScrollName || "Blank Imbuement Scroll",
        ingredients,
      };
    });

  const ids = new Set();

  for (const recipe of resolvedRecipes) {
    ids.add(recipe.outputItemId);
    ids.add(recipe.blankScrollItemId);
    recipe.ingredients.forEach((ingredient) => ids.add(ingredient.itemId));
  }

  const values = await getMarketValuesWithRetry([...ids]);
  const marketById = new Map(values.map((row) => [Number(row.id), row]));
  const ingredientIds = [...new Set(
    resolvedRecipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.itemId)),
  )];
  const ingredientBoards = new Map();
  const boardRequests = [];

  for (let index = 0; index < ingredientIds.length; index++) {
    const itemId = ingredientIds[index];
    boardRequests.push(
      getMarketBoardWithRetry(itemId, { maxAttempts: 1 }).then((board) => {
        ingredientBoards.set(itemId, board);
        if (!board && flags.verbose) {
          console.log("Ingredient market_board unavailable for item " + itemId + "; using market_values fallback.");
        }
      }),
    );
    if (index < ingredientIds.length - 1) await sleep(5500);
  }

  await Promise.all(boardRequests);

  const rows = resolvedRecipes.map((recipe) => {
    const outputMarket = marketById.get(recipe.outputItemId);
    const blankMarket = marketById.get(recipe.blankScrollItemId);

    const outputSell = Number(outputMarket?.sell_offer || outputMarket?.lowest_sell || 0);
    const outputSellSource = outputMarket?.sell_offer
      ? "sell_offer"
      : outputMarket?.lowest_sell ? "lowest_sell" : "missing (0)";
    const outputBuy = getBuyPrice(outputMarket);
    const outputBuySource = getBuyPriceSource(outputMarket);
    const sellStatsTransactions = Number(outputMarket?.month_sold || 0);
    const sellStatsAveragePrice = Number(outputMarket?.month_average_sell || 0);
    const hasSellStats = sellStatsTransactions > 0 && sellStatsAveragePrice > 0;
    const blankMarketSell = getSellPrice(blankMarket);
    const blankMarketPriceSource = getSellPriceSource(blankMarket);
    const blankCost = effectiveBlankCost(blankMarketSell, BLANK_SCROLL_NPC_PRICE);

    let ingredientsCost = 0;
    let oldIngredientsCost = 0;
    const missing = [];
    if (outputSell <= 0 && !hasSellStats) missing.push(recipe.outputName + " sell price");
    if (blankMarketSell <= 0) missing.push("Blank Imbuement Scroll market price (using NPC price)");

    const ingredientRows = recipe.ingredients.map((ingredient) => {
      const market = marketById.get(ingredient.itemId);
      const unitPriceEstimate = getSellPrice(market);
      const unitPriceSource = getSellPriceSource(market);
      const board = ingredientBoards.get(ingredient.itemId);
      const fill = simulateIngredientFill(board, ingredient.qty, unitPriceEstimate);
      const cost = fill.fillCost;
      const oldCost = unitPriceEstimate * Number(ingredient.qty || 0);

      if (unitPriceEstimate <= 0) {
        missing.push(ingredient.name);
      }

      ingredientsCost += cost;
      oldIngredientsCost += oldCost;

      return {
        ...ingredient,
        unitPrice: fill.fillAvgUnitPrice,
        priceSource: fill.ingredientCostSource,
        unitPriceEstimate,
        lowestSellUnitPrice: unitPriceEstimate,
        unitPriceSource,
        oldCost,
        cost,
        ...fill,
        daySold: getDaySold(market),
        monthSold: getMonthSold(market),
      };
    });

    const allIngredientsFillComplete = ingredientRows.every((ingredient) => ingredient.fillComplete);
    const incompleteIngredients = ingredientRows.filter((ingredient) => !ingredient.marketBoardFillComplete && ingredient.marketBoardAvailable);
    const fallbackIngredients = ingredientRows.filter((ingredient) => ingredient.ingredientCostSource === "market_values_fallback");
    const unhealthyFallbackIngredients = fallbackIngredients.filter(
      (ingredient) => ingredient.monthSold < Number(ingredient.qty || 0),
    );
    const ingredientFillWarnings = ingredientRows
      .filter((ingredient) => ingredient.ingredientCostSource !== "market_board" || ingredient.fillSlippagePercent > 0)
      .map((ingredient) => {
        if (ingredient.ingredientCostSource === "market_values_fallback") {
          const health = ingredient.monthSold >= Number(ingredient.qty || 0) ? "healthy" : "thin";
          return ingredient.name + ": market_board unavailable; market_values fallback used (monthSold " + health + ")";
        }
        if (!ingredient.fillComplete) {
          return ingredient.name + ": missing " + ingredient.missingQty + " units on market_board; fallback estimate used";
        }
        return ingredient.name + ": fill slippage " + ingredient.fillSlippagePercent.toFixed(2) + "%";
      });
    const lowestSellIngredientEstimate = ingredientRows.reduce(
      (sum, ingredient) => sum + ingredient.unitPriceEstimate * Number(ingredient.qty || 0),
      0,
    );
    const totalIngredientFillSlippagePercent = lowestSellIngredientEstimate > 0
      ? Math.max(0, ((ingredientsCost - lowestSellIngredientEstimate) / lowestSellIngredientEstimate) * 100)
      : 0;
    const ingredientFillRisk = incompleteIngredients.length > 0 || unhealthyFallbackIngredients.length > 0
      ? "HIGH"
      : fallbackIngredients.length > 0 || totalIngredientFillSlippagePercent > 10
        ? "MEDIUM"
        : "LOW";

    const fixedGoldCost = POWERFUL_FIXED_COST;
    const totalCraftCost = fixedGoldCost + blankCost + ingredientsCost;
    const oldTotalCraftCost = fixedGoldCost + blankCost + oldIngredientsCost;
    const currentLowestSell = outputSell;
    const outputNetSell = currentLowestSell * (1 - TAX_RATE);
    const profitNow = outputNetSell - totalCraftCost;
    const oldProfitNow = outputNetSell - oldTotalCraftCost;
    const roiNow = totalCraftCost > 0 ? (profitNow / totalCraftCost) * 100 : 0;
    const avgSellPrice = sellStatsAveragePrice;
    const avgProfit = avgSellPrice > 0
      ? avgSellPrice * (1 - TAX_RATE) - totalCraftCost
      : 0;
    const realisticSellPrice = avgSellPrice > 0 ? avgSellPrice : currentLowestSell;
    const realisticNetSell = realisticSellPrice * (1 - TAX_RATE);
    const realisticProfit = avgProfit;
    const realisticRoi = totalCraftCost > 0 ? (avgProfit / totalCraftCost) * 100 : 0;
    const currentProfit = profitNow;
    const rawProfit = profitNow;
    const profit = profitNow;
    const roi = roiNow;
    const breakEvenSell = totalCraftCost > 0 ? Math.ceil(totalCraftCost / (1 - TAX_RATE)) : 0;

    const daySold = getDaySold(outputMarket);
    const marketMonthSold = getMonthSold(outputMarket);
    const dayBought = getDayBought(outputMarket);
    const monthBought = getMonthBought(outputMarket);
    const monthSold = hasSellStats ? sellStatsTransactions : marketMonthSold;
    const sellOffers = Math.max(0, Number(outputMarket?.sell_offers || 0));
    const buyOffers = Math.max(0, Number(outputMarket?.buy_offers || 0));
    const activeTraders = Math.max(0, Number(outputMarket?.active_traders || 0));
    const dataConfidence = outputMarket?.is_full_data === true
      ? (currentLowestSell > 0 && avgSellPrice > 0 ? "HIGH" : "MEDIUM")
      : "LOW";
    const row = {
      outputName: recipe.outputName,
      outputItemId: recipe.outputItemId,
      tier: recipe.tier,
      imbuement: recipe.imbuement,
      category: recipe.category,
      fixedGoldCost,
      blankCost,
      blankMarketSell,
      blankMarketPriceSource,
      blankScrollItemId: recipe.blankScrollItemId,
      blankScrollNpcCap: BLANK_SCROLL_NPC_PRICE,
      ingredientsCost,
      oldIngredientsCost,
      oldTotalCraftCost,
      ingredientFillRisk,
      ingredientFillWarnings,
      totalIngredientFillSlippagePercent,
      allIngredientsFillComplete,
      totalCraftCost,
      outputSell,
      outputSellSource,
      currentLowestSell,
      outputBuy,
      outputBuySource,
      outputNetSell,
      currentProfit,
      profitNow,
      oldProfitNow,
      roiNow,
      avgSellPrice,
      avgProfit,
      sellStatsTransactions,
      sellStatsAveragePrice,
      hasSellStats,
      realisticSellPrice,
      realisticNetSell,
      realisticProfit,
      realisticRoi,
      rawProfit,
      profit,
      roi,
      breakEvenSell,
      daySold,
      monthSold,
      dayBought,
      monthBought,
      marketMonthSold,
      sellOffers,
      buyOffers,
      activeTraders,
      dataConfidence,
      missing,
      ingredients: ingredientRows,
    };

    return {
      ...row,
      action: decide(row),
    };
  });

  const enrichedRows = rows
    .map(enrichScrollLiquidity)
    .map(enrichExpectedCraftValue);

  const sortedRows = [...enrichedRows].sort(comparePracticalRank);
  const filtered = sortedRows
    .filter((row) => row.profitNow >= minProfit);

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      server: SERVER,
      rows: sortedRows,
    }, null, 2),
  );

  console.log("\nSCROLL CRAFTING SCANNER — " + SERVER);
  console.log("Recipes checked: " + resolvedRecipes.length);
  if (onlyFilter.length > 0) {
    console.log("Filter: " + onlyFilter.join(", "));
  }
  console.log("Blank scroll: market price capped at NPC " + formatGp(25000) + " gp");
  console.log("Tax included: " + formatPercent(TAX_RATE * 100));
  console.log("");

  if (flags["debug-prices"]) {
    sortedRows.forEach(printPriceTrace);
  }

  if (flags.audit) {
    exportAudit(sortedRows);
    printAuditTable(sortedRows);
    console.log("");
    console.log("Saved audit JSON to " + AUDIT_JSON_FILE);
    console.log("Saved audit CSV to " + AUDIT_CSV_FILE);
    console.log("Saved manual template to " + MANUAL_TEMPLATE_FILE);
    return;
  }

  const shown = filtered.slice(0, limit);

  const printMissingPriceSummary = () => {
    const missingRows = enrichedRows.filter((row) => row.missing.length > 0);
    if (missingRows.length === 0) return;

    console.log("Missing price summary:");
    missingRows.forEach((row) => {
      console.log("- " + row.outputName + ": " + row.missing.join(", "));
    });
    console.log("");
  };

  if (shown.length === 0) {
    console.log("No scroll crafting candidates found with the current filters.");
    printMissingPriceSummary();
    console.log("Saved full results to " + RESULTS_FILE);
    return;
  }

  shown.forEach((row, index) => {
    console.log("#" + (index + 1) + " " + row.outputName + " — " + row.action);
    console.log("Tier: " + row.tier + (row.category ? " | Category: " + row.category : ""));
    if (row.hasSellStats) {
      console.log("Avg sell: " + formatGp(row.sellStatsAveragePrice) + " gp | Transactions: " + formatGp(row.sellStatsTransactions) + "/30d | Current sell: " + formatGp(row.currentLowestSell) + " gp");
      console.log("Realistic net after tax: " + formatGp(row.realisticNetSell) + " gp");
    } else {
      console.log("Sell est: " + formatGp(row.currentLowestSell) + " gp | Net after tax: " + formatGp(row.realisticNetSell) + " gp");
    }
    console.log("Craft cost: " + formatGp(row.totalCraftCost) + " gp");
    console.log("  Fixed: " + formatGp(row.fixedGoldCost) + " | Blank: " + formatGp(row.blankCost) + " | Ingredients: " + formatGp(row.ingredientsCost));
    console.log("Profit Now: " + formatGp(row.profitNow) + " gp | Safe: " + formatGp(row.safeScore) + " gp | ROI: " + formatPercent(row.roiNow));
    console.log("Avg sell: " + formatGp(row.avgSellPrice) + " gp | Avg profit: " + formatGp(row.avgProfit) + " gp");
    console.log("Realism: " + formatPercent(row.priceRealismFactor * 100) + " | Queue: " + (Number.isFinite(row.estimatedQueueDays) ? "~" + row.estimatedQueueDays.toFixed(1) + "d" : "Infinity") + " | Confidence: " + row.dataConfidence);
    console.log("Break-even sell: " + formatGp(row.breakEvenSell) + " gp");
    console.log(row.hasSellStats
      ? "Volume: " + formatGp(row.sellStatsTransactions) + " transactions / 30 days (live sell statistics)"
      : "Volume: " + formatGp(row.daySold) + " sold today | " + formatGp(row.monthSold) + " sold month");
    console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demand + " | Buy support: " + row.buySupport + " | Risk: " + row.risk);

    if (row.missing.length > 0) {
      console.log("Missing prices: " + row.missing.join(", "));
    }

    const expensive = [...row.ingredients]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3)
      .map((ingredient) => ingredient.qty + "x " + ingredient.name + " @ " + formatGp(ingredient.unitPrice) + " = " + formatGp(ingredient.cost));

    console.log("Main ingredient costs: " + expensive.join(" | "));
    console.log("");
  });

  printMissingPriceSummary();

  console.log("Saved full results to " + RESULTS_FILE);

  await maybeSendDiscord(filtered, flags);
}

main().catch((err) => {
  const status = err?.response?.status;
  const apiMessage = err?.response?.data?.error;

  if (status === 429) {
    console.log("");
    console.log("SCROLL CRAFTING SCANNER STOPPED");
    console.log("--------------------------------");
    console.log("TibiaMarket API is rate-limiting this request right now.");
    console.log(apiMessage || "Rate limit exceeded.");
    console.log("");
    console.log("What to do:");
    console.log("1) Wait 5-10 minutes.");
    console.log("2) Do not run flips/scanner/scrolls during that time.");
    console.log("3) Try again:");
    console.log("   npm run scrolls -- --tier powerful");
    console.log("");
    console.log("This is not a recipe bug. The API blocked the market price request.");
    process.exit(1);
  }

  console.error("Scroll crafting scan failed: " + (err?.message || String(err)));
  process.exit(1);
});
