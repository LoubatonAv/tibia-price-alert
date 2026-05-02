import axios from "axios";
import "dotenv/config";

await axios.post(process.env.DISCORD_WEBHOOK_URL, {
  content: "✅ Tibia price alert test works!",
});

console.log("Sent Discord test message.");
