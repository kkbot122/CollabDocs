# AGENTS.md — CollabDocs architectural constitution

Read this file and the assigned task in `TASKS.md` before changing the repository. CollabDocs is a deliberately narrow portfolio project: optimize for correctness, evidence, and an implementation the developer can explain in an interview—not feature breadth.

## Project purpose

Build a single-node collaborative plain-text editor that demonstrates:

- deterministic CRDT convergence with Yjs;
- the real `y-protocols` sync and Awareness protocols over raw WebSockets;
- state-vector reconciliation after a temporary disconnect;
- explicit in-memory room lifecycle management;
- authenticated, authorized document access; and
- asynchronous PostgreSQL snapshot persistence outside the synchronization hot path.

Do not describe this as a Google Docs replacement or as fully offline-first. The initial client retains edits only while its browser tab and in-memory `Y.Doc` remain alive.

## Non-negotiable architecture

- Use Yjs, never custom OT or a custom CRDT.
- Use raw WebSockets: `ws`/`@fastify/websocket` on the server and native `WebSocket` in the browser. Do not add Socket.IO.
- Use `y-protocols/sync`, `y-protocols/awareness`, `lib0/encoding`, and `lib0/decoding`. Once CRDT sync begins, do not replace or obscure their binary protocol with an invented JSON message union.
- A small temporary message used to prove join, leave, and broadcast in the transport milestone must be removed or isolated from the production sync path.
- Bind plain `Y.Text` to CodeMirror 6 using the current stable compatible binding. Rich text is optional future work, never a completion requirement.
- Run one application-server instance. Redis, Kafka, queues, Kubernetes, sticky-session infrastructure, distributed room ownership, and multi-instance coordination are out of scope.
- Share documents by adding an existing registered collaborator by email. Do not add public links, invite tokens, or anonymous access.
- The WebSocket URL is `/ws?docId=<id>&token=<jwt>`. Authenticate and authorize before joining. The accepted socket is associated once with `docId` and its `Room`; binary protocol frames do not repeat `docId` for routing.
- During an active room, its live in-memory `Y.Doc` is authoritative. During inactivity, PostgreSQL holds the latest durable snapshot.
- Never await PostgreSQL in the receive/apply/broadcast path.

Agents must not silently change these decisions, the declared stack, API surface, persistence semantics, or scope boundaries. Propose a documented decision and wait for approval if a task appears to require a change.

Core network surface:

```text
POST   /auth/signup
POST   /auth/login
POST   /documents
GET    /documents
GET    /documents/:docId
DELETE /documents/:docId
POST   /documents/:docId/share
GET    /ws?docId=<id>&token=<jwt>   # WebSocket upgrade
```

Room hydration and the Yjs handshake are the one initial-state path. Do not add a separate REST snapshot bootstrap unless a measured, documented need is approved.

## Stack

- Frontend: React, TypeScript, Vite, CodeMirror 6, stable Yjs v13-compatible `y-codemirror.next` unless current authoritative documentation requires a reviewed change
- Backend: Node.js LTS, TypeScript, Fastify, `@fastify/websocket`
- Collaboration: Yjs, `y-protocols`, `lib0`, raw WebSockets
- Persistence: PostgreSQL and Drizzle
- Tests: Vitest or Node's test runner, with deterministic integration tests

Pin compatible versions after checking current documentation. Do not substitute core libraries without approval.

## Runtime model

Each active room conceptually owns:

```text
Room
├── Y.Doc                    persistent collaborative content while active
├── Awareness                ephemeral presence only
├── connected sockets        already authenticated and authorized
├── PersistWorker/state      dirty, scheduled, and in-flight flush metadata
└── lifecycle metadata       enough to make join/leave/teardown safe
```

`Y.Doc` and Awareness are different state systems. Content in `Y.Doc` is snapshotted. Awareness may contain authenticated display identity, cursor/selection, and other presence metadata, is derived via `awareness.getStates()`, and is never stored in PostgreSQL or embedded in document snapshots.

## Yjs synchronization model

Use binary composite messages with a small top-level protocol discriminator: sync protocol or Awareness protocol. The nested sync protocol has `SyncStep1`, `SyncStep2`, and `Update` message types.

- `SyncStep1` contains the sender's encoded state vector: the known logical clock for each Yjs client.
- `SyncStep2` contains `encodeStateAsUpdate(doc, receivedStateVector)`: only the document update data the receiver is missing relative to that vector.
- `Update` carries update bytes emitted for a subsequent `Y.Doc` transaction.
- Applying an already-known Yjs update is idempotent and must not duplicate content.

For client–server connections, the client initiates the handshake:

```text
CLIENT                                      SERVER
SyncStep1(client state vector) ───────────► compute client-missing update
                              ◄──────────── SyncStep2(server → client diff)
                              ◄──────────── SyncStep1(server state vector)
compute server-missing update ────────────► SyncStep2(client → server diff)
                         replicas converge
```

