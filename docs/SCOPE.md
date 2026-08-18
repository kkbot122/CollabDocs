# CollabDocs — Scope

## What we are building

CollabDocs is a single-node real-time collaborative plain-text editor. Its purpose is to demonstrate Yjs CRDT convergence, the standard binary Yjs sync protocol over raw WebSockets, ephemeral Awareness presence, transient disconnect recovery, authenticated document rooms, explicit in-memory room lifecycle, and asynchronous PostgreSQL snapshot persistence.

Core user behavior:

- A user can sign up, log in, create, list, open, and delete documents.
- An owner can share a document with an existing registered collaborator by email.
- Authorized collaborators can edit the same `Y.Text` through CodeMirror 6 and see convergent content, cursors, selections, and presence.
- A user may keep editing during a temporary network interruption while the tab's in-memory `Y.Doc` remains alive. On reconnect, the standard state-vector handshake exchanges missing updates and replicas converge.
- The server loads an inactive document's latest durable snapshot into a new room, keeps the live `Y.Doc` authoritative while that room is active, asynchronously snapshots dirty state, performs a final graceful flush when the last client leaves, destroys room resources, and removes the room from memory.

The WebSocket connection is authenticated and authorized at `/ws?docId=<id>&token=<jwt>`. Once accepted, the socket is bound to its room; binary Yjs/Awareness frames do not repeat `docId`.

Initial collaborative state comes through server-side room hydration followed by the Yjs handshake. The core does not add a second REST snapshot-bootstrap path.

## What we are measuring

Benchmarks are targets for evaluation, not advance capacity claims.

- Concurrent-editor behavior at approximately 1, 10, 25, 50, and 100 simulated clients on one document; report the largest configuration that completes reliably.
- End-to-end edit propagation latency from sender update creation through server apply/broadcast to receiver apply, using a monotonic clock and reporting p50, p95, and p99.
- Yjs `applyUpdate` latency as a separate metric.
- Reconnection recovery time from successful socket reconnection until all replicas converge, over repeated trials with percentiles.
- Deterministic seeded randomized convergence scenarios, reporting scenarios, operations, replicas, seeds, and failures.
- Propagation latency while injecting 0, 50, 100, and 250 ms persistence latency, to measure whether database delay stays off the synchronization hot path.

Raw results and environment metadata must be saved. Resume claims use only measured results from the completed suite. There is no predetermined claim for 100 editors, concurrent room capacity, latency, recovery time, or zero convergence failures.

## Authority and durability

- While a room is active, its in-memory `Y.Doc` is the authoritative current collaborative state.
- While a room is inactive, PostgreSQL contains the latest durable snapshot.
- Reopening creates and hydrates a new `Y.Doc` from that snapshot before clients are served.
- Awareness is ephemeral and never persisted.
- Synchronization never waits for PostgreSQL.
- Periodic snapshots plus a graceful final flush do not provide zero-data-loss durability after a sudden crash. Updates after the latest completed snapshot may be lost; this is an explicit portfolio-project tradeoff.

## What we are deliberately not building

- A Google Docs replacement or broad productivity suite
- Rich text in the required build; only plain `Y.Text` + CodeMirror 6
- Persistent offline-first support across refresh, tab close, crash, or restart
- Public share links, invite tokens, or anonymous access
- Comments, suggestions, version history, attachments, or document export
- OAuth, password reset, email verification, or enterprise identity
- Redis, Kafka, message queues, Kubernetes, multi-instance coordination, sticky-session infrastructure, or distributed room ownership
- An untested room-count or editor-count service-level claim

Rich text and IndexedDB-backed persistent offline support are optional future work only.

## Future scaling/design discussion

The implemented system remains single-instance. A future design discussion may compare document-aware routing, consistent hashing, cross-instance pub/sub, room migration/rebalancing, and their failure/recovery implications. No one technique is presented as universally correct, and none is part of the delivered runtime.

## Resume claim templates

Before benchmarks:

> Built a real-time collaborative editor using Yjs CRDTs and raw WebSockets, with live presence, state-vector-based reconnection, authenticated document rooms, and asynchronous PostgreSQL snapshot persistence.

After real benchmark results exist, measured values may populate:

> Sustained [N] simulated concurrent editors with [X] ms p95 edit-propagation latency in a documented local benchmark and verified convergence across [Y] randomized concurrent-edit scenarios.

> Implemented state-vector-based reconnection that reconciled transient-disconnect edits in [X] ms p95 across [Y] repeated recovery trials.

Never publish placeholders or fabricated figures as results.
