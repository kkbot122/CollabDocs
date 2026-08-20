import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { RawData } from "ws";
import {
  encodeSyncUpdate,
  isRemoteUpdateOrigin,
  readAwarenessFrame,
  readSyncFrame,
} from "./protocol-codec.js";
import { RoomManager } from "./room-manager.js";

interface WebSocketQuery {
  docId?: string;
}

function hasValidDocId(docId: unknown): docId is string {
  return typeof docId === "string" && docId.trim().length > 0;
}

function rawDataToUint8Array(message: RawData): Uint8Array {
  if (Array.isArray(message)) {
    const length = message.reduce((total, chunk) => total + chunk.byteLength, 0);
    const combined = new Uint8Array(length);
    let offset = 0;

    for (const chunk of message) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return combined;
  }

  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

export function registerWebSocketServer(
  app: FastifyInstance,
  roomManager = new RoomManager(),
): void {
  app.register(async (instance) => {
    await instance.register(fastifyWebsocket);

    instance.get<{ Querystring: WebSocketQuery }>(
      "/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (!hasValidDocId(request.query.docId)) {
            return reply.code(400).send({ error: "Invalid docId" });
          }
        },
      },
      (socket, request) => {
        const docId = request.query.docId;

        if (!hasValidDocId(docId)) {
          return;
        }

        const room = roomManager.join(docId, socket);

        const onMessage = (message: RawData): void => {
          const updates: Uint8Array[] = [];
          const stopObserving = room.observeUpdates((update, origin) => {
            if (isRemoteUpdateOrigin(origin)) {
              updates.push(update);
            }
          });

          try {
            const frame = rawDataToUint8Array(message);
            const frameKind = frame[0];

            if (frameKind === 1) {
              readAwarenessFrame(frame, room.awareness, socket);
              return;
            }

            const reply = readSyncFrame(frame, room.doc);

            for (const update of updates) {
              roomManager.broadcast(docId, socket, encodeSyncUpdate(update));
            }

            if (reply.byteLength > 0) {
              socket.send(reply);
            }
          } catch {
            socket.close(1002, "Invalid sync frame");
          } finally {
            stopObserving();
          }
        };

        const cleanup = (): void => {
          roomManager.leave(docId, socket);
          socket.off("message", onMessage);
          socket.off("error", cleanup);
          socket.off("close", cleanup);
        };

        socket.on("message", onMessage);
        socket.once("error", cleanup);
        socket.once("close", cleanup);
      },
    );
  });
}
