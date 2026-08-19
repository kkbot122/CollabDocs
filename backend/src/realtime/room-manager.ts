import * as Y from "yjs";

export interface TransportSocket {
  send(payload: string | Uint8Array): void;
}

export type RoomUpdateObserver = (update: Uint8Array, origin: unknown) => void;

export class Room {
  readonly doc = new Y.Doc();
  readonly sockets = new Set<TransportSocket>();
  private readonly updateObservers = new Set<RoomUpdateObserver>();
  private readonly handleUpdate = (update: Uint8Array, origin: unknown): void => {
    for (const observer of this.updateObservers) {
      observer(update, origin);
    }
  };

  constructor() {
    this.doc.on("update", this.handleUpdate);
  }

  observeUpdates(observer: RoomUpdateObserver): () => void {
    this.updateObservers.add(observer);
    return () => {
      this.updateObservers.delete(observer);
    };
  }

  destroy(): void {
    this.doc.off("update", this.handleUpdate);
    this.updateObservers.clear();
    this.sockets.clear();
    this.doc.destroy();
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  join(docId: string, socket: TransportSocket): Room {
    let room = this.rooms.get(docId);

    if (!room) {
      room = new Room();
      this.rooms.set(docId, room);
    }

    room.sockets.add(socket);
    return room;
  }

  leave(docId: string, socket: TransportSocket): void {
    const room = this.rooms.get(docId);

    if (!room) {
      return;
    }

    room.sockets.delete(socket);

    if (room.sockets.size === 0) {
      this.rooms.delete(docId);
      room.destroy();
    }
  }

  getRoom(docId: string): Room | undefined {
    return this.rooms.get(docId);
  }

  broadcast(
    docId: string,
    sender: TransportSocket,
    payload: string | Uint8Array,
  ): void {
    const room = this.rooms.get(docId);

    if (!room) {
      return;
    }

    for (const socket of room.sockets) {
      if (socket !== sender) {
        socket.send(payload);
      }
    }
  }

  hasRoom(docId: string): boolean {
    return this.rooms.has(docId);
  }
}
