const fs = require("fs");

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function patchPackageJson() {
  const path = "package.json";
  const pkg = readJson(path, null);
  if (!pkg) throw new Error("package.json not found");

  pkg.scripts ||= {};
  pkg.scripts["promote-discovery"] ||= "node promote-discovery.mjs";

  writeJson(path, pkg);
}

function patchBat() {
  const path = "trade-manager.bat";
  if (!fs.existsSync(path)) return;

  let bat = fs.readFileSync(path, "utf8");

  if (!bat.includes("Discovery Promotion")) {
    bat = bat.replace(
      /echo\s+18\.?\s+Relist \/ Update Listing\s*\r?\necho\s+19\.?\s+Exit/i,
      "echo 18. Relist / Update Listing\r\necho 19. Discovery Promotion\r\necho 20. Exit"
    );

    if (!/echo\s+19\.?\s+Discovery Promotion/i.test(bat)) {
      bat = bat.replace(
        /echo\s+18\.?\s+Relist \/ Update Listing\s*$/im,
        "echo 18. Relist / Update Listing\r\necho 19. Discovery Promotion\r\necho 20. Exit"
      );
    }

    let exitTarget = "exit";
    const route19 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"19"\s+goto\s+([^\s\r\n]+)/im);
    if (route19 && route19[1].toLowerCase() !== "promotion") {
      exitTarget = route19[1];
    }

    bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"19"\s+goto\s+[^\r\n]+\r?\n?/gim, "");
    bat = bat.replace(/^\s*if\s+"%choice%"\s*==\s*"20"\s+goto\s+[^\r\n]+\r?\n?/gim, "");

    const route18 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"18"\s+goto\s+relist\s*$/im);

    if (route18) {
      const insertAt = route18.index + route18[0].length;
      bat =
        bat.slice(0, insertAt) +
        `\r\nif "%choice%"=="19" goto promotion\r\nif "%choice%"=="20" goto ${exitTarget}` +
        bat.slice(insertAt);
    } else {
      const route17 = bat.match(/^\s*if\s+"%choice%"\s*==\s*"17"\s+goto\s+dashboard\s*$/im);
      if (!route17) throw new Error("Could not find BAT route 17/18 area.");

      const insertAt = route17.index + route17[0].length;
      bat =
        bat.slice(0, insertAt) +
        `\r\nif "%choice%"=="19" goto promotion\r\nif "%choice%"=="20" goto ${exitTarget}` +
        bat.slice(insertAt);
    }

    if (!bat.includes(":promotion")) {
      const block = `

:promotion
cls
echo DISCOVERY PROMOTION
echo.
echo Promote stable Discovery candidates into tracked-items.json.
echo.
call npm run promote-discovery
echo.
echo Finished. Press any key to return to menu.
pause >nul
goto menu
`;

      if (bat.includes(":relist")) {
        bat = bat.replace(/\r?\n:relist/i, block + "\r\n:relist");
      } else if (bat.includes(":dashboard")) {
        bat = bat.replace(/\r?\n:dashboard/i, block + "\r\n:dashboard");
      } else {
        bat += block;
      }
    }
  }

  fs.writeFileSync(path, bat, "utf8");
}

