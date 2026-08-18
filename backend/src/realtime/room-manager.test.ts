import { describe, expect, it } from "vitest";
import { RoomManager, type TransportSocket } from "./room-manager.js";

class FakeSocket implements TransportSocket {
  readonly messages: string[] = [];

  send(payload: string): void {
    this.messages.push(payload);
  }
}

describe("RoomManager", () => {
  it("creates a room on first join and removes it after the last leave", () => {
    const manager = new RoomManager();
    const socket = new FakeSocket();

    manager.join("document-a", socket);
    expect(manager.hasRoom("document-a")).toBe(true);

    manager.leave("document-a", socket);
    expect(manager.hasRoom("document-a")).toBe(false);
  });

  it("makes leave idempotent", () => {
    const manager = new RoomManager();
    const socket = new FakeSocket();

    manager.leave("document-a", socket);
    manager.join("document-a", socket);
    manager.leave("document-a", socket);
    manager.leave("document-a", socket);

    expect(manager.hasRoom("document-a")).toBe(false);
  });

  it("broadcasts to peers while excluding the sender", () => {
    const manager = new RoomManager();
    const sender = new FakeSocket();
    const peer = new FakeSocket();

    manager.join("document-a", sender);
    manager.join("document-a", peer);
    manager.broadcast("document-a", sender, "temporary payload");

    expect(sender.messages).toEqual([]);
    expect(peer.messages).toEqual(["temporary payload"]);
  });

  it("keeps broadcasts isolated between rooms", () => {
    const manager = new RoomManager();
    const sender = new FakeSocket();
    const roomAPeer = new FakeSocket();
    const roomBPeer = new FakeSocket();

    manager.join("document-a", sender);
    manager.join("document-a", roomAPeer);
    manager.join("document-b", roomBPeer);
    manager.broadcast("document-a", sender, "room-a payload");

    expect(roomAPeer.messages).toEqual(["room-a payload"]);
    expect(roomBPeer.messages).toEqual([]);
  });
});
