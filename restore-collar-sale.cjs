const fs = require("fs");

const currentPath = "positions.json";
const backupFiles = fs.readdirSync(".")
  .filter((name) => name.startsWith("positions.json.bak"))
  .sort()
  .reverse();

if (!fs.existsSync(currentPath)) {
  throw new Error("positions.json not found");
}

const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
if (!Array.isArray(current.positions)) current.positions = [];

const alreadyExists = current.positions.some((p) =>
  p.name === "collar of red plasma" &&
  p.status === "CLOSED" &&
  (p.events || []).some((e) => e.type === "SOLD_ITEMS")
);

if (alreadyExists) {
  console.log("Closed collar of red plasma sale already exists in positions.json");
  process.exit(0);
}

let found = null;
let foundIn = null;

for (const file of backupFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const match = (data.positions || []).find((p) =>
      p.name === "collar of red plasma" &&
      p.status === "CLOSED" &&
      (p.events || []).some((e) => e.type === "SOLD_ITEMS")
    );

    if (match) {
      found = match;
      foundIn = file;
      break;
    }
  } catch {}
}

if (!found) {
  console.log("Could not find closed collar of red plasma sale in positions.json backups.");
  console.log("Backups checked:", backupFiles.join(", "));
  process.exit(1);
}

current.positions.push(found);

fs.copyFileSync(currentPath, currentPath + ".bak-before-restore-collar");
fs.writeFileSync(currentPath, JSON.stringify(current, null, 2) + "\n");

console.log("Restored closed collar of red plasma sale from:", foundIn);
console.log("Profit:", (found.events || []).find((e) => e.type === "SOLD_ITEMS")?.netProfit);
