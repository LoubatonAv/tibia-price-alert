import axios from "axios";

const API_URL = "https://api.tibiamarket.top";

async function test() {
  try {
    const res = await axios.get(`${API_URL}/item_metadata`, {
      params: {
        item_ids: "36972,22086,10449,22516",
      },
    });

    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

test();
