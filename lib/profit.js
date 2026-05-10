import { TAX_RATE } from "./constants.js";

export function calculateOfferFlipProfit(buyOfferPrice, sellOfferPrice) {
  const realBuyCost = buyOfferPrice;
  const realSellIncome = sellOfferPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    mode: "BUY_OFFER_TO_SELL_OFFER",
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
  };
}

export function calculateInstantBuyToSellOfferProfit(
  instantBuyPrice,
  sellOfferPrice,
) {
  const realBuyCost = instantBuyPrice;
  const realSellIncome = sellOfferPrice * (1 - TAX_RATE);
  const profit = realSellIncome - realBuyCost;

  return {
    mode: "INSTANT_BUY_TO_SELL_OFFER",
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
  };
}

export function calculateBuyOfferToInstantSellProfit(
  buyOfferPrice,
  instantSellPrice,
) {
  const realBuyCost = buyOfferPrice * (1 + TAX_RATE);
  const realSellIncome = instantSellPrice;
  const profit = realSellIncome - realBuyCost;

  return {
    mode: "BUY_OFFER_TO_INSTANT_SELL",
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
  };
}

export function calculateInstantArbitrageProfit(
  instantBuyPrice,
  instantSellPrice,
) {
  const realBuyCost = instantBuyPrice;
  const realSellIncome = instantSellPrice;
  const profit = realSellIncome - realBuyCost;

  return {
    mode: "INSTANT_BUY_TO_INSTANT_SELL",
    realBuyCost,
    realSellIncome,
    profit,
    profitPercent: realBuyCost > 0 ? (profit / realBuyCost) * 100 : 0,
  };
}

// backwards-compatible for now
export function calculateProfit(buyOfferPrice, sellOfferPrice) {
  return calculateOfferFlipProfit(buyOfferPrice, sellOfferPrice);
}
