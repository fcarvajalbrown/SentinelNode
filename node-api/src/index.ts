/**
 * src/index.ts
 *
 * Entry point for the SentinelNode API.
 *
 * Responsibilities:
 *   - Boot the Hono app
 *   - Register all module routes
 *   - Attach shared middleware (auth, error handling)
 *   - Start the HTTP server on the configured port
 *
 * Nothing else belongs here. Business logic lives in modules.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { scannerRoutes } from "./modules/scanner/scanner.routes.js";
import { networkRoutes } from "./modules/network/network.routes.js";
import { authMiddleware } from "./shared/middleware/auth.js";

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── Global middleware ─────────────────────────────────────────────────────────

/**
 * Simple request logger.
 * In production you would replace this with a structured logger like pino.
 */
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} - ${ms}ms`);
});

// ── Public routes (no auth required) ─────────────────────────────────────────

app.route("/api/auth", authRoutes);

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * Used by Docker to verify the container is alive.
 * Returns 200 with a simple JSON payload.
 */
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Protected routes (JWT required) ──────────────────────────────────────────

/**
 * All routes below this middleware require a valid JWT.
 * authMiddleware reads the HTTP-only cookie, verifies the token,
 * and attaches the decoded payload to the context.
 */
app.use("/api/*", authMiddleware);

app.route("/api/scanner", scannerRoutes);
app.route("/api/network", networkRoutes);

// ── Global error handler ──────────────────────────────────────────────────────

/**
 * Catches any unhandled errors thrown inside route handlers.
 * Returns a consistent JSON error shape instead of leaking stack traces.
 */
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    { error: "Internal server error", message: err.message },
    500
  );
});

// ── 404 handler ───────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: "Not found", path: c.req.path }, 404);
});

// ── Static files (React frontend) ────────────────────────────────────────────

/**
 * Serve the compiled React app for any route that is not an API route.
 * In production the frontend is built to frontend/dist/ by the Dockerfile.
 * The wildcard /* must come LAST — after all API routes.
 */
app.use("/*", serveStatic({ root: "./frontend/dist" }));
app.get("/*", serveStatic({ path: "./frontend/dist/index.html" }));

// ── Server ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`SentinelNode API running on http://localhost:${info.port}`);
  }
);