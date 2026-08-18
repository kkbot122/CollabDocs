import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../app.js";
import { TEMPORARY_TRANSPORT_TEST_PAYLOAD } from "../transport-test-fixture.js";

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

describe("temporary WebSocket transport", () => {
  const clients: WebSocket[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.on("error", () => undefined);
      client.terminate();
    }
  });

  it("echoes the temporary payload and closes cleanly", async () => {
    const { app, url } = await openServer();
    const client = new WebSocket(`${url}?docId=transport-test`);
    client.on("error", () => undefined);
    clients.push(client);

    await once(client, "open");
    const messagePromise = once(client, "message");
    client.send(TEMPORARY_TRANSPORT_TEST_PAYLOAD);

    const [message] = await messagePromise;
    expect(message.toString()).toBe(TEMPORARY_TRANSPORT_TEST_PAYLOAD);

    const closePromise = once(client, "close");
    client.close(1000, "test complete");
    const [code] = await closePromise;
    expect(code).toBe(1000);

    await app.close();
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
