import fs from "fs";

export function firstExistingPath(paths) {
  return paths.find((path) => fs.existsSync(path)) || paths[0];
}

export function readJsonFromFirstExisting(paths, fallback = null) {
  const path = firstExistingPath(paths);

  if (!fs.existsSync(path)) {
    if (fallback !== null) return fallback;
    throw new Error(`Missing JSON file. Tried: ${paths.join(", ")}`);
  }

  return JSON.parse(fs.readFileSync(path, "utf8"));
}
