const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) throw new Error(path + " not found");
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function writeJson(path, data) {
  write(path, JSON.stringify(data, null, 2) + "\n");
}

const pkgPath = "./package.json";
const pkg = JSON.parse(read(pkgPath));
pkg.scripts ||= {};

// Best = scans ALL powerful, shows top results after sorting by profit
pkg.scripts.scrolls = "node scroll-crafting-scanner.mjs --tier powerful --limit 10";

// All = scans ALL powerful, shows everything
pkg.scripts["scrolls-all"] = "node scroll-crafting-scanner.mjs --tier powerful --limit 999";

// Discord = scans ALL powerful, sends best few
pkg.scripts["scrolls-discord"] = "node scroll-crafting-scanner.mjs --tier powerful --limit 8 --discord";

// Keep compatibility, but do NOT make this a hardcoded subset
pkg.scripts["scrolls-top"] = "node scroll-crafting-scanner.mjs --tier powerful --limit 10";

// Remove special Epiphany script if it exists
delete pkg.scripts["scrolls-epiphany"];
delete pkg.scripts["scrolls-epiphany-powerful"];
delete pkg.scripts["scrolls-epiphany-intricate"];
delete pkg.scripts["scrolls-intricate"];

writeJson(pkgPath, pkg);

// Make scanner respect enabled:false, if you ever want to disable a scroll
const scannerPath = "./scroll-crafting-scanner.mjs";
let scanner = read(scannerPath);

if (!scanner.includes("recipe.enabled === false")) {
  scanner = scanner.replace(
    `.filter((recipe) => {
      if (tierFilter && String(recipe.tier).toLowerCase() !== tierFilter) {`,
    `.filter((recipe) => {
      if (recipe.enabled === false) {
        return false;
      }

      if (tierFilter && String(recipe.tier).toLowerCase() !== tierFilter) {`
  );
}

write(scannerPath, scanner);

// Replace BAT submenu to match the real behavior
const batPath = "./trade-manager.bat";
if (fs.existsSync(batPath)) {
  let bat = read(batPath);

  if (bat.includes(":scrollcraft")) {
    const start = bat.indexOf(":scrollcraft");

    const possibleEnds = [
      bat.indexOf(":stats", start + 1),
      bat.indexOf(":menu", start + 1),
      bat.indexOf(":markettools", start + 1),
    ].filter((x) => x !== -1);

    const end = possibleEnds.length ? Math.min(...possibleEnds) : bat.length;

    const block = `:scrollcraft
cls
echo ============================
echo    SCROLL CRAFTING SCANNER
echo ============================
echo.
echo 1. Best Powerful scrolls
echo    - Scans all enabled Powerful scrolls and shows the best by profit.
echo.
echo 2. All Powerful scrolls
echo    - Scans all enabled Powerful scrolls and shows the full list.
echo.
echo 0. Back
echo.
set /p scrollchoice=Choose option: 

if "%scrollchoice%"=="1" call npm run scrolls
if "%scrollchoice%"=="2" call npm run scrolls-all
if "%scrollchoice%"=="0" goto markettools
pause
goto scrollcraft

`;

    bat = bat.slice(0, start) + block + bat.slice(end);
    write(batPath, bat);
  }
}

console.log("Scroll scanner now finds best Powerful scrolls automatically.");
console.log("npm run scrolls = all Powerful recipes, top 10 by profit.");
console.log("npm run scrolls-all = all Powerful recipes, full list.");
