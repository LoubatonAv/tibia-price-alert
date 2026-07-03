const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

if (!text.includes("async function getMarketValuesWithRetry")) {
  const helper = `
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMarketValuesWithRetry(ids, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 5);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getMarketValues(ids);
    } catch (error) {
      const status = error?.response?.status;
      const retryAfterHeader = error?.response?.headers?.["retry-after"];
      const retryAfterSeconds = Number(retryAfterHeader || 5);
      const waitMs = Math.max(5000, retryAfterSeconds * 1000) + 750;

      if (status !== 429 || attempt >= maxAttempts) {
        throw error;
      }

      console.log(
        "Market API rate limit hit. Waiting " +
          Math.round(waitMs / 1000) +
          "s before retry " +
          (attempt + 1) +
          "/" +
          maxAttempts +
          "..."
      );

      await sleep(waitMs);
    }
  }

  return [];
}
`;

  const marker = "function formatGp(value) {";
  if (!text.includes(marker)) throw new Error("formatGp marker not found");
  text = text.replace(marker, helper + "\n" + marker);
}

text = text.replace(
  "const values = await getMarketValues([...ids]);",
  "const values = await getMarketValuesWithRetry([...ids]);"
);

fs.writeFileSync(path, text, "utf8");
console.log("Added 429 retry handling to scroll crafting scanner.");
