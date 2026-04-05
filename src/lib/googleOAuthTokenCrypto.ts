import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "near-google-oauth-v1";

/** AES-256-GCM。平文 refresh_token を DB 保存用に暗号化 */
export function encryptRefreshToken(plain: string, secret: string): string {
  const key = scryptSync(secret, SALT, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptRefreshToken(ciphertext: string, secret: string): string {
  const buf = Buffer.from(ciphertext, "base64url");
  if (buf.length < 28) throw new Error("invalid ciphertext");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = scryptSync(secret, SALT, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
