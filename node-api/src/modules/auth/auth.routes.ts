/**
 * src/modules/auth/auth.routes.ts
 *
 * Authentication routes for SentinelNode.
 *
 * Endpoints:
 *   POST /api/auth/login    — validate credentials, issue token pair
 *   POST /api/auth/logout   — clear both cookies
 *   POST /api/auth/refresh  — exchange refresh token for new access token
 *
 * Security decisions:
 *   - Tokens are stored in HTTP-only, Secure, SameSite=Strict cookies.
 *     Never in localStorage or response bodies.
 *   - Access token expires in 15 minutes.
 *   - Refresh token expires in 7 days.
 *   - Two separate secrets sign each token type so a leaked access
 *     token cannot be used to forge a refresh token.
 *
 * MVP note:
 *   Credentials are hardcoded via environment variables for now.
 *   A real implementation would query a users table in SQLite.
 */

import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import jwt from "jsonwebtoken";
import type { HonoVariables, AccessTokenPayload, RefreshTokenPayload } from "../../shared/types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY  = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const ACCESS_COOKIE        = "access_token";
const REFRESH_COOKIE       = "refresh_token";

/** Shared cookie options — HTTP-only and Strict prevent XSS and CSRF. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict" as const,
  path: "/",
};

// ── Router ────────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: HonoVariables }>();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * Zod schema for the login request body.
 * zValidator runs this before the handler — invalid bodies never reach it.
 */
const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Issues a signed JWT access token for the given user.
 *
 * @param userId - The user's unique identifier
 * @param email  - The user's email address
 * @returns Signed JWT string
 */
function issueAccessToken(userId: string, email: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  return jwt.sign(
    { sub: userId, email },
    secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Issues a signed JWT refresh token for the given user.
 *
 * @param userId - The user's unique identifier
 * @returns Signed JWT string
 */
function issueRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not set");

  return jwt.sign(
    { sub: userId },
    secret,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 *
 * Validates credentials and sets both token cookies.
 * Returns 200 on success, 401 on bad credentials.
 */
app.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  // ── MVP: hardcoded credentials from environment variables ───────────────
  // Replace this block with a SQLite query when adding multi-user support.
  const adminEmail    = process.env.ADMIN_EMAIL    ?? "admin@sentinel.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme";

  if (email !== adminEmail || password !== adminPassword) {
    // Use a generic message — never reveal which field was wrong.
    return c.json({ success: false, error: "Invalid credentials" }, 401);
  }

  const userId = "admin";

  const accessToken  = issueAccessToken(userId, email);
  const refreshToken = issueRefreshToken(userId);

  // Set both tokens as HTTP-only cookies.
  // The browser will send them automatically on every subsequent request.
  setCookie(c, ACCESS_COOKIE,  accessToken,  COOKIE_OPTIONS);
  setCookie(c, REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);

  return c.json({ success: true, data: { email } });
});

/**
 * POST /api/auth/logout
 *
 * Clears both token cookies.
 * Always returns 200 — even if the user wasn't logged in.
 */
app.post("/logout", (c) => {
  deleteCookie(c, ACCESS_COOKIE,  { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/" });

  return c.json({ success: true, data: null });
});

/**
 * POST /api/auth/refresh
 *
 * Verifies the refresh token cookie and issues a new access token.
 * Returns 401 if the refresh token is missing, expired, or invalid.
 */
app.post("/refresh", (c) => {
  const token = getCookie(c, REFRESH_COOKIE);

  if (!token) {
    return c.json({ success: false, error: "No refresh token" }, 401);
  }

  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    return c.json({ success: false, error: "Server misconfiguration" }, 500);
  }

  try {
    const payload = jwt.verify(token, secret) as RefreshTokenPayload;
    const newAccessToken = issueAccessToken(payload.sub, "admin@sentinel.local");

    setCookie(c, ACCESS_COOKIE, newAccessToken, COOKIE_OPTIONS);

    return c.json({ success: true, data: { refreshed: true } });
  } catch {
    return c.json({ success: false, error: "Invalid or expired refresh token" }, 401);
  }
});


/**
 * GET /api/auth/me
 *
 * Returns 200 if the access token cookie is valid, 401 if not.
 * Called by App.tsx on startup to check if the user is already logged in.
 */

/**
 * GET /api/auth/me
 *
 * Returns 200 if the access token cookie is valid, 401 if not.
 * Called by App.tsx on startup to check if the user is already logged in.
 * Auth is handled by the global authMiddleware in index.ts.
 */
app.get("/me", (c) => {
  const token = getCookie(c, "access_token");
  if (!token) return c.json({ success: false, error: "Unauthorized" }, 401);

  const secret = process.env.JWT_SECRET;
  if (!secret) return c.json({ success: false, error: "Server misconfiguration" }, 500);

  try {
    const payload = jwt.verify(token, secret) as AccessTokenPayload;
    return c.json({ success: true, data: { email: payload.email } });
  } catch {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
});

export { app as authRoutes };