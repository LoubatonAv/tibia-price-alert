export const TAX_RATE = 0.02;

export const MAX_HISTORY = 20;

export const SERVER = "Harmonia";

export const API_URL = "https://api.tibiamarket.top";

export const SCANNER_BATCH_SIZE = Number(process.env.SCANNER_BATCH_SIZE || 80);

export const BATCH_SIZE = Number(process.env.FLIPS_BATCH_SIZE || 80);

export const BUY_ALERT_COOLDOWN = Number(process.env.BUY_ALERT_COOLDOWN || 6);

export const SELL_ALERT_COOLDOWN = Number(process.env.SELL_ALERT_COOLDOWN || 6);

export const VOLATILITY_THRESHOLDS = {
  LOW: 8,
  MEDIUM: 18,
};

export const MIN_PROFIT = Number(process.env.MIN_PROFIT || 1000);

export const MIN_PROFIT_PERCENT = Number(process.env.MIN_PROFIT_PERCENT || 3);

export const ALERT_COOLDOWN_HOURS = 12;

export const SELL_ALERT_COOLDOWN_HOURS = 6;

export const MIN_SIMPLE_BUY_BRAIN_SCORE = Number(
  process.env.MIN_SIMPLE_BUY_BRAIN_SCORE || 70,
);

export const MIN_SIMPLE_BUY_PROFIT_PERCENT = Number(
  process.env.MIN_SIMPLE_BUY_PROFIT_PERCENT || 5,
);

export const MIN_SIMPLE_BUY_VOLUME_RATIO = Number(
  process.env.MIN_SIMPLE_BUY_VOLUME_RATIO || 0.7,
);

export const MAX_SIMPLE_BUY_FAKE_SPREAD_RISK = Number(
  process.env.MAX_SIMPLE_BUY_FAKE_SPREAD_RISK || 30,
);

export const SEND_EMPTY_SUMMARY =
  String(process.env.SEND_EMPTY_SUMMARY || "true").toLowerCase() !== "false";

// Conservative allowance for research-only candidates. These never become a clean BUY unless the conviction engine agrees.
export const ENABLE_LOW_CONVICTION_CANDIDATES =
  String(
    process.env.ENABLE_LOW_CONVICTION_CANDIDATES || "true",
  ).toLowerCase() !== "false";

export const LOW_CONVICTION_MIN_BRAIN_SCORE = Number(
  process.env.LOW_CONVICTION_MIN_BRAIN_SCORE || 80,
);

export const LOW_CONVICTION_MIN_TRADEABILITY = Number(
  process.env.LOW_CONVICTION_MIN_TRADEABILITY || 55,
);

export const LOW_CONVICTION_MIN_VOLUME_RATIO = Number(
  process.env.LOW_CONVICTION_MIN_VOLUME_RATIO || 0.8,
);

export const LOW_CONVICTION_MAX_FAKE_SPREAD_RISK = Number(
  process.env.LOW_CONVICTION_MAX_FAKE_SPREAD_RISK || 20,
);

export const VOLATILITY_HISTORY_WINDOW = Number(
  process.env.VOLATILITY_HISTORY_WINDOW || 6,
);

export const VOLATILITY_ITEM_SPIKE_CAP = Number(
  process.env.VOLATILITY_ITEM_SPIKE_CAP || 35,
);

export const VOLATILITY_HIGH_THRESHOLD = Number(
  process.env.VOLATILITY_HIGH_THRESHOLD || 12,
);

export const VOLATILITY_MEDIUM_THRESHOLD = Number(
  process.env.VOLATILITY_MEDIUM_THRESHOLD || 5,
);

export const FLIPS_DEBUG_REJECTIONS =
  String(process.env.FLIPS_DEBUG_REJECTIONS || "true").toLowerCase() !==
  "false";

export const EMPTY_SUMMARY_TOP_REJECTIONS = Number(
  process.env.EMPTY_SUMMARY_TOP_REJECTIONS || 5,
);

export const SCORE_DROP_WARNING = 15;

export const SCORE_DROP_PANIC = 25;

export const SCANNER_TOP_LIMIT = Number(process.env.SCANNER_TOP_LIMIT || 10);

export const SCANNER_POOL = String(
  process.env.SCANNER_POOL || "all",
).toLowerCase();

// Optional market intelligence enrichment. Kept conservative to avoid API pressure.
export const ENABLE_MARKET_INTELLIGENCE =
  String(process.env.ENABLE_MARKET_INTELLIGENCE || "true").toLowerCase() !==
  "false";

export const ENABLE_ITEM_ACTIVITY =
  String(process.env.ENABLE_ITEM_ACTIVITY || "true").toLowerCase() !== "false";

export const ENABLE_ITEM_HISTORY =
  String(process.env.ENABLE_ITEM_HISTORY || "true").toLowerCase() !== "false";

export const ENABLE_EVENTS_CONTEXT =
  String(process.env.ENABLE_EVENTS_CONTEXT || "true").toLowerCase() !== "false";

export const MARKET_INTELLIGENCE_TOP_LIMIT = Number(
  process.env.MARKET_INTELLIGENCE_TOP_LIMIT || 15,
);

export const MARKET_INTELLIGENCE_DELAY_MS = Number(
  process.env.MARKET_INTELLIGENCE_DELAY_MS || 2500,
);

export const ITEM_HISTORY_DAYS = Number(process.env.ITEM_HISTORY_DAYS || 30);

export const EVENTS_REFRESH_DAYS = Number(
  process.env.EVENTS_REFRESH_DAYS || 21,
);

// Snipe mode: expensive listings that look meaningfully underpriced vs normal history.
export const SNIPE_MIN_SELL_PRICE = Number(
  process.env.SNIPE_MIN_SELL_PRICE || 1000000,
);

export const SNIPE_MIN_DISCOUNT_PERCENT = Number(
  process.env.SNIPE_MIN_DISCOUNT_PERCENT || 20,
);

export const SNIPE_TOP_LIMIT = Number(process.env.SNIPE_TOP_LIMIT || 5);

// Discovery scanner: slow research pool for finding new items to track.
export const DISCOVERY_BATCH_SIZE = Number(
  process.env.DISCOVERY_BATCH_SIZE || 80,
);

export const DISCOVERY_CACHE_TTL_HOURS = Number(
  process.env.DISCOVERY_CACHE_TTL_HOURS || 6,
);

export const DISCOVERY_TOP_LIMIT = Number(
  process.env.DISCOVERY_TOP_LIMIT || 10,
);

export const DISCOVERY_MIN_WATCH_PROFIT = Number(
  process.env.DISCOVERY_MIN_WATCH_PROFIT || 700,
);

export const DISCOVERY_MIN_WATCH_ROI = Number(
  process.env.DISCOVERY_MIN_WATCH_ROI || 6,
);

export const DISCOVERY_MIN_EXPERIMENTAL_PROFIT = Number(
  process.env.DISCOVERY_MIN_EXPERIMENTAL_PROFIT || 250,
);

export const DISCOVERY_MIN_EXPERIMENTAL_ROI = Number(
  process.env.DISCOVERY_MIN_EXPERIMENTAL_ROI || 4,
);
