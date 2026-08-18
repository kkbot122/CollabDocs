# ADR 002: Use raw WebSockets over Socket.IO

## Status

Accepted

## Context

CollabDocs needs a bidirectional transport for collaborative document traffic.
The transport must support the browser's native WebSocket API, raw binary
frames for the later Yjs and Awareness protocols, and a connection that is
bound to one document room after the WebSocket upgrade.

The project is deliberately a single-node application. Distributed room
ownership, Redis, pub/sub infrastructure, and multi-instance coordination are
outside the current scope.

## Decision

Use raw WebSockets with `@fastify/websocket` on the backend and the browser's
native `WebSocket` through a framework-independent frontend wrapper.

The connection endpoint is:

```text
GET /ws?docId=<id>&token=<jwt>
```

The current transport milestone validates `docId`, associates an accepted
socket with its in-memory room, and uses a temporary text payload for transport
tests. That payload is test-only and must be removed or isolated when the Yjs
binary protocol is introduced. The payload does not carry `docId`; routing is
based on the connection's accepted query context.

The production synchronization protocol will use the standard binary
`y-protocols` messages over this transport. Raw WebSockets are the transport
choice, not a replacement for the Yjs protocol.

## Alternatives considered

### Socket.IO

Rejected. Socket.IO adds its own event and framing layer, while this project
needs direct control of binary WebSocket frames for the standard Yjs sync and
Awareness protocols. It would also obscure the transport boundary that this
milestone is intended to demonstrate.

### Server-Sent Events and HTTP polling

Rejected. They do not provide the required symmetric, low-level client-to-server
message channel for collaborative updates and binary protocol frames.

### Distributed transport or pub/sub infrastructure

Deferred. Redis, Kafka, queues, and multi-instance coordination are outside the
single-node scope. The current room registry is intentionally in memory.

## Consequences

### Positive

- The backend and browser use the same standard WebSocket transport model.
- Binary payloads can pass through without an invented JSON synchronization
  envelope.
- The document binding and room lifecycle remain explicit and testable.
- The later Yjs provider can use the standard protocol over the established
  connection.

### Tradeoffs

- The application owns connection lifecycle, close cleanup, room membership,
  error handling, and future reconnection behavior.
- Authentication and authorization must be implemented at the upgrade boundary
  in a later task.
- The current in-memory room registry is limited to one application instance.
- The temporary transport fixture is intentionally not a durable protocol and
  must not be carried into production synchronization.

## Evidence

The decision is supported by the completed transport milestone:

- T007 tested the real `/ws` endpoint, exact temporary-payload handling,
  invalid `docId` rejection, and clean socket closure.
- T008 unit-tested room creation, idempotent leave, sender exclusion, and
  isolation between document IDs.
- T009 tested the browser-side wrapper's open, send, receive, error, close,
  binary-send, and intentional-destroy behavior.
- T010 used three real WebSocket clients to verify same-room delivery,
  cross-room isolation, and removal of empty rooms. The full backend suite
  passed with 11 tests at that milestone.

These tests establish transport and room-lifecycle behavior. They do not claim
Yjs convergence, Awareness behavior, reconnection recovery, authentication,
capacity, latency, or performance results.
