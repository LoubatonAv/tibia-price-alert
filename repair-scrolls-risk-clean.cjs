const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

function removeFunctionAll(source, name) {
  const needle = "function " + name + "(";

  while (source.includes(needle)) {
    const start = source.indexOf(needle);
    const openBrace = source.indexOf("{", start);

    if (openBrace === -1) {
      throw new Error("Could not find opening brace for " + name);
    }

    let depth = 0;
    let end = -1;

    for (let i = openBrace; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;

      if (depth === 0) {
        end = i + 1;
        break;
      }
    }

    if (end === -1) {
      throw new Error("Could not find end of function " + name);
    }

    source = source.slice(0, start) + "\n" + source.slice(end);
  }

  return source;
}

for (const name of [
  "classifyDemand",
  "classifyBuySupport",
  "classifyRisk",
  "enrichScrollLiquidity",
]) {
  text = removeFunctionAll(text, name);
}

const marker = "function buildDiscordPayload(rows) {";
const markerIndex = text.indexOf(marker);

if (markerIndex === -1) {
  throw new Error("buildDiscordPayload marker not found");
}

const helpers = `
function classifyDemand(row) {
  const daySold = Number(row.daySold || 0);
  const monthSold = Number(row.monthSold || 0);

  if (daySold >= 2 || monthSold >= 20) return "HIGH";
  if (daySold >= 1 || monthSold >= 7) return "MEDIUM";
  if (monthSold > 0) return "LOW";
  return "UNKNOWN";
}

function classifyBuySupport(row) {
  const highestBuy = Number(row.outputBuy || 0);
  const breakEvenSell = Number(row.breakEvenSell || 0);

  if (highestBuy <= 0) return "NONE";
  if (breakEvenSell <= 0) return "UNKNOWN";

  const ratio = highestBuy / breakEvenSell;

  if (ratio >= 1) return "STRONG";
  if (ratio >= 0.9) return "GOOD";
  if (ratio >= 0.7) return "WEAK";
  return "BAD";
}

function classifyRisk(row) {
  const daySold = Number(row.daySold || 0);
  const monthSold = Number(row.monthSold || 0);
  const highestBuy = Number(row.outputBuy || 0);
  const breakEvenSell = Number(row.breakEvenSell || 0);

  if (row.missing?.length > 0) return "UNKNOWN";
  if (monthSold <= 0 && daySold <= 0 && highestBuy <= 0) return "HIGH";

  const buySupportRatio =
    breakEvenSell > 0 && highestBuy > 0 ? highestBuy / breakEvenSell : 0;

  if (highestBuy <= 0 && monthSold >= 7) return "MEDIUM";
  if (highestBuy <= 0) return "HIGH";

  if (monthSold < 3 && buySupportRatio < 0.7) return "HIGH";
  if (monthSold < 10 && buySupportRatio < 0.9) return "MEDIUM";

  return "LOW";
}

function enrichScrollLiquidity(row) {
  return {
    ...row,
    demand: classifyDemand(row),
    buySupport: classifyBuySupport(row),
    risk: classifyRisk(row),
  };
}

`;

text = text.slice(0, markerIndex) + helpers + text.slice(markerIndex);

// Remove old enrichment attempts
text = text.replace(/\n\s*rows\.forEach\(enrichScrollLiquidity\);\s*/g, "\n");
text = text.replace(/\n\s*const enrichedRows = rows\.map\(enrichScrollLiquidity\);\s*/g, "\n");

// Make filtered use enrichedRows
text = text.replace(
  /const filtered = (rows|enrichedRows)\s*\n\s*\.filter\(\(row\) => row\.profit >= minProfit\)\s*\n\s*\.sort\(\(a, b\) => b\.profit - a\.profit\);/,
  `const enrichedRows = rows.map(enrichScrollLiquidity);

  const filtered = enrichedRows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);`
);

// Save enrichedRows into JSON
text = text.replace(
  /JSON\.stringify\(\{\s*updatedAt:\s*new Date\(\)\.toISOString\(\),\s*server:\s*SERVER,\s*rows(?::\s*[A-Za-z0-9_]+)?\s*\},\s*null,\s*2\s*\)/g,
  `JSON.stringify({ updatedAt: new Date().toISOString(), server: SERVER, rows: enrichedRows }, null, 2)`
);

// Console line
text = text.replaceAll(
  `console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demand + " | Risk: " + row.risk);`,
  `console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demand + " | Buy support: " + row.buySupport + " | Risk: " + row.risk);`
);

// Discord line
text = text.replaceAll(
  `"Highest buy: **" + formatGp(row.outputBuy) + "** | Risk: **" + row.risk + "**\\n" +`,
  `"Highest buy: **" + formatGp(row.outputBuy) + "** | Buy support: **" + row.buySupport + "** | Risk: **" + row.risk + "**\\n" +`
);

fs.writeFileSync(path, text, "utf8");
console.log("Cleaned duplicate liquidity helpers and saved enriched JSON rows.");
