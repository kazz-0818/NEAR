/**
 * LIRA_ICON 由来の画像からバッジ（LIRA 表記）が見えないよう顔〜肩中心にクロップ。
 * 正式な IRIE_ICON.png が用意できたら AI_ICON から public/icons へ上書きし、本スクリプトは不要。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "public", "icons");
const source =
  process.argv[2] ??
  path.join(process.env.HOME ?? "", "Downloads", "AI_ICON", "LIRA_ICON.png");
const output = path.join(iconsDir, "IRIE_ICON.png");

const buf = await sharp(source)
  .extract({ left: 80, top: 40, width: 1090, height: 820 })
  .resize(1254, 1254, { fit: "cover", position: "top" })
  .png()
  .toBuffer();

await fs.writeFile(output, buf);

await sharp(buf)
  .resize(512, 512, { fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82 })
  .toFile(path.join(iconsDir, "IRIE_ICON.webp"));

console.log("cropped IRIE_ICON.png + IRIE_ICON.webp from", source);
