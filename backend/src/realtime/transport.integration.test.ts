import Fastify from "fastify";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";
import * as Y from "yjs";
import {
  encodeSyncStep1,
  readSyncFrame,
} from "./protocol-codec.js";
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

const waitForText = (doc: Y.Doc, expected: string): Promise<void> =>
  new Promise((resolve) => {
    const text = doc.getText("content");
    const check = (): void => {
      if (text.toString() === expected) {
        doc.off("update", checkForUpdate);
        resolve();
      }
    };
    const checkForUpdate = (): void => check();
    doc.on("update", checkForUpdate);
    check();
  });

const waitForEqualText = (first: Y.Doc, second: Y.Doc): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (first.getText("content").toString() === second.getText("content").toString()) {
        first.off("update", check);
        second.off("update", check);
        resolve();
      }
    };
    first.on("update", check);
    second.on("update", check);
    check();
  });

const rawDataToUint8Array = (message: RawData): Uint8Array => {
  if (Array.isArray(message)) {
    const length = message.reduce((total, chunk) => total + chunk.byteLength, 0);
    const combined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of message) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
};

const attachSyncClient = (
  client: WebSocket,
  doc: Y.Doc,
): void => {
  client.on("message", (message: RawData) => {
    const reply = readSyncFrame(rawDataToUint8Array(message), doc);
    if (reply.byteLength > 0) {
      client.send(reply);
    }
  });
};

describe("WebSocket Yjs synchronization", () => {
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

  it("exchanges initial state, relays later edits, and isolates rooms", async () => {
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
    const clientDoc = new Y.Doc();
    clientDoc.getText("content").insert(0, "client initial");
    const clientA = new WebSocket(`${url}?docId=document-a`);
    clients.push(clientA);
    clientA.on("error", () => undefined);
    await once(clientA, "open");

    const activeRoom = roomManager.getRoom("document-a");
    if (!activeRoom) {
      throw new Error("Expected document-a room after client connection");
    }
    activeRoom.doc.getText("content").insert(0, "server initial");
    attachSyncClient(clientA, clientDoc);
    const initialConvergence = waitForEqualText(clientDoc, activeRoom.doc);
    clientA.send(encodeSyncStep1(clientDoc));
    await initialConvergence;

    const clientB = new WebSocket(`${url}?docId=document-a`);
    const clientC = new WebSocket(`${url}?docId=document-b`);
    clients.push(clientB, clientC);
    clientB.on("error", () => undefined);
    clientC.on("error", () => undefined);
    await Promise.all([once(clientB, "open"), once(clientC, "open")]);
    const clientBDoc = new Y.Doc();
    const clientCDoc = new Y.Doc();
    attachSyncClient(clientB, clientBDoc);
    attachSyncClient(clientC, clientCDoc);
    clientB.send(encodeSyncStep1(clientBDoc));
    clientC.send(encodeSyncStep1(clientCDoc));
    await waitForText(clientBDoc, activeRoom.doc.getText("content").toString());
    await waitForText(clientCDoc, "");

    expect(roomManager.hasRoom("document-a")).toBe(true);
    expect(roomManager.hasRoom("document-b")).toBe(true);

    let isolatedRoomUpdates = 0;
    clientC.on("message", (message) => {
      try {
        const before = clientCDoc.getText("content").toString();
        readSyncFrame(rawDataToUint8Array(message), clientCDoc);
        if (clientCDoc.getText("content").toString() !== before) {
          isolatedRoomUpdates += 1;
        }
      } catch {
        // The sync client handler above owns valid protocol frames.
      }
    });
    clientDoc.getText("content").insert(clientDoc.getText("content").length, " plus later edit");
    const expectedAfterEdit = clientDoc.getText("content").toString();
    const clientBUpdate = waitForText(clientBDoc, expectedAfterEdit);
    await clientBUpdate;
    expect(isolatedRoomUpdates).toBe(0);

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
