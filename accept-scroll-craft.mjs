import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const RECIPES_FILE = "./data/scroll-recipes.json";
const RESULTS_FILE = "./scroll-crafting-results.json";
const POSITIONS_FILE = "./positions.json";
const BLANK_SCROLL_NAME = "Blank Imbuement Scroll";
const BLANK_NPC_PRICE = 25000;
const MARKET_TAX_RATE = 0.02;

function parseFlags(argv) {
  const flags = { price: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    const value = !next || next.startsWith("--") ? true : next;
    if (value !== true) i++;
    if (key === "price") flags.price.push(value);
    else flags[key] = value;
  }
  return flags;
}

function loadJson(path, fallback) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
}

function saveJson(path, value) {
  const temp = path + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, path);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function parseMoney(value, label) {
  const number = Number(String(value).replace(/[,_ ]/g, ""));
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or a positive number.`);
  return number;
}

function parsePriceValue(value, requiredQty, label) {
  const text = String(value).trim();
  const unitMatch = text.match(/^(?:u|unit)\s*[:=]\s*(.+)$/i);
  if (unitMatch) return { total: parseMoney(unitMatch[1], label) * requiredQty, inputMode: "unit" };
  return { total: parseMoney(text, label), inputMode: "total" };
}

function parsePriceFlags(values) {
  const prices = new Map();
  for (const value of values) {
    const separator = String(value).indexOf("=");
    if (separator < 1) throw new Error(`Invalid --price value: ${value}. Use "Item Name=total" or "Item Name=unit:price".`);
    const name = String(value).slice(0, separator).trim();
    prices.set(normalizeName(name), String(value).slice(separator + 1).trim());
  }
  return prices;
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US") + " gp";
}

async function askPrice(rl, prompt, requiredQty, supplied, defaultTotal = null) {
  let answer = supplied;
  if (answer == null) {
    const suffix = defaultTotal == null ? "" : ` [${Math.round(defaultTotal)}]`;
    answer = await rl.question(`${prompt}${suffix} (total, or unit:PRICE): `);
    if (!String(answer).trim() && defaultTotal != null) answer = String(defaultTotal);
  }
  if (!String(answer).trim()) throw new Error(`${prompt} is required.`);
  return parsePriceValue(answer, requiredQty, prompt);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const qty = Number(flags.qty ?? 1);
  if (!flags.scroll) throw new Error("--scroll is required.");
  if (!Number.isInteger(qty) || qty < 1) throw new Error("--qty must be a positive integer (1 or greater).");

  const wanted = normalizeName(flags.scroll);
  const recipe = (loadJson(RECIPES_FILE, { recipes: [] }).recipes || [])
    .find((item) => normalizeName(item.outputName) === wanted);
  if (!recipe) throw new Error(`Scroll recipe not found: ${flags.scroll}`);

  const result = (loadJson(RESULTS_FILE, { rows: [] }).rows || [])
    .find((row) => normalizeName(row.outputName) === wanted) || {};
  const craftFeeEach = Number(result.fixedGoldCost || 250000);
  const craftFeeTotal = craftFeeEach * qty;
  const requiredIngredients = recipe.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: Number(ingredient.qty) * qty,
  }));

  console.log(`\nCrafting:\n${qty}x ${recipe.outputName}\n`);
  console.log("Required:");
  requiredIngredients.forEach((ingredient) => console.log(`${ingredient.quantity}x ${ingredient.name}`));
  console.log(`${qty}x ${BLANK_SCROLL_NAME}`);
  console.log(`Craft fee: ${formatGp(craftFeeTotal)}`);
  if (qty > 1) console.log(`MULTI-SCROLL CRAFT POSITION: ${qty} scrolls.`);
  if (result.action === "SPECULATIVE") {
    console.log("\nWARNING: This was marked SPECULATIVE. Current sell may be far above monthly average.");
    if (qty > 1) console.log("WARNING: Multiple speculative scrolls increase exposure. Quantity is not blocked.");
  }

  const suppliedPrices = parsePriceFlags(flags.price);
  if (flags["dry-run"] && !flags["list-price"] && suppliedPrices.size === 0) {
    console.log("\nActual-cost prompts that would be asked:");
    requiredIngredients.forEach((ingredient) =>
      console.log(`- Actual total paid for ${ingredient.name}: (total, or unit:PRICE)`));
    console.log(`- Actual total paid for Blank Imbuement Scrolls [${qty * BLANK_NPC_PRICE}]:`);
    console.log("- Intended listing price per scroll:");
    console.log("- Confirm save? yes/no");
    console.log("\nDry run: recipe and quantity resolved; nothing saved.");
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const actualIngredients = [];
    for (const ingredient of requiredIngredients) {
      const paid = await askPrice(
        rl,
        `Actual total paid for ${ingredient.name}`,
        ingredient.quantity,
        suppliedPrices.get(normalizeName(ingredient.name)),
      );
      actualIngredients.push({ ...ingredient, actualTotalPaid: paid.total, inputMode: paid.inputMode });
    }

    const blankPaid = await askPrice(
      rl,
      "Actual total paid for Blank Imbuement Scrolls",
      qty,
      flags["blank-cost"],
      qty * BLANK_NPC_PRICE,
    );
    const listPrice = flags["list-price"] == null
      ? parseMoney(await rl.question("Intended listing price per scroll: "), "Intended listing price")
      : parseMoney(flags["list-price"], "--list-price");
    if (listPrice <= 0) throw new Error("Intended listing price must be greater than zero.");

    const ingredientCostTotal = actualIngredients.reduce((sum, ingredient) => sum + ingredient.actualTotalPaid, 0);
    const actualCraftCostTotal = craftFeeTotal + blankPaid.total + ingredientCostTotal;
    const actualCraftCostPerScroll = actualCraftCostTotal / qty;
    const expectedNetPerScroll = listPrice * (1 - MARKET_TAX_RATE);
    const expectedProfitTotal = expectedNetPerScroll * qty - actualCraftCostTotal;
    const breakEvenListPrice = actualCraftCostPerScroll / (1 - MARKET_TAX_RATE);
    const scannerEstimatedCostTotal = Number(result.totalCraftCost || 0) * qty;

    console.log("\nACTUAL COST SUMMARY");
    actualIngredients.forEach((ingredient) => console.log(`${ingredient.name}: ${formatGp(ingredient.actualTotalPaid)}`));
    console.log(`${BLANK_SCROLL_NAME}: ${formatGp(blankPaid.total)}`);
    console.log(`Craft fee: ${formatGp(craftFeeTotal)}`);
    console.log(`Actual total craft cost: ${formatGp(actualCraftCostTotal)}`);
    console.log(`Actual craft cost per scroll: ${formatGp(actualCraftCostPerScroll)}`);
    console.log(`Intended listing price per scroll: ${formatGp(listPrice)}`);
    console.log(`Expected profit after 2% tax: ${formatGp(expectedProfitTotal)}`);

    if (scannerEstimatedCostTotal > 0 && actualCraftCostTotal > scannerEstimatedCostTotal * 1.05) {
      const percent = ((actualCraftCostTotal / scannerEstimatedCostTotal - 1) * 100).toFixed(1);
      console.log(`WARNING: Actual craft cost is ${percent}% above the scanner estimate.`);
    }
    if (listPrice < breakEvenListPrice) {
      console.log(`WARNING: Listing price is below break-even (${formatGp(breakEvenListPrice)}).`);
      if (!flags["dry-run"]) {
        const belowBreakEven = await rl.question("Explicitly continue below break-even? yes/no: ");
        if (!["y", "yes"].includes(belowBreakEven.trim().toLowerCase())) {
          console.log("Cancelled. Nothing saved.");
          return;
        }
      }
    }

    if (flags["dry-run"]) {
      console.log("Dry run: actual costs calculated; nothing saved.");
      return;
    }

    const confirmed = await rl.question("Confirm save? yes/no: ");
    if (!["y", "yes"].includes(confirmed.trim().toLowerCase())) {
      console.log("Cancelled. Nothing saved.");
      return;
    }

    const now = new Date().toISOString();
    const actualCostDetails = {
      quantity: qty,
      multiScroll: qty > 1,
      craftFeeTotal,
      blankScroll: { name: BLANK_SCROLL_NAME, quantity: qty, actualTotalPaid: blankPaid.total, inputMode: blankPaid.inputMode },
      ingredients: actualIngredients,
      ingredientCostTotal,
      actualCraftCostTotal,
      actualCraftCostPerScroll,
      intendedListingPricePerScroll: listPrice,
      expectedNetPerScroll,
      expectedProfitTotal,
      scannerEstimatedCostTotal: scannerEstimatedCostTotal || null,
    };
    const position = {
      id: Number(result.outputItemId), name: recipe.outputName, createdAt: now, openedAt: now,
      flow: "SCROLL_CRAFT_FLOW", source: "ACCEPTED_SCROLL_CRAFT",
      entryPrice: actualCraftCostPerScroll, averageEntryPrice: actualCraftCostPerScroll,
      originalQuantity: qty, quantity: qty, orderedQuantity: qty, receivedQuantity: qty,
      listedQuantity: 0, soldQuantity: 0, totalListedQuantity: 0,
      buyOfferFeePaid: 0, sellOfferFeePaid: 0, targetSell: listPrice, desiredMargin: 0.06,
      status: "ITEMS_RECEIVED", craft: actualCostDetails,
      events: [{ type: "SCROLLS_CRAFTED", at: now, quantity: qty, entryPrice: actualCraftCostPerScroll,
        totalCraftCost: actualCraftCostTotal, multiScroll: qty > 1, actualCostDetails, source: "ACCEPTED_SCROLL_CRAFT" }],
    };
    if (!Number.isFinite(position.id) || position.id <= 0) throw new Error("Scanner result has no valid output item ID.");
    const data = loadJson(POSITIONS_FILE, { positions: [] });
    if (!Array.isArray(data.positions)) data.positions = [];
    data.positions.push(position);
    saveJson(POSITIONS_FILE, data);
    console.log(`Saved ${qty > 1 ? "multi-scroll " : ""}craft position with actual costs. Status: ITEMS_RECEIVED.`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Accept scroll craft failed:", error.message);
  process.exit(1);
});
