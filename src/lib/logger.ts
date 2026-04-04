import pino from "pino";
import { getEnv } from "../config/env.js";

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) return logger;
  const env = getEnv();
  logger = pino({
    level: env.NODE_ENV === "production" ? "info" : "debug",
  });
  return logger;
}
