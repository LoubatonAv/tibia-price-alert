const fs = require("fs");

const path = "check-flips.js";
let text = fs.readFileSync(path, "utf8");

function replaceFunction(source, functionName, replacement) {
  const start = source.indexOf("function " + functionName + "(");
  if (start === -1) throw new Error(functionName + " not found");

  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) throw new Error("Opening brace not found for " + functionName);

  let depth = 0;
  let end = -1;

  for (let i = openBrace; i < source.length; i++) {
    const char = source[i];

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end === -1) throw new Error("Could not find end of " + functionName);

  return source.slice(0, start) + replacement + "\n" + source.slice(end);
}

const replacement = String.raw`
function printTrackedButNotActionableSummary(analyzedItems, buySignals, sellSignals) {
  const buyIds = new Set(buySignals.map((item) => Number(item.id)));
  const sellIds = new Set(sellSignals.map((item) => Number(item.id)));

  const showAvoided = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.FLIPPER_SHOW_AVOIDED || "").toLowerCase(),
  );

  const limit = Number(process.env.FLIPPER_NOT_ACTIONABLE_LIMIT || 10);
  const avoidedLimit = Number(process.env.FLIPPER_AVOIDED_LIMIT || 10);

  function isAvoided(item) {
    const decision = String(item.decision || "").toUpperCase();
    const signalClass = String(item.signalClass || "").toUpperCase();

    if (decision === "AVOID" || signalClass === "AVOID") return true;

    return (
      getNumber(item.brainScore) <= 0 &&
      getNumber(item.tradeabilityScore) <= 0 &&
      getNumber(item.fakeSpreadRisk) >= 80
    );
  }

  function getNoBuyReasons(item) {
    if (Array.isArray(item.rejectionReasons) && item.rejectionReasons.length) {
      return item.rejectionReasons.slice(0, 3).join(", ");
    }

    if (Array.isArray(item.tradeWarnings) && item.tradeWarnings.length) {
      return item.tradeWarnings.slice(0, 3).join(", ");
    }

    if (item.reason) return item.reason;

    const decision = String(item.decision || "").toUpperCase();
    if (decision === "WAIT") return "Waiting for a better entry price.";
    if (decision === "WATCH") return "Interesting, but not strong enough for BUY.";
    if (decision === "RESEARCH") return "Research only; needs manual confirmation.";

    return "No BUY signal right now.";
  }

  function usefulScore(item) {
    const decision = String(item.decision || "").toUpperCase();
    const signalClass = String(item.signalClass || "").toUpperCase();

    let bonus = 0;
    if (["BUY_CANDIDATE", "WATCH", "WAIT", "RESEARCH"].includes(signalClass)) bonus += 40;
    if (["BUY_CANDIDATE", "WATCH", "WAIT", "RESEARCH"].includes(decision)) bonus += 30;

    return (
      bonus +
      getNumber(item.brainScore) * 3 +
      getNumber(item.tradeabilityScore) * 2 +
      Math.min(getNumber(item.profitPercent), 30) * 2 +
      Math.min(getNumber(item.profit) / 1000, 20) -
      getNumber(item.fakeSpreadRisk) * 1.5 -
      getNumber(item.marketPressure || item.pressureScore || 0) * 0.5
    );
  }

  const baseRows = analyzedItems
    .filter((item) => !buyIds.has(Number(item.id)))
    .filter((item) => !sellIds.has(Number(item.id)))
    .map((item) => ({
      item,
      avoided: isAvoided(item),
      score: usefulScore(item),
      reasons: getNoBuyReasons(item),
    }));

  const usefulRows = baseRows
    .filter((row) => !row.avoided)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const avoidedRows = baseRows
    .filter((row) => row.avoided)
    .sort((a, b) => b.score - a.score);

  if (usefulRows.length === 0 && avoidedRows.length === 0) return;

  console.log("\nTRACKED BUT NOT ACTIONABLE / NEAR MISSES");
  console.log("----------------------------------------");

  if (usefulRows.length === 0) {
    console.log("No non-AVOID tracked items were close to BUY right now.");
  } else {
    usefulRows.forEach(({ item, reasons }, index) => {
      const decision = item.decision || "UNKNOWN";
      const signalClass = item.signalClass || "REJECTED";
      const profit = formatGp(item.profit || 0);
      const roi = Number(item.profitPercent || 0).toFixed(2);

      console.log(
        index + 1 + ") " + item.name + " (" + item.id + ")\n" +
          "   Decision: " + decision + " | Signal: " + signalClass + "\n" +
          "   Brain: " + (item.brainScore ?? "?") + "/100 | Tradeability: " + (item.tradeabilityScore ?? "?") + "/100\n" +
          "   Profit: ~" + profit + " gp ea | ROI: " + roi + "%\n" +
          "   Why no BUY: " + reasons + "\n",
      );
    });
  }

  if (avoidedRows.length > 0 && !showAvoided) {
    console.log(
      "Hidden " +
        avoidedRows.length +
        " AVOID tracked items. To show them: $env:FLIPPER_SHOW_AVOIDED=\"1\"",
    );
  }

  if (showAvoided && avoidedRows.length > 0) {
    console.log("\nTRACKED AVOIDED ITEMS");
    console.log("---------------------");

    avoidedRows.slice(0, avoidedLimit).forEach(({ item, reasons }, index) => {
      console.log(
        index + 1 + ") " + item.name + " (" + item.id + ")\n" +
          "   Decision: " + (item.decision || "AVOID") + " | Signal: " + (item.signalClass || "AVOID") + "\n" +
          "   Brain: " + (item.brainScore ?? "?") + "/100 | Tradeability: " + (item.tradeabilityScore ?? "?") + "/100\n" +
          "   Why avoided: " + reasons + "\n",
      );
    });
  }
}
`.trim();

text = replaceFunction(text, "printTrackedButNotActionableSummary", replacement);

fs.writeFileSync(path, text, "utf8");
console.log("Patched tracked-but-not-actionable summary to hide AVOID items by default.");
