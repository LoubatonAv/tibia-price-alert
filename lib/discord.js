import axios from "axios";

export async function sendDiscordErrorAlert(err) {
  const message = err?.stack || err?.message || String(err);

  try {
    if (!process.env.ERROR_WEBHOOK_URL) {
      console.error("Missing ERROR_WEBHOOK_URL");
      return;
    }

    await axios.post(process.env.ERROR_WEBHOOK_URL, {
      content: `🚨 **Tibia Flipper crashed**\n\n\`\`\`${message.slice(
        0,
        1800,
      )}\`\`\``,
    });

    console.log("Discord error alert sent.");
  } catch (discordErr) {
    console.error("Failed to send Discord error alert:", discordErr);
  }
}
