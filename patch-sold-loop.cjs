const fs = require("fs");

const path = "trade-manager.bat";
let text = fs.readFileSync(path, "utf8");

const newSoldBlock = `:sold
cls
echo SOLD ITEMS
echo.
echo Choose Flip for bought positions, or Loot / External for items added manually.
echo.
call npm run trade -- sold-menu

echo.
set "SELL_MORE="
set /p "SELL_MORE=Record another sold item? Y/N: "

if /I "%SELL_MORE%"=="Y" goto sold

pause
goto menu

:stats`;

const pattern = /:sold[\s\S]*?\r?\n:stats/;

if (!pattern.test(text)) {
  throw new Error("Could not find :sold block in trade-manager.bat");
}

text = text.replace(pattern, newSoldBlock);
fs.writeFileSync(path, text, "utf8");

console.log("Updated SOLD ITEMS loop in trade-manager.bat");
