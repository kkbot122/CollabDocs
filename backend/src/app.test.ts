import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("health check", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns an OK response", async () => {
    app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