Afterward, local `Y.Doc` updates travel as sync `Update` messages. Tag network-applied transactions with an origin so provider observers do not echo them indefinitely. A reconnect runs the same handshake against the still-live local `Y.Doc`; do not build a second recovery protocol or manual operation queue.

## Room lifecycle and authority

```text
first authorized client joins
  → create Room
  → load latest PostgreSQL snapshot
  → apply snapshot to the new Y.Doc
  → create Awareness and attach update/persistence observers
  → attach socket and run Yjs handshake

last client leaves
  → remove that connection's Awareness client states and broadcast removal
  → request and await a final graceful persistence flush
  → detach observers and destroy Awareness/Y.Doc resources
  → remove Room from RoomManager
```

Creation/hydration must be single-flight per `docId`: concurrent first joins must not create two rooms or expose an unhydrated room. Once last-client teardown enters `closing`, a new join waits for the final flush and destruction, then creates and hydrates a fresh room from the completed snapshot. It never revives or joins the closing room. Rooms do not remain cached indefinitely.

When a room is inactive, reopening hydrates a new `Y.Doc` from the latest PostgreSQL snapshot before it serves clients. The WebSocket Yjs handshake exchanges the state the client is missing after hydration; there is no separate core REST snapshot bootstrap.

## Sync and persistence invariants

```text
incoming collaborative update
           │
           ▼
       room Y.Doc
           ├────────► broadcast protocol update to room peers
           └────────► mark dirty / notify PersistWorker
                                   │
                                   ▼
                         asynchronous snapshot write
                                   │
                                   ▼
                              PostgreSQL
```

- Document A updates never reach document B.
- Once messages are delivered, client replicas and the server room replica converge.
- Repeated updates do not duplicate content.
- Persistence failures or artificial DB delay do not block applying or broadcasting updates.
- A completed snapshot recreates the same `Y.Doc` after the original room is destroyed.
- Awareness disappears after disconnect/timeout and is never durable document state.
- Unauthorized users never join a room or receive its state.
- A graceful final flush reduces loss on orderly shutdown. Periodic snapshots do **not** guarantee zero data loss after a process/host crash: changes after the latest completed snapshot may be lost. Never claim stronger durability.

## Code-quality rules

- Enable TypeScript strict mode. Do not use `any` in the RoomManager, protocol codec, provider, Awareness, authentication, or persistence worker.
- Keep RoomManager, codecs, and persistence scheduling framework-agnostic and independently testable.
- Keep protocol encoding/decoding explicit. Prefer small named functions over clever abstractions.
- Test behavioral invariants, boundaries, race-prone lifecycle transitions, cleanup, and failure paths rather than private implementation details.
- Never manufacture benchmark results. Save raw, machine-readable output and environment metadata.
- Do not add fields, tables, routes, or features merely because they are common in production systems.

## Teach before implementing critical tasks

Before the first Yjs protocol task, client sync provider, Awareness, reconnection, persistence worker, room hydration, or load-test/benchmark task:

1. Explain the mechanism in plain engineering language, including its data flow and failure boundary.
2. Check that the developer understands the mental model and answer questions.
3. Wait for the developer to authorize implementation.

Do not add confirmation gates to trivial setup work. Follow the assigned task's `Before implementation` section exactly.

## Implementation debriefs

After every implementation task, provide a concise `Implementation Debrief` containing:

### What changed

### Mental model

### Data flow

### Important invariants

### Why this design

### Files to understand

List the 1–3 most important files.

### Code walkthrough

Explain important functions and interactions, not boilerplate line by line.

### Failure modes

### Interview questions

Give 2–4 questions the developer should now be able to answer.

Scale the debrief to the task. Detailed debriefs are especially important for RoomManager, protocol handling, the provider, Awareness, reconnection, persistence, hydration, WebSocket authorization, randomized convergence tests, and benchmarks.

## Context7 and source verification

For every task marked `Context7: REQUIRED`, retrieve only the relevant current official APIs before implementing. For protocol-sensitive work, verify `y-protocols/sync`, `writeSyncStep1`, `writeSyncStep2`, `readSyncMessage`, Yjs update APIs, `lib0/encoding`, `lib0/decoding`, and `y-protocols/awareness`. Verify current stable Yjs/CodeMirror 6 binding compatibility before installing versions. Record material version or API findings in the debrief. If Context7 is unavailable, stop and tell the developer rather than guessing; continue only with explicit approval to use upstream primary documentation.

## Scope boundaries

Core scope excludes rich text, persistent offline storage (IndexedDB), public share links, comments, version history, file attachments, OAuth, password reset, mobile apps, multi-instance runtime infrastructure, and unmeasured capacity promises.

Future scaling discussion may compare document-aware routing, consistent hashing, cross-instance pub/sub, room migration/rebalancing, and failure/recovery tradeoffs. Present alternatives, not consistent hashing as a universal answer, and clearly separate discussion from implemented behavior.
