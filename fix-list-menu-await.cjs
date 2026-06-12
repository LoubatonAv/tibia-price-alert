const fs = require("fs");

const path = "trade.js";
let text = fs.readFileSync(path, "utf8");

const bad = `if (action === "list-menu") {
  await runListMenu(positionsData);
  process.exit(0);
}

`;

const good = `if (action === "list-menu") {
  runListMenu(positionsData)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("List menu failed:", error);
      process.exit(1);
    });
}

`;

if (!text.includes(bad)) {
  throw new Error("Could not find the broken list-menu await block.");
}

text = text.replace(bad, good);
fs.writeFileSync(path, text, "utf8");

console.log("Fixed list-menu top-level await.");
