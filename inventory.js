import fs from "fs";
import "dotenv/config";
import { TAX_RATE } from "./lib/constants.js";
import { getItemMap, getMarketValues } from "./lib/market.js";

const INVENTORY_FILE = "./inventory.json";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function loadInventory() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    return { items: [] };
  }

  const raw = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
  if (Array.isArray(raw)) return { items: raw };
  return { items: raw.items || [] };
}

function normalizeInventoryItem(item, itemMap) {
  const id = Number(item.id ?? item.itemId);
  return {
    id,
    name: item.name || itemMap[id] || `Unknown Item (${id})`,
    quantity: Math.max(1, safeNumber(item.quantity, 1)),
    minSellPrice: safeNumber(item.minSellPrice ?? item.minSell ?? item.minimumSell, 0),
    notes: item.notes || "",
  };
}

function getVolumeRatio(marketItem) {
  const daySold = safeNumber(marketItem.day_sold);
  const monthSold = safeNumber(marketItem.month_sold);
  const avgDailyVolume = monthSold > 0 ? monthSold / 30 : 0;
  return avgDailyVolume > 0 ? daySold / avgDailyVolume : 0;
}

function getRecommendation({ inventoryItem, marketItem }) {
  const sellOffer = safeNumber(marketItem.sell_offer);
  const buyOffer = safeNumber(marketItem.buy_offer);
  const dayAverageSell = safeNumber(marketItem.day_average_sell);
  const monthAverageSell = safeNumber(marketItem.month_average_sell);
  const daySold = safeNumber(marketItem.day_sold);
  const monthSold = safeNumber(marketItem.month_sold);
  const volumeRatio = getVolumeRatio(marketItem);

  const netAtCurrentSell = sellOffer * (1 - TAX_RATE);
  const netTotal = netAtCurrentSell * inventoryItem.quantity;
  const instantSellTotal = buyOffer * inventoryItem.quantity;

  const avgAnchor = Math.min(...[dayAverageSell, monthAverageSell].filter(Boolean));
  const hasAverage = Number.isFinite(avgAnchor) && avgAnchor > 0;
  const currentVsAveragePercent = hasAverage
    ? ((sellOffer - avgAnchor) / avgAnchor) * 100
    : 0;

  const reasons = [];
  let action = "WAIT";
  let listPrice = sellOffer;

  if (!sellOffer && !buyOffer) {
    return {
      action: "NO DATA",
      listPrice: 0,
      netAtCurrentSell: 0,
      netTotal: 0,
      instantSellTotal: 0,
      currentVsAveragePercent: 0,
      volumeRatio,
      reasons: ["No market prices returned for this item."],
    };
  }

  if (inventoryItem.minSellPrice > 0 && sellOffer < inventoryItem.minSellPrice) {
    action = "WAIT";
    reasons.push("Current sell offer is below your minimum sell price.");
  } else if (monthSold < 20 && daySold === 0) {
    action = "LIST HIGH";
    listPrice = Math.max(sellOffer, monthAverageSell || sellOffer);
    reasons.push("Very slow item. List patiently instead of racing down.");
  } else if (hasAverage && currentVsAveragePercent >= 8 && volumeRatio >= 0.7) {
    action = "SELL NOW";
    reasons.push("Current sell price is strong versus average and volume is acceptable.");
  } else if (hasAverage && currentVsAveragePercent <= -8) {
    action = "WAIT";
    reasons.push("Current sell price is weak versus average.");
  } else if (volumeRatio < 0.45 && monthSold >= 20) {
    action = "LIST HIGH";
    listPrice = Math.max(sellOffer, dayAverageSell || sellOffer, monthAverageSell || sellOffer);
    reasons.push("Demand is weak today, so avoid aggressive undercutting.");
  } else if (sellOffer > 0) {
    action = "LIST NORMAL";
    reasons.push("Price looks normal. List near current sell offer.");
  } else if (buyOffer > 0) {
    action = "INSTANT SELL ONLY IF NEEDED";
    reasons.push("No sell offer found, but there is a buy offer.");
  }

  if (buyOffer > 0 && sellOffer > 0) {
    const spreadPercent = ((sellOffer - buyOffer) / buyOffer) * 100;
    if (spreadPercent > 35) reasons.push("Large spread: current sell price may be optimistic.");
  }

  return {
    action,
    listPrice: Math.max(0, Math.round(listPrice || 0)),
    netAtCurrentSell,
    netTotal,
    instantSellTotal,
    currentVsAveragePercent,
    volumeRatio,
    reasons,
  };
}

async function main() {
  const itemMap = getItemMap();
  const inventory = loadInventory();
  const items = inventory.items
    .map((item) => normalizeInventoryItem(item, itemMap))
    .filter((item) => Number.isFinite(item.id) && item.id > 0);

  if (items.length === 0) {
    console.log("\nInventory is empty. Add items to inventory.json first.\n");
    return;
  }

  const marketValues = await getMarketValues(items.map((item) => item.id));
  const marketById = new Map(marketValues.map((item) => [Number(item.item_id ?? item.id), item]));

  console.log("\nTIBIA INVENTORY ADVISOR\n");

  for (const inventoryItem of items) {
    const marketItem = marketById.get(inventoryItem.id);

    if (!marketItem) {
      console.log(`❓ ${inventoryItem.name} — NO DATA`);
      console.log(`Item ID: ${inventoryItem.id}\n`);
      continue;
    }

    const recommendation = getRecommendation({ inventoryItem, marketItem });

    console.log(`${recommendation.action} — ${inventoryItem.name}`);
    console.log(`Quantity: ${inventoryItem.quantity}`);
    console.log(`Current sell offer: ${formatGp(marketItem.sell_offer)} gp`);
    console.log(`Current buy offer: ${formatGp(marketItem.buy_offer)} gp`);
    console.log(`Suggested list price: ${formatGp(recommendation.listPrice)} gp`);
    console.log(`Net if sold at current sell: ${formatGp(recommendation.netTotal)} gp after ${TAX_RATE * 100}% tax`);
    console.log(`Instant sell value: ${formatGp(recommendation.instantSellTotal)} gp`);
    console.log(`Day sold / month sold: ${marketItem.day_sold || 0} / ${marketItem.month_sold || 0}`);
    console.log(`Vs average: ${recommendation.currentVsAveragePercent.toFixed(2)}%`);
    console.log(`Volume ratio: ${recommendation.volumeRatio.toFixed(2)}x`);
    console.log(`Why: ${recommendation.reasons.join(" ")}`);
    console.log(`Item ID: ${inventoryItem.id}\n`);
  }
}

main().catch((error) => {
  console.error("\nInventory advisor failed:");
  console.error(error.message || error);
  process.exit(1);
});
