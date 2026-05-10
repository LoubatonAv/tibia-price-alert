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

export const MIN_PROFIT = 1000;

export const MIN_PROFIT_PERCENT = 3;

export const ALERT_COOLDOWN_HOURS = 12;

export const SELL_ALERT_COOLDOWN_HOURS = 6;

export const MIN_SIMPLE_BUY_BRAIN_SCORE = 70;

export const MIN_SIMPLE_BUY_PROFIT_PERCENT = 5;

export const MIN_SIMPLE_BUY_VOLUME_RATIO = 0.7;

export const MAX_SIMPLE_BUY_FAKE_SPREAD_RISK = 30;

export const SEND_EMPTY_SUMMARY = true;

export const SCORE_DROP_WARNING = 15;

export const SCORE_DROP_PANIC = 25;

export const SCANNER_TOP_LIMIT = Number(process.env.SCANNER_TOP_LIMIT || 10);

export const SCANNER_POOL = String(
  process.env.SCANNER_POOL || "all",
).toLowerCase();
