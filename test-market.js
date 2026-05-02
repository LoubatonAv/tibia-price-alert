import axios from "axios";
import "dotenv/config";

const API_URL = "https://api.tibiamarket.top";
const SERVER = "Harmonia";
const ITEM_ID = "22118";

async function test() {
  try {
    const res = await axios.get(`${API_URL}/market_values`, {
      params: {
        server: SERVER,
        item_ids: ITEM_ID,
      },
    });
    console.log(res.data);
  } catch (err) {
    console.log(err.response?.data || err.message);
  }
}

test();
