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

export function getColor(brainScore) {
  if (brainScore >= 85) {
    return 0x00ff00;
  }

  if (brainScore >= 70) {
    return 0xffff00;
  }

  return 0xff9900;
}

export function getSellColor(level) {
  if (level === "PANIC") return 0xff0000; // אדום = סכנה
  if (level === "SELL_NOW") return 0x00ff00; // ירוק = target hit / רווח
  if (level === "TAKE_PROFIT") return 0xffff00; // צהוב = כדאי לשקול
  return 0xff9900; // כתום = warning
}

export function getScannerColor(tier) {
  if (tier === "SAFE") {
    return 0x00ff00;
  }

  if (tier === "WATCH") {
    return 0xffff00;
  }

  if (tier === "SPECULATIVE") {
    return 0xff9900;
  }

  return 0xff0000;
}
