import * as Y from "yjs";
import * as awareness from "y-protocols/awareness";
import { encodeAwarenessUpdate } from "./protocol-codec.js";

export interface TransportSocket {
  send(payload: string | Uint8Array): void;
}

export type RoomUpdateObserver = (update: Uint8Array, origin: unknown) => void;
export type AwarenessUpdateObserver = (
  clientIds: number[],
  origin: unknown,
) => void;

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awareness.Awareness(this.doc);
  readonly sockets = new Set<TransportSocket>();
  private readonly updateObservers = new Set<RoomUpdateObserver>();
  private readonly awarenessUpdateObservers = new Set<AwarenessUpdateObserver>();
  private readonly awarenessClientIdsBySocket = new Map<
    TransportSocket,
    Set<number>
  >();
  private readonly handleUpdate = (update: Uint8Array, origin: unknown): void => {
    for (const observer of this.updateObservers) {
      observer(update, origin);
    }
  };
  private readonly handleAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const clientIds = [...change.added, ...change.updated, ...change.removed];
    if (clientIds.length === 0) {
      return;
    }

    const socket = origin as TransportSocket;
    const announcedClientIds = this.awarenessClientIdsBySocket.get(socket);
    if (announcedClientIds) {
      for (const clientId of [...change.added, ...change.updated]) {
        announcedClientIds.add(clientId);
      }
      for (const clientId of change.removed) {
        announcedClientIds.delete(clientId);
      }
    }

    for (const observer of this.awarenessUpdateObservers) {
      observer(clientIds, origin);
    }
  };

  constructor() {
    this.doc.on("update", this.handleUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    this.awareness.setLocalState(null);
  }

  observeUpdates(observer: RoomUpdateObserver): () => void {
    this.updateObservers.add(observer);
    return () => {
      this.updateObservers.delete(observer);
    };
  }

  observeAwarenessUpdates(observer: AwarenessUpdateObserver): () => void {
    this.awarenessUpdateObservers.add(observer);
    return () => {
      this.awarenessUpdateObservers.delete(observer);
    };
  }

  trackSocket(socket: TransportSocket): void {
    this.awarenessClientIdsBySocket.set(socket, new Set());
  }

  removeSocketAwareness(socket: TransportSocket): void {
    const clientIds = this.awarenessClientIdsBySocket.get(socket);
    if (!clientIds) {
      return;
    }

    awareness.removeAwarenessStates(
      this.awareness,
      [...clientIds],
      socket,
    );
    this.awarenessClientIdsBySocket.delete(socket);
  }

  broadcastAwareness(
    sender: unknown,
    clientIds: number[],
  ): void {
    const payload = encodeAwarenessUpdate(this.awareness, clientIds);
    for (const socket of this.sockets) {
      if (socket !== sender) {
        socket.send(payload);
      }
    }
  }

  destroy(): void {
    this.doc.off("update", this.handleUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.updateObservers.clear();
    this.awarenessUpdateObservers.clear();
    this.awarenessClientIdsBySocket.clear();
    this.sockets.clear();
    this.awareness.destroy();
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
      room.observeAwarenessUpdates((clientIds, origin) => {
        room?.broadcastAwareness(origin, clientIds);
      });
    }

    room.sockets.add(socket);
    room.trackSocket(socket);
    return room;
  }

  leave(docId: string, socket: TransportSocket): void {
    const room = this.rooms.get(docId);

    if (!room) {
      return;
    }

    room.removeSocketAwareness(socket);
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
