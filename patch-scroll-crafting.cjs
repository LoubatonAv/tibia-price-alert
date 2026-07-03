const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function ensureDir(path) {
  if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

const INTRICATE_COST = 60000;
const POWERFUL_COST = 250000;
const BLANK_SCROLL_NPC_CAP = 25000;

const recipeBases = [
  {
    base: "Vampirism",
    category: "life leech",
    intricate: [
      ["Vampire Teeth", 25],
      ["Bloody Pincers", 15],
    ],
    powerfulExtra: [["Piece of Dead Brain", 5]],
  },
  {
    base: "Void",
    category: "mana leech",
    intricate: [
      ["Rope Belt", 25],
      ["Silencer Claws", 25],
    ],
    powerfulExtra: [["Some Grimeleech Wings", 5]],
  },
  {
    base: "Strike",
    category: "critical",
    intricate: [
      ["Protective Charm", 20],
      ["Sabretooth", 25],
    ],
    powerfulExtra: [["Vexclaw Talon", 5]],
  },
  {
    base: "Lich Shroud",
    category: "death protection",
    intricate: [
      ["Flask of Embalming Fluid", 25],
      ["Gloom Wolf Fur", 20],
    ],
    powerfulExtra: [["Mystical Hourglass", 5]],
  },
  {
    base: "Snake Skin",
    category: "earth protection",
    intricate: [
      ["Piece of Swampling Wood", 25],
      ["Snake Skin", 20],
    ],
    powerfulExtra: [["Brimstone Fangs", 10]],
  },
  {
    base: "Dragon Hide",
    category: "fire protection",
    intricate: [
      ["Green Dragon Leather", 20],
      ["Blazing Bone", 10],
    ],
    powerfulExtra: [["Draken Sulphur", 5]],
  },
  {
    base: "Quara Scale",
    category: "ice protection",
    intricate: [
      ["Winter Wolf Fur", 25],
      ["Thick Fur", 15],
    ],
    powerfulExtra: [["Deepling Warts", 10]],
  },
  {
    base: "Cloud Fabric",
    category: "energy protection",
    intricate: [
      ["Wyvern Talisman", 20],
      ["Crawler Head Plating", 15],
    ],
    powerfulExtra: [["Wyrm Scale", 10]],
  },
  {
    base: "Demon Presence",
    category: "holy protection",
    intricate: [
      ["Cultish Robe", 25],
      ["Cultish Mask", 25],
    ],
    powerfulExtra: [["Hellspawn Tail", 20]],
  },
  {
    base: "Featherweight",
    category: "capacity",
    intricate: [
      ["Fairy Wings", 20],
      ["Little Bowl of Myrrh", 10],
    ],
    powerfulExtra: [["Goosebump Leather", 5]],
  },
  {
    base: "Epiphany",
    category: "magic level",
    intricate: [
      ["Elvish Talisman", 25],
      ["Broken Shamanic Staff", 15],
    ],
    powerfulExtra: [["Strand of Medusa Hair", 15]],
  },
  {
    base: "Punch",
    category: "fist fighting",
    intricate: [
      ["Tarantula Egg", 25],
      ["Mantassin Tail", 20],
    ],
    powerfulExtra: [["Gold-Brocaded Cloth", 15]],
  },
  {
    base: "Bash",
    category: "club fighting",
    intricate: [
      ["Cyclops Toe", 20],
      ["Ogre Nose Ring", 15],
    ],
    powerfulExtra: [["Warmaster's Wristguards", 10]],
  },
  {
    base: "Slash",
    category: "sword fighting",
    intricate: [
      ["Lion's Mane", 25],
      ["Mooh'tah Shell", 25],
    ],
    powerfulExtra: [["War Crystal", 5]],
  },
  {
    base: "Chop",
    category: "axe fighting",
    intricate: [
      ["Orc Tooth", 20],
      ["Battle Stone", 25],
    ],
    powerfulExtra: [["Moohtant Horn", 20]],
  },
  {
    base: "Precision",
    category: "distance fighting",
    intricate: [
      ["Elven Scouting Glass", 25],
      ["Elven Hoof", 20],
    ],
    powerfulExtra: [["Metal Spike", 10]],
  },
  {
    base: "Blockade",
    category: "shielding",
    intricate: [
      ["Piece of Scarab Shell", 20],
      ["Brimstone Shell", 25],
    ],
    powerfulExtra: [["Frazzle Skin", 25]],
  },
];

function ingredient([name, qty]) {
  return { name, qty };
}

const recipes = [];

for (const base of recipeBases) {
  recipes.push({
    outputName: `Intricate ${base.base} Scroll`,
    tier: "intricate",
    imbuement: base.base,
    category: base.category,
    fixedGoldCost: INTRICATE_COST,
    blankScrollName: "Blank Imbuement Scroll",
    blankScrollNpcCap: BLANK_SCROLL_NPC_CAP,
    ingredients: base.intricate.map(ingredient),
  });

  recipes.push({
    outputName: `Powerful ${base.base} Scroll`,
    tier: "powerful",
    imbuement: base.base,
    category: base.category,
    fixedGoldCost: POWERFUL_COST,
    blankScrollName: "Blank Imbuement Scroll",
    blankScrollNpcCap: BLANK_SCROLL_NPC_CAP,
    ingredients: [...base.intricate, ...base.powerfulExtra].map(ingredient),
  });
}

ensureDir("./data");
write(
  "./data/scroll-recipes.json",
  JSON.stringify({ updatedAt: new Date().toISOString(), recipes }, null, 2) +
    "\n",
);

const scanner = String.raw`import fs from "fs";
import axios from "axios";
import "dotenv/config";
import { getMarketValues } from "./lib/market.js";
import { TAX_RATE, SERVER } from "./lib/constants.js";

const RECIPES_FILE = "./data/scroll-recipes.json";
const ITEMS_PATHS = ["./data/items.json", "./items.json"];
const RESULTS_FILE = "./scroll-crafting-results.json";

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
  const tierFilter = String(flags.tier || "").toLowerCase();
  const limit = Number(flags.limit || 15);
  const minProfit = Number(flags["min-profit"] || 0);

  const items = loadItems();
  const resolveItem = createResolver(items);
  const recipes = loadRecipes();

  const resolvedRecipes = recipes
    .filter((recipe) => !tierFilter || String(recipe.tier).toLowerCase() === tierFilter)
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

  const values = await getMarketValues([...ids]);
  const marketById = new Map(values.map((row) => [Number(row.id), row]));

  const rows = resolvedRecipes.map((recipe) => {
    const outputMarket = marketById.get(recipe.outputItemId);
    const blankMarket = marketById.get(recipe.blankScrollItemId);

    const outputSell = getSellPrice(outputMarket);
    const outputBuy = getBuyPrice(outputMarket);
    const blankMarketSell = getSellPrice(blankMarket);
    const blankCost = effectiveBlankCost(blankMarketSell, recipe.blankScrollNpcCap);

    let ingredientsCost = 0;
    const missing = [];

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

    const fixedGoldCost = Number(recipe.fixedGoldCost || 0);
    const totalCraftCost = fixedGoldCost + blankCost + ingredientsCost;
    const outputNetSell = outputSell * (1 - TAX_RATE);
    const profit = outputNetSell - totalCraftCost;
    const roi = totalCraftCost > 0 ? (profit / totalCraftCost) * 100 : 0;
    const breakEvenSell = totalCraftCost > 0 ? Math.ceil(totalCraftCost / (1 - TAX_RATE)) : 0;

    const row = {
      outputName: recipe.outputName,
      outputItemId: recipe.outputItemId,
      tier: recipe.tier,
      imbuement: recipe.imbuement,
      category: recipe.category,
      fixedGoldCost,
      blankCost,
      blankMarketSell,
      blankScrollNpcCap: recipe.blankScrollNpcCap,
      ingredientsCost,
      totalCraftCost,
      outputSell,
      outputBuy,
      outputNetSell,
      profit,
      roi,
      breakEvenSell,
      daySold: getDaySold(outputMarket),
      monthSold: getMonthSold(outputMarket),
      missing,
      ingredients: ingredientRows,
    };

    return {
      ...row,
      action: decide(row),
    };
  });

  const filtered = rows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), server: SERVER, rows }, null, 2));

  console.log("\nSCROLL CRAFTING SCANNER — " + SERVER);
  console.log("Blank scroll: market price capped at NPC " + formatGp(25000) + " gp");
  console.log("Tax included: " + formatPercent(TAX_RATE * 100));
  console.log("");

  const shown = filtered.slice(0, limit);

  if (shown.length === 0) {
    console.log("No scroll crafting candidates found with the current filters.");
    console.log("Saved full results to " + RESULTS_FILE);
    return;
  }

  shown.forEach((row, index) => {
    console.log("#" + (index + 1) + " " + row.outputName + " — " + row.action);
    console.log("Tier: " + row.tier + " | Category: " + row.category);
    console.log("Sell: " + formatGp(row.outputSell) + " gp | Net after tax: " + formatGp(row.outputNetSell) + " gp");
    console.log("Craft cost: " + formatGp(row.totalCraftCost) + " gp");
    console.log("  Fixed: " + formatGp(row.fixedGoldCost) + " | Blank: " + formatGp(row.blankCost) + " | Ingredients: " + formatGp(row.ingredientsCost));
    console.log("Profit: ~" + formatGp(row.profit) + " gp | ROI: " + formatPercent(row.roi));
    console.log("Break-even sell: " + formatGp(row.breakEvenSell) + " gp");

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

  console.log("Saved full results to " + RESULTS_FILE);

  await maybeSendDiscord(shown, flags);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

write("./scroll-crafting-scanner.mjs", scanner + "\n");

const pkgPath = "./package.json";
const pkg = JSON.parse(read(pkgPath));
pkg.scripts ||= {};
pkg.scripts.scrolls = "node scroll-crafting-scanner.mjs";
pkg.scripts["scrolls-discord"] = "node scroll-crafting-scanner.mjs --discord";
write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const batPath = "./trade-manager.bat";
if (fs.existsSync(batPath)) {
  let bat = read(batPath);

  if (!bat.includes("Scroll Crafting Scanner")) {
    const marketStart = bat.indexOf(":markettools");
    const marketEnd = bat.indexOf(":stats", marketStart);
    const before = bat.slice(0, marketStart);
    let market = bat.slice(
      marketStart,
      marketEnd === -1 ? bat.length : marketEnd,
    );
    const after = marketEnd === -1 ? "" : bat.slice(marketEnd);

    market = market.replace(
      "echo 0. Back",
      "echo 10. Scroll Crafting Scanner\r\n" +
        "echo     - Finds which Intricate/Powerful scrolls are profitable to craft.\r\n" +
        "echo.\r\n" +
        "echo 0. Back",
    );

    market = market.replace(
      'if "%toolchoice%"=="0" goto menu',
      'if "%toolchoice%"=="10" goto scrollcraft\r\nif "%toolchoice%"=="0" goto menu',
    );

    market +=
      "\r\n:scrollcraft\r\n" +
      "cls\r\n" +
      "call npm run scrolls\r\n" +
      "pause\r\n" +
      "goto markettools\r\n";

    bat = before + market + after;
    write(batPath, bat);
  }
}

console.log("Scroll crafting scanner installed.");
console.log("Created: data/scroll-recipes.json");
console.log("Created: scroll-crafting-scanner.mjs");
console.log("Added scripts: npm run scrolls / npm run scrolls-discord");
