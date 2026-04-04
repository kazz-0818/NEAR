import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");

export async function loadPrompt(relativeFromProjectRoot: string): Promise<string> {
  const path = join(projectRoot, relativeFromProjectRoot);
  return readFile(path, "utf-8");
}
