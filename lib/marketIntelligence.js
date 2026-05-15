import {
  SERVER,
  ENABLE_MARKET_INTELLIGENCE,
  ENABLE_ITEM_ACTIVITY,
  ENABLE_ITEM_HISTORY,
  ENABLE_EVENTS_CONTEXT,
  MARKET_INTELLIGENCE_TOP_LIMIT,
  ITEM_HISTORY_DAYS,
  EVENTS_REFRESH_DAYS,
  MARKET_INTELLIGENCE_DELAY_MS,
} from "./constants.js";
import { getItemActivity, getItemHistory, getEvents } from "./market.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getField(object, names, fallback = 0) {
  for (const name of names) {
    if (object && object[name] !== undefined && object[name] !== null) {
      return object[name];
    }
  }

  return fallback;
}

function normalizeHistoryRows(history = []) {
  const rows = Array.isArray(history) ? history : history?.history || [];

  return rows
    .map((row) => ({
      time: safeNumber(getField(row, ["time", "timestamp", "date", "day"], 0)),
      buyOffer: safeNumber(getField(row, ["buy_offer", "buyOffer", "highest_buy", "highestBuy"], 0)),
      sellOffer: safeNumber(getField(row, ["sell_offer", "sellOffer", "lowest_sell", "lowestSell"], 0)),
      daySold: safeNumber(getField(row, ["day_sold", "daySold", "sold", "trades"], 0)),
      dayAverageSell: safeNumber(getField(row, ["day_average_sell", "dayAverageSell", "average_sell", "avgSell"], 0)),
    }))
    .filter((row) => row.buyOffer > 0 || row.sellOffer > 0 || row.daySold > 0)
    .sort((a, b) => a.time - b.time);
}

function analyzeApiHistory(history, item) {
  const rows = normalizeHistoryRows(history);

  if (rows.length < 4) {
    return {
      scoreAdjust: 0,
      pressureAdjust: 0,
      tradeabilityAdjust: 0,
      label: "HISTORY BUILDING",
      summary: "API history: building memory",
      warnings: [],
    };
  }

  const recent = rows.slice(-7);
  const sellPrices = recent.map((row) => row.sellOffer).filter((price) => price > 0);
  const spreads = recent
    .map((row) => (row.buyOffer > 0 && row.sellOffer > 0 ? ((row.sellOffer - row.buyOffer) / row.buyOffer) * 100 : 0))
    .filter((spread) => spread > 0);

  const firstSell = sellPrices[0] || 0;
  const lastSell = sellPrices[sellPrices.length - 1] || 0;
  const priceChangePercent = firstSell > 0 ? ((lastSell - firstSell) / firstSell) * 100 : 0;

  const last3 = sellPrices.slice(-3);
  const falling3 = last3.length === 3 && last3[0] > last3[1] && last3[1] > last3[2];
  const rising3 = last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2];

  const avgSpread = spreads.length ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : 0;
  const minSpread = spreads.length ? Math.min(...spreads) : 0;
  const maxSpread = spreads.length ? Math.max(...spreads) : 0;
  const spreadStable = spreads.length >= 4 && maxSpread - minSpread <= 5 && avgSpread >= 4;
  const spreadLargeAndUnstable = spreads.length >= 4 && avgSpread >= 18 && maxSpread - minSpread >= 12;

  let scoreAdjust = 0;
  let pressureAdjust = 0;
  let tradeabilityAdjust = 0;
  let label = "HISTORY OK";
  const warnings = [];

  if (falling3 || priceChangePercent <= -8) {
    label = "PRICE WEAKENING";
    scoreAdjust -= 8;
    pressureAdjust += 12;
    tradeabilityAdjust -= 5;
    warnings.push("API history says price has been weakening recently.");
  } else if (rising3 && priceChangePercent <= 12) {
    label = "HEALTHY MOMENTUM";
    scoreAdjust += 4;
    tradeabilityAdjust += 3;
  }

  if (spreadStable) {
    label = label === "HISTORY OK" ? "SPREAD PERSISTENT" : label;
    scoreAdjust += 5;
    tradeabilityAdjust += 5;
  }

  if (spreadLargeAndUnstable) {
    label = "UNSTABLE SPREAD";
    scoreAdjust -= 7;
    pressureAdjust += 10;
    warnings.push("API history shows a large but unstable spread.");
  }

  const summaryParts = [];
  summaryParts.push(`History: ${label}`);

  if (Number.isFinite(priceChangePercent) && Math.abs(priceChangePercent) >= 1) {
    summaryParts.push(`7d ${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(1)}%`);
  }

  if (avgSpread > 0) {
    summaryParts.push(`avg spread ${avgSpread.toFixed(1)}%`);
  }

  return {
    scoreAdjust,
    pressureAdjust,
    tradeabilityAdjust,
    label,
    summary: summaryParts.join(" | "),
    warnings,
  };
}

