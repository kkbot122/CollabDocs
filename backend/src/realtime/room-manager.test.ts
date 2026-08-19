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

  it("creates one Y.Doc per active room and reuses it for later joins", () => {
    const manager = new RoomManager();
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();

    const firstRoom = manager.join("document-a", firstSocket);
    const secondRoom = manager.join("document-a", secondSocket);

    expect(secondRoom).toBe(firstRoom);
    expect(manager.getRoom("document-a")?.doc).toBe(firstRoom.doc);
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

  it("keeps Y.Doc content isolated between rooms", () => {
    const manager = new RoomManager();
    const roomASocket = new FakeSocket();
    const roomBSocket = new FakeSocket();

    const roomA = manager.join("document-a", roomASocket);
    const roomB = manager.join("document-b", roomBSocket);
    roomA.doc.getText("content").insert(0, "room A");

    expect(roomA.doc.getText("content").toString()).toBe("room A");
    expect(roomB.doc.getText("content").toString()).toBe("");
  });

  it("destroys the Y.Doc and clears sockets after the last leave", () => {
    const manager = new RoomManager();
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const room = manager.join("document-a", firstSocket);
    manager.join("document-a", secondSocket);

    manager.leave("document-a", firstSocket);
    expect(room.doc.isDestroyed).toBe(false);

    manager.leave("document-a", secondSocket);

    expect(room.doc.isDestroyed).toBe(true);
    expect(room.sockets).toHaveLength(0);
    expect(manager.getRoom("document-a")).toBeUndefined();
  });

  it("detaches room update observers during destruction", () => {
    const manager = new RoomManager();
    const socket = new FakeSocket();
    const room = manager.join("document-a", socket);
    let updates = 0;
    room.observeUpdates(() => {
      updates += 1;
    });

    room.doc.getText("content").insert(0, "before leave");
    expect(updates).toBe(1);

    manager.leave("document-a", socket);

    expect(room.doc.isDestroyed).toBe(true);
    expect(updates).toBe(1);
  });
});
