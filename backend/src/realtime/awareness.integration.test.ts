import Fastify from "fastify";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";
import * as awareness from "y-protocols/awareness";
import * as Y from "yjs";
import {
  encodeAwarenessUpdate,
  encodeSyncStep1,
  readAwarenessFrame,
  readSyncFrame,
} from "./protocol-codec.js";
import { RoomManager, type Room } from "./room-manager.js";
import { registerWebSocketServer } from "./ws-server.js";

type AwarenessClient = {
  readonly socket: WebSocket;
  readonly doc: Y.Doc;
  readonly awareness: awareness.Awareness;
};

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

const waitFor = (
  check: () => boolean,
  subscribe: (notify: () => void) => () => void,
): Promise<void> =>
  new Promise((resolve) => {
    const notify = (): void => {
      if (!check()) {
        return;
      }
      unsubscribe();
      resolve();
    };
    const unsubscribe = subscribe(notify);
    notify();
  });

const waitForAwarenessState = (
  client: AwarenessClient,
  clientId: number,
  expected: object | undefined,
): Promise<void> =>
  waitFor(
    () => {
      const state = client.awareness.getStates().get(clientId);
      return JSON.stringify(state) === JSON.stringify(expected);
    },
    (notify) => {
      const listener = (): void => notify();
      client.awareness.on("change", listener);
      return () => client.awareness.off("change", listener);
    },
  );

const openClient = async (url: string): Promise<AwarenessClient> => {
  const socket = new WebSocket(url);
  socket.on("error", () => undefined);
  await once(socket, "open");
  const doc = new Y.Doc();
  const clientAwareness = new awareness.Awareness(doc);

  socket.on("message", (message: RawData) => {
    const frame = rawDataToUint8Array(message);
    if (frame[0] === 0) {
      const reply = readSyncFrame(frame, doc);
      if (reply.byteLength > 0) {
        socket.send(reply);
      }
      return;
    }

    readAwarenessFrame(frame, clientAwareness, "server");
  });
  socket.send(encodeSyncStep1(doc));
  return { socket, doc, awareness: clientAwareness };
};

const sendLocalAwareness = (client: AwarenessClient, state: object): void => {
  client.awareness.setLocalState(state);
  client.socket.send(
    encodeAwarenessUpdate(client.awareness, [client.awareness.clientID]),
  );
};

const closeClient = (client: AwarenessClient): void => {
  client.socket.on("error", () => undefined);
  client.socket.terminate();
};

describe("server Awareness protocol", () => {
  const clients: AwarenessClient[] = [];
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      closeClient(client);
    }
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  const startServer = async (): Promise<{
    roomManager: RoomManager;
    url: string;
  }> => {
    const roomManager = new RoomManager();
    const app = Fastify();
    apps.push(app);
    registerWebSocketServer(app, roomManager);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Awareness server did not expose a TCP address");
    }
    return { roomManager, url: `ws://127.0.0.1:${address.port}/ws` };
  };

  it("propagates Awareness state and leaves the Y.Doc unchanged", async () => {
    const { roomManager, url } = await startServer();
    const first = await openClient(`${url}?docId=room-a`);
    const second = await openClient(`${url}?docId=room-a`);
    clients.push(first, second);

    const room = roomManager.getRoom("room-a") as Room;
    room.doc.getText("content").insert(0, "durable content");
    let documentUpdates = 0;
    room.doc.on("update", () => documentUpdates++);

    const state = { user: { name: "Alice" }, cursor: { anchor: 5, head: 5 } };
    sendLocalAwareness(first, state);
    await waitForAwarenessState(second, first.awareness.clientID, state);

    expect(room.awareness.getStates().get(first.awareness.clientID)).toEqual(state);
    expect(second.awareness.getStates().get(first.awareness.clientID)).toEqual(state);
    expect(room.doc.getText("content").toString()).toBe("durable content");
    expect(documentUpdates).toBe(0);
  });

  it("isolates Awareness updates between rooms", async () => {
    const { roomManager, url } = await startServer();
    const roomAFirst = await openClient(`${url}?docId=room-a`);
    const roomASecond = await openClient(`${url}?docId=room-a`);
    const roomB = await openClient(`${url}?docId=room-b`);
    clients.push(roomAFirst, roomASecond, roomB);

    const state = { user: { name: "Alice" }, cursor: { anchor: 2, head: 8 } };
    sendLocalAwareness(roomAFirst, state);
    await waitForAwarenessState(
      roomASecond,
      roomAFirst.awareness.clientID,
      state,
    );

    expect(
      roomManager
        .getRoom("room-a")
        ?.awareness.getStates()
        .get(roomAFirst.awareness.clientID),
    ).toEqual(state);
    expect(roomB.awareness.getStates().has(roomAFirst.awareness.clientID)).toBe(
      false,
    );
  });

  it("removes announced states on graceful disconnect", async () => {
    const { roomManager, url } = await startServer();
    const first = await openClient(`${url}?docId=room-a`);
    const second = await openClient(`${url}?docId=room-a`);
    clients.push(first, second);
    const state = { user: { name: "Alice" } };
    sendLocalAwareness(first, state);
    await waitForAwarenessState(second, first.awareness.clientID, state);

    first.socket.close(1000, "graceful test close");
    await waitForAwarenessState(second, first.awareness.clientID, undefined);

    expect(
      roomManager.getRoom("room-a")?.awareness.getStates().has(
        first.awareness.clientID,
      ),
    ).toBe(false);
  });

  it("removes announced states on abrupt disconnect", async () => {
    const { roomManager, url } = await startServer();
    const first = await openClient(`${url}?docId=room-a`);
    const second = await openClient(`${url}?docId=room-a`);
    clients.push(first, second);
    const state = { user: { name: "Alice" } };
    sendLocalAwareness(first, state);
    await waitForAwarenessState(second, first.awareness.clientID, state);

    first.socket.terminate();
    await waitForAwarenessState(second, first.awareness.clientID, undefined);

    expect(
      roomManager.getRoom("room-a")?.awareness.getStates().has(
        first.awareness.clientID,
      ),
    ).toBe(false);
  });

  it("ignores duplicate and stale Awareness clocks", async () => {
    const { url } = await startServer();
    const first = await openClient(`${url}?docId=room-a`);
    const second = await openClient(`${url}?docId=room-a`);
    clients.push(first, second);

    const initialState = { user: { name: "Alice" }, cursor: { anchor: 1 } };
    first.awareness.setLocalState(initialState);
    const initialFrame = encodeAwarenessUpdate(first.awareness, [
      first.awareness.clientID,
    ]);
    first.socket.send(initialFrame);
    await waitForAwarenessState(
      second,
      first.awareness.clientID,
      initialState,
    );

    const newerState = { user: { name: "Alice" }, cursor: { anchor: 9 } };
    first.awareness.setLocalState(newerState);
    const newerFrame = encodeAwarenessUpdate(first.awareness, [
      first.awareness.clientID,
    ]);
    first.socket.send(newerFrame);
    await waitForAwarenessState(second, first.awareness.clientID, newerState);

    first.socket.send(initialFrame);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(second.awareness.getStates().get(first.awareness.clientID)).toEqual(
      newerState,
    );
  });
});
