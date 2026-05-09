import axios from "axios";
import fs from "fs";
import { API_URL, SERVER, SCANNER_BATCH_SIZE } from "./constants.js";

export function getItemMap() {
  const raw = fs.readFileSync("./data/items.json");

  const items = JSON.parse(raw);

  const map = {};

  items.forEach((item) => {
    map[item.id] = item.name;
  });

  return map;
}

export async function getMarketValues(itemIds) {
  if (itemIds.length === 0) {
    return [];
  }

  const batches = [];

  for (let i = 0; i < itemIds.length; i += SCANNER_BATCH_SIZE) {
    batches.push(itemIds.slice(i, i + SCANNER_BATCH_SIZE));
  }

  const results = [];

  for (const batch of batches) {
    const res = await axios.get(`${API_URL}/market_values`, {
      params: {
        server: SERVER,
        item_ids: batch.join(","),
      },
    });

    results.push(...res.data);
  }

  return results;
}