function normalizeActivityRows(activity) {
  if (!activity) return [];

  if (Array.isArray(activity)) return activity;
  if (Array.isArray(activity.worlds)) return activity.worlds;
  if (Array.isArray(activity.activity)) return activity.activity;
  if (Array.isArray(activity.data)) return activity.data;

  return [];
}

function analyzeActivity(activity) {
  const rows = normalizeActivityRows(activity);
  const worldRow = rows.find((row) => {
    const world = String(row.world || row.server || row.name || row.world_name || "").toLowerCase();
    return world === SERVER.toLowerCase();
  });

  if (!worldRow) {
    return {
      scoreAdjust: 0,
      pressureAdjust: 0,
      tradeabilityAdjust: 0,
      label: "ACTIVITY UNKNOWN",
      summary: "Activity: no world-specific data",
      warnings: [],
    };
  }

  const trades = safeNumber(getField(worldRow, ["verified_trades", "verifiedTrades", "trades", "trade_count", "tradeCount"], 0));
  const activeOffers = safeNumber(getField(worldRow, ["active_offers", "activeOffers", "offers", "offer_count", "offerCount"], 0));

  let scoreAdjust = 0;
  let pressureAdjust = 0;
  let tradeabilityAdjust = 0;
  let label = "ACTIVITY OK";
  const warnings = [];

  const offerToTradeRatio = trades > 0 ? activeOffers / trades : activeOffers > 0 ? 999 : 0;

  if (trades >= 80) {
    label = "VERY ACTIVE WORLD";
    scoreAdjust += 5;
    tradeabilityAdjust += 7;
  } else if (trades >= 25) {
    label = "ACTIVE WORLD";
    scoreAdjust += 3;
    tradeabilityAdjust += 4;
  } else if (trades > 0 && trades < 8) {
    label = "LOW VERIFIED TRADES";
    scoreAdjust -= 4;
    tradeabilityAdjust -= 5;
    warnings.push("Item has low verified trade activity on this world.");
  }

  if (offerToTradeRatio >= 8) {
    label = "OFFER HEAVY";
    pressureAdjust += 10;
    tradeabilityAdjust -= 6;
    warnings.push("Many active offers compared with verified trades; market may be crowded.");
  }

  return {
    scoreAdjust,
    pressureAdjust,
    tradeabilityAdjust,
    label,
    trades,
    activeOffers,
    summary: `Activity: ${label}${trades ? ` | trades ${trades}` : ""}${activeOffers ? ` | offers ${activeOffers}` : ""}`,
    warnings,
  };
}

function selectCandidates(items) {
  return [...items]
    .filter((item) => Number(item.profit || item.realisticProfit || 0) > 0)
    .sort((a, b) => {
      const aScore =
        Number(a.tradeabilityScore || 0) * 4 +
        Number(a.brainScore || 0) * 3 +
        Number(a.profitPercent || a.realisticProfitPercent || 0) * 2 +
        Number(a.monthSold || 0) / 50 -
        Number(a.fakeSpreadRisk || 0) * 2;

      const bScore =
        Number(b.tradeabilityScore || 0) * 4 +
        Number(b.brainScore || 0) * 3 +
        Number(b.profitPercent || b.realisticProfitPercent || 0) * 2 +
        Number(b.monthSold || 0) / 50 -
        Number(b.fakeSpreadRisk || 0) * 2;

      return bScore - aScore;
    })
    .slice(0, MARKET_INTELLIGENCE_TOP_LIMIT);
}

async function refreshEventsContext(state) {
  if (!ENABLE_EVENTS_CONTEXT || !state) return null;

  const previous = state.marketEvents;
  const lastChecked = previous?.lastCheckedAt ? new Date(previous.lastCheckedAt).getTime() : 0;
  const ageDays = lastChecked > 0 ? (Date.now() - lastChecked) / 1000 / 60 / 60 / 24 : Infinity;

  if (previous && ageDays < EVENTS_REFRESH_DAYS) {
    return previous;
  }

  const events = await getEvents({ startDaysAgo: 240, endDaysAgo: -1 });
  const eventNames = events
    .map((event) => String(event.name || event.title || event.event || event.type || "").trim())
    .filter(Boolean)
    .slice(0, 10);

  const context = {
    lastCheckedAt: new Date().toISOString(),
    refreshDays: EVENTS_REFRESH_DAYS,
    count: Array.isArray(events) ? events.length : 0,
    names: eventNames,
    summary: eventNames.length ? `Events context: ${eventNames.slice(0, 3).join(" / ")}` : "Events context: no recent event names parsed",
  };

  state.marketEvents = context;
  return context;
}

