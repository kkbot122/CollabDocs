import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { RawData } from "ws";
import { TEMPORARY_TRANSPORT_TEST_PAYLOAD } from "../transport-test-fixture.js";
import { RoomManager } from "./room-manager.js";

interface WebSocketQuery {
  docId?: string;
}

function hasValidDocId(docId: unknown): docId is string {
  return typeof docId === "string" && docId.trim().length > 0;
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

        roomManager.join(docId, socket);

        const onMessage = (message: RawData): void => {
          if (message.toString() === TEMPORARY_TRANSPORT_TEST_PAYLOAD) {
            roomManager.broadcast(
              docId,
              socket,
              TEMPORARY_TRANSPORT_TEST_PAYLOAD,
            );
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
