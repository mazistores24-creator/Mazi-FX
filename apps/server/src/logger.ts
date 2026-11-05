import pino from "pino";

/** Field paths that must never reach log output. */
export const REDACT_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "*.accessToken",
  "*.refreshToken",
  "authorization",
  "headers.authorization",
  "req.headers.authorization",
  "DERIV_TOKEN",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "TELEGRAM_BOT_TOKEN",
];

export function createLogger(level: string) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    base: { service: "mazzi-server" },
  });
}

export type Logger = ReturnType<typeof createLogger>;
