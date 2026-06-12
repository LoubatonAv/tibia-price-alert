const fs = require("fs");

const path = "positions.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));

if (!Array.isArray(data.positions)) {
  data.positions = [];
}

const alreadyExists = data.positions.some((p) =>
  p.id === 23544 &&
  p.name === "collar of red plasma" &&
  p.status === "CLOSED" &&
  (p.events || []).some((e) => e.type === "SOLD_ITEMS" && Number(e.sellPrice) === 25384)
);

if (alreadyExists) {
  console.log("Closed collar of red plasma sale already exists. Nothing added.");
  process.exit(0);
}

const restored = {
  id: 23544,
  name: "collar of red plasma",
  createdAt: "2026-06-03T00:56:33.516Z",
  openedAt: "2026-06-03T00:56:33.516Z",
  flow: "MANUAL_LISTING",
  entryPrice: 0,
  averageEntryPrice: 0,
  originalQuantity: 4,
  quantity: 0,
  orderedQuantity: 4,
  receivedQuantity: 4,
  listedQuantity: 0,
  soldQuantity: 4,
  totalListedQuantity: 4,
  buyOfferFeePaid: 0,
  sellOfferFeePaid: 2030.72,
  targetSell: null,
  desiredMargin: 0,
  entryBrainScore: null,
  status: "CLOSED",
  events: [
    {
      type: "MANUAL_POSITION_CREATED_FROM_LISTING",
      at: "2026-06-03T00:56:33.516Z",
      quantity: 4,
      entryPrice: 0,
      listPrice: 25384,
      buyOfferFeePaid: 0
    },
    {
      type: "LISTED_FOR_SALE",
      at: "2026-06-03T00:56:33.517Z",
      quantity: 4,
      listPrice: 25384,
      offerFeePaid: 2030.72
    },
    {
      type: "SOLD_ITEMS",
      at: "2026-06-03T09:43:11.482Z",
      quantity: 4,
      sellPrice: 25384,
      grossSell: 101536,
      buyOfferFeePaid: 0,
      sellOfferFeePaid: 2030.72,
      totalFees: 2030.72,
      netProfit: 99505.28,
      roiPercent: 4900,
      exitReason: "RESTORED_MISSING_EXTERNAL_SALE"
    }
  ],
  lastListPrice: 25384,
  lastListedAt: "2026-06-03T00:56:33.517Z",
  lastSoldAt: "2026-06-03T09:43:11.482Z",
  lastSellPrice: 25384,
  closedAt: "2026-06-03T09:43:11.482Z",
  finalSellPrice: 25384
};

fs.copyFileSync(path, path + ".bak-before-restore-collar-fixed");
data.positions.push(restored);
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

console.log("Restored missing closed collar of red plasma sale.");
