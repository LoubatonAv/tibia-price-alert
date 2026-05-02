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

function getSignal(item, profit, profitPercent) {
  const dayVsMonthSell =
    ((item.day_average_sell - item.month_average_sell) /
      item.month_average_sell) *
    100;

  const volumeBoost = item.day_sold > item.month_sold / 30;

  if (
    profit >= MIN_PROFIT &&
    profitPercent >= MIN_PROFIT_PERCENT &&
    dayVsMonthSell > 2 &&
    volumeBoost
  ) {
    return "🟢 STRONG BUY";
  }

  if (dayVsMonthSell > 2) {
    return "🟡 RISING";
  }

  if (dayVsMonthSell < -2) {
    return "🔴 FALLING";
  }

  return "⚪ NEUTRAL";
}

function getDecision(item, profit, profitPercent) {
  const daySell = item.day_average_sell || 0;
  const monthSell = item.month_average_sell || 0;
  const daySold = item.day_sold || 0;
  const monthSold = item.month_sold || 0;

  const dayVsMonthSell =
    monthSell > 0 ? ((daySell - monthSell) / monthSell) * 100 : 0;

  const averageDailyVolume = monthSold / 30;
  const volumeRatio = averageDailyVolume > 0 ? daySold / averageDailyVolume : 0;

  const isGoodProfit =
    profit >= MIN_PROFIT && profitPercent >= MIN_PROFIT_PERCENT;

  const isRising = dayVsMonthSell > 2;
  const isFalling = dayVsMonthSell < -2;
  const hasGoodVolume = volumeRatio >= 1;
  const hasLowVolume = volumeRatio < 0.5;

  let decision = "⚪ WATCH";
  let action = "Watch this item, but do not buy yet.";
  let reason = "The numbers are not strong enough yet.";

  if (isGoodProfit && isRising && hasGoodVolume) {
    decision = "🟢 BUY NOW";
    action = `Try buying at or below ${item.buy_offer.toLocaleString()} gp. Target sell around ${item.sell_offer.toLocaleString()} gp.`;
    reason = "Good profit, rising price, and healthy volume.";
  } else if (isGoodProfit && isFalling) {
    decision = "🟡 WAIT 1–2 DAYS";
    action =
      "Do not buy yet. Price is falling, so you may get a better entry soon.";
    reason = "The flip is profitable, but the market is currently moving down.";
  } else if (isGoodProfit && hasLowVolume) {
    decision = "🟠 RISKY BUY";
    action = "Only buy a small amount. This may be hard to resell quickly.";
    reason = "Profit looks good, but liquidity is low.";
  } else if (isGoodProfit) {
    decision = "🟡 BUY ONLY IF CHEAP";
    action = `Only buy if you can get it below ${Math.floor(item.buy_offer * 0.98).toLocaleString()} gp.`;
    reason = "Profit exists, but trend/volume are not strong enough.";
  } else if (isRising && hasGoodVolume) {
    decision = "🔵 WATCH CLOSELY";
    action = "Do not buy yet. This may become profitable soon.";
    reason = "Price and volume are rising, but profit is not good enough yet.";
  } else if (isFalling) {
    decision = "🔴 AVOID";
    action = "Avoid buying now. Wait for stabilization.";
    reason = "Price is falling compared to the monthly average.";
  }

  return {
    decision,
    action,
    reason,
    dayVsMonthSell,
    volumeRatio,
  };
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
      {
        name: "Decision",
        value: item.decision,
        inline: true,
      },
      {
        name: "Reason",
        value: item.reason,
        inline: false,
      },
      {
        name: "What to do",
        value: item.action,
        inline: false,
      },
      {
        name: "Trend",
        value: `${item.dayVsMonthSell.toFixed(2)}% vs monthly avg`,
        inline: true,
      },
      {
        name: "Volume",
        value: `${item.volumeRatio.toFixed(2)}x normal daily volume`,
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

      const decisionData = getDecision(
        item,
        result.profit,
        result.profitPercent,
      );

      return {
        id: item.id,
        name: itemMap[item.id] || "Unknown",
        buyOffer: item.buy_offer,
        sellOffer: item.sell_offer,
        ...result,
        ...decisionData,
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
      `${item.decision} ${item.name} (ID: ${item.id})\n` +
        `Buy: ${item.buyOffer} | Sell: ${item.sellOffer}\n` +
        `Profit: ${item.profit.toFixed(0)} (${item.profitPercent.toFixed(2)}%)\n` +
        `Reason: ${item.reason}\n` +
        `Action: ${item.action}\n`,
    );
  });

  await sendDiscordAlert(opportunities);
}

main();
