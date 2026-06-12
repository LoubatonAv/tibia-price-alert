const fs = require("fs");

const path = "trade-manager.bat";
let bat = fs.readFileSync(path, "utf8");

if (!fs.existsSync(path + ".bak-force-relist-routing")) {
  fs.copyFileSync(path, path + ".bak-force-relist-routing");
}

// Find old exit target from choice 18 or existing choice 19
let exitTarget = "exit";

const old18 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"18"\s+goto\s+([^\s\r\n]+)/im);
const old19 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"19"\s+goto\s+([^\s\r\n]+)/im);

if (old19 && old19[1].toLowerCase() !== "relist") {
  exitTarget = old19[1];
} else if (old18 && old18[1].toLowerCase() !== "relist") {
  exitTarget = old18[1];
}

// Fix menu text
bat = bat.replace(
  /^\s*echo\s+18\.?\s+Exit\s*$/im,
  "echo 18. Relist / Update Listing\r\necho 19. Exit"
);

if (!/echo\s+18\.?\s+Relist \/ Update Listing/i.test(bat)) {
  bat = bat.replace(
    /^\s*echo\s+17\.?\s+Action Dashboard\s*$/im,
    "echo 17. Action Dashboard\r\necho 18. Relist / Update Listing\r\necho 19. Exit"
  );
}

// Remove all old routing for 18/19
bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"18"\s+goto\s+[^\r\n]+\r?\n?/gim, "");
bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"19"\s+goto\s+[^\r\n]+\r?\n?/gim, "");

// Add clean routing after choice 17
const route17 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"17"\s+goto\s+dashboard\s*$/im);

if (!route17) {
  throw new Error('Could not find route for choice 17 dashboard');
}

const insertAt = route17.index + route17[0].length;
bat =
  bat.slice(0, insertAt) +
  `\r\nif "%choice%"=="18" goto relist\r\nif "%choice%"=="19" goto ${exitTarget}` +
  bat.slice(insertAt);

// Remove old relist block if exists
bat = bat.replace(/\r?\n:relist[\s\S]*?(?=\r?\n:[a-zA-Z0-9_]+\b)/i, "");

// Add relist block before dashboard
const relistBlock = `

:relist
cls
echo RELIST / UPDATE EXISTING LISTING
echo.
echo Use this only after you actually changed the listing in Tibia Market.
echo.
call npm run trade -- relist-menu
echo.
echo Finished. Press any key to return to menu.
pause >nul
goto menu
`;

if (bat.includes(":dashboard")) {
  bat = bat.replace(/\r?\n:dashboard/i, relistBlock + "\r\n:dashboard");
} else {
  bat += relistBlock;
}

fs.writeFileSync(path, bat, "utf8");

console.log("Forced BAT relist routing fixed.");
console.log("Exit target is:", exitTarget);
