import axios from "axios";
import { API_URL, SERVER, SCANNER_BATCH_SIZE } from "./constants.js";
import { readJsonFromFirstExisting } from "./paths.js";

export function getItemMap() {
  const items = readJsonFromFirstExisting(
    ["./data/items.json", "./items.json"],
    [],
  );

  const map = {};

  items.forEach((item) => {
    map[item.id] = item.name;
  });

  return map;
}

export async function getMarketValues(itemIds) {
  if (itemIds.length === 0) {
    return [];
  }

  const batches = [];

  for (let i = 0; i < itemIds.length; i += SCANNER_BATCH_SIZE) {
    batches.push(itemIds.slice(i, i + SCANNER_BATCH_SIZE));
  }

  const results = [];

  for (const batch of batches) {
    const res = await axios.get(`${API_URL}/market_values`, {
      params: {
        server: SERVER,
        item_ids: batch.join(","),
      },
    });

    results.push(...res.data);
  }

  return results;
}

export function simulateInstantSell(board, quantity) {
  const buyers = [...(board?.buyers || [])]
    .filter((b) => Number(b.price) > 0 && Number(b.amount) > 0)
    .sort((a, b) => b.price - a.price);

  let remaining = Number(quantity || 0);
  let totalValue = 0;

  const fills = [];

  for (const buyer of buyers) {
    if (remaining <= 0) break;

    const available = Number(buyer.amount || 0);
    const fillQty = Math.min(remaining, available);

    fills.push({
      price: Number(buyer.price),
      quantity: fillQty,
    });

    totalValue += fillQty * Number(buyer.price);
    remaining -= fillQty;
  }

  const soldQuantity = quantity - remaining;

  return {
    fills,
    soldQuantity,
    remaining,
    averagePrice: soldQuantity > 0 ? totalValue / soldQuantity : 0,
    totalValue,
  };
}

export function analyzeSellQueue(board, targetPrice) {
  const sellers = [...(board?.sellers || [])]
    .filter((s) => Number(s.price) > 0 && Number(s.amount) > 0)
    .sort((a, b) => a.price - b.price);

  let itemsAhead = 0;
  let listingsAhead = 0;
  let whaleWalls = 0;

  for (const seller of sellers) {
    if (seller.price > targetPrice) break;

    itemsAhead += Number(seller.amount || 0);
    listingsAhead += 1;

    if (Number(seller.amount || 0) >= 50) {
      whaleWalls += 1;
    }
  }

  return {
    itemsAhead,
    listingsAhead,
    whaleWalls,
  };
}

export function detectBoardManipulation(board) {
  const warnings = [];

  const sellers = [...(board?.sellers || [])]
    .filter((s) => Number(s.price) > 0)
    .sort((a, b) => a.price - b.price);

  const buyers = [...(board?.buyers || [])]
    .filter((b) => Number(b.price) > 0)
    .sort((a, b) => b.price - a.price);

  if (sellers.length > 0 && buyers.length > 0) {
    const lowestSell = sellers[0].price;
    const highestBuy = buyers[0].price;

    if (lowestSell < highestBuy * 0.9) {
      warnings.push(
        "Lowest sell listing is far below highest buy offer. Possible stale or fake listing.",
      );
    }
  }

  const singleItemListings = sellers.filter(
    (s) => Number(s.amount || 0) === 1,
  ).length;

  if (singleItemListings >= 5) {
    warnings.push(
      "Many single-item listings detected. Possible undercut bait behavior.",
    );
  }

  const whaleListings = sellers.filter(
    (s) => Number(s.amount || 0) >= 100,
  ).length;

  if (whaleListings >= 2) {
    warnings.push(
      "Large sell walls detected. Market may be harder to exit quickly.",
    );
  }

  return warnings;
}

export async function getMarketBoard(itemId) {
  const id = Number(itemId);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const requestVariants = [
    { server: SERVER, item_id: id },
    { world: SERVER, item_id: id },
    { server: SERVER, id },
    { world: SERVER, id },
  ];

  let data = null;
  let lastError = null;

  for (const params of requestVariants) {
    try {
      const res = await axios.get(`${API_URL}/market_board`, { params });
      data = res.data || null;
      if (data) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!data) {
    if (lastError) throw lastError;
    return null;
  }

  const sellers = Array.isArray(data.sellers)
    ? data.sellers
        .map((offer) => ({
          ...offer,
          amount: Number(offer.amount || 0),
          price: Number(offer.price || 0),
          time: Number(offer.time || 0),
        }))
        .filter((offer) => offer.amount > 0 && offer.price > 0)
        .sort((a, b) => a.price - b.price || b.time - a.time)
    : [];

  const buyers = Array.isArray(data.buyers)
    ? data.buyers
        .map((offer) => ({
          ...offer,
          amount: Number(offer.amount || 0),
          price: Number(offer.price || 0),
          time: Number(offer.time || 0),
        }))
        .filter((offer) => offer.amount > 0 && offer.price > 0)
        .sort((a, b) => b.price - a.price || b.time - a.time)
    : [];

  return {
    ...data,
    id,
    sellers,
    buyers,
  };
}

export async function getItemHistory(itemId, options = {}) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const startDaysAgo = Number(options.startDaysAgo ?? options.start_days_ago ?? 30);
  const endDaysAgo = Number(options.endDaysAgo ?? options.end_days_ago ?? -1);

  try {
    const res = await axios.get(`${API_URL}/item_history`, {
      params: {
        server: SERVER,
        item_id: id,
        start_days_ago: startDaysAgo,
        end_days_ago: endDaysAgo,
      },
    });

    return Array.isArray(res.data) ? res.data : res.data?.history || [];
  } catch (err) {
    console.warn(`item_history failed for ${id}: ${err?.message || err}`);
    return [];
  }
}

export async function getItemActivity(itemId) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    const res = await axios.get(`${API_URL}/item_activity`, {
      params: { item_id: id },
    });

    return res.data || null;
  } catch (err) {
    console.warn(`item_activity failed for ${id}: ${err?.message || err}`);
    return null;
  }
}

export async function getEvents(options = {}) {
  const startDaysAgo = Number(options.startDaysAgo ?? options.start_days_ago ?? 180);
  const endDaysAgo = Number(options.endDaysAgo ?? options.end_days_ago ?? -1);

  try {
    const res = await axios.get(`${API_URL}/events`, {
      params: {
        start_days_ago: startDaysAgo,
        end_days_ago: endDaysAgo,
      },
    });

    return Array.isArray(res.data) ? res.data : res.data?.events || [];
  } catch (err) {
    console.warn(`events fetch failed: ${err?.message || err}`);
    return [];
  }
}
