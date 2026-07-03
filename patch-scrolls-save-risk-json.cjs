const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

function insertBefore(source, marker, block) {
  if (source.includes(block.trim().slice(0, 80))) return source;
  const index = source.indexOf(marker);
  if (index === -1) throw new Error("Marker not found: " + marker);
  return source.slice(0, index) + block + "\n" + source.slice(index);
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
  row.demand = classifyDemand(row);
  row.buySupport = classifyBuySupport(row);
  row.risk = classifyRisk(row);
  return row;
}

`;

if (!text.includes("function enrichScrollLiquidity(row)")) {
  if (text.includes("function classifyDemand(row)")) {
    text = insertBefore(text, "function buildDiscordPayload(rows) {", `
function enrichScrollLiquidity(row) {
  row.demand = classifyDemand(row);
  row.buySupport = typeof classifyBuySupport === "function" ? classifyBuySupport(row) : row.buySupport;
  row.risk = classifyRisk(row);
  return row;
}
`);
  } else {
    text = insertBefore(text, "function buildDiscordPayload(rows) {", helpers);
  }
}

if (!text.includes("rows.forEach(enrichScrollLiquidity);")) {
  text = text.replace(
    `const filtered = rows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);`,
    `rows.forEach(enrichScrollLiquidity);

  const filtered = rows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);`
  );
}

text = text.replace(
  `console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demand + " | Risk: " + row.risk);`,
  `console.log("Highest buy: " + formatGp(row.outputBuy) + " gp | Demand: " + row.demand + " | Buy support: " + row.buySupport + " | Risk: " + row.risk);`
);

fs.writeFileSync(path, text, "utf8");
console.log("Ensured liquidity/risk fields are saved to scroll-crafting-results.json.");
