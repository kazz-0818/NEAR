import { JWT } from "google-auth-library";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { getEnv } from "../config/env.js";

let saJwt: JWT | null = null;
let sheetsClient: sheets_v4.Sheets | null = null;
let driveClient: drive_v3.Drive | null = null;

const SA_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;

function serviceAccountJwtOrThrow(): JWT {
  if (saJwt) return saJwt;
  const j = parseServiceAccountJson();
  if (!j?.client_email || !j.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing or invalid");
  }
  saJwt = new JWT({
    email: String(j.client_email),
    key: String(j.private_key),
    scopes: [...SA_SCOPES],
  });
  return saJwt;
}

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

/** Google Sheets API v4 クライアント（読み取り専用 + Drive メタデータは同一 SA JWT） */
export async function getSheetsAPI(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;
  const auth = serviceAccountJwtOrThrow();
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

/** Drive API v3（スプレッドシートの files.list 用。メタデータ readonly） */
export async function getDriveAPI(): Promise<drive_v3.Drive> {
  if (driveClient) return driveClient;
  const auth = serviceAccountJwtOrThrow();
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

/** intent の `spreadsheet_id` や環境変数の生 ID 用（Sheets API のブック ID 形式の最低限チェック） */
export function isValidSpreadsheetId(id: string): boolean {
  return /^[a-zA-Z0-9-_]{20,}$/.test(id.trim());
}

/**
 * docs.google.com/.../spreadsheets/d/<id>/… から ID を取り出す。
 * LINE 貼り付けのゼロ幅文字・改行・全半角ゆれを吸収する。
 */
export function extractSpreadsheetIdFromText(text: string): string | null {
  const cleaned = text
    .normalize("NFKC")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m =
    cleaned.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ??
    cleaned.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  const id = m?.[1];
  return id && isValidSpreadsheetId(id) ? id : null;
}

export function spreadsheetIdFromIntentParams(
  requiredParams: Record<string, unknown> | undefined
): string | null {
  const p = requiredParams?.spreadsheet_id;
  return typeof p === "string" && isValidSpreadsheetId(p) ? p.trim() : null;
}
