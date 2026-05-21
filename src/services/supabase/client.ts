import type { Db } from "../../db/client.js";
import { getPool } from "../../db/client.js";

export type VerioraDb = Db;

export function getVerioraDb(): VerioraDb {
  return getPool();
}
