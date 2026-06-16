const fs = require("fs");

const path = "trade-manager.bat";
let text = fs.readFileSync(path, "utf8");

const oldBlock = `:rundiscovery
cls
set SCANNER_MODE=discovery
call npm run scanner
pause
goto markettools`;

const newBlock = `:rundiscovery
cls
set SCANNER_MODE=discovery
call npm run scanner
echo.
echo ============================
echo Discovery scan finished.
echo ============================
echo.
set /p runPromo=Run Discovery Promotion now? Y/N: 
if /I "%runPromo%"=="Y" call npm run promote-discovery
pause
goto markettools`;

if (!text.includes(oldBlock)) {
  throw new Error("Could not find exact :rundiscovery block in trade-manager.bat");
}

text = text.replace(oldBlock, newBlock);

fs.writeFileSync(path, text, "utf8");
console.log("Added optional Discovery Promotion prompt after Discovery scanner.");
