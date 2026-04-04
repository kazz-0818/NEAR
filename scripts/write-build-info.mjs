import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const builtAt = new Date().toISOString();
writeFileSync(join(dist, "build-info.json"), JSON.stringify({ builtAt }, null, 0), "utf-8");
console.log("build-info.json", builtAt);
