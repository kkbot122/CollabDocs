import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  isRemoteUpdateOrigin,
  readSyncFrame,
  REMOTE_UPDATE_ORIGIN,
} from "./protocol-codec.js";

const textOf = (doc: Y.Doc): string => doc.getText("content").toString();

describe("Yjs protocol codec", () => {
  it("converges two different documents through both handshake directions", () => {
    const client = new Y.Doc();
    const server = new Y.Doc();
    client.getText("content").insert(0, "client change");
    server.getText("content").insert(0, "server change");

    const serverReply = readSyncFrame(encodeSyncStep1(client), server);
    const clientReply = readSyncFrame(serverReply, client);
    readSyncFrame(clientReply, server);

    expect(textOf(client)).toBe(textOf(server));
  });

  it("encodes an explicit SyncStep2 for a received state vector", () => {
    const source = new Y.Doc();
    const target = new Y.Doc();
    source.getText("content").insert(0, "missing state");

    const stateVector = Y.encodeStateVector(target);
    const response = encodeSyncStep2(source, stateVector);
    readSyncFrame(response, target);

    expect(textOf(target)).toBe("missing state");
  });

  it("relays later Update messages in both directions", () => {
    const client = new Y.Doc();
    const server = new Y.Doc();
    readSyncFrame(readSyncFrame(encodeSyncStep1(client), server), client);

    let clientUpdate: Uint8Array | undefined;
    client.once("update", (update) => {
      clientUpdate = update;
    });
    client.getText("content").insert(0, "client update");
    expect(clientUpdate).toBeDefined();
    readSyncFrame(encodeSyncUpdate(clientUpdate as Uint8Array), server);

    let serverUpdate: Uint8Array | undefined;
    server.once("update", (update) => {
      serverUpdate = update;
    });
    server.getText("content").insert(server.getText("content").length, " server update");
    expect(serverUpdate).toBeDefined();
    readSyncFrame(encodeSyncUpdate(serverUpdate as Uint8Array), client);

    expect(textOf(client)).toBe(textOf(server));
  });

  it("treats repeated delivery as idempotent and marks it remote", () => {
    const source = new Y.Doc();
    const target = new Y.Doc();

    const updates: unknown[] = [];
    target.on("update", (_update, origin) => {
      updates.push(origin);
    });
    let sourceUpdate: Uint8Array | undefined;
    source.once("update", (update) => {
      sourceUpdate = update;
    });
    source.getText("content").insert(0, "once only");
    expect(sourceUpdate).toBeDefined();

    const frame = encodeSyncUpdate(sourceUpdate as Uint8Array);
    readSyncFrame(frame, target);
    readSyncFrame(frame, target);

    expect(textOf(target)).toBe("once only");
    expect(updates).toHaveLength(1);
    expect(updates.every(isRemoteUpdateOrigin)).toBe(true);
    expect(isRemoteUpdateOrigin(REMOTE_UPDATE_ORIGIN)).toBe(true);
  });

  it("rejects non-sync top-level frames", () => {
    const awarenessFrame = new Uint8Array([1]);

    expect(() => readSyncFrame(awarenessFrame, new Y.Doc())).toThrow(
      "Unsupported protocol frame: 1",
    );
  });
});
