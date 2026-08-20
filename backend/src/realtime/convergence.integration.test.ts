import Fastify from "fastify";
import * as decoding from "lib0/decoding";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";
import * as Y from "yjs";
import {
  encodeSyncStep1,
  encodeSyncUpdate,
  readSyncFrame,
} from "./protocol-codec.js";
import { RoomManager } from "./room-manager.js";
import { registerWebSocketServer } from "./ws-server.js";

type Replica = {
  readonly client: WebSocket;
  readonly doc: Y.Doc;
  readonly receivedFrames: Uint8Array[];
};

type TestSystem = {
  readonly app: ReturnType<typeof Fastify>;
  readonly roomManager: RoomManager;
  readonly replicas: [Replica, Replica];
  readonly serverDoc: Y.Doc;
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

const textOf = (doc: Y.Doc): string => doc.getText("content").toString();

const waitFor = (
  check: () => boolean,
  onChange: (notify: () => void) => () => void,
): Promise<void> =>
  new Promise((resolve) => {
    const notify = (): void => {
      if (!check()) {
        return;
      }
      unsubscribe();
      resolve();
    };
    const unsubscribe = onChange(notify);
    notify();
  });

const waitForReplicaConvergence = (system: TestSystem): Promise<void> =>
  waitFor(
    () => {
      const expected = textOf(system.serverDoc);
      return system.replicas.every(({ doc }) => textOf(doc) === expected);
    },
    (notify) => {
      const listeners = system.replicas.map(({ doc }) => {
        const listener = (): void => notify();
        doc.on("update", listener);
        return { doc, listener };
      });
      const serverListener = (): void => notify();
      system.serverDoc.on("update", serverListener);

      return () => {
        for (const { doc, listener } of listeners) {
          doc.off("update", listener);
        }
        system.serverDoc.off("update", serverListener);
      };
    },
  );

const isSyncUpdateFrame = (frame: Uint8Array): boolean => {
  const decoder = decoding.createDecoder(frame);
  return decoding.readVarUint(decoder) === 0 && decoding.readVarUint(decoder) === 2;
};

const waitForSyncUpdateFrame = (replica: Replica): Promise<Uint8Array> =>
  new Promise((resolve) => {
    const check = (): void => {
      const frame = replica.receivedFrames.find(isSyncUpdateFrame);
      if (frame) {
        resolve(frame);
        return;
      }
      setImmediate(check);
    };
    check();
  });

const captureUpdate = (doc: Y.Doc, change: () => void): Uint8Array => {
  let update: Uint8Array | undefined;
  doc.once("update", (value) => {
    update = value;
  });
  change();

  if (!update) {
    throw new Error("Expected the change to produce a Yjs update");
  }
  return encodeSyncUpdate(update);
};

const createSystem = async (): Promise<TestSystem> => {
  const roomManager = new RoomManager();
  const app = Fastify();
  registerWebSocketServer(app, roomManager);
  await app.listen({ host: "127.0.0.1", port: 0 });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Convergence server did not expose a TCP address");
  }

  const serverUrl = `ws://127.0.0.1:${address.port}/ws?docId=convergence-test`;
  const firstDoc = new Y.Doc();
  firstDoc.getText("content").insert(0, "abcdef");
  const secondDoc = new Y.Doc();

  const createReplica = async (doc: Y.Doc): Promise<Replica> => {
    const client = new WebSocket(serverUrl);
    client.on("error", () => undefined);
    await once(client, "open");
    const receivedFrames: Uint8Array[] = [];
    client.on("message", (message: RawData) => {
      const frame = rawDataToUint8Array(message);
      receivedFrames.push(frame);
      const reply = readSyncFrame(frame, doc);
      if (reply.byteLength > 0) {
        client.send(reply);
      }
    });
    client.send(encodeSyncStep1(doc));
    return { client, doc, receivedFrames };
  };

  const first = await createReplica(firstDoc);
  const second = await createReplica(secondDoc);
  const room = roomManager.getRoom("convergence-test");
  if (!room) {
    first.client.terminate();
    second.client.terminate();
    await app.close();
    throw new Error("Expected convergence test room");
  }

  const system: TestSystem = {
    app,
    roomManager,
    replicas: [first, second],
    serverDoc: room.doc,
  };
  await waitForReplicaConvergence(system);
  return system;
};

