import { z } from "zod";
import { PROTECTED_STRATEGY, OPERATING_MODES, assertProtectedZone, isOperatingMode } from "@mazzi/core";
import type { OperatingMode } from "@mazzi/core";

const secret = z.string().min(32, "must be at least 32 characters");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().url().optional(),
    JWT_ACCESS_SECRET: secret.optional(),
    JWT_REFRESH_SECRET: secret.optional(),
    DERIV_APP_ID: z.string().regex(/^\d*$/, "must be numeric").default(""),
    DERIV_TOKEN: z.string().optional(),
    DERIV_WS_ENDPOINT: z.string().default("wss://ws.derivws.com/websockets/v3"),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_OWNER_CHAT_ID: z.string().optional(),
    TRADING_MODE: z.string().default("ALERT_ONLY"),
    FIB_ZONE_LOWER: z.coerce.number().default(0.5),
    FIB_ZONE_UPPER: z.coerce.number().default(0.618),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (!env.DATABASE_URL) ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "required in production" });
      if (!env.JWT_ACCESS_SECRET) ctx.addIssue({ code: "custom", path: ["JWT_ACCESS_SECRET"], message: "required in production" });
      if (!env.JWT_REFRESH_SECRET) ctx.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "required in production" });
    }
    if (!isOperatingMode(env.TRADING_MODE)) {
      ctx.addIssue({ code: "custom", path: ["TRADING_MODE"], message: `must be one of ${OPERATING_MODES.join(", ")}` });
    }
  });

export interface AppConfig {
  readonly env: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string | undefined;
  readonly jwtAccessSecret: string;
  readonly jwtRefreshSecret: string;
  readonly deriv: { appId: string; token: string | undefined; endpoint: string };
  readonly telegram: { botToken: string | undefined; ownerChatId: string | undefined };
  readonly tradingMode: OperatingMode;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validates environment into AppConfig. Throws ConfigError on any problem,
 * including a changed protected baseline zone or AUTOMATED mode in this build.
 */
export function loadConfig(raw: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new ConfigError(`invalid configuration: ${detail}`);
  }
  const env = parsed.data;

  try {
    assertProtectedZone(env.FIB_ZONE_LOWER, env.FIB_ZONE_UPPER);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }

  const mode = env.TRADING_MODE as OperatingMode;
  if (mode === "AUTOMATED") {
    throw new ConfigError("AUTOMATED mode is not enabled in this build");
  }

  // Development fallbacks: random-free but clearly non-production so local runs work.
  // Production never reaches these because the schema requires the secrets.
  const devAccess = "dev-only-access-secret-change-me-0000";
  const devRefresh = "dev-only-refresh-secret-change-me-0000";

  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    jwtAccessSecret: env.JWT_ACCESS_SECRET ?? devAccess,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET ?? devRefresh,
    deriv: { appId: env.DERIV_APP_ID, token: env.DERIV_TOKEN, endpoint: env.DERIV_WS_ENDPOINT },
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN, ownerChatId: env.TELEGRAM_OWNER_CHAT_ID },
    tradingMode: mode,
  };
}

export const PROTECTED_ZONE_FOR_DISPLAY = PROTECTED_STRATEGY.fibZone;
