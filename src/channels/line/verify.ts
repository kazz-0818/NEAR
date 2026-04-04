import crypto from "node:crypto";
import { getEnv } from "../../config/env.js";
import { LineSignatureError } from "../../lib/errors.js";

export function verifyLineSignature(rawBody: string, signature: string | undefined): void {
  if (!signature) throw new LineSignatureError("Missing X-Line-Signature");
  const secret = getEnv().LINE_CHANNEL_SECRET;
  const hash = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  if (hash !== signature) {
    throw new LineSignatureError();
  }
}
