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
export type WebSocketConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "destroyed";

export interface WebSocketClientOptions {
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  jitterRatio?: number;
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
}

type Listener<T> = (value: T) => void;

const OPEN = 1;

export class BrowserWebSocketClient {
  private readonly url: string;
  private socket: WebSocketLike | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private intentionalClose = false;
  private retryAttempt = 0;
  private status: WebSocketConnectionStatus = "idle";
  private connectionGeneration = 0;

  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly jitterRatio: number;
  private readonly scheduleTimeout: NonNullable<WebSocketClientOptions["setTimeout"]>;
  private readonly cancelTimeout: NonNullable<WebSocketClientOptions["clearTimeout"]>;
  private readonly random: () => number;

  private readonly openListeners = new Set<Listener<number>>();
  private readonly messageListeners = new Set<Listener<WebSocketMessage>>();
  private readonly errorListeners = new Set<Listener<unknown>>();
  private readonly closeListeners = new Set<Listener<CloseEvent>>();
  private readonly statusListeners = new Set<Listener<WebSocketConnectionStatus>>();

  constructor(
    serverUrl: string,
    docId: string,
    private readonly createSocket: WebSocketFactory = (url) =>
      new WebSocket(url),
    options: WebSocketClientOptions = {},
  ) {
    const url = new URL(serverUrl);
    url.searchParams.set("docId", docId);
    this.url = url.toString();
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 250;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.scheduleTimeout = options.setTimeout ?? ((handler, timeout) => setTimeout(handler, timeout));
    this.cancelTimeout = options.clearTimeout ?? ((timer) => clearTimeout(timer));
    this.random = options.random ?? Math.random;
  }

  onOpen(listener: (generation: number) => void): () => void {
    return this.subscribe(this.openListeners, listener);
  }

  onStatus(listener: Listener<WebSocketConnectionStatus>): () => void {
    return this.subscribe(this.statusListeners, listener);
  }

  getStatus(): WebSocketConnectionStatus {
    return this.status;
  }

  getConnectionGeneration(): number {
    return this.connectionGeneration;
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
    if (this.destroyed || this.socket || this.retryTimer) {
      return;
    }

    this.intentionalClose = false;
    this.setStatus(this.retryAttempt > 0 ? "reconnecting" : "connecting");
    try {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      socket.onopen = () => {
        if (!this.destroyed) {
          this.retryAttempt = 0;
          this.connectionGeneration += 1;
          this.setStatus("open");
          this.emit(this.openListeners, this.connectionGeneration);
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
          if (!this.intentionalClose) {
            this.scheduleReconnect();
          } else {
            this.setStatus("idle");
          }
        }
      };
    } catch (error) {
      this.emit(this.errorListeners, error);
      this.scheduleReconnect();
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
      this.intentionalClose = true;
      this.cancelReconnect();
      this.socket?.close(code, reason);
      if (!this.socket) {
        this.setStatus("idle");
      }
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.setStatus("destroyed");
    this.cancelReconnect();
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
    this.statusListeners.clear();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.intentionalClose || this.retryTimer) {
      return;
    }

    const exponentialDelay = Math.min(
      this.maxRetryDelayMs,
      this.initialRetryDelayMs * 2 ** this.retryAttempt,
    );
    // Apply symmetric bounded jitter so simultaneous clients spread retries without
    // exceeding the configured cap (or retrying before zero milliseconds).
    const jitter = exponentialDelay * this.jitterRatio * (this.random() * 2 - 1);
    const delay = Math.max(0, exponentialDelay + jitter);
    this.retryAttempt += 1;
    this.setStatus("reconnecting");
    this.retryTimer = this.scheduleTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.retryTimer) {
      this.cancelTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private setStatus(status: WebSocketConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit(this.statusListeners, status);
  }

  private subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private emit<T>(listeners: Set<Listener<T>>, value: T): void;
  private emit<T>(listeners: Set<Listener<T> | (() => void)>, value?: T): void {
    for (const listener of listeners) {
      (listener as Listener<T>)(value as T);
    }
  }
}
