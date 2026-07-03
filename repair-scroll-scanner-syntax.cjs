const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

const formatMarker = "function formatGp(value) {";
const formatIndex = text.indexOf(formatMarker);

if (formatIndex === -1) {
  throw new Error("formatGp marker not found");
}

const sleepIndex = text.indexOf("function sleep(ms)");
const retryIndex = text.indexOf("async function getMarketValuesWithRetry(");

let startIndex = -1;

if (sleepIndex !== -1 && retryIndex !== -1) {
  startIndex = Math.min(sleepIndex, retryIndex);
} else if (sleepIndex !== -1) {
  startIndex = sleepIndex;
} else if (retryIndex !== -1) {
  startIndex = retryIndex;
}

const helper = `
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMarketValuesWithRetry(ids, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 12);
  const initialWaitMs = Number(options.initialWaitMs || 6500);

  console.log(
    "Waiting " +
      Math.round(initialWaitMs / 1000) +
      "s before market request to respect API rate limit..."
  );

  await sleep(initialWaitMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getMarketValues(ids);
    } catch (error) {
      const status = error?.response?.status;
      const retryAfterHeader = error?.response?.headers?.["retry-after"];
      const resetHeader = error?.response?.headers?.["x-ratelimit-reset"];

      let waitMs = 7500;

      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        waitMs = Math.max(waitMs, retryAfterSeconds * 1000 + 1500);
      }

      const resetEpochSeconds = Number(resetHeader);
      if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
        const untilResetMs = resetEpochSeconds * 1000 - Date.now() + 1500;
        if (untilResetMs > 0 && untilResetMs < 60000) {
          waitMs = Math.max(waitMs, untilResetMs);
        }
      }

      if (status !== 429 || attempt >= maxAttempts) {
        console.log("");
        console.log("Market request failed.");
        console.log("Status:", status || "unknown");
        console.log("Tip: wait 30-60 seconds, then run npm run scrolls again.");
        throw error;
      }

      console.log(
        "Market API rate limit hit. Waiting " +
          Math.ceil(waitMs / 1000) +
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

if (startIndex !== -1 && startIndex < formatIndex) {
  text = text.slice(0, startIndex) + helper + text.slice(formatIndex);
} else {
  text = text.slice(0, formatIndex) + helper + text.slice(formatIndex);
}

fs.writeFileSync(path, text, "utf8");
console.log("Repaired scroll scanner retry helper block.");
