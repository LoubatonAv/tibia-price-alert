const fs = require("fs");

const path = "trade.js";
let text = fs.readFileSync(path, "utf8");

function replaceFunction(source, functionName, replacement) {
  const start = source.indexOf("function " + functionName + "(");
  if (start === -1) throw new Error(functionName + " not found");

  const openBrace = source.indexOf("{", start);
  let depth = 0;
  let end = -1;

  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end === -1) throw new Error("Could not find end of " + functionName);
  return source.slice(0, start) + replacement + "\n" + source.slice(end);
}

const replacement = `
function parseListArgs(args) {
  if (args.length < 3) {
    return null;
  }

  const cleanArgs = [];
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const value = args[i];

    if (
      value === "--entry-price" ||
      value === "--actual-entry" ||
      value === "--cost"
    ) {
      const number = Number(args[i + 1]);
      options.entryPrice = Number.isFinite(number) && number >= 0 ? number : null;
      i += 1;
      continue;
    }

    if (value === "--source" || value === "--flow") {
      options.source = args[i + 1] || "";
      i += 1;
      continue;
    }

    cleanArgs.push(value);
  }

  if (cleanArgs.length < 3) {
    return null;
  }

  let entryPrice = options.entryPrice;
  let listPrice = cleanArgs[cleanArgs.length - 1];
  let quantity = cleanArgs[cleanArgs.length - 2];
  let itemInput = cleanArgs.slice(0, -2).join(" ");

  // Support shorthand:
  // trade.js list "stone skin amulet" 9 15992 0
  // item + quantity + listPrice + entryPrice
  if (
    cleanArgs.length >= 4 &&
    entryPrice === undefined &&
    Number(cleanArgs[cleanArgs.length - 1]) >= 0 &&
    Number(cleanArgs[cleanArgs.length - 2]) > 0 &&
    Number(cleanArgs[cleanArgs.length - 3]) > 0
  ) {
    entryPrice = Number(cleanArgs[cleanArgs.length - 1]);
    listPrice = cleanArgs[cleanArgs.length - 2];
    quantity = cleanArgs[cleanArgs.length - 3];
    itemInput = cleanArgs.slice(0, -3).join(" ");
  }

  return {
    itemInput,
    quantity,
    listPrice,
    entryPrice,
    source: options.source || "",
  };
}
`.trim();

text = replaceFunction(text, "parseListArgs", replacement);
fs.writeFileSync(path, text, "utf8");
console.log("Patched parseListArgs to support shorthand entry price.");
