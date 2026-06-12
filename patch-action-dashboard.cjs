const fs = require("fs");

function backup(path) {
  if (fs.existsSync(path) && !fs.existsSync(path + ".bak-dashboard")) {
    fs.copyFileSync(path, path + ".bak-dashboard");
  }
}

function replaceOrFail(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error("Could not patch " + label);
  return next;
}

const tradePath = "trade.js";
const batPath = "trade-manager.bat";

backup(tradePath);
backup(batPath);

let trade = fs.readFileSync(tradePath, "utf8");

const dashboardBlock = String.raw`
function getDashboardAgeHours(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / 1000 / 60 / 60);
}

function getDashboardStatus(position) {
  return String(position.status || "").toUpperCase();
}

function getDashboardFlow(position) {
  return String(position.flow || "").toUpperCase();
}

function getDashboardWaitingQuantity(position) {
  const ordered = Number(position.orderedQuantity || position.originalQuantity || 0);
  const received = Number(position.receivedQuantity || 0);
  return Math.max(0, ordered - received);
}

function getDashboardKind(position) {
  const flow = getDashboardFlow(position);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const buyFee = Number(position.buyOfferFeePaid || 0);

  if (flow.includes("EXTERNAL") || flow.includes("LOOT")) return "Loot / external";
  if (flow.includes("MANUAL_LISTING") && entryPrice <= 0 && buyFee <= 0) return "Loot / external";
  return "Flip";
}

function getOpenDashboardPositions() {
  const positionsData = loadPositions();

  return (positionsData.positions || [])
    .map((position) => {
      normalizePosition(position);
      return position;
    })
    .filter((position) => getDashboardStatus(position) !== "CLOSED");
}

function printDashboardPosition(position, index, extraLines = []) {
  normalizePosition(position);

  const status = position.status || "UNKNOWN";
  const kind = getDashboardKind(position);
  const waiting = getDashboardWaitingQuantity(position);
  const lastListPrice = Number(position.lastListPrice || 0);

  console.log(String(index + 1) + ") " + position.name + " (" + position.id + ")");
  console.log("   " + kind + " | " + status + " | age " + formatAge(position.openedAt || position.createdAt));
  console.log(
    "   Entry: " + formatGp(position.entryPrice) + " gp" +
      " | Owned: " + Number(position.quantity || 0) +
      " | Listed: " + Number(position.listedQuantity || 0) +
      " | Waiting: " + waiting
  );

  if (lastListPrice > 0) {
    console.log(
      "   Last list: " + formatGp(lastListPrice) + " gp" +
        " | listed age " + formatAge(position.lastListedAt)
    );
  }

  for (const line of extraLines) {
    console.log("   " + line);
  }

  console.log("");
}

function getDashboardSuspiciousNotes(position) {
  const notes = [];
  const status = getDashboardStatus(position);
  const quantity = Number(position.quantity || 0);
  const listed = Number(position.listedQuantity || 0);
  const waiting = getDashboardWaitingQuantity(position);
  const entryPrice = Number(position.entryPrice || position.averageEntryPrice || 0);
  const targetSell = Number(position.targetSell || 0);
  const ageHours = getDashboardAgeHours(position.openedAt || position.createdAt);

  if (listed > quantity) notes.push("Listed quantity is higher than owned quantity.");
  if (quantity <= 0 && waiting <= 0 && status !== "CLOSED") notes.push("No quantity left, but position is still open.");
  if (status.includes("BUY_ORDER") && waiting > 0 && ageHours >= 24 * 30) notes.push("Buy order is older than 30 days; consider expire/cancel.");
  if (entryPrice > 0 && targetSell > 0 && targetSell < entryPrice) notes.push("Target sell is lower than entry price.");

  return notes;
}

function printDashboardSection(title, items, emptyText, printer) {
  console.log("\n" + title);
  console.log("-".repeat(title.length));

  if (items.length === 0) {
    console.log(emptyText + "\n");
    return;
  }

  items.forEach((item, index) => printer(item, index));
}

function printDashboard() {
  const openPositions = getOpenDashboardPositions();
  const listed = openPositions
    .filter((position) => Number(position.quantity || 0) > 0 && Number(position.listedQuantity || 0) > 0)
    .sort((a, b) => getDashboardAgeHours(b.lastListedAt) - getDashboardAgeHours(a.lastListedAt));

  const needToList = openPositions
    .filter((position) => Number(position.quantity || 0) > 0 && Number(position.listedQuantity || 0) <= 0)
    .sort((a, b) => getDashboardAgeHours(b.openedAt || b.createdAt) - getDashboardAgeHours(a.openedAt || a.createdAt));

  const buyOrders = openPositions
    .filter((position) => getDashboardWaitingQuantity(position) > 0)
    .sort((a, b) => getDashboardAgeHours(b.openedAt || b.createdAt) - getDashboardAgeHours(a.openedAt || a.createdAt));

  const staleDays = Number(process.env.TIBIA_STALE_LISTING_DAYS || 7);
  const staleListed = listed.filter((position) => getDashboardAgeHours(position.lastListedAt) >= staleDays * 24);

  const suspicious = openPositions
    .map((position) => ({ position, notes: getDashboardSuspiciousNotes(position) }))
    .filter((entry) => entry.notes.length > 0);

  const listedValue = listed.reduce(
    (sum, position) => sum + Number(position.listedQuantity || 0) * Number(position.lastListPrice || 0),
    0,
  );

  const openCost = openPositions.reduce(
    (sum, position) => sum + Number(position.quantity || 0) * Number(position.entryPrice || position.averageEntryPrice || 0),
    0,
  );

  console.log("\nTIBIA ACTION DASHBOARD\n");
  console.log("Open positions: " + openPositions.length);
  console.log("Need to list: " + needToList.length);
  console.log("Listed / waiting to sell: " + listed.length);
  console.log("Open buy orders: " + buyOrders.length);
  console.log("Stale listings (" + staleDays + "d+): " + staleListed.length);
  console.log("Suspicious positions: " + suspicious.length);
  console.log("Estimated open item cost: " + formatGp(openCost) + " gp");
  console.log("Estimated listed value: " + formatGp(listedValue) + " gp");

  console.log("\nNEXT ACTIONS");
  console.log("------------");
  if (needToList.length > 0) console.log("1) List received items for sale: use BAT option 4.");
  if (listed.length > 0) console.log("2) Check Tibia market sold items: use BAT option 5.");
  if (staleListed.length > 0) console.log("3) Review stale listings: run Sell Check or relist manually.");
  if (buyOrders.length > 0) console.log("4) Check whether buy orders filled: use BAT option 2 when received.");
  if (suspicious.length > 0) console.log("5) Fix suspicious positions before trusting stats.");
  if (needToList.length + listed.length + staleListed.length + buyOrders.length + suspicious.length === 0) {
    console.log("Nothing urgent. You can run scanner/flips or discovery.");
  }

  printDashboardSection(
    "NEED TO LIST",
    needToList,
    "No received unlisted items.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "LISTED / WAITING TO SELL",
    listed,
    "No active listed positions.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "OPEN BUY ORDERS",
    buyOrders,
    "No buy orders waiting.",
    (position, index) => printDashboardPosition(position, index),
  );

  printDashboardSection(
    "STALE LISTINGS",
    staleListed,
    "No stale listings.",
    (position, index) => printDashboardPosition(position, index, ["Action: check live market price; consider relist/update."]),
  );

  console.log("\nSUSPICIOUS POSITIONS");
  console.log("--------------------");
  if (suspicious.length === 0) {
    console.log("No obvious data issues found.\n");
  } else {
    suspicious.forEach((entry, index) => printDashboardPosition(entry.position, index, entry.notes.map((note) => "Warning: " + note)));
  }
}
`;

