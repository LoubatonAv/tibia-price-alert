const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

if (text.includes("rows: sortedRows") && !text.includes("const sortedRows =")) {
  const marker = "const enrichedRows = rows.map(enrichScrollLiquidity);";

  if (!text.includes(marker)) {
    throw new Error("Could not find enrichedRows marker");
  }

  text = text.replace(
    marker,
    marker + `

  const sortedRows = [...enrichedRows].sort((a, b) => b.profit - a.profit);`
  );
}

text = text.replace(
  `const filtered = enrichedRows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);`,
  `const filtered = sortedRows
    .filter((row) => row.profit >= minProfit);`
);

fs.writeFileSync(path, text, "utf8");
console.log("Fixed missing sortedRows definition.");