export async function applyMarketIntelligence(items, options = {}) {
  if (!ENABLE_MARKET_INTELLIGENCE || !Array.isArray(items) || items.length === 0) {
    return { enriched: 0, skipped: true };
  }

  const state = options.state || null;
  const eventContext = await refreshEventsContext(state);
  const candidates = selectCandidates(items);
  let enriched = 0;

  for (const item of candidates) {
    const notes = [];
    const warnings = [];
    let scoreAdjust = 0;
    let pressureAdjust = 0;
    let tradeabilityAdjust = 0;

    if (ENABLE_ITEM_HISTORY) {
      try {
        const history = await getItemHistory(item.id, { startDaysAgo: ITEM_HISTORY_DAYS });
        const historyIntel = analyzeApiHistory(history, item);
        notes.push(historyIntel.summary);
        warnings.push(...historyIntel.warnings);
        scoreAdjust += historyIntel.scoreAdjust;
        pressureAdjust += historyIntel.pressureAdjust;
        tradeabilityAdjust += historyIntel.tradeabilityAdjust;
        item.apiHistoryLabel = historyIntel.label;
      } catch (error) {
        console.log(`item_history failed for ${item.id}: ${error.message}`);
        if (error?.response?.status === 429) {
          console.log("Rate limited. Cooling down 10s...");
          await sleep(10000);
        }
      }

      await sleep(MARKET_INTELLIGENCE_DELAY_MS);
    }

    if (ENABLE_ITEM_ACTIVITY) {
      try {
        const activity = await getItemActivity(item.id);
        const activityIntel = analyzeActivity(activity);
        notes.push(activityIntel.summary);
        warnings.push(...activityIntel.warnings);
        scoreAdjust += activityIntel.scoreAdjust;
        pressureAdjust += activityIntel.pressureAdjust;
        tradeabilityAdjust += activityIntel.tradeabilityAdjust;
        item.apiActivityLabel = activityIntel.label;
        item.apiVerifiedTrades = activityIntel.trades || 0;
        item.apiActiveOffers = activityIntel.activeOffers || 0;
      } catch (error) {
        console.log(`item_activity failed for ${item.id}: ${error.message}`);
        if (error?.response?.status === 429) {
          console.log("Rate limited. Cooling down 10s...");
          await sleep(10000);
        }
      }

      await sleep(MARKET_INTELLIGENCE_DELAY_MS);
    }

    if (eventContext?.summary) {
      item.marketEventSummary = eventContext.summary;
    }

    item.brainScore = clamp(Number(item.brainScore || 0) + scoreAdjust, 0, 100);
    item.marketPressure = clamp(Number(item.marketPressure || 0) + pressureAdjust, 0, 100);
    item.tradeabilityScore = clamp(Number(item.tradeabilityScore || 0) + tradeabilityAdjust, 0, 100);

    if (item.marketPressure >= 70) item.marketPressureLevel = "EXTREME";
    else if (item.marketPressure >= 45) item.marketPressureLevel = "HIGH";
    else if (item.marketPressure >= 25) item.marketPressureLevel = "MEDIUM";
    else item.marketPressureLevel = "LOW";

    item.marketIntelScoreAdjust = scoreAdjust;
    item.marketIntelPressureAdjust = pressureAdjust;
    item.marketIntelTradeabilityAdjust = tradeabilityAdjust;
    item.marketIntelSummary = notes.filter(Boolean).join("\n");
    item.marketIntelWarnings = warnings;

    if (warnings.length) {
      item.tradeWarnings = [...(item.tradeWarnings || []), ...warnings];
    }

    enriched += 1;
  }

  if (eventContext?.summary) {
    console.log(eventContext.summary);
  }

  console.log(
    `Market intelligence enriched ${enriched}/${items.length} items ` +
      `(top limit ${MARKET_INTELLIGENCE_TOP_LIMIT}).`,
  );

  return { enriched, eventContext };
}
