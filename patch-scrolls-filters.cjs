const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function patchScrollScanner() {
  const path = "scroll-crafting-scanner.mjs";
  let text = read(path);

  text = text.replace(
    `const tierFilter = String(flags.tier || "").toLowerCase();
  const limit = Number(flags.limit || 15);
  const minProfit = Number(flags["min-profit"] || 0);`,
    `const tierFilter = String(flags.tier || "").toLowerCase();
  const onlyFilter = String(flags.only || flags.imbuement || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const limit = Number(flags.limit || 15);
  const minProfit = Number(flags["min-profit"] || 0);`
  );

  text = text.replace(
    `.filter((recipe) => !tierFilter || String(recipe.tier).toLowerCase() === tierFilter)
    .map((recipe) => {`,
    `.filter((recipe) => {
      if (tierFilter && String(recipe.tier).toLowerCase() !== tierFilter) {
        return false;
      }

      if (onlyFilter.length > 0) {
        const haystack = [
          recipe.outputName,
          recipe.imbuement,
          recipe.category,
          recipe.tier,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return onlyFilter.some((token) => haystack.includes(token));
      }

      return true;
    })
    .map((recipe) => {`
  );

  if (!text.includes("async function getMarketValuesWithRetry")) {
    const marker = "function formatGp(value) {";
    const helper = `
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMarketValuesWithRetry(ids, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 8);
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
      const retryAfterSeconds = Number(retryAfterHeader || 5);
      const waitMs = Math.max(7000, retryAfterSeconds * 1000 + 1500);

      if (status !== 429 || attempt >= maxAttempts) {
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
    if (!text.includes(marker)) throw new Error("formatGp marker not found");
    text = text.replace(marker, helper + marker);
  }

  text = text.replace(
    "const values = await getMarketValues([...ids]);",
    "const values = await getMarketValuesWithRetry([...ids]);"
  );

  text = text.replace(
    `console.log("Blank scroll: market price capped at NPC " + formatGp(25000) + " gp");`,
    `console.log("Recipes checked: " + resolvedRecipes.length);
  if (onlyFilter.length > 0) {
    console.log("Filter: " + onlyFilter.join(", "));
  }
  console.log("Blank scroll: market price capped at NPC " + formatGp(25000) + " gp");`
  );

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
    console.log("Try a smaller scan:");
    console.log("  npm run scrolls-epiphany");
    console.log("  npm run scrolls-top");
    console.log("  npm run scrolls -- --tier powerful --only Epiphany,Vampirism,Void");
    console.log("");
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});`
  );

  write(path, text);
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = JSON.parse(read(path));

  pkg.scripts ||= {};
  pkg.scripts.scrolls = "node scroll-crafting-scanner.mjs";
  pkg.scripts["scrolls-discord"] = "node scroll-crafting-scanner.mjs --discord";
  pkg.scripts["scrolls-top"] =
    "node scroll-crafting-scanner.mjs --tier powerful --only Epiphany,Vampirism,Void,Strike,Precision,Bash,Slash,Chop --min-profit 0";
  pkg.scripts["scrolls-epiphany"] =
    "node scroll-crafting-scanner.mjs --only Epiphany --min-profit 0";

  write(path, JSON.stringify(pkg, null, 2) + "\n");
}

function patchBat() {
  const path = "trade-manager.bat";
  if (!fs.existsSync(path)) return;

  let text = read(path);

  if (!text.includes(":scrollcraft")) return;

  const start = text.indexOf(":scrollcraft");
  const nextStats = text.indexOf(":stats", start);
  const nextMenu = text.indexOf(":menu", start + 1);
  let end = -1;

  if (nextStats !== -1) end = nextStats;
  else if (nextMenu !== -1) end = nextMenu;
  else end = text.length;

  const block = `:scrollcraft
cls
echo ============================
echo    SCROLL CRAFTING SCANNER
echo ============================
echo.
echo 1. Top Powerful scrolls only
echo    - Recommended. Checks the most useful craftable scrolls.
echo.
echo 2. Epiphany only
echo    - Fast test for Powerful/Intricate Epiphany.
echo.
echo 3. Full scan
echo    - More complete, but may hit API rate limit.
echo.
echo 0. Back
echo.
set /p scrollchoice=Choose option: 

if "%scrollchoice%"=="1" call npm run scrolls-top
if "%scrollchoice%"=="2" call npm run scrolls-epiphany
if "%scrollchoice%"=="3" call npm run scrolls
if "%scrollchoice%"=="0" goto markettools
pause
goto scrollcraft

`;

  text = text.slice(0, start) + block + text.slice(end);
  write(path, text);
}

patchScrollScanner();
patchPackageJson();
patchBat();

console.log("Patched scroll scanner filters and BAT submenu.");
