export type WebSocketMessage = string | ArrayBuffer | Blob;
export type WebSocketSendData =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob;

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<WebSocketMessage>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: WebSocketSendData): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

type Listener<T> = (value: T) => void;

const OPEN = 1;

export class BrowserWebSocketClient {
  private readonly url: string;
  private socket: WebSocketLike | undefined;
  private destroyed = false;

  private readonly openListeners = new Set<() => void>();
  private readonly messageListeners = new Set<Listener<WebSocketMessage>>();
  private readonly errorListeners = new Set<Listener<unknown>>();
  private readonly closeListeners = new Set<Listener<CloseEvent>>();

  constructor(
    serverUrl: string,
    docId: string,
    private readonly createSocket: WebSocketFactory = (url) =>
      new WebSocket(url),
  ) {
    const url = new URL(serverUrl);
    url.searchParams.set("docId", docId);
    this.url = url.toString();
  }

  onOpen(listener: () => void): () => void {
    return this.subscribe(this.openListeners, listener);
  }

  onMessage(listener: Listener<WebSocketMessage>): () => void {
    return this.subscribe(this.messageListeners, listener);
  }

  onError(listener: Listener<unknown>): () => void {
    return this.subscribe(this.errorListeners, listener);
  }

  onClose(listener: Listener<CloseEvent>): () => void {
    return this.subscribe(this.closeListeners, listener);
  }

  connect(): void {
    if (this.destroyed || this.socket) {
      return;
    }

    try {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      socket.onopen = () => {
        if (!this.destroyed) {
          this.emit(this.openListeners);
        }
      };
      socket.onmessage = (event) => {
        if (!this.destroyed) {
          this.emit(this.messageListeners, event.data);
        }
      };
      socket.onerror = (event) => {
        if (!this.destroyed) {
          this.emit(this.errorListeners, event);
        }
      };
      socket.onclose = (event) => {
        this.socket = undefined;
        if (!this.destroyed) {
          this.emit(this.closeListeners, event);
        }
      };
    } catch (error) {
      this.emit(this.errorListeners, error);
    }
  }

  send(data: WebSocketSendData): boolean {
    if (this.destroyed || !this.socket || this.socket.readyState !== OPEN) {
      return false;
    }

    this.socket.send(data);
    return true;
  }

  close(code?: number, reason?: string): void {
    if (!this.destroyed) {
      this.socket?.close(code, reason);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    const socket = this.socket;
    this.socket = undefined;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }

    this.openListeners.clear();
    this.messageListeners.clear();
    this.errorListeners.clear();
    this.closeListeners.clear();
  }

  private subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private emit<T>(listeners: Set<Listener<T>>, value: T): void;
  private emit(listeners: Set<() => void>): void;
  private emit<T>(listeners: Set<Listener<T> | (() => void)>, value?: T): void {
    for (const listener of listeners) {
      if (value === undefined) {
        (listener as () => void)();
      } else {
        (listener as Listener<T>)(value);
      }
    }
  }
}