const promoteScript = String.raw`
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { addTrackedItem } from "./lib/trackedItemsWriter.js";

function formatGp(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function getTrackedPath() {
  if (fs.existsSync("./data/tracked-items.json")) return "./data/tracked-items.json";
  return "./tracked-items.json";
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
}

function getAlreadyTrackedIds() {
  const tracked = readJson(getTrackedPath(), {});

  return new Set(
    uniqueNumbers([
      ...(tracked.core || []),
      ...(tracked.watch || []),
      ...(tracked.scanner?.safe || []),
      ...(tracked.scanner?.watch || []),
      ...(tracked.scanner?.experimental || []),
    ]).map(String),
  );
}

function getPromotableCandidates() {
  const state = readJson("./state.json", {});
  const history = state.discovery?.history || {};
  const alreadyTracked = getAlreadyTrackedIds();

  const minGoodSnapshots = Number(process.env.DISCOVERY_PROMOTE_MIN_GOOD || 2);
  const minAvgProfit = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_PROFIT || 1000);
  const minAvgRoi = Number(process.env.DISCOVERY_PROMOTE_MIN_AVG_ROI || 5);

  return Object.values(history)
    .filter((entry) => entry && entry.id)
    .filter((entry) => !alreadyTracked.has(String(entry.id)))
    .filter((entry) => String(entry.stability || "").toUpperCase() !== "DEAD")
    .filter((entry) => Number(entry.goodSnapshots || 0) >= minGoodSnapshots)
    .filter((entry) => Number(entry.avgNetProfit || 0) >= minAvgProfit)
    .filter((entry) => Number(entry.avgRoi || 0) >= minAvgRoi)
    .map((entry) => {
      const good = Number(entry.goodSnapshots || 0);
      const scans = Number(entry.scans || 0);
      const avgProfit = Number(entry.avgNetProfit || 0);
      const avgRoi = Number(entry.avgRoi || 0);
      const stability = String(entry.stability || "UNKNOWN");

      let section = "experimental";

      if (
        stability === "STABLE" &&
        good >= 4 &&
        avgProfit >= 3000 &&
        avgRoi >= 7
      ) {
        section = "watch";
      }

      if (
        stability === "STABLE" &&
        good >= 6 &&
        avgProfit >= 6000 &&
        avgRoi >= 9
      ) {
        section = "safe";
      }

      const score =
        good * 25 +
        scans * 2 +
        Math.min(avgProfit / 200, 50) +
        Math.min(avgRoi * 3, 45) +
        (stability === "STABLE" ? 35 : 0) -
        Number(entry.badSnapshots || 0) * 10;

      return {
        ...entry,
        good,
        scans,
        avgProfit,
        avgRoi,
        stability,
        section,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function printCandidate(candidate, index) {
  console.log(
    "#" + (index + 1) + " " + candidate.name + " (" + candidate.id + ")\n" +
      "Suggested bucket: " + candidate.section + "\n" +
      "Stability: " + candidate.stability +
      " | good: " + candidate.goodSnapshots +
      "/" + candidate.scans +
      " | bad: " + Number(candidate.badSnapshots || 0) + "\n" +
      "Avg profit: ~" + formatGp(candidate.avgProfit) + " gp" +
      " | Avg ROI: " + candidate.avgRoi.toFixed(2) + "%\n" +
      "Last seen: " + (candidate.lastSeenAt || "unknown") + "\n",
  );
}

function parseSelection(answer, max) {
  const cleaned = String(answer || "").trim().toLowerCase();

  if (!cleaned) return [];
  if (cleaned === "all") return Array.from({ length: max }, (_, i) => i);

  return [
    ...new Set(
      cleaned
        .split(/[,\s]+/)
        .map((part) => Number(part) - 1)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < max),
    ),
  ];
}

async function main() {
  const candidates = getPromotableCandidates();

  console.log("\nDISCOVERY PROMOTION\n");

  if (candidates.length === 0) {
    console.log("No promotion-ready Discovery candidates yet.");
    console.log("");
    console.log("This is normal if Discovery has not seen the same good item enough times.");
    console.log("Run Discovery a few more times, then come back here.");
    console.log("");
    console.log("Current thresholds:");
    console.log("- min good snapshots:", process.env.DISCOVERY_PROMOTE_MIN_GOOD || 2);
    console.log("- min avg profit:", process.env.DISCOVERY_PROMOTE_MIN_AVG_PROFIT || 1000);
    console.log("- min avg ROI:", process.env.DISCOVERY_PROMOTE_MIN_AVG_ROI || 5);
    return;
  }

  candidates.slice(0, 20).forEach(printCandidate);

  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      "Choose numbers to promote, comma-separated, 'all', or Enter to cancel: ",
    );

    const indexes = parseSelection(answer, Math.min(candidates.length, 20));

    if (indexes.length === 0) {
      console.log("\nCancelled. Nothing changed.");
      return;
    }

    console.log("\nYou selected:\n");

    for (const index of indexes) {
      const candidate = candidates[index];
      console.log(
        "- " +
          candidate.name +
          " (" +
          candidate.id +
          ") → " +
          candidate.section,
      );
    }

    const confirm = await rl.question("\nAdd these to tracked-items.json? Y/N: ");

    if (String(confirm).trim().toLowerCase() !== "y") {
      console.log("\nCancelled. Nothing changed.");
      return;
    }

    console.log("");

    for (const index of indexes) {
      const candidate = candidates[index];
      const result = addTrackedItem(candidate.id, candidate.section);

      if (result.added) {
        console.log(
          "Added " +
            candidate.name +
            " (" +
            candidate.id +
            ") to " +
            result.section +
            " in " +
            result.filePath,
        );
      } else {
        console.log(
          "Skipped " +
            candidate.name +
            " (" +
            candidate.id +
            "): " +
            result.reason,
        );
      }
    }

    console.log("\nDone. Review tracked-items.json, then commit + push.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Discovery promotion failed:", error);
  process.exit(1);
});
`;

fs.writeFileSync("promote-discovery.mjs", promoteScript, "utf8");

patchPackageJson();
patchBat();

console.log("Discovery Promotion installed.");
console.log("Added:");
console.log("- promote-discovery.mjs");
console.log("- npm run promote-discovery");
console.log("- BAT option 19 Discovery Promotion");
