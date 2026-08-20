import * as Y from "yjs";
import {
  encodeSyncStep1,
  encodeSyncUpdate,
  NETWORK_ORIGIN,
  readSyncFrame,
} from "./sync-protocol";
import {
  BrowserWebSocketClient,
  type WebSocketFactory,
  type WebSocketMessage,
} from "./ws-client";

export type SyncStatus = "connecting" | "connected" | "disconnected";
type StatusListener = (status: SyncStatus) => void;

export interface SyncProviderOptions {
  readonly createSocket?: WebSocketFactory;
}

export class SyncProvider {
  readonly doc = new Y.Doc();

  private statusValue: SyncStatus = "connecting";
  private destroyed = false;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly socket: BrowserWebSocketClient;
  private readonly unsubscribeOpen: () => void;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose: () => void;
  private readonly handleDocUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (origin === NETWORK_ORIGIN || this.destroyed) {
      return;
    }

    this.socket.send(encodeSyncUpdate(update));
  };

  constructor(
    serverUrl: string,
    docId: string,
    options: SyncProviderOptions = {},
  ) {
    this.socket = new BrowserWebSocketClient(
      serverUrl,
      docId,
      options.createSocket,
    );

    this.unsubscribeOpen = this.socket.onOpen(() => {
      this.setStatus("connected");
      this.socket.send(encodeSyncStep1(this.doc));
    });
    this.unsubscribeMessage = this.socket.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.unsubscribeClose = this.socket.onClose(() => {
      this.setStatus("disconnected");
    });
    this.doc.on("update", this.handleDocUpdate);
    this.socket.connect();
  }

  get status(): SyncStatus {
    return this.statusValue;
  }

  onStatus(listener: StatusListener): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.doc.off("update", this.handleDocUpdate);
    this.unsubscribeOpen();
    this.unsubscribeMessage();
    this.unsubscribeClose();
    this.socket.destroy();
    this.statusListeners.clear();
    this.doc.destroy();
  }

  private async handleMessage(message: WebSocketMessage): Promise<void> {
    if (this.destroyed) {
      return;
    }

    try {
      const frame = await toUint8Array(message);
      const reply = readSyncFrame(frame, this.doc);

      if (reply.byteLength > 0) {
        this.socket.send(reply);
      }
    } catch {
      this.socket.close(1002, "Invalid sync frame");
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this.destroyed || this.statusValue === status) {
      return;
    }

    this.statusValue = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

const toUint8Array = async (message: WebSocketMessage): Promise<Uint8Array> => {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  if (typeof Blob !== "undefined" && message instanceof Blob) {
    return new Uint8Array(await message.arrayBuffer());
  }

  throw new Error("Expected a binary WebSocket message");
};
