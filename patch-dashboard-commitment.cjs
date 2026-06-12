const fs = require("fs");

const path = "trade.js";
let text = fs.readFileSync(path, "utf8");

text = text.replace(
`  const openCost = openPositions.reduce(
    (sum, position) => sum + Number(position.quantity || 0) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  console.log("\\nTIBIA ACTION DASHBOARD\\n");`,
`  const openCost = openPositions.reduce(
    (sum, position) => sum + Number(position.quantity || 0) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  const buyOrderCommitment = buyOrders.reduce(
    (sum, position) => sum + getDashboardWaitingQuantity(position) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  console.log("\\nTIBIA ACTION DASHBOARD\\n");`
);

text = text.replace(
`  console.log("Estimated open item cost: " + formatGp(openCost) + " gp");
  console.log("Estimated listed value: " + formatGp(listedValue) + " gp");`,
`  console.log("Estimated open item cost: " + formatGp(openCost) + " gp");
  console.log("Estimated buy order commitment: " + formatGp(buyOrderCommitment) + " gp");
  console.log("Estimated listed value: " + formatGp(listedValue) + " gp");`
);

text = text.replace(
`  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 30) notes.push("Buy order is older than 30 days; consider expire/cancel.");`,
`  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 27 && ageHours < 24 * 30) notes.push("Buy order is near 30 days; check if it should expire soon.");
  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 30) notes.push("Buy order is older than 30 days; consider expire/cancel.");`
);

fs.writeFileSync(path, text, "utf8");
console.log("Dashboard improved: buy order commitment + near-expiry warning.");
