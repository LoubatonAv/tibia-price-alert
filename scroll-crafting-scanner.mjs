import fs from "fs";
import axios from "axios";
import "dotenv/config";
import { getMarketValues } from "./lib/market.js";
import { TAX_RATE, SERVER } from "./lib/constants.js";

const RECIPES_FILE = "./data/scroll-recipes.json";
const ITEMS_PATHS = ["./data/items.json", "./items.json"];
const RESULTS_FILE = "./scroll-crafting-results.json";
const POWERFUL_FIXED_COST = 250000;
const BLANK_SCROLL_NPC_PRICE = 25000;

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

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function formatPercent(value) {
  return Number(value || 0).toFixed(2) + "%";
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

function getBuyPrice(row) {
  return Number(row?.buy_offer || row?.highest_buy || 0);
}

function getDaySold(row) {
  return Number(row?.day_sold || 0);
}

function getMonthSold(row) {
  return Number(row?.month_sold || 0);
}

function classifyDemand(daySold, monthSold) {
  if (daySold >= 2 || monthSold >= 20) return "HIGH";
  if (daySold >= 1 || monthSold >= 7) return "MEDIUM";
  if (monthSold > 0) return "LOW";
  return "UNKNOWN";
}

function classifyRisk({ missing, daySold, monthSold, outputBuy, breakEvenSell }) {
  if (missing.length > 0) return "UNKNOWN";
  if (monthSold <= 0 && daySold <= 0 && outputBuy <= 0) return "HIGH";

  const buySupport = breakEvenSell > 0 ? outputBuy / breakEvenSell : 0;
  if (monthSold < 3 && buySupport < 0.7) return "HIGH";
  if (monthSold < 10 && buySupport < 0.9) return "MEDIUM";
  return "LOW";
}

function effectiveBlankCost(blankMarketSell, npcCap) {
  const cap = Number(npcCap || 25000);
  const market = Number(blankMarketSell || 0);

  if (market > 0) return Math.min(market, cap);
  return cap;
}

function decide(row) {
  if (row.missing.length > 0) return "MISSING DATA";
  if (row.outputSell <= 0) return "NO SCROLL SELL PRICE";
  if (row.profit <= 0) return "NOT PROFITABLE";
  if (row.profit >= 100000 && row.roi >= 15) return "CRAFT";
  if (row.profit >= 40000 && row.roi >= 8) return "WATCH";
  return "LOW EDGE";
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
  row.demand = classifyDemand(row);
  row.buySupport = classifyBuySupport(row);
  row.risk = classifyRisk(row);
  return row;
}


function buildDiscordPayload(rows) {
  const top = rows.slice(0, 8);

  return {
    embeds: [
      {
        title: "📜 Scroll Crafting Scanner",
        description: "Best imbuement scroll crafting opportunities on " + SERVER,
        color: 0x9966ff,
        fields: top.map((row, index) => ({
          name: "#" + (index + 1) + " " + row.outputName + " — " + row.action,
          value:
            "Sell: **" + formatGp(row.outputSell) + "** | Craft: **" + formatGp(row.totalCraftCost) + "**\n" +
            "Profit: **" + formatGp(row.profit) + "** | ROI: **" + formatPercent(row.roi) + "**\n" +
            "Break-even sell: **" + formatGp(row.breakEvenSell) + "**\n" +
            "Volume: **" + formatGp(row.daySold) + "/day | " + formatGp(row.monthSold) + "/month**\n" +
            "Highest buy: **" + formatGp(row.outputBuy) + "** | Demand: **" + row.demandLevel + "** | Risk: **" + row.riskLevel + "**\n" +
            "Blank: **" + formatGp(row.blankCost) + "** | Missing: **" + row.missing.length + "**",
        })),
        footer: {
          text: "Tax included. Blank scroll uses market price capped at NPC 25k.",
        },
      },
    ],
  };
}

async function maybeSendDiscord(rows, flags) {
  if (!flags.discord) return;

  const webhook =
    process.env.TIBIA_SCROLLS_WEBHOOK_URL ||
    process.env.TIBIA_SCANNER_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    console.log("Discord skipped: missing TIBIA_SCROLLS_WEBHOOK_URL / TIBIA_SCANNER_WEBHOOK_URL.");
    return;
  }

  await axios.post(webhook, buildDiscordPayload(rows));
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

  const rows = resolvedRecipes.map((recipe) => {
    const outputMarket = marketById.get(recipe.outputItemId);
    const blankMarket = marketById.get(recipe.blankScrollItemId);

    const outputSell = getSellPrice(outputMarket);
    const outputBuy = getBuyPrice(outputMarket);
    const blankMarketSell = getSellPrice(blankMarket);
    const blankCost = effectiveBlankCost(blankMarketSell, BLANK_SCROLL_NPC_PRICE);

    let ingredientsCost = 0;
    const missing = [];
    if (outputSell <= 0) missing.push(recipe.outputName + " sell price");
    if (blankMarketSell <= 0) missing.push("Blank Imbuement Scroll market price (using NPC price)");

    const ingredientRows = recipe.ingredients.map((ingredient) => {
      const market = marketById.get(ingredient.itemId);
      const unitPrice = getSellPrice(market);
      const cost = unitPrice * Number(ingredient.qty || 0);

      if (unitPrice <= 0) {
        missing.push(ingredient.name);
      }

      ingredientsCost += cost;

      return {
        ...ingredient,
        unitPrice,
        cost,
        daySold: getDaySold(market),
        monthSold: getMonthSold(market),
      };
    });

    const fixedGoldCost = POWERFUL_FIXED_COST;
    const totalCraftCost = fixedGoldCost + blankCost + ingredientsCost;
    const outputNetSell = outputSell * (1 - TAX_RATE);
    const profit = outputNetSell - totalCraftCost;
    const roi = totalCraftCost > 0 ? (profit / totalCraftCost) * 100 : 0;
    const breakEvenSell = totalCraftCost > 0 ? Math.ceil(totalCraftCost / (1 - TAX_RATE)) : 0;

    const daySold = getDaySold(outputMarket);
    const monthSold = getMonthSold(outputMarket);
    const row = {
      outputName: recipe.outputName,
      outputItemId: recipe.outputItemId,
      tier: recipe.tier,
      imbuement: recipe.imbuement,
      category: recipe.category,
      fixedGoldCost,
      blankCost,
      blankMarketSell,
      blankScrollNpcCap: BLANK_SCROLL_NPC_PRICE,
      ingredientsCost,
      totalCraftCost,
      outputSell,
      outputBuy,
      outputNetSell,
      profit,
      roi,
      breakEvenSell,
      daySold,
      monthSold,
      missing,
      ingredients: ingredientRows,
    };

    return {
      ...row,
      demandLevel: classifyDemand(daySold, monthSold),
      riskLevel: classifyRisk(row),
      action: decide(row),
    };
  });

  const sortedRows = [...rows].sort((a, b) => b.profit - a.profit);
  const filtered = sortedRows.filter((row) => row.profit >= minProfit);

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), server: SERVER, rows: sortedRows }, null, 2));

  console.log("\nSCROLL CRAFTING SCANNER — " + SERVER);
  console.log("Recipes checked: " + resolvedRecipes.length);
  if (onlyFilter.length > 0) {
    console.log("Filter: " + onlyFilter.join(", "));
  }
  console.log("Blank scroll: market price capped at NPC " + formatGp(25000) + " gp");
  console.log("Tax included: " + formatPercent(TAX_RATE * 100));
  console.log("");

  const shown = filtered.slice(0, limit);

  const printMissingPriceSummary = () => {
    const missingRows = rows.filter((row) => row.missing.length > 0);
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
    console.log("Sell: " + formatGp(row.outputSell) + " gp | Net after tax: " + formatGp(row.outputNetSell) + " gp");
    console.log("Craft cost: " + formatGp(row.totalCraftCost) + " gp");
    console.log("  Fixed: " + formatGp(row.fixedGoldCost) + " | Blank: " + formatGp(row.blankCost) + " | Ingredients: " + formatGp(row.ingredientsCost));
    console.log("Profit: ~" + formatGp(row.profit) + " gp | ROI: " + formatPercent(row.roi));
    console.log("Break-even sell: " + formatGp(row.breakEvenSell) + " gp");
    console.log("Volume: " + formatGp(row.daySold) + " sold today | " + formatGp(row.monthSold) + " sold month");
    console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demandLevel + " | Risk: " + row.riskLevel);

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

  await maybeSendDiscord(shown, flags);
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
