import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as awareness from "y-protocols/awareness";
import * as Y from "yjs";
import { registerWebSocketServer } from "../../../backend/src/realtime/ws-server";
import { RoomManager } from "../../../backend/src/realtime/room-manager";
import {
  BrowserWebSocketClient,
  type WebSocketLike,
  type WebSocketMessage,
} from "./ws-client";
import {
  encodeAwarenessUpdate,
  NETWORK_ORIGIN,
  encodeSyncUpdate,
} from "./sync-protocol";
import { SyncProvider } from "./sync-provider";

const textOf = (doc: Y.Doc): string => doc.getText("content").toString();

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

const waitForStatus = (
  provider: SyncProvider,
  expected: "connected" | "disconnected",
): Promise<void> =>
  waitFor(
    () => provider.status === expected,
    (notify) => provider.onStatus(notify),
  );

const waitForEqualText = (first: Y.Doc, second: Y.Doc): Promise<void> =>
  waitFor(
    () => textOf(first) === textOf(second),
    (notify) => {
      const handleUpdate = (): void => notify();
      first.on("update", handleUpdate);
      second.on("update", handleUpdate);
      return () => {
        first.off("update", handleUpdate);
        second.off("update", handleUpdate);
      };
    },
  );

class FakeSocket implements WebSocketLike {
  readonly sent: Array<string | ArrayBuffer | ArrayBufferView | Blob> = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<WebSocketMessage>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closeCalls = 0;

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code: 1006 }));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(data: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

describe("SyncProvider", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  const providers: SyncProvider[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) {
      provider.destroy();
    }
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  it("converges two providers through the real server in both directions", async () => {
    const roomManager = new RoomManager();
    const app = Fastify();
    apps.push(app);
    registerWebSocketServer(app, roomManager);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    const url = `ws://127.0.0.1:${address.port}/ws`;
    const providerA = new SyncProvider(url, "provider-test", {
      createSocket: (socketUrl) =>
        new WebSocket(socketUrl) as unknown as WebSocketLike,
    });
    const providerB = new SyncProvider(url, "provider-test", {
      createSocket: (socketUrl) =>
        new WebSocket(socketUrl) as unknown as WebSocketLike,
    });
    providers.push(providerA, providerB);

    providerA.doc.getText("content").insert(0, "from A");
    providerB.doc.getText("content").insert(0, "from B");

    await Promise.all([
      waitForStatus(providerA, "connected"),
      waitForStatus(providerB, "connected"),
    ]);
    await waitForEqualText(providerA.doc, providerB.doc);

    providerA.doc
      .getText("content")
      .insert(providerA.doc.getText("content").length, " + later A");
    await waitForEqualText(providerA.doc, providerB.doc);

    providerB.doc
      .getText("content")
      .insert(providerB.doc.getText("content").length, " + later B");
    await waitForEqualText(providerA.doc, providerB.doc);

    expect(textOf(providerA.doc)).toBe(textOf(providerB.doc));
    expect(roomManager.getRoom("provider-test")).toBeDefined();
  });

  it("propagates local Awareness state and graceful removal", async () => {
    const roomManager = new RoomManager();
    const app = Fastify();
    apps.push(app);
    registerWebSocketServer(app, roomManager);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    const url = `ws://127.0.0.1:${address.port}/ws`;
    const createSocket = (socketUrl: string): WebSocketLike =>
      new WebSocket(socketUrl) as unknown as WebSocketLike;
    const providerA = new SyncProvider(url, "awareness-test", { createSocket });
    const providerB = new SyncProvider(url, "awareness-test", { createSocket });
    providers.push(providerA, providerB);

    await Promise.all([
      waitForStatus(providerA, "connected"),
      waitForStatus(providerB, "connected"),
    ]);

    providerA.awareness.setLocalState({ user: { id: "a", name: "A" } });
    await waitFor(
      () => [...providerB.awareness.getStates().values()].some(
        (state) => state.user?.id === "a",
      ),
      (notify) => {
        const listener = (): void => notify();
        providerB.awareness.on("change", listener);
        return () => providerB.awareness.off("change", listener);
      },
    );

    providerA.destroy();
    await waitFor(
      () => ![...providerB.awareness.getStates().values()].some(
        (state) => state.user?.id === "a",
      ),
      (notify) => {
        const listener = (): void => notify();
        providerB.awareness.on("change", listener);
        return () => providerB.awareness.off("change", listener);
      },
    );
  });

  it("does not echo a network-origin Awareness update", async () => {
    let socket: FakeSocket | undefined;
    const provider = new SyncProvider("ws://localhost:3000/ws", "doc", {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    socket?.open();

    const source = new Y.Doc();
    const sourceAwareness = new awareness.Awareness(source);
    sourceAwareness.setLocalState({ user: { id: "remote" } });
    socket?.receive(
      encodeAwarenessUpdate(sourceAwareness, [sourceAwareness.clientID]).buffer,
    );

    await waitFor(
      () => [...provider.awareness.getStates().values()].some(
        (state) => state.user?.id === "remote",
      ),
      (notify) => {
        const listener = (): void => notify();
        provider.awareness.on("change", listener);
        return () => provider.awareness.off("change", listener);
      },
    );

    expect(socket?.sent).toHaveLength(2);
    provider.destroy();
    sourceAwareness.destroy();
  });

  it("does not resend a network-origin update and stops after destroy", async () => {
    let socket: FakeSocket | undefined;
    const provider = new SyncProvider("ws://localhost:3000/ws", "doc", {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });

    socket?.open();
    expect(socket?.sent).toHaveLength(2);

    const source = new Y.Doc();
    let update: Uint8Array | undefined;
    source.once("update", (value) => {
      update = value;
    });
    source.getText("content").insert(0, "remote");
    expect(update).toBeDefined();

    socket?.receive(encodeSyncUpdate(update as Uint8Array).buffer);
    await waitFor(
      () => textOf(provider.doc) === "remote",
      (notify) => {
        const listener = (): void => notify();
        provider.doc.on("update", listener);
        return () => provider.doc.off("update", listener);
      },
    );
    expect(socket?.sent).toHaveLength(2);
    provider.destroy();
    expect(socket?.closeCalls).toBe(1);
    provider.doc.getText("content").insert(0, "after destroy");
    provider.awareness.setLocalState({ user: { id: "after destroy" } });
    expect(socket?.sent).toHaveLength(3);
  });

  it("exposes status transitions", () => {
    let socket: FakeSocket | undefined;
    const statuses: string[] = [];
    const provider = new SyncProvider("ws://localhost:3000/ws", "doc", {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    provider.onStatus((status) => statuses.push(status));

    socket?.open();
    socket?.close();
    socket?.onclose?.(new CloseEvent("close", { code: 1000 }));

    expect(provider.status).toBe("disconnected");
    expect(statuses).toEqual(["connected", "disconnected"]);
    provider.destroy();
  });

  it("replays the Yjs handshake and local Awareness after reconnect", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const provider = new SyncProvider("ws://localhost:3000/ws", "doc", {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    sockets[0].open();
    provider.awareness.setLocalState({ user: { id: "local" } });
    provider.doc.getText("content").insert(0, "retained while disconnected");
    sockets[0].sent.length = 0;

    sockets[0].remoteClose();
    expect(provider.status).toBe("disconnected");
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(2);
    expect(provider.doc.getText("content").toString()).toBe(
      "retained while disconnected",
    );

    sockets[1].open();
    expect(
      sockets[1].sent.map(
        (frame) => new Uint8Array(frame as Uint8Array)[0],
      ),
    ).toEqual([0, 1]);

    provider.destroy();
  });

  it("uses the network origin for inbound protocol application", async () => {
    let socket: FakeSocket | undefined;
    const provider = new SyncProvider("ws://localhost:3000/ws", "doc", {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    socket?.open();

    const origins: unknown[] = [];
    provider.doc.on("update", (_update, origin) => origins.push(origin));
    const source = new Y.Doc();
    let update: Uint8Array | undefined;
    source.once("update", (value) => {
      update = value;
    });
    source.getText("content").insert(0, "remote");
    socket?.receive(encodeSyncUpdate(update as Uint8Array).buffer);

    await waitFor(
      () => origins.length === 1,
      (notify) => {
        const listener = (): void => notify();
        provider.doc.on("update", listener);
        return () => provider.doc.off("update", listener);
      },
    );
    expect(origins[0]).toBe(NETWORK_ORIGIN);
    provider.destroy();
  });
});
