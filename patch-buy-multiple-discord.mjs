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

const before = text.slice(0, start);
let block = text.slice(start, end);
const after = text.slice(end);

// Bring back up to 5 BUY alerts
block = block.replace(
  "const embeds = alertable.slice(0, 1).map((item) => {",
  "const embeds = alertable.slice(0, 5).map((item) => {"
);

// Also handle if the old/original version is there
block = block.replace(
  "const embeds = alertable.slice(0, 5).map((item) => {",
  "const embeds = alertable.slice(0, 5).map((item) => {"
);

// Keep accept command under Discord field limit
block = block.replace(
  "value: getAcceptBuyDiscordValue(item),",
  "value: String(getAcceptBuyDiscordValue(item)).slice(0, 900),"
);

// Replace current BUY send block with per-embed sending
const patterns = [
`  const buyPayload = {
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
`,
`  await axios.post(DISCORD_WEBHOOK_URL, {
    content: \`🟢 Tibia Flipper BUY signals on **\${SERVER}** (\${alertable.length} alert\${alertable.length === 1 ? "" : "s"})\`,
    embeds,
  });
`
];

const replacement = `  const visibleAlertCount = embeds.length;
  const hiddenAlertCount = Math.max(0, alertable.length - visibleAlertCount);

  for (let i = 0; i < embeds.length; i++) {
    const buyPayload = {
      content:
        i === 0
          ? \`🟢 Tibia Flipper BUY signals on **\${SERVER}** (\${alertable.length} alert\${alertable.length === 1 ? "" : "s"})\${hiddenAlertCount ? \` — showing top \${visibleAlertCount}, hidden \${hiddenAlertCount}\` : ""}\`
          : \`🟢 BUY signal \${i + 1}/\${visibleAlertCount} on **\${SERVER}**\`,
      embeds: [embeds[i]],
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
  }
`;

let replaced = false;
for (const pattern of patterns) {
  if (block.includes(pattern)) {
    block = block.replace(pattern, replacement);
    replaced = true;
    break;
  }
}

if (!replaced) {
  throw new Error("Could not find current BUY Discord send block.");
}

fs.writeFileSync(path, before + block + after, "utf8");

console.log("Patched BUY Discord alerts: up to 5 items, sent one embed per webhook message.");
