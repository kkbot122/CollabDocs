export interface TransportSocket {
  send(payload: string): void;
}

export class RoomManager {
  private readonly rooms = new Map<string, Set<TransportSocket>>();

  join(docId: string, socket: TransportSocket): void {
    let room = this.rooms.get(docId);

    if (!room) {
      room = new Set<TransportSocket>();
      this.rooms.set(docId, room);
    }

    room.add(socket);
  }

  leave(docId: string, socket: TransportSocket): void {
    const room = this.rooms.get(docId);

    if (!room) {
      return;
    }

    room.delete(socket);

    if (room.size === 0) {
      this.rooms.delete(docId);
    }
  }

  broadcast(
    docId: string,
    sender: TransportSocket,
    payload: string,
  ): void {
    const room = this.rooms.get(docId);

    if (!room) {
      return;
    }

    for (const socket of room) {
      if (socket !== sender) {
        socket.send(payload);
      }
    }
  }

  hasRoom(docId: string): boolean {
    return this.rooms.has(docId);
  }
}
