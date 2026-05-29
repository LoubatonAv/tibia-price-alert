import fs from "fs";
import { getSmartDiscoveryItemIds } from "./smartDiscovery.js";

const ITEM_PATHS = ["./data/items.json", "./items.json"];

const DEFAULT_POOL_LIMIT = Number(
  process.env.SMART_DISCOVERY_POOL_LIMIT || 800,
);
const DEFAULT_MIN_SCORE = Number(process.env.SMART_DISCOVERY_MIN_SCORE || 8);

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function uniqueNumbers(values) {
  return [
    ...new Set(
      values.map(Number).filter((value) => Number.isFinite(value) && value > 0),
    ),
  ];
}

function readJsonIfExists(paths) {
  const path = paths.find((candidate) => fs.existsSync(candidate));
  if (!path) return null;

  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function getMaxNpcBuy(item) {
  const npcBuy = Array.isArray(item.npc_buy) ? item.npc_buy : [];
  return Math.max(0, ...npcBuy.map((entry) => safeNumber(entry.price, 0)));
}

function getMinNpcSell(item) {
  const npcSell = Array.isArray(item.npc_sell) ? item.npc_sell : [];
  const prices = npcSell
    .map((entry) => safeNumber(entry.price, 0))
    .filter((price) => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function hasNpcBuy(item) {
  return getMaxNpcBuy(item) > 0;
}

function hasNpcSell(item) {
  return getMinNpcSell(item) > 0;
}

function scoreCategory(category) {
  const normalized = normalizeText(category);

  const strongCategories = new Set([
    "creature products",
    "valuables",
    "rings",
    "amulets",
    "boots",
    "armors",
    "legs",
    "helmets hats",
    "shields",
  ]);

  const okayCategories = new Set([
    "swords",
    "axes",
    "clubs",
    "distance weapons",
    "wands rods",
    "tools",
  ]);

  const weakCategories = new Set([
    "others",
    "decoration",
    "food",
    "potions",
    "ammunition",
  ]);

  if (strongCategories.has(normalized)) return 8;
  if (okayCategories.has(normalized)) return 4;
  if (weakCategories.has(normalized)) return -4;

  return 0;
}

function scoreTier(tier) {
  const numericTier = safeNumber(tier, -1);

  if (numericTier >= 4) return 6;
  if (numericTier >= 3) return 5;
  if (numericTier >= 2) return 3;
  if (numericTier >= 1) return 1;

  return 0;
}

function scoreNpcBuy(maxNpcBuy) {
  if (maxNpcBuy >= 50000) return 10;
  if (maxNpcBuy >= 25000) return 8;
  if (maxNpcBuy >= 10000) return 6;
  if (maxNpcBuy >= 5000) return 5;
  if (maxNpcBuy >= 1000) return 3;
  if (maxNpcBuy >= 250) return 1;

  return 0;
}

function scoreNpcSell(minNpcSell, categoryScore, maxNpcBuy) {
  if (!minNpcSell) return 0;

  // NPC sell is not automatically bad.
  // It only becomes risky when the NPC price is very low and the item is already weak.
  if (minNpcSell <= 100 && categoryScore < 0 && maxNpcBuy < 1000) return -5;
  if (minNpcSell <= 500 && categoryScore < 0 && maxNpcBuy < 1000) return -3;
  if (minNpcSell <= 2000 && categoryScore < 0) return -1;

  // Expensive NPC-sold items can still have convenience / access premium.
  if (minNpcSell >= 10000) return 1;

  return 0;
}

function scoreName(name, wikiName) {
  const text = normalizeText(`${name} ${wikiName}`);

  let score = 0;

  const hardJunkPatterns = [
    /\bcontract\b/,
    /\bsigned contract\b/,
    /\bsecret letter\b/,
    /\bintelligence reports?\b/,
    /\bfile\b/,
    /\bpackage of\b/,
    /\bspecial flask\b/,
    /\bempty potion flask\b/,
    /\bcrate\b/,
    /\bparcel\b/,
  ];

  const softJunkPatterns = [
    /\bscroll\b/,
    /\bbook\b/,
    /\bdocument\b/,
    /\bdisguise\b/,
    /\bpillow\b/,
    /\bflower pot\b/,
    /\btrophy stand\b/,
    /\bwaterball\b/,
    /\bpresent\b/,
  ];

  for (const pattern of hardJunkPatterns) {
    if (pattern.test(text)) score -= 8;
  }

  for (const pattern of softJunkPatterns) {
    if (pattern.test(text)) score -= 3;
  }

  const goodPatterns = [
    /\bplasma\b/,
    /\btoken\b/,
    /\bessence\b/,
    /\bcrystal\b/,
    /\bscale\b/,
    /\bhide\b/,
    /\bfur\b/,
    /\bclaw\b/,
    /\btooth\b/,
    /\bbone\b/,
    /\bblood\b/,
    /\brainbow\b/,
    /\benchanted\b/,
    /\bboots\b/,
    /\bring\b/,
    /\bamulet\b/,
    /\bcollar\b/,
  ];

  for (const pattern of goodPatterns) {
    if (pattern.test(text)) score += 2;
  }

  return score;
}

function shouldSkipItem(item, score, details) {
  const category = normalizeText(item.category);
  const tier = safeNumber(item.tier, -1);
  const maxNpcBuy = details.maxNpcBuy;

  if (!item || !safeNumber(item.id, 0)) return true;

  // Very weak consumables/decorations with no meaningful NPC floor are usually API waste.
  if (
    ["potions", "ammunition", "food"].includes(category) &&
    maxNpcBuy < 1000 &&
    tier < 1
  ) {
    return true;
  }

  // Low-score "Others" with no NPC floor are usually quest/junk items.
  if (
    category === "others" &&
    maxNpcBuy < 1000 &&
    score < DEFAULT_MIN_SCORE + 3
  ) {
    return true;
  }

  return false;
}

export function getSmartDiscoveryItemIds({
  includeTracked = false,
  trackedIds = new Set(),
  blacklist = new Set(),
  limit = DEFAULT_POOL_LIMIT,
  minScore = DEFAULT_MIN_SCORE,
} = {}) {
  const items = readJsonIfExists(ITEM_PATHS);

  if (!Array.isArray(items)) {
    return [];
  }

  const candidates = [];

  for (const item of items) {
    const id = safeNumber(item.id, 0);

    if (!id) continue;
    if (blacklist.has(id)) continue;
    if (!includeTracked && trackedIds.has(id)) continue;

    const categoryScore = scoreCategory(item.category);
    const tierScore = scoreTier(item.tier);
    const maxNpcBuy = getMaxNpcBuy(item);
    const minNpcSell = getMinNpcSell(item);

    let score = 0;

    score += categoryScore;
    score += tierScore;
    score += scoreNpcBuy(maxNpcBuy);
    score += scoreNpcSell(minNpcSell, categoryScore, maxNpcBuy);
    score += scoreName(item.name, item.wiki_name);

    // NPC buy is a real reason to inspect an item, even if the category is weak.
    if (hasNpcBuy(item) && maxNpcBuy >= 1000) {
      score += 2;
    }

    // NPC sell is not a skip. It is just context.
    if (hasNpcSell(item) && minNpcSell >= 5000) {
      score += 1;
    }

    const details = {
      maxNpcBuy,
      minNpcSell,
      categoryScore,
      tierScore,
    };

    if (shouldSkipItem(item, score, details)) continue;
    if (score < minScore) continue;

    candidates.push({
      id,
      score,
      name: item.name || item.wiki_name || `Item ${id}`,
      category: item.category || "Unknown",
      tier: safeNumber(item.tier, -1),
      maxNpcBuy,
      minNpcSell,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.maxNpcBuy !== a.maxNpcBuy) return b.maxNpcBuy - a.maxNpcBuy;
    return a.id - b.id;
  });

  return uniqueNumbers(candidates.slice(0, limit).map((item) => item.id));
}
