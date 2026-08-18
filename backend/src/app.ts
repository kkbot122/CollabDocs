import Fastify from "fastify";
import { registerWebSocketServer } from "./realtime/ws-server.js";

export function buildApp() {
  const app = Fastify();

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/db", async () => {
    const { sql } = await import("drizzle-orm");
    const { db } = await import("./db/client.js");

    await db.execute(sql`SELECT 1`);
    return { db: "ok" };
  });

  registerWebSocketServer(app);

  return app;
}
