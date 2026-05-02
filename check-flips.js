import axios from "axios";
import fs from "fs";
import "dotenv/config";

const API_URL = "https://api.tibiamarket.top";
const SERVER = "Harmonia";

const TAX_RATE = 0.02;

// Only notify for BIG profits
const MIN_PROFIT = 5000;
const MIN_PROFIT_PERCENT = 3;

const ITEM_IDS = "22118,22516,22721"; // tibia coins, silver token, gold token

function getItemMap() {
  const raw = fs.readFileSync("./data/items.json");
  const items = JSON.parse(raw);

  const map = {};
  items.forEach((item) => {
    map[item.id] = item.name;
  });

  return map;
}

function calculateProfit(buyPrice, sellPrice) {
  const realBuyCost = buyPrice * (1 + TAX_RATE);
  const realSellIncome = sellPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: (profit / realBuyCost) * 100,
  };
}

async function getMarketValues() {
  const res = await axios.get(`${API_URL}/market_values`, {
    params: {
      server: SERVER,
      item_ids: ITEM_IDS,
    },
  });

  return res.data;
}

function getColor(profitPercent) {
  if (profitPercent >= 20) return 0x00ff00;
  if (profitPercent >= 10) return 0xffff00;
  return 0xff9900;
}

async function sendDiscordAlert(opportunities) {
  if (opportunities.length === 0) {
    console.log("No big profitable flips found. No Discord message sent.");
    return;
  }

  const embeds = opportunities.slice(0, 5).map((item, index) => ({
    title: `🟢 #${index + 1} ${item.name}`,
    color: getColor(item.profitPercent),
    fields: [
      {
        name: "Buy",
        value: `${item.buyOffer.toLocaleString()} gp`,
        inline: true,
      },
      {
        name: "Sell",
        value: `${item.sellOffer.toLocaleString()} gp`,
        inline: true,
      },
      {
        name: "Real Profit",
        value: `${Math.round(item.profit).toLocaleString()} gp`,
        inline: true,
      },
      {
        name: "Profit %",
        value: `${item.profitPercent.toFixed(2)}%`,
        inline: true,
      },
    ],
    footer: {
      text: `Item ID: ${item.id} | Tax included`,
    },
  }));

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: `🔥 Big Tibia flip opportunities on **${SERVER}**`,
    embeds,
  });

  console.log("Discord alert sent.");
}

async function main() {
  const items = await getMarketValues();
  const itemMap = getItemMap();

  const opportunities = items
    .map((item) => {
      const result = calculateProfit(item.buy_offer, item.sell_offer);

      return {
        id: item.id,
        name: itemMap[item.id] || "Unknown",
        buyOffer: item.buy_offer,
        sellOffer: item.sell_offer,
        ...result,
      };
    })
    .filter((item) => {
      return (
        item.profit >= MIN_PROFIT && item.profitPercent >= MIN_PROFIT_PERCENT
      );
    })
    .sort((a, b) => b.profit - a.profit);

  opportunities.forEach((item) => {
    console.log(
      `${item.name} (ID: ${item.id})\n` +
        `Buy: ${item.buyOffer} | Sell: ${item.sellOffer}\n` +
        `Profit: ${item.profit.toFixed(0)} (${item.profitPercent.toFixed(2)}%)\n`,
    );
  });

  await sendDiscordAlert(opportunities);
}

main();
