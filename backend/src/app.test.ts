import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("health check", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    const { pool } = await import("./db/client.js");
    await pool.end();
  });

  it("returns an OK response", async () => {
    app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns an OK response when PostgreSQL is reachable", async () => {
    app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ db: "ok" });
  });
});
