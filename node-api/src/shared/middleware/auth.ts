/**
 * src/shared/middleware/auth.ts
 *
 * JWT authentication middleware and verification utilities.
 *
 * Exports:
 *   authMiddleware  — Hono middleware for protected routes
 *   verifyToken     — standalone verification for use outside middleware
 *                     (e.g. SSE handlers where EventSource can't set headers)
 */

import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import jwt from "jsonwebtoken";
import type { AccessTokenPayload, HonoVariables } from "../types.js";

const ACCESS_TOKEN_COOKIE = "access_token";

// ── Shared verification logic ─────────────────────────────────────────────────

/**
 * Verifies a JWT access token string against JWT_SECRET.
 *
 * Returns the decoded payload on success.
 * Returns null on any failure (missing secret, expired, invalid signature).
 *
 * This is the single place where token verification logic lives.
 * Both authMiddleware and any handler that needs manual auth call this.
 */
export function verifyToken(token: string): AccessTokenPayload | null {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error("FATAL: JWT_SECRET environment variable is not set");
    return null;
  }

  try {
    return jwt.verify(token, secret) as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Reads the access token cookie from a Hono context.
 * Returns null if the cookie is missing.
 */
export function getTokenFromContext(c: Parameters<MiddlewareHandler>[0]): string | null {
  return getCookie(c, ACCESS_TOKEN_COOKIE) ?? null;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Hono middleware that verifies the JWT access token on every protected request.
 *
 * On success: attaches decoded payload to c.set("user", payload)
 * On failure: returns 401 and stops the chain
 *
 * Mounted once in index.ts on "/api/*".
 * Never runs on public routes like /api/auth/login.
 */
export const authMiddleware: MiddlewareHandler<{
  Variables: HonoVariables;
}> = async (c, next) => {
  const token = getTokenFromContext(c);

  if (!token) {
    return c.json({ success: false, error: "Unauthorized — no token" }, 401);
  }

  const payload = verifyToken(token);

  if (!payload) {
    return c.json({ success: false, error: "Unauthorized — invalid or expired token" }, 401);
  }

  c.set("user", payload);
  await next();
};