import fs from "fs";

export function readJsonFromFirstExisting(paths, fallback = {}) {
  const filePath = paths.find((path) => fs.existsSync(path));
  if (!filePath) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
