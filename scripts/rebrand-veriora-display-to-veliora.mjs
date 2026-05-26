/**
 * 表示名・ドキュメント・TS 識別子の Veriora → Veliora。
 * Postgres スキーマ名 `veriora` / env `VERIORA_*` / 適用済み migration ファイル名は変更しない。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".git",
  "site/dist",
  ".cursor",
  "coverage",
]);

const EXT = new Set([".md", ".ts", ".tsx", ".py", ".html", ".yml", ".yaml", ".json", ".mjs"]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

function transform(content) {
  let s = content;
  s = s.replaceAll("Veriora", "Veliora");
  s = s.replaceAll("VERIORA_AGENT_DEFINITIONS", "VELIORA_AGENT_DEFINITIONS");
  s = s.replaceAll("VerioraAgentRow", "VelioraAgentRow");
  s = s.replaceAll("VerioraDb", "VelioraDb");
  s = s.replaceAll("getVerioraAgentByCode", "getVelioraAgentByCode");
  s = s.replaceAll("getVerioraAgentByKey", "getVelioraAgentByKey");
  s = s.replaceAll("getVerioraAgentById", "getVelioraAgentById");
  s = s.replaceAll("getVerioraDb", "getVelioraDb");
  s = s.replaceAll("recordVerioraHandoffHint", "recordVelioraHandoffHint");
  return s;
}

const files = await walk(root);
let n = 0;
for (const file of files) {
  if (file.includes(`${path.sep}scripts${path.sep}rebrand-veriora-display-to-veliora.mjs`)) continue;
  const raw = await fs.readFile(file, "utf8");
  const next = transform(raw);
  if (next !== raw) {
    await fs.writeFile(file, next);
    n++;
  }
}
console.log(`updated ${n} files under ${root}`);
