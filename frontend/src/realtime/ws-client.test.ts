import { describe, expect, it } from "vitest";
import { TEMPORARY_TRANSPORT_TEST_PAYLOAD } from "../transport-test-fixture";
import {
  BrowserWebSocketClient,
  type WebSocketLike,
  type WebSocketMessage,
} from "./ws-client";

class FakeSocket implements WebSocketLike {
  readonly url: string;
  readonly sent: Array<string | ArrayBuffer | ArrayBufferView | Blob> = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<WebSocketMessage>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(data: WebSocketMessage): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code: 1000 }));
  }
}

describe("BrowserWebSocketClient", () => {
  it("connects, sends text and binary data, and receives messages", () => {
    let socket: FakeSocket | undefined;
    const client = new BrowserWebSocketClient(
      "ws://localhost:3000/ws?existing=value",
      "doc A",
      (url) => {
        socket = new FakeSocket(url);
        return socket;
      },
    );
    const messages: WebSocketMessage[] = [];
    let opened = 0;
    client.onOpen(() => opened++);
    client.onMessage((message) => messages.push(message));

    client.connect();
    expect(socket?.url).toBe(
      "ws://localhost:3000/ws?existing=value&docId=doc+A",
    );
    expect(client.send(TEMPORARY_TRANSPORT_TEST_PAYLOAD)).toBe(false);

    socket?.open();
    const binary = new Uint8Array([1, 2, 3]);
    expect(client.send(binary)).toBe(true);
    socket?.receive(TEMPORARY_TRANSPORT_TEST_PAYLOAD);

    expect(opened).toBe(1);
    expect(socket?.sent).toEqual([binary]);
    expect(messages).toEqual([TEMPORARY_TRANSPORT_TEST_PAYLOAD]);
  });

  it("emits error and close signals", () => {
    let socket: FakeSocket | undefined;
    const client = new BrowserWebSocketClient("ws://localhost:3000/ws", "doc", (url) => {
      socket = new FakeSocket(url);
      return socket;
    });
    const errors: unknown[] = [];
    const closeCodes: number[] = [];
    client.onError((error) => errors.push(error));
    client.onClose((event) => closeCodes.push(event.code));

    client.connect();
    socket?.fail();
    socket?.remoteClose();

    expect(errors).toHaveLength(1);
    expect(closeCodes).toEqual([1000]);
  });

  it("suppresses future work after intentional destroy", () => {
    let socket: FakeSocket | undefined;
    const client = new BrowserWebSocketClient("ws://localhost:3000/ws", "doc", (url) => {
      socket = new FakeSocket(url);
      return socket;
    });
    let signalCount = 0;
    client.onOpen(() => signalCount++);
    client.onMessage(() => signalCount++);
    client.onError(() => signalCount++);
    client.onClose(() => signalCount++);

    client.connect();
    client.destroy();
    socket?.open();
    socket?.receive("late message");
    socket?.fail();
    socket?.remoteClose();

    expect(socket?.closeCalls).toBe(1);
    expect(signalCount).toBe(0);
    expect(client.send("after destroy")).toBe(false);
  });
});
