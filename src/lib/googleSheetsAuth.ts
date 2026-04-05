import { JWT } from "google-auth-library";
import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { getEnv } from "../config/env.js";

let sheetsClient: sheets_v4.Sheets | null = null;

export function googleSheetsConfigured(): boolean {
  const env = getEnv();
  return !!(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || env.GOOGLE_SERVICE_ACCOUNT_JSON_B64?.trim());
}

export function parseServiceAccountJson(): Record<string, unknown> | null {
  const env = getEnv();
  const b64 = env.GOOGLE_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (b64) {
    try {
      const raw = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const rawJson = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      return JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function getServiceAccountClientEmail(): string | null {
  const j = parseServiceAccountJson();
  const email = j?.client_email;
  return typeof email === "string" ? email : null;
}

/** Google Sheets API v4 クライアント（読み取り専用スコープ） */
export async function getSheetsAPI(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;
  const j = parseServiceAccountJson();
  if (!j?.client_email || !j.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing or invalid");
  }
  const auth = new JWT({
    email: String(j.client_email),
    key: String(j.private_key),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

/** docs.google.com/spreadsheets/d/<id>/… から ID を取り出す */
export function extractSpreadsheetIdFromText(text: string): string | null {
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}
