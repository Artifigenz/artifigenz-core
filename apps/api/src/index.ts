import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { bootstrapAgents } from "./bootstrap";
import { Scheduler } from "./platform/scheduling/scheduler";
import { createSkillWorker } from "./platform/scheduling/workers/skill-worker";
import { createSyncWorker } from "./platform/scheduling/workers/sync-worker";
import { createDeliveryWorker } from "./platform/scheduling/workers/delivery-worker";

// Routes
import userRoutes from "./routes/user.routes";
import { createAgentRoutes } from "./routes/agents.routes";
import insightRoutes from "./routes/insights.routes";
import { createDataSourceRoutes } from "./routes/data-sources.routes";
import deliveryRoutes from "./routes/delivery.routes";
import webhookRoutes from "./routes/webhooks.routes";
import chatRoutes from "./routes/chat.routes";

// ─── Bootstrap ──────────────────────────────────────────────────────

const registry = bootstrapAgents();
const app = new Hono();

// ─── Middleware ──────────────────────────────────────────────────────

app.use("/*", logger());

// CORS — default to local dev origins, override with ALLOWED_ORIGINS env var
// (comma-separated list of allowed origins, e.g.
//   "https://artifigenz.vercel.app,https://artifigenz-web-git-mvp.vercel.app")
const defaultOrigins = ["http://localhost:3000", "http://localhost:8081"];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : defaultOrigins;

app.use(
  "/*",
  cors({
    origin: (origin) => {
      // Allow same-origin or no-origin requests (curl, server-to-server, mobile apps)
      if (!origin) return origin;
      // Exact match
      if (allowedOrigins.includes(origin)) return origin;
      // Allow any *.vercel.app preview if a vercel.app entry is in the list
      // (so PR preview deploys work without re-listing every URL)
      if (
        allowedOrigins.some((o) => o.includes("vercel.app")) &&
        origin.endsWith(".vercel.app")
      ) {
        return origin;
      }
      return null; // Reject
    },
    credentials: true,
  }),
);

console.log(`  CORS allowed origins: ${allowedOrigins.join(", ")}`);

// ─── Health ─────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ─── Routes ─────────────────────────────────────────────────────────

app.route("/api/me", userRoutes);
app.route("/api/agents", createAgentRoutes(registry));
app.route("/api/me/insights", insightRoutes);
app.route("/api/me/agents", createDataSourceRoutes(registry));
app.route("/api/me/delivery", deliveryRoutes);
app.route("/api/me/chat", chatRoutes);
app.route("/api/me", chatRoutes); // exposes /conversations under /api/me
app.route("/api/webhooks", webhookRoutes);

// ─── Start ──────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "4000");

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  Artifigenz API running on http://localhost:${info.port}\n`);
});

// ─── Workers & Scheduler ────────────────────────────────────────────
// Workers connect to Redis — only start if REDIS_URL is set

async function startWorkers() {
  if (!process.env.REDIS_URL) {
    console.log("  REDIS_URL not set — workers disabled (API-only mode)");
    return;
  }

  // Test Redis connection before starting workers
  const { default: IORedis } = await import("ioredis");
  const url = new URL(process.env.REDIS_URL);
  const useTls = url.protocol === "rediss:";
  const testConn = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: useTls ? {} : undefined,
  });

  try {
    await testConn.ping();
    await testConn.quit();
  } catch {
    console.log("  Redis not reachable — workers disabled (API-only mode)");
    return;
  }

  createSkillWorker(registry);
  createSyncWorker(registry);
  createDeliveryWorker();

  const scheduler = new Scheduler(registry);
  await scheduler.start();

  console.log("  Workers started (skill, sync, delivery)");
}

startWorkers().catch((err) => {
  console.warn("[Workers] Failed to start:", (err as Error).message);
  console.warn("  API will run without background workers.");
});
