const fs = require("fs");

const path = "trade.js";
let text = fs.readFileSync(path, "utf8");

// Remove broken list-menu branches wherever they were inserted.
text = text.replace(
  /if \(action === "list-menu"\) \{\s*await runListMenu\(positionsData\);\s*process\.exit\(0\);\s*\}\s*/g,
  ""
);

text = text.replace(
  /if \(action === "list-menu"\) \{\s*runListMenu\(positionsData\)\s*\.then\(\(\) => process\.exit\(0\)\)\s*\.catch\(\(error\) => \{\s*console\.error\("List menu failed:", error\);\s*process\.exit\(1\);\s*\}\);\s*\}\s*/g,
  ""
);

// Make sure list-menu is allowed.
const validationMatch = /!\[\s*([\s\S]*?)\]\.includes\(action\)/.exec(text);

if (!validationMatch) {
  throw new Error("Could not find action validation list.");
}

if (!validationMatch[1].includes('"list-menu"')) {
  const oldBlock = validationMatch[1];
  const newBlock = oldBlock.replace('"list",', '"list",\n    "list-menu",');

  if (newBlock === oldBlock) {
    throw new Error("Could not add list-menu to validation list.");
  }

  text =
    text.slice(0, validationMatch.index) +
    validationMatch[0].replace(oldBlock, newBlock) +
    text.slice(validationMatch.index + validationMatch[0].length);
}

// Insert the correct branch at TOP LEVEL, after the top-level positionsData load.
const rawActionIndex = text.indexOf("const [, , rawAction, ...args] = process.argv;");
if (rawActionIndex < 0) {
  throw new Error("Could not find action parser.");
}

const positionsMarker = "const positionsData = loadPositions();";
const positionsIndex = text.indexOf(positionsMarker, rawActionIndex);

if (positionsIndex < 0) {
  throw new Error("Could not find top-level positionsData load.");
}

const insertAfter = positionsIndex + positionsMarker.length;

const branch = `

if (action === "list-menu") {
  await runListMenu(positionsData);
  process.exit(0);
}
`;

text = text.slice(0, insertAfter) + branch + text.slice(insertAfter);

fs.writeFileSync(path, text, "utf8");

console.log("Fixed list-menu dispatch location.");
