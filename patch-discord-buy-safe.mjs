import fs from "fs";

const path = "./check-flips.js";
let text = fs.readFileSync(path, "utf8");

const startMarker = "async function sendDiscordBuyAlerts(buySignals, state) {";
const endMarker = "async function sendDiscordSellAlerts(sellSignals, state) {";

const start = text.indexOf(startMarker);
const end = text.indexOf(endMarker);

if (start === -1 || end === -1 || end <= start) {
  throw new Error("Could not find sendDiscordBuyAlerts block.");
}

let before = text.slice(0, start);
let block = text.slice(start, end);
let after = text.slice(end);

// Limit BUY embeds to 1 message so Discord does not reject large embed payloads.
block = block.replace(
  "const embeds = alertable.slice(0, 5).map((item) => {",
  "const embeds = alertable.slice(0, 1).map((item) => {"
);

// Keep the accept command under Discord field limit.
block = block.replace(
  "value: getAcceptBuyDiscordValue(item),",
  "value: String(getAcceptBuyDiscordValue(item)).slice(0, 900),"
);

// Add proper Discord error output.
const oldPost = `  await axios.post(DISCORD_WEBHOOK_URL, {
    content: \`🟢 Tibia Flipper BUY signals on **\${SERVER}** (\${alertable.length} alert\${alertable.length === 1 ? "" : "s"})\`,
    embeds,
  });
`;

const newPost = `  const buyPayload = {
    content: \`🟢 Tibia Flipper BUY signals on **\${SERVER}** (\${alertable.length} alert\${alertable.length === 1 ? "" : "s"})\`,
    embeds,
    allowed_mentions: { parse: [] },
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, buyPayload, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Discord BUY webhook failed");
    console.error("Status:", err.response?.status);
    console.error("Response:", JSON.stringify(err.response?.data, null, 2));
    console.error("Payload summary:", {
      contentLength: buyPayload.content?.length ?? 0,
      embedsCount: buyPayload.embeds?.length ?? 0,
      payloadLength: JSON.stringify(buyPayload).length,
    });
    throw err;
  }
`;

if (!block.includes(oldPost)) {
  throw new Error("Could not find BUY axios.post block.");
}

block = block.replace(oldPost, newPost);

fs.writeFileSync(path, before + block + after, "utf8");

console.log("Restored clean backup and patched BUY Discord sending safely.");
