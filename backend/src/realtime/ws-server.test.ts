import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../app.js";

const openServer = async () => {
  const app = buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();

  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Test server did not expose a TCP address");
  }

  return { app, url: `ws://127.0.0.1:${address.port}/ws` };
};

describe("WebSocket server", () => {
  const clients: WebSocket[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.on("error", () => undefined);
      client.terminate();
    }
  });

  it("rejects a missing docId during the upgrade", async () => {
    const { app, url } = await openServer();
    const client = new WebSocket(url);
    client.on("error", () => undefined);
    clients.push(client);

    const [, response] = await once(client, "unexpected-response");
    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
