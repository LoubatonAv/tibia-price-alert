const fs = require("fs");

const path = "scroll-crafting-scanner.mjs";
let text = fs.readFileSync(path, "utf8");

function replaceFunction(source, functionName, replacement) {
  const start = source.indexOf("async function " + functionName + "(");
  if (start === -1) throw new Error(functionName + " not found");

  const openBrace = source.indexOf("{", start);
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

  if (end === -1) throw new Error("Could not find end of " + functionName);
  return source.slice(0, start) + replacement + "\n" + source.slice(end);
}

const replacement = `
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
`.trim();

text = replaceFunction(text, "getMarketValuesWithRetry", replacement);

fs.writeFileSync(path, text, "utf8");
console.log("Made scroll scanner API retry more patient.");
