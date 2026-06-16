const fs = require("fs");

const path = "check-flips.js";
let text = fs.readFileSync(path, "utf8");

const replacement = String.raw`
function getAcceptBuyDiscordValue(item) {
  const command = getAcceptBuyCommand(item);
  const projectPath =
    process.env.ACCEPT_BUY_PROJECT_PATH ||
    "C:\\Users\\Avner\\Desktop\\Projects\\tibia-price-alert";

  return (
    "After you actually place this Buy Offer in Tibia Market, paste this in PowerShell/CMD:\\n" +
    "\`\`\`powershell\\n" +
    "cd " + quotePowerShellArg(projectPath) + "\\n" +
    command +
    "\\n\`\`\`\\n" +
    "**Do not run it before placing the offer in Tibia.**"
  );
}
`;

if (!/function getAcceptBuyDiscordValue\(item\)/.test(text)) {
  throw new Error("getAcceptBuyDiscordValue not found");
}

text = text.replace(
  /function getAcceptBuyDiscordValue\(item\) \{[\s\S]*?\n\}/,
  replacement.trim()
);

fs.writeFileSync(path, text, "utf8");
console.log("Fixed Discord accept-buy command formatting.");
