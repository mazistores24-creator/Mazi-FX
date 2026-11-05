import argon2 from "argon2";
import jwt from "jsonwebtoken";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenClaims {
  sub: string;
  type: "access" | "refresh";
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function issueTokens(userId: string, accessSecret: string, refreshSecret: string): TokenPair {
  const accessToken = jwt.sign({ sub: userId, type: "access" }, accessSecret, {
    algorithm: "HS256",
    expiresIn: ACCESS_TTL_SECONDS,
  });
  const refreshToken = jwt.sign({ sub: userId, type: "refresh" }, refreshSecret, {
    algorithm: "HS256",
    expiresIn: REFRESH_TTL_SECONDS,
  });
  return { accessToken, refreshToken };
}

/** Verifies a token of the expected type. Returns the subject or undefined. */
export function verifyToken(token: string, secret: string, expected: "access" | "refresh"): string | undefined {
  try {
    const claims = jwt.verify(token, secret, { algorithms: ["HS256"] }) as TokenClaims;
    if (claims.type !== expected || typeof claims.sub !== "string") return undefined;
    return claims.sub;
  } catch {
    return undefined;
  }
}