if (!trade.includes("function printDashboard()")) {
  trade = replaceOrFail(
    trade,
    "const [, , rawAction, ...args] = process.argv;",
    dashboardBlock + "\nconst [, , rawAction, ...args] = process.argv;",
    "dashboard functions",
  );
}

const validationStart = trade.indexOf("if (\n  ![");
const validationEnd = validationStart >= 0 ? trade.indexOf("].includes(action)", validationStart) : -1;
const validationBlock = validationStart >= 0 && validationEnd >= 0 ? trade.slice(validationStart, validationEnd) : "";

if (!validationBlock.includes('"dashboard"') && !validationBlock.includes("'dashboard'")) {
  if (validationStart < 0 || validationEnd < 0) throw new Error("Could not find action validation block");
  const patchedValidationBlock = validationBlock.replace(/(\"orders\",\s*\n)/, '$1    "dashboard",\n');
  if (patchedValidationBlock === validationBlock) throw new Error("Could not add dashboard to validation block");
  trade = trade.slice(0, validationStart) + patchedValidationBlock + trade.slice(validationEnd);
}

if (!trade.includes('dash: "dashboard"') && !trade.includes("dash: 'dashboard'")) {
  trade = replaceOrFail(
    trade,
    /(const actionAliases = \{\s*\n)/,
    '$1  dash: "dashboard",\n  "action-dashboard": "dashboard",\n',
    "dashboard aliases",
  );
}

if (!trade.includes('if (action === "dashboard")')) {
  trade = replaceOrFail(
    trade,
    /if \(action === "orders"\) \{\s*\n  printOrders\(\);\s*\n  process\.exit\(0\);\s*\n\}\s*\n/,
    'if (action === "orders") {\n  printOrders();\n  process.exit(0);\n}\n\nif (action === "dashboard") {\n  printDashboard();\n  process.exit(0);\n}\n\n',
    "dashboard action branch",
  );
}

trade = trade.replace(
  "  node trade.js stats\n",
  "  node trade.js stats\n  node trade.js dashboard\n",
);

fs.writeFileSync(tradePath, trade, "utf8");

let bat = fs.readFileSync(batPath, "utf8");

if (!bat.includes("Action Dashboard")) {
  bat = bat.replace(/echo 16\. Git Push\r?\necho 17\. Exit/, "echo 16. Git Push\r\necho 17. Action Dashboard\r\necho 18. Exit");
  bat = bat.replace(/if "%choice%"=="17" exit/, 'if "%choice%"=="17" goto dashboard\r\nif "%choice%"=="18" exit');
}

if (!bat.includes(":dashboard")) {
  bat = bat.replace(/\r?\n:gitpush/, '\r\n:dashboard\r\ncls\r\necho ACTION DASHBOARD\r\necho.\r\ncall npm run trade -- dashboard\r\npause\r\ngoto menu\r\n\r\n:gitpush');
}

fs.writeFileSync(batPath, bat, "utf8");

console.log("Added Action Dashboard to trade.js and trade-manager.bat");
