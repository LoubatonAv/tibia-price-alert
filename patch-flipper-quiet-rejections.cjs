const fs = require("fs");

const path = "check-flips.js";

if (!fs.existsSync(path)) {
  throw new Error("check-flips.js not found");
}

let text = fs.readFileSync(path, "utf8");

const block = `
// Quiet normal output: rejected item dumps are shown only in debug mode.
const FLIPPER_DEBUG_REJECTIONS = ["1", "true", "yes", "y"].includes(
  String(process.env.FLIPPER_DEBUG_REJECTIONS || "").toLowerCase(),
);

const originalFlipperConsoleLog = console.log.bind(console);

console.log = (...args) => {
  const message = args.map((arg) => String(arg)).join(" ");

  if (!FLIPPER_DEBUG_REJECTIONS && /^\\s*REJECTED:/m.test(message)) {
    return;
  }

  originalFlipperConsoleLog(...args);
};

`;

if (text.includes("FLIPPER_DEBUG_REJECTIONS")) {
  console.log("FLIPPER_DEBUG_REJECTIONS already exists. Nothing changed.");
  process.exit(0);
}

// Insert after import lines if possible.
const importRegex = /^(import[\\s\\S]*?;\\s*)/gm;
let lastImportEnd = 0;
let match;

while ((match = importRegex.exec(text)) !== null) {
  lastImportEnd = match.index + match[0].length;
}

if (lastImportEnd > 0) {
  text = text.slice(0, lastImportEnd) + block + text.slice(lastImportEnd);
} else {
  text = block + text;
}

fs.writeFileSync(path, text, "utf8");

console.log("Rejected output is now debug-only.");
