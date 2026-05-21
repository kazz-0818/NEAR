import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "public", "icons");

const files = await fs.readdir(iconsDir);
const pngs = files.filter((f) => f.endsWith(".png"));

for (const name of pngs) {
  const input = path.join(iconsDir, name);
  const output = path.join(iconsDir, name.replace(/\.png$/i, ".webp"));
  await sharp(input)
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output);
  console.log(`optimized: ${name} -> ${path.basename(output)}`);
}

console.log(`done (${pngs.length} icons)`);
