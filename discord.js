async function sendDiscordAlert(message) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    console.error("Missing DISCORD_WEBHOOK_URL");
    return;
  }

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: message,
      }),
    });
  } catch (err) {
    console.error("Failed to send Discord alert:", err.message);
  }
}

module.exports = { sendDiscordAlert };
