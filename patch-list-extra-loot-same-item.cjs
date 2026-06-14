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

function replaceBlockAfter(source, afterMarker, blockStart, replacement) {
  const after = source.indexOf(afterMarker);
  if (after === -1) throw new Error("Marker not found: " + afterMarker);

  const start = source.indexOf(blockStart, after);
  if (start === -1) throw new Error("Block start not found after marker: " + blockStart);

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

  if (end === -1) throw new Error("Could not find end of block");
  return source.slice(0, start) + replacement + source.slice(end);
}

const parseListArgsReplacement = `
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

  const listPrice = cleanArgs[cleanArgs.length - 1];
  const quantity = cleanArgs[cleanArgs.length - 2];
  const itemInput = cleanArgs.slice(0, -2).join(" ");

  return {
    itemInput,
    quantity,
    listPrice,
    entryPrice: options.entryPrice,
    source: options.source || "",
  };
}
`.trim();

text = replaceFunction(text, "parseListArgs", parseListArgsReplacement);

if (!text.includes("function getActiveOwnedPositionsForItem(")) {
  const helper = `
function getActiveOwnedPositionsForItem(positionsData, itemId) {
  const positions = Array.isArray(positionsData.positions)
    ? positionsData.positions
    : [];

  return positions.filter((position) => {
    const sameItem = String(position.id) === String(itemId);
    const status = String(position.status || "").toUpperCase();

    const isClosed =
      status === "SOLD" ||
      status === "CLOSED" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "BUY_ORDER_CANCELLED" ||
      status === "BUY_ORDER_EXPIRED" ||
      status === "EXPIRED";

    const ownedQuantity = Number(position.quantity || 0);

    return sameItem && !isClosed && ownedQuantity > 0;
  });
}

async function chooseActivePositionForListing(positionsData, itemId, requestedQuantity) {
  const activePositions = getActiveOwnedPositionsForItem(positionsData, itemId);

  const listablePositions = activePositions.filter((position) => {
    const ownedQuantity = Number(position.quantity || 0);
    const listedQuantity = Number(position.listedQuantity || 0);
    const availableToList = Math.max(0, ownedQuantity - listedQuantity);

    return availableToList >= Number(requestedQuantity || 0);
  });

  if (listablePositions.length === 0) {
    return null;
  }

  if (listablePositions.length === 1) {
    return listablePositions[0];
  }

  console.log("\\nMultiple listable positions found for this item:\\n");

  listablePositions.forEach((position, index) => {
    const ownedQuantity = Number(position.quantity || 0);
    const listedQuantity = Number(position.listedQuantity || 0);
    const availableToList = Math.max(0, ownedQuantity - listedQuantity);

    console.log(
      \`\${index + 1}) \${position.name} | flow: \${position.flow || "UNKNOWN"} | status: \${position.status} | owned: \${ownedQuantity} | listed: \${listedQuantity} | available: \${availableToList} | entry: \${
        position.entryPrice ?? position.averageEntryPrice ?? "?"
      } gp\`,
    );
  });

  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(
    "\\nChoose which position to list by number: ",
  );

  rl.close();

  const selectedIndex = Number(answer) - 1;

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= listablePositions.length
  ) {
    fail("Invalid position selection.");
  }

  return listablePositions[selectedIndex];
}
`;

  const insertBefore = "\nasync function askYesNo(question)";
  if (!text.includes(insertBefore)) {
    throw new Error("Could not find askYesNo marker");
  }

  text = text.replace(insertBefore, "\n" + helper + insertBefore);
}

text = text.replace(
  `  const resolvedItem = resolveItem(itemInput);
  let position = await chooseActivePosition(positionsData, resolvedItem.id);

  const listQty = Number(quantity);
  const numericListPrice = Number(listPrice);`,
  `  const resolvedItem = resolveItem(itemInput);

  const listQty = Number(quantity);
  const numericListPrice = Number(listPrice);
  const listEntryPrice =
    Number.isFinite(Number(parsed.entryPrice)) && Number(parsed.entryPrice) >= 0
      ? Number(parsed.entryPrice)
      : null;

  let position = await chooseActivePositionForListing(
    positionsData,
    resolvedItem.id,
    listQty,
  );`
);

