const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

// No .bak files anymore — Git is the backup.
if (!/from\s+["'](?:node:)?fs["']/.test(text) && !/require\(["']fs["']\)/.test(text)) {
  text = 'import fs from "fs";\n' + text;
}

const exposureBlock = String.raw`
let positionExposureCache = null;

function getPositionExposureMap() {
  if (positionExposureCache) return positionExposureCache;

  const map = new Map();

  if (!fs.existsSync("positions.json")) {
    positionExposureCache = map;
    return map;
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync("positions.json", "utf8"));
  } catch {
    positionExposureCache = map;
    return map;
  }

  for (const position of data.positions || []) {
    const status = String(position.status || "").toUpperCase();

    if (
      status === "CLOSED" ||
      status === "SOLD" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "BUY_ORDER_CANCELLED" ||
      status === "BUY_ORDER_EXPIRED"
    ) {
      continue;
    }

    const id = String(position.id || "");
    if (!id) continue;

    const entryPrice = getNumber(position.entryPrice || position.averageEntryPrice);
    const ordered = getNumber(position.orderedQuantity || position.originalQuantity);
    const received = getNumber(position.receivedQuantity);
    const owned = getNumber(position.quantity);
    const listed = getNumber(position.listedQuantity);
    const buyFee = getNumber(position.buyOfferFeePaid);
    const sellFee = getNumber(position.sellOfferFeePaid);
    const lastListPrice = getNumber(position.lastListPrice || position.targetSell);

    let waiting = getNumber(position.waitingQuantity || position.waiting);

    if (!waiting && status.includes("BUY_ORDER")) {
      waiting = Math.max(0, ordered - received);
    }

    const capitalLocked =
      waiting * entryPrice +
      owned * entryPrice +
      buyFee +
      sellFee;

    const listedValue = listed * lastListPrice;

    if (!map.has(id)) {
      map.set(id, {
        id,
        name: position.name,
        positions: 0,
        waiting: 0,
        owned: 0,
        listed: 0,
        capitalLocked: 0,
        listedValue: 0,
        hasOpenBuyOrder: false,
        statuses: new Set(),
      });
    }

    const exposure = map.get(id);

    exposure.positions += 1;
    exposure.waiting += waiting;
    exposure.owned += owned;
    exposure.listed += listed;
    exposure.capitalLocked += capitalLocked;
    exposure.listedValue += listedValue;
    exposure.hasOpenBuyOrder = exposure.hasOpenBuyOrder || status.includes("BUY_ORDER");
    exposure.statuses.add(status);
  }

  positionExposureCache = map;
  return map;
}

function getItemExposure(itemId) {
  return getPositionExposureMap().get(String(itemId)) || {
    positions: 0,
    waiting: 0,
    owned: 0,
    listed: 0,
    capitalLocked: 0,
    listedValue: 0,
    hasOpenBuyOrder: false,
    statuses: new Set(),
  };
}

function getExposureGuard(item, plan) {
  const exposure = getItemExposure(item.id);
  const maxItemCapital = Number(process.env.FLIPPER_MAX_ITEM_CAPITAL || 300000);
  const newCapital = getNumber(plan?.capital?.capitalLocked);
  const combinedCapital = exposure.capitalLocked + newCapital;
  const totalQty = exposure.waiting + exposure.owned + exposure.listed;

  const warnings = [];

  if (totalQty > 0 || exposure.positions > 0 || exposure.capitalLocked > 0) {
    warnings.push(
      "Already exposed: waiting " +
        exposure.waiting +
        ", owned " +
        exposure.owned +
        ", listed " +
        exposure.listed +
        "."
    );
  }

  if (exposure.hasOpenBuyOrder) {
    warnings.push("You already have an open buy order for this item.");
  }

  if (totalQty >= getNumber(plan?.capital?.qty)) {
    warnings.push("Do not add more unless intentional.");
  }

  if (combinedCapital >= maxItemCapital) {
    warnings.push(
      "Combined capital would be ~" +
        formatGp(combinedCapital) +
        " gp, above item cap " +
        formatGp(maxItemCapital) +
        " gp."
    );
  }

  return {
    exposure,
    maxItemCapital,
    newCapital,
    combinedCapital,
    totalQty,
    warnings,
    hasWarning: warnings.length > 0,
  };
}

function getExposureConsoleText(item, plan) {
  const guard = getExposureGuard(item, plan);

  if (!guard.hasWarning) {
    return (
      "Exposure guard: no open exposure found for this item. New capital: ~" +
      formatGp(guard.newCapital) +
      " gp.\n"
    );
  }

  return (
    "Exposure guard: ⚠️ CHECK BEFORE ADDING MORE\n" +
    "- " +
    guard.warnings.join("\n- ") +
    "\nCapital already locked: ~" +
    formatGp(guard.exposure.capitalLocked) +
    " gp | New capital: ~" +
    formatGp(guard.newCapital) +
    " gp | Combined: ~" +
    formatGp(guard.combinedCapital) +
    " gp\n"
  );
}

function getExposureDiscordText(item, plan) {
  const guard = getExposureGuard(item, plan);

  if (!guard.hasWarning) {
    return (
      "No open exposure found. New capital: **~" +
      formatGp(guard.newCapital) +
      " gp**."
    );
  }

  return (
    "⚠️ **CHECK BEFORE ADDING MORE**\n" +
    guard.warnings.map((warning) => "• " + warning).join("\n") +
    "\nCapital already locked: **~" +
    formatGp(guard.exposure.capitalLocked) +
    " gp**\nNew capital: **~" +
    formatGp(guard.newCapital) +
    " gp**\nCombined: **~" +
    formatGp(guard.combinedCapital) +
    " gp**"
  );
}
`;

if (!text.includes("function getPositionExposureMap")) {
  const marker = "function getBuyFee(price, qty)";
  if (!text.includes(marker)) {
    throw new Error("Could not find getBuyFee marker. Run flipper quality patch first.");
  }

  text = text.replace(marker, exposureBlock + "\n" + marker);
}

// Add exposure to console BUY print.
if (!text.includes("const exposureText = getExposureConsoleText(item, plan);")) {
  text = text.replace(
    "function printQualityBuySignal(item) {\n  const plan = buildQualityActionPlan(item);",
    "function printQualityBuySignal(item) {\n  const plan = buildQualityActionPlan(item);\n  const exposureText = getExposureConsoleText(item, plan);"
  );
}

if (!text.includes('+ exposureText,')) {
  text = text.replace(
    '"Manual checks:\\n- " + plan.checks.slice(0, 4).join("\\n- ") + "\\n",',
    '"Manual checks:\\n- " + plan.checks.slice(0, 4).join("\\n- ") + "\\n" +\n      exposureText,'
  );
}

// Add exposure field to Discord BUY embeds.
if (!text.includes('name: "🧯 EXPOSURE GUARD"')) {
  const capitalFieldRegex = /      \{\s*name: "💼 CAPITAL",[\s\S]*?inline: true,\s*\},/m;

  const match = text.match(capitalFieldRegex);

  if (!match) {
    console.log("Warning: could not find Discord CAPITAL field. Console exposure guard still applied.");
  } else {
    const exposureField = match[0] + `
      {
        name: "🧯 EXPOSURE GUARD",
        value: (() => {
          const plan = buildQualityActionPlan(item);
          return getExposureDiscordText(item, plan);
        })(),
        inline: false,
      },`;

    text = text.replace(capitalFieldRegex, exposureField);
  }
}

fs.writeFileSync(path, text, "utf8");

console.log("Flipper exposure guard patch complete.");
