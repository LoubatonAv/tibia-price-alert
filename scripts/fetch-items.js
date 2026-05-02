import axios from "axios";
import fs from "fs";

const API_URL = "https://api.tibiamarket.top";

async function fetchAndSave() {
  const res = await axios.get(`${API_URL}/item_metadata`);

  fs.writeFileSync("./data/items.json", JSON.stringify(res.data, null, 2));

  console.log("Items saved locally.");
}

fetchAndSave();