const closeSystem = async (system: TestSystem): Promise<void> => {
  for (const { client } of system.replicas) {
    client.on("error", () => undefined);
    client.terminate();
  }
  await system.app.close();
};

describe("deterministic Yjs convergence", () => {
  const systems: TestSystem[] = [];

  afterEach(async () => {
    for (const system of systems.splice(0)) {
      await closeSystem(system);
    }
  });

  it.each([
    ["distinct concurrent inserts", 1, "A", 5, "B"],
    ["overlapping concurrent inserts", 3, "A", 3, "B"],
  ])(
    "converges after %s delivered in reverse order",
    async (_name, firstIndex, firstValue, secondIndex, secondValue) => {
      const system = await createSystem();
      systems.push(system);
      const [first, second] = system.replicas;

      const firstFrame = captureUpdate(first.doc, () => {
        first.doc.getText("content").insert(firstIndex, firstValue);
      });
      const secondFrame = captureUpdate(second.doc, () => {
        second.doc.getText("content").insert(secondIndex, secondValue);
      });

      second.client.send(secondFrame);
      first.client.send(firstFrame);
      await waitForReplicaConvergence(system);

      expect(textOf(first.doc)).toBe(textOf(second.doc));
      expect(textOf(first.doc)).toBe(textOf(system.serverDoc));
    },
  );

  it("converges after concurrent deletes at distinct positions", async () => {
    const system = await createSystem();
    systems.push(system);
    const [first, second] = system.replicas;

    const firstFrame = captureUpdate(first.doc, () => {
      first.doc.getText("content").delete(1, 2);
    });
    const secondFrame = captureUpdate(second.doc, () => {
      second.doc.getText("content").delete(3, 2);
    });

    second.client.send(secondFrame);
    first.client.send(firstFrame);
    await waitForReplicaConvergence(system);

    expect(textOf(first.doc)).toBe(textOf(second.doc));
    expect(textOf(first.doc)).toBe(textOf(system.serverDoc));
  });

  it.each([
    ["distinct", 1, "X", 4, "Y"],
    ["overlapping", 2, "X", 2, "Y"],
  ])(
    "converges after concurrent replacements at %s positions",
    async (_name, firstIndex, firstValue, secondIndex, secondValue) => {
      const system = await createSystem();
      systems.push(system);
      const [first, second] = system.replicas;

      const replace = (doc: Y.Doc, index: number, value: string): void => {
        doc.transact(() => {
          const text = doc.getText("content");
          text.delete(index, 1);
          text.insert(index, value);
        });
      };
      const firstFrame = captureUpdate(first.doc, () => {
        replace(first.doc, firstIndex, firstValue);
      });
      const secondFrame = captureUpdate(second.doc, () => {
        replace(second.doc, secondIndex, secondValue);
      });

      second.client.send(secondFrame);
      first.client.send(firstFrame);
      await waitForReplicaConvergence(system);

      expect(textOf(first.doc)).toBe(textOf(second.doc));
      expect(textOf(first.doc)).toBe(textOf(system.serverDoc));
    },
  );

  it("does not duplicate content when an Update frame is delivered twice", async () => {
    const system = await createSystem();
    systems.push(system);
    const [first, second] = system.replicas;
    const frame = captureUpdate(first.doc, () => {
      first.doc.getText("content").insert(6, " once");
    });

    first.client.send(frame);
    const deliveredFrame = await waitForSyncUpdateFrame(second);
    await waitForReplicaConvergence(system);
    const convergedText = textOf(second.doc);

    const duplicateReply = readSyncFrame(deliveredFrame, second.doc);
    expect(duplicateReply.byteLength).toBe(0);
    expect(textOf(second.doc)).toBe(convergedText);
    expect(textOf(first.doc)).toBe(textOf(system.serverDoc));
  });
});
