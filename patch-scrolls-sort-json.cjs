const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

text = text.replace(
`const enrichedRows = rows.map(enrichScrollLiquidity);

  const filtered = enrichedRows
    .filter((row) => row.profit >= minProfit)
    .sort((a, b) => b.profit - a.profit);`,
`const enrichedRows = rows.map(enrichScrollLiquidity);

  const sortedRows = [...enrichedRows].sort((a, b) => b.profit - a.profit);

  const filtered = sortedRows
    .filter((row) => row.profit >= minProfit);`
);

text = text.replaceAll(
  `rows: enrichedRows`,
  `rows: sortedRows`
);

fs.writeFileSync(path, text, "utf8");
console.log("Saved scroll crafting JSON sorted by profit.");
