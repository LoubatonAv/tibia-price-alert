const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

text = text.replace(
  `main().catch((err) => {
  console.error(err);
  process.exit(1);
});`,
  `main().catch((err) => {
  const status = err?.response?.status;
  const apiMessage = err?.response?.data?.error;

  if (status === 429) {
    console.log("");
    console.log("SCROLL CRAFTING SCANNER STOPPED");
    console.log("--------------------------------");
    console.log("TibiaMarket API is rate-limiting this request right now.");
    console.log(apiMessage || "Rate limit exceeded.");
    console.log("");
    console.log("What to do:");
    console.log("1) Wait 5-10 minutes.");
    console.log("2) Do not run flips/scanner/scrolls during that time.");
    console.log("3) Try again:");
    console.log("   npm run scrolls -- --tier powerful");
    console.log("");
    console.log("This is not a recipe bug. The API blocked the market price request.");
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});`
);

fs.writeFileSync(path, text, "utf8");
console.log("Made scroll scanner 429 errors readable.");
