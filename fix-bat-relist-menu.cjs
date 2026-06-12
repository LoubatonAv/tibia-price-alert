const fs = require("fs");

const path = "trade-manager.bat";

if (!fs.existsSync(path)) {
  throw new Error("trade-manager.bat not found");
}

let bat = fs.readFileSync(path, "utf8");

if (!fs.existsSync(path + ".bak-relist-menu-fix")) {
  fs.copyFileSync(path, path + ".bak-relist-menu-fix");
}

// Fix menu display: 18 becomes Relist, Exit becomes 19
bat = bat.replace(
  /echo\s+17\.?\s+Action Dashboard\s*\r?\necho\s+18\.?\s+Exit/i,
  "echo 17. Action Dashboard\r\necho 18. Relist / Update Listing\r\necho 19. Exit"
);

// Fix choice routing
bat = bat.replace(
  /if\s+"%choice%"\s*==\s*"17"\s+goto\s+dashboard\s*\r?\nif\s+"%choice%"\s*==\s*"18"\s+goto\s+([a-zA-Z0-9_]+)/i,
  'if "%choice%"=="17" goto dashboard\r\nif "%choice%"=="18" goto relist\r\nif "%choice%"=="19" goto $1'
);

// Fallback if it only has the old exit choice somewhere
if (!bat.includes('if "%choice%"=="18" goto relist')) {
  bat = bat.replace(
    /if\s+"%choice%"\s*==\s*"18"\s+goto\s+([a-zA-Z0-9_]+)/i,
    'if "%choice%"=="18" goto relist\r\nif "%choice%"=="19" goto $1'
  );
}

// Add relist label if missing
if (!bat.includes(":relist")) {
  const relistBlock = `

:relist
cls
echo RELIST / UPDATE EXISTING LISTING
echo.
echo Use this only after you actually changed the listing in Tibia Market.
echo.
call npm run trade -- relist-menu
pause
goto menu
`;

  if (bat.includes(":dashboard")) {
    bat = bat.replace(":dashboard", relistBlock + "\r\n:dashboard");
  } else {
    bat += relistBlock;
  }
}

fs.writeFileSync(path, bat, "utf8");

console.log("BAT relist menu fixed.");