const newNoPositionBlock = `
  if (!position) {
    const existingSameItemPositions = getActiveOwnedPositionsForItem(
      positionsData,
      resolvedItem.id,
    );

    if (existingSameItemPositions.length > 0) {
      console.log(
        \`\\nNo unlisted quantity is available in existing positions for \${resolvedItem.name}.\`,
      );
      console.log(
        "Existing same-item positions are probably already fully listed.",
      );
      console.log(
        "This is normal when you have a flip position already listed and you want to list extra loot/external items.",
      );
      console.log("\\nExisting same-item positions:\\n");

      existingSameItemPositions.forEach((existingPosition, index) => {
        const ownedQuantity = Number(existingPosition.quantity || 0);
        const listedQuantity = Number(existingPosition.listedQuantity || 0);
        const availableToList = Math.max(0, ownedQuantity - listedQuantity);

        console.log(
          \`\${index + 1}) \${existingPosition.name} | flow: \${existingPosition.flow || "UNKNOWN"} | status: \${existingPosition.status} | owned: \${ownedQuantity} | listed: \${listedQuantity} | available: \${availableToList}\`,
        );
      });
    } else {
      console.log(\`\\nNo active position found for \${resolvedItem.name}.\`);
    }

    console.log(
      \`\\nYou are trying to list \${listQty}x at \${formatGp(numericListPrice)} gp each.\`,
    );

    const createNew = await askYesNo(
      "\\nCreate a separate new loot/external/manual position for these listed items? Y/N",
    );

    if (!createNew) {
      console.log("\\nCancelled. Nothing was saved.\\n");
      process.exit(0);
    }

    let entryPrice = listEntryPrice;

    if (entryPrice === null) {
      const rl = readline.createInterface({ input, output });

      const entryAnswer = await rl.question(
        "\\nEnter actual entry price / cost per item. Use 0 if this was loot/drop: ",
      );

      rl.close();

      entryPrice = Number(entryAnswer);
    }

    if (!Number.isFinite(entryPrice) || entryPrice < 0) {
      fail("ENTRY_PRICE must be 0 or higher.");
    }

    let buyOfferFeePaid = 0;

    if (entryPrice > 0) {
      const hadBuyOfferFee = await askYesNo(
        "\\nDid you originally buy this through a Tibia buy offer? Y/N",
      );

      buyOfferFeePaid = hadBuyOfferFee
        ? calculateBuyOfferFee(entryPrice, listQty)
        : 0;
    }

    const now = new Date().toISOString();
    const isLootOrExternal = entryPrice <= 0;

    position = {
      id: resolvedItem.id,
      name: resolvedItem.name,
      createdAt: now,
      openedAt: now,
      flow: isLootOrExternal ? "LOOT_OR_EXTERNAL_LISTING" : "MANUAL_LISTING",
      entryPrice,
      averageEntryPrice: entryPrice,
      originalQuantity: listQty,
      quantity: listQty,
      orderedQuantity: listQty,
      receivedQuantity: listQty,
      listedQuantity: 0,
      soldQuantity: 0,
      totalListedQuantity: 0,
      buyOfferFeePaid,
      sellOfferFeePaid: 0,
      targetSell: null,
      desiredMargin: 0,
      entryBrainScore: null,
      status: "EXTERNAL_READY",
      events: [
        {
          type: isLootOrExternal
            ? "LOOT_OR_EXTERNAL_POSITION_CREATED_FROM_LISTING"
            : "MANUAL_POSITION_CREATED_FROM_LISTING",
          at: now,
          quantity: listQty,
          entryPrice,
          listPrice: numericListPrice,
          buyOfferFeePaid,
        },
      ],
    };

    positionsData.positions.push(position);
  }
`;

text = replaceBlockAfter(
  text,
  'if (action === "list") {',
  "  if (!position) {",
  newNoPositionBlock
);

fs.writeFileSync(path, text, "utf8");

let batPath = "trade-manager.bat";
if (fs.existsSync(batPath)) {
  let bat = fs.readFileSync(batPath, "utf8");

  bat = bat.replace(
    'call npm run trade -- list "%ITEM%" %QTY% %LIST_PRICE%',
    'call npm run trade -- list "%ITEM%" %QTY% %LIST_PRICE% --entry-price "%ENTRY_PRICE%"'
  );

  fs.writeFileSync(batPath, bat, "utf8");
}

console.log("Fixed listing same item when existing position is already fully listed.");
