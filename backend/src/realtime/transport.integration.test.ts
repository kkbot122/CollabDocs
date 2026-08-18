import Fastify from "fastify";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { TEMPORARY_TRANSPORT_TEST_PAYLOAD } from "../transport-test-fixture.js";
import { RoomManager } from "./room-manager.js";
import { registerWebSocketServer } from "./ws-server.js";

const waitForRoomRemoval = (
  roomManager: RoomManager,
  docId: string,
): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (!roomManager.hasRoom(docId)) {
        resolve();
        return;
      }

      setImmediate(check);
    };

    check();
  });

describe("raw transport integration", () => {
  const clients: WebSocket[] = [];
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.on("error", () => undefined);
      client.terminate();
    }

    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  it("isolates rooms and removes them after the last client leaves", async () => {
    const roomManager = new RoomManager();
    const app = Fastify();
    apps.push(app);
    registerWebSocketServer(app, roomManager);
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Integration server did not expose a TCP address");
    }

    const url = `ws://127.0.0.1:${address.port}/ws`;
    const clientA = new WebSocket(`${url}?docId=document-a`);
    const clientB = new WebSocket(`${url}?docId=document-a`);
    const clientC = new WebSocket(`${url}?docId=document-b`);
    clients.push(clientA, clientB, clientC);
    for (const client of clients) {
      client.on("error", () => undefined);
    }

    await Promise.all(
      clients.map((client) => once(client, "open")),
    );
    expect(roomManager.hasRoom("document-a")).toBe(true);
    expect(roomManager.hasRoom("document-b")).toBe(true);

    let documentBMessages = 0;
    clientC.on("message", () => {
      documentBMessages += 1;
    });
    const peerMessage = once(clientB, "message");
    clientA.send(TEMPORARY_TRANSPORT_TEST_PAYLOAD);

    const [message] = await peerMessage;
    expect(message.toString()).toBe(TEMPORARY_TRANSPORT_TEST_PAYLOAD);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(documentBMessages).toBe(0);

    const clientAClose = once(clientA, "close");
    clientA.close(1000, "test complete");
    await clientAClose;
    expect(roomManager.hasRoom("document-a")).toBe(true);

    const clientBClose = once(clientB, "close");
    clientB.close(1000, "test complete");
    await clientBClose;
    await waitForRoomRemoval(roomManager, "document-a");

    const clientCClose = once(clientC, "close");
    clientC.close(1000, "test complete");
    await clientCClose;
    await waitForRoomRemoval(roomManager, "document-b");

    expect(roomManager.hasRoom("document-b")).toBe(false);
    expect(roomManager.hasRoom("document-a")).toBe(false);
  });
});
