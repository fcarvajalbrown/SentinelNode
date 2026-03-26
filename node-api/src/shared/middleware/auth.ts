/**
 * src/shared/middleware/auth.ts
 *
 * JWT authentication middleware for Hono.
 *
 * Responsibilities:
 *   - Read the access token from the HTTP-only cookie
 *   - Verify the token signature using JWT_SECRET
 *   - Attach the decoded payload to Hono context as "user"
 *   - Reject requests with missing or invalid tokens with 401
 *
 * This middleware is mounted once in index.ts on "/api/*".
 * It never runs on public routes like /api/auth/login.
 */

import { type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import jwt from "jsonwebtoken";
import type { AccessTokenPayload, HonoVariables } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_COOKIE = "access_token";

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Verifies the JWT access token from the HTTP-only cookie.
 *
 * On success: attaches decoded payload to c.set("user", payload)
 * On failure: returns 401 JSON response and stops the chain
 */
export const authMiddleware: MiddlewareHandler<{
  Variables: HonoVariables;
}> = async (c, next) => {
  // Read the token from the HTTP-only cookie.
  // HTTP-only means JavaScript on the page cannot access this cookie —
  // only the server can read it. This prevents XSS token theft.
  const token = getCookie(c, ACCESS_TOKEN_COOKIE);

  if (!token) {
    return c.json({ success: false, error: "Unauthorized — no token" }, 401);
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // This should never happen in a correctly configured environment.
    // If JWT_SECRET is missing, fail loudly rather than silently.
    console.error("FATAL: JWT_SECRET environment variable is not set");
    return c.json({ success: false, error: "Server misconfiguration" }, 500);
  }

  try {
    // jwt.verify throws if the token is expired, malformed, or the
    // signature doesn't match the secret. We never reach the catch
    // block on a valid token.
    const payload = jwt.verify(token, secret) as AccessTokenPayload;

    // Attach the decoded payload to the context so route handlers
    // can access the current user without re-decoding the token.
    c.set("user", payload);

    // Pass control to the next middleware or route handler.
    await next();
  } catch (err) {
    // jwt.verify throws JsonWebTokenError, TokenExpiredError, or
    // NotBeforeError. We catch all of them and return 401.
    if (err instanceof jwt.TokenExpiredError) {
      return c.json({ success: false, error: "Unauthorized — token expired" }, 401);
    }

    return c.json({ success: false, error: "Unauthorized — invalid token" }, 401);
  }
};