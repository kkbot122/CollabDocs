# TASKS.md — CollabDocs implementation plan

Execute one task at a time after reading `AGENTS.md`. Do not advance until the pass condition is met. Tasks intentionally prioritize transport, CRDT sync, editor integration, Awareness, reconnection, persistence, authentication, the real frontend flow, verification, and benchmarks—in that order.

Locked stack: Fastify, Drizzle, Vite, React, TypeScript, CodeMirror 6, Yjs, `y-protocols`, `lib0`, raw WebSockets, and PostgreSQL.

For every task that changes implementation, finish with the `Implementation Debrief` required by `AGENTS.md`. Keep setup-task debriefs short; use the full depth for RoomManager, protocol, provider, Awareness, reconnection, persistence, hydration, WebSocket authorization, randomized convergence, and benchmarks. Do not fabricate files, commands, or results in a debrief.

For every `Before implementation` gate: teach the mechanism, answer questions, and wait for the developer's authorization before writing code.

---

## Milestone 0 — Foundation

### T001 — Monorepo scaffolding

**Goal:** Create minimal `backend/` and `frontend/` TypeScript projects.

**Why this task exists:** Establish the layout used by later work without starting features.

**Files to inspect:** `docs/AGENTS.md`, repository root.

**Files likely to change:** root `package.json`, `.gitignore`, `README.md`; backend/frontend package and TypeScript configuration; Vite-generated frontend files.

**Implementation requirements:** Use npm workspaces or two simple package roots; enable strict TypeScript; keep the README factual and point to the three planning documents.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** None.

**Do not:** Add Fastify, Drizzle, Yjs, WebSockets, database code, or feature UI.

**Pass condition:** Backend typecheck and the default frontend production build succeed.

**Implementation Debrief requirements:** Brief debrief; explain the workspace boundary and commands.

### T002 — Backend health-check skeleton

**Goal:** Build a testable Fastify app with `GET /health`.

**Why this task exists:** Establish the server entry point independently of networking and persistence.

**Files to inspect:** Backend package and TypeScript configuration.

**Files likely to change:** `backend/src/app.ts`, `backend/src/index.ts`, backend tests and package manifest.

**Implementation requirements:** Export `buildApp()` separately from `listen()`; return `{ status: "ok" }`; configure a test runner.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T001.

**Do not:** Add WebSockets, database access, auth, or other routes.

**Pass condition:** An injected request test receives status 200 and the expected body.

**Implementation Debrief requirements:** Brief debrief; identify app construction versus process startup.

### T003 — Frontend skeleton

**Goal:** Replace Vite demo content with a minimal CollabDocs placeholder.

**Why this task exists:** Provide a clean mount point without prematurely designing UI.

**Files to inspect:** Vite-generated frontend source.

**Files likely to change:** `frontend/src/App.tsx`, `frontend/src/main.tsx`, related styles/tests.

**Implementation requirements:** Render a single accessible heading; keep the build warning-free.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T001.

**Do not:** Add routing, editor, auth, or API calls.

**Pass condition:** Frontend build and its minimal render test pass.

**Implementation Debrief requirements:** Brief debrief.

### T004 — PostgreSQL and Drizzle connection

**Goal:** Configure a Drizzle client and a database health probe without defining tables.

**Why this task exists:** Separate environment/connectivity failures from schema failures.

**Files to inspect:** Backend app and package files.

**Files likely to change:** `backend/src/db/client.ts`, `backend/drizzle.config.ts`, `backend/.env.example`, backend package manifest, health route/test.

**Implementation requirements:** Read `DATABASE_URL` from the environment; never commit a secret; use a single selected PostgreSQL driver; expose `GET /health/db` solely as a connectivity probe.

**Context7 requirement:** REQUIRED — verify current Drizzle PostgreSQL client and drizzle-kit configuration APIs only.

**Depends on:** T002.

**Do not:** Define tables or generate migrations.

**Pass condition:** Against a configured local database, `GET /health/db` returns `{ db: "ok" }`.

**Implementation Debrief requirements:** Brief debrief including the selected driver and verified API version.

### T005 — Core schema and initial migration

**Goal:** Define users, documents, collaborators, and durable document state.

**Why this task exists:** Lock the minimal durable model before persistence and authorization depend on it.

**Files to inspect:** `docs/AGENTS.md`, Drizzle client/config.

**Files likely to change:** `backend/src/db/schema.ts`, generated migration files.

**Implementation requirements:** Model users (`userId`, unique email, password hash, optional avatar), documents (`docId`, owner, title, timestamps), registered collaborators, and `doc_state` (`docId`, binary Yjs state update, version, timestamp). A join table is preferred for collaborators because authorization and idempotent sharing become explicit; document the choice. No rooms or Awareness table.

**Context7 requirement:** REQUIRED — verify current PostgreSQL table, UUID, timestamp, binary/bytea, foreign-key, unique-index, migration, and transaction APIs.

**Depends on:** T004.

**Do not:** Add document-count constraints, invite tokens, public links, session tables, or room tables.

**Pass condition:** Migration applies cleanly to a fresh database and schema tests confirm keys/constraints.

**Implementation Debrief requirements:** Explain entity relationships and why transient state is absent.

---

## Milestone 1 — Raw WebSocket transport

The temporary payload in this milestone exists only to prove connection, join, leave, room isolation, and broadcast. It is not the Yjs synchronization protocol and must not constrain Milestone 2.

### T006 — Temporary transport-test message

**Goal:** Define the smallest temporary payload needed for transport tests.

**Why this task exists:** Prove framing and broadcast without conflating transport bugs with protocol bugs.

**Files to inspect:** Backend/frontend package layout.

**Files likely to change:** A small transport-test fixture/type shared or duplicated between test surfaces.

**Implementation requirements:** Use a clearly named test-only text or binary payload; document its planned removal/isolation when Yjs begins. Routing comes from the connection `docId`, not the payload.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T002, T003.

**Do not:** Define invented JSON synchronization/presence message kinds or any long-lived application protocol.

**Pass condition:** Both projects typecheck and the contract is explicitly marked temporary.

**Implementation Debrief requirements:** Briefly distinguish transport framing from Yjs protocol semantics.

### T007 — Bare WebSocket endpoint

**Goal:** Accept `/ws?docId=<id>` and echo the temporary test payload to its sender.

**Why this task exists:** Validate upgrade, send, receive, and close independently.

**Files to inspect:** `backend/src/app.ts`, T006 fixture.

**Files likely to change:** `backend/src/realtime/ws-server.ts`, app registration, backend package/tests.

**Implementation requirements:** Register the current Fastify WebSocket plugin; reject a missing/invalid `docId`; ensure cleanup runs on close. Authentication comes later.

**Context7 requirement:** REQUIRED — verify current `@fastify/websocket` registration, route, binary-message, close, and test APIs.

**Depends on:** T006.

**Do not:** Add Yjs, rooms, reconnection, or auth.

**Pass condition:** A real WebSocket integration test gets an exact echo and observes clean closure.

**Implementation Debrief requirements:** Explain upgrade and socket lifetime.

### T008 — Transport-only room registry

**Goal:** Track sockets by `docId` and broadcast temporary payloads only within one room.

**Why this task exists:** Establish room isolation and join/leave behavior before adding CRDT state.

**Files to inspect:** WebSocket endpoint and transport fixture.

**Files likely to change:** `backend/src/realtime/room-manager.ts`, `ws-server.ts`, unit tests.

**Implementation requirements:** Keep the manager framework-agnostic behind a minimal socket interface; create a transport room on first join; remove it on last leave; make leave idempotent; broadcast to peers, excluding sender.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T007.

**Do not:** Add `Y.Doc`, Awareness, persistence, or permanent protocol types.

**Pass condition:** Unit tests prove join, leave, last-member deletion, sender exclusion, and A/B room isolation.

**Implementation Debrief requirements:** Full RoomManager debrief with lifecycle and invariants.

### T009 — Raw browser WebSocket wrapper

**Goal:** Create a framework-independent client connection wrapper for the transport test.

**Why this task exists:** Separate native WebSocket state from React and the later Yjs provider.

**Files to inspect:** T006 fixture and frontend configuration.

**Files likely to change:** `frontend/src/realtime/ws-client.ts`, tests.

**Implementation requirements:** Accept server URL and `docId`; expose connect/send/message/close signals; make intentional destroy suppress future work. Design binary support even though the temporary test may use text.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T006.

**Do not:** Add Yjs, React hooks, reconnect, or tokens.

**Pass condition:** Mock or real-server tests cover open, send, receive, error/close, and intentional destroy.

**Implementation Debrief requirements:** Explain the transport abstraction boundary.

### T010 — Raw transport integration test

**Goal:** Prove join, broadcast, isolation, and leave with real sockets.

**Why this task exists:** It is the transport milestone exit test.

**Files to inspect:** T007–T009 implementation and tests.

**Files likely to change:** Backend integration test only.

**Implementation requirements:** Connect two clients to one document and one client to another; assert only the intended peer receives a payload; close clients and assert the room disappears.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T008, T009.

**Do not:** Add features while writing the test or begin Yjs if this fails.

**Pass condition:** Deterministic integration test passes without timing sleeps that hide races.

**Implementation Debrief requirements:** Explain what this test proves and does not prove.

### T011 — Record the raw-WebSocket decision

**Goal:** Create `docs/decisions/002-raw-websocket-over-socketio.md` after transport is proven.

**Why this task exists:** Capture an implemented, interview-relevant decision at the point evidence exists.

**Files to inspect:** `docs/AGENTS.md`, T007–T010 results.

**Files likely to change:** Only `docs/decisions/002-raw-websocket-over-socketio.md`.

**Implementation requirements:** Record context, decision, alternatives, consequences, and evidence; distinguish raw transport from the Yjs protocol.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T010.

**Do not:** Claim performance or simplicity results that were not measured.

**Pass condition:** ADR accurately describes the implemented transport and tradeoffs.

**Implementation Debrief requirements:** Short documentation debrief.

---

## Milestone 2 — Binary Yjs synchronization

### T012 — Yjs room state and deterministic teardown

**Goal:** Replace transport-only rooms with active rooms containing a `Y.Doc` and sockets.

**Why this task exists:** Establish ownership and cleanup before protocol traffic mutates shared state.

**Files to inspect:** RoomManager and its tests; `docs/AGENTS.md` runtime model.

**Files likely to change:** Backend package manifest, RoomManager, tests.

**Implementation requirements:** Install compatible Yjs/y-protocols/lib0 versions; create one `Y.Doc` for a first join; reuse it for later joins; detach observers, destroy it, and remove the room after the last leave. Persistence/hydration will refine teardown later without changing authority rules.

**Context7 requirement:** REQUIRED — verify current stable Yjs v13 `Y.Doc` construction, update events, `getText`, `destroy`, and y-protocols/lib0 compatibility.

**Depends on:** T010.

**Do not:** Keep rooms forever, implement sync messages, or persist state.

**Pass condition:** Tests prove one doc per active room, cross-room isolation, and resource destruction on last leave.

**Implementation Debrief requirements:** Full lifecycle/authority debrief.

### T013 — Binary protocol codec

**Goal:** Encode and decode the standard composite sync protocol with no socket dependency.

**Why this task exists:** Make the most protocol-sensitive logic directly testable.

**Files to inspect:** Room model and current upstream protocol documentation.

**Files likely to change:** `backend/src/realtime/protocol-codec.ts`, focused tests; an equivalent shared/client module if justified.

**Before implementation:** Explain state vectors, `SyncStep1`, `SyncStep2`, `Update`, `readSyncMessage`, composite framing, and the client–server handshake; wait for authorization.

**Implementation requirements:** Use `lib0/encoding` and `lib0/decoding`; top-level frame kind distinguishes sync from Awareness; call `writeSyncStep1`, `writeSyncStep2`, and `readSyncMessage` as their current APIs require; return any bytes written into the reply encoder. Add a transaction origin strategy to prevent network echo loops.

**Context7 requirement:** REQUIRED — verify `y-protocols/sync`, message constants, `writeSyncStep1`, `writeSyncStep2`, `readSyncMessage`, Yjs update APIs, and lib0 encoder/decoder APIs.

**Depends on:** T012.

**Do not:** Invent JSON sync envelopes, add `docId` to frames, or manually compute CRDT operations.

**Pass condition:** Direct two-`Y.Doc` tests exercise both handshake directions and subsequent Update messages to convergence; repeated delivery is idempotent.

**Implementation Debrief requirements:** Full protocol debrief including exact frame nesting and function interaction.

### T014 — Server synchronization integration

**Goal:** Route binary sync frames between each socket and its room `Y.Doc`.

**Why this task exists:** Connect the verified protocol codec to the verified room transport.

**Files to inspect:** WebSocket server, RoomManager, protocol codec.

**Files likely to change:** `ws-server.ts`, RoomManager/codec adapters, integration tests; temporary contract references.

**Implementation requirements:** The client sends initial `SyncStep1`; the server responds with `SyncStep2` immediately followed by server `SyncStep1`; apply client `SyncStep2`/Update to the room doc; broadcast resulting sync Update frames to other room sockets. Associate socket→room at connection time. Remove or isolate the temporary transport message path.

**Context7 requirement:** REQUIRED — recheck the official client–server handshake ordering and `readSyncMessage` reply behavior before integration.

**Depends on:** T013.

**Do not:** Have the server initiate the handshake, repeat `docId` per frame, await persistence, or add Awareness.

**Pass condition:** Real-socket tests show a pre-populated client and pre-populated server exchange missing changes in both directions, then relay later edits; other rooms receive nothing.

**Implementation Debrief requirements:** Full server data-flow and failure-mode debrief.

### T015 — Client sync provider

**Goal:** Build a framework-independent provider that owns a live client `Y.Doc` and speaks the same binary protocol.

**Why this task exists:** Isolate collaboration state and transport from React/editor lifetime.

**Files to inspect:** Browser WebSocket wrapper, server codec/integration.

**Files likely to change:** `frontend/src/realtime/sync-provider.ts`, frontend protocol helpers/tests, package manifest.

**Before implementation:** Explain provider ownership, first-connect handshake, local versus network transaction origins, and teardown; wait for authorization.

**Implementation requirements:** Send client `SyncStep1` on open; process server `SyncStep2` and `SyncStep1`; reply to server `SyncStep1`; encode local doc updates as sync Update frames; never resend network-origin updates; expose `doc`, status events, and `destroy()`.

**Context7 requirement:** REQUIRED — verify current Yjs update event/origin patterns and the same protocol/lib0 APIs on the browser build.

**Depends on:** T014, T009.

**Do not:** Use `y-websocket`, add reconnect, React hooks, Awareness, or a manual operation queue.

**Pass condition:** Two providers against the real server converge from different initial states and on later edits; destroy removes listeners and closes the socket.

**Implementation Debrief requirements:** Full provider mental model and code walkthrough.

### T016 — Deterministic convergence and idempotence tests

**Goal:** Validate this transport integration under concurrent edits and repeated delivery.

**Why this task exists:** Demonstrate integration correctness without claiming to prove the Yjs algorithm.

**Files to inspect:** Provider, server protocol integration, existing tests.

**Files likely to change:** Backend or cross-workspace integration tests.

**Implementation requirements:** Exercise concurrent inserts, edits at distinct/overlapping positions, deletes, reordered delivery where the harness permits, and duplicate Update frames; eventually assert client A text = client B text = server room text.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T015.

**Do not:** Assert one hand-picked text ordering when convergence is the invariant; claim formal CRDT verification.

**Pass condition:** All deterministic scenarios converge and duplicate delivery never duplicates content.

**Implementation Debrief requirements:** Explain tested invariants and limitations.

### T017 — CodeMirror 6 plain-text binding and Yjs ADR

**Goal:** Bind the provider's `Y.Text` to CodeMirror 6 and record why Yjs was chosen.

**Why this task exists:** Make synchronization user-visible and document the core decision after it works.

**Files to inspect:** Provider, frontend app, current binding package documentation.

**Files likely to change:** `frontend/src/components/Editor.tsx`, `App.tsx`, frontend package/tests, `docs/decisions/001-yjs-over-custom-ot.md`.

**Implementation requirements:** Verify and use the current stable CodeMirror 6/Yjs v13-compatible binding (expected `y-codemirror.next`); bind one plain `Y.Text`; manage editor/provider teardown; write the ADR with context, decision, alternatives, consequences, and test evidence.

**Context7 requirement:** REQUIRED — verify current stable `y-codemirror.next`, Yjs v13, and CodeMirror 6 peer/API compatibility before installation.

**Depends on:** T016.

**Do not:** Add rich text, hand-roll editor↔Y.Text glue, or add presence before Awareness exists.

**Pass condition:** Two browser tabs on one hardcoded document converge while typing, and the ADR matches the implementation.

**Implementation Debrief requirements:** Explain the editor-binding boundary and version choice.

---

## Milestone 3 — Awareness and presence

### T018 — Room Awareness protocol

**Goal:** Give every active room a distinct Awareness instance and relay standard Awareness frames.

**Why this task exists:** Presence is ephemeral protocol state, not collaborative document content.

**Files to inspect:** RoomManager, WebSocket routing, binary codec.

**Files likely to change:** Awareness codec/handler, RoomManager, WebSocket routing, tests.

**Before implementation:** Explain Awareness clocks/state, update encoding, `getStates()`, heartbeat/timeout semantics, disconnect cleanup, and why it is not persisted; wait for authorization.

**Implementation requirements:** Use `Awareness`, `encodeAwarenessUpdate`, `applyAwarenessUpdate`, `removeAwarenessStates`, and Awareness update/change events; multiplex with the top-level Awareness discriminator; derive users from `getStates()`; track which Awareness client IDs each socket announced so disconnect removes the correct states and broadcasts removal.

**Context7 requirement:** REQUIRED — verify all named Awareness APIs and current timeout/refresh semantics.

**Depends on:** T016.

**Do not:** Create a parallel presence-list message, persist Awareness, place presence in `Y.Doc`, or trust client-supplied identity as authoritative.

**Pass condition:** Tests prove room isolation, update propagation, state derivation from `getStates()`, graceful/abrupt disconnect removal, and no document-state mutation.

**Implementation Debrief requirements:** Full Awareness versus Y.Doc debrief.

### T019 — Client Awareness integration

**Goal:** Extend the provider with local and remote Awareness state.

**Why this task exists:** Give the UI one standard source for identity, cursor, selection, and online state.

**Files to inspect:** Sync provider and server Awareness handler.

**Files likely to change:** Provider, client codec/helpers, tests.

**Before implementation:** Explain local state ownership, encoded updates, remote state subscription, cleanup, and authenticated identity overlay; wait for authorization.

**Implementation requirements:** Expose the provider's Awareness instance; send its encoded local updates; apply remote updates with a network origin; re-advertise local state after a future reconnect through a reusable method; clear/broadcast local state on graceful destroy where possible.

**Context7 requirement:** REQUIRED — verify `setLocalStateField`, `getStates`, `on('update')`, `on('change')`, encoding/apply/removal, and destroy behavior.

**Depends on:** T018, T015.

**Do not:** Build a parallel presence array or persist state.

**Pass condition:** Two provider instances observe each other's states and removal through `getStates()`.

**Implementation Debrief requirements:** Full client Awareness data flow and identity caveats.

### T020 — Remote cursors and presence UI

**Goal:** Display remote selections/cursors and a simple connected-user list.

**Why this task exists:** Complete the visible presence feature while keeping protocol state canonical.

**Files to inspect:** Editor, provider Awareness surface, current binding docs.

**Files likely to change:** Editor component, `PresenceList` component, focused UI tests/styles.

**Implementation requirements:** Use binding-provided Awareness cursor support; render the list from `awareness.getStates()`; use temporary clearly labeled identities until auth integration replaces them; ensure adequate cursor color contrast.

**Context7 requirement:** REQUIRED — verify the binding's remote cursor/selection API for the pinned compatible version.

**Depends on:** T019, T017.

**Do not:** Hand-build a second presence store or add UI polish unrelated to clarity.

**Pass condition:** Two tabs show remote cursor/selection and exactly the currently aware users; closing one removes it.

**Implementation Debrief requirements:** Explain how Awareness reaches CodeMirror and the list.

---

## Milestone 4 — Transient disconnect recovery

### T021 — Reconnecting WebSocket transport

**Goal:** Re-establish unexpectedly closed client sockets with bounded backoff.

**Why this task exists:** Separate transport recovery from state reconciliation.

**Files to inspect:** Browser WebSocket wrapper/tests.

**Files likely to change:** `ws-client.ts`, fake-clock tests.

**Implementation requirements:** Use exponential or stepped backoff with cap and jitter policy documented; expose connection generation/status/open events; prevent reconnect after intentional destroy; prevent duplicate concurrent attempts; queue no semantic edits.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T019.

**Do not:** Implement a Yjs-specific recovery path or promise a fixed recovery time.

**Pass condition:** Fake-clock tests cover drop, repeated failure, eventual open, single active socket, and destroy cancellation.

**Implementation Debrief requirements:** Explain the transport state machine and failure modes.

### T022 — State-vector resynchronization on reconnect

**Goal:** Reuse the initial Yjs handshake after every successful reconnection.

**Why this task exists:** Reconcile server-side and in-memory client edits without full-document replacement or a custom queue.

**Files to inspect:** Provider, WebSocket wrapper, server handshake, Awareness integration.

**Files likely to change:** Sync provider and tests; server cleanup only if tests expose a bug.

**Before implementation:** Walk through connected → drop → both replicas edit → socket reconnects → client `SyncStep1` → bidirectional missing updates → convergence; distinguish this from persistent offline-first support; wait for authorization.

**Implementation requirements:** On each open generation send fresh client `SyncStep1`; complete the same bidirectional handshake; keep the local `Y.Doc` alive throughout the drop; re-advertise local Awareness after sync/open; server leave must remove stale socket/Awareness state idempotently.

**Context7 requirement:** REQUIRED — re-verify client–server handshake ordering and state-vector semantics; do not infer a separate reconnect protocol.

**Depends on:** T021, T014.

**Do not:** Add IndexedDB, manual operation buffering, document replacement, or the term offline-first.

**Pass condition:** Automated integration test edits both connected and disconnected replicas, reconnects, and asserts both clients and server converge exactly once.

**Implementation Debrief requirements:** Full reconnection mental model, limits, and walkthrough.

### T023 — Reconnection and room-isolation stress cases

**Goal:** Harden reconnect behavior against repeated drops and cross-room leakage.

**Why this task exists:** Recovery paths are race-prone and need invariant tests beyond a happy path.

**Files to inspect:** T021–T022 tests and RoomManager.

**Files likely to change:** Integration tests; implementation only for scoped defects found.

**Implementation requirements:** Cover repeated reconnect, duplicate frame delivery, a disconnect during handshake, intentional destroy, Awareness cleanup/readvertisement, and simultaneous activity in another document.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T022.

**Do not:** Introduce sleeps as correctness mechanisms or broaden into persistence recovery.

**Pass condition:** Deterministic tests prove eventual convergence, idempotence, cleanup, and room isolation.

**Implementation Debrief requirements:** Explain the races exercised and any scoped fix.

---

## Milestone 5 — Asynchronous snapshot persistence and room hydration

### T024 — Persistence worker state machine

**Goal:** Implement dirty tracking, bounded snapshot scheduling, flush serialization/coalescing, and retry/error state behind an injected writer.

**Why this task exists:** Keep database work independent of the latency-sensitive synchronization path.

**Files to inspect:** RoomManager update flow and `docs/AGENTS.md` persistence invariants.

**Files likely to change:** `backend/src/persistence/persist-worker.ts`, fake-clock unit tests.

**Before implementation:** Explain dirty marking, snapshot capture, async write, updates arriving in flight, coalescing, final flush, and hard-crash loss window; wait for authorization.

**Implementation requirements:** Trigger after configured time and/or update count; capture `encodeStateAsUpdate` without awaiting storage in the update/broadcast handler; serialize per-room writes; if updates arrive during a write, retain dirty state for another flush; expose `flushNow()` for graceful teardown and `destroy()` only after settled cleanup; surface errors without unhandled rejections.

**Context7 requirement:** REQUIRED — verify current Yjs state encoding/update event APIs used to capture a snapshot; internal scheduling needs no library lookup.

**Depends on:** T023, T005.

**Do not:** Await the database in WebSocket message handling, claim zero-loss durability, or persist Awareness.

**Pass condition:** Fake-writer tests cover time/count triggers, in-flight coalescing, later updates, failure/retry policy, and final flush.

**Implementation Debrief requirements:** Full worker state machine and durability tradeoff.

### T025 — Snapshot repository

**Goal:** Store and load the latest binary Yjs state update atomically.

**Why this task exists:** Isolate Drizzle/PostgreSQL concerns from lifecycle scheduling.

**Files to inspect:** Schema, Drizzle client, worker writer interface.

**Files likely to change:** `backend/src/persistence/doc-state-repo.ts`, database integration tests.

**Implementation requirements:** Upsert snapshot/version/timestamp by `docId`; prevent an older completion from overwriting a newer version; return no-state distinctly; preserve bytes exactly.

**Context7 requirement:** REQUIRED — verify current Drizzle PostgreSQL upsert, comparison/conditional update, transaction, and bytea mapping APIs.

**Depends on:** T024, T005.

**Do not:** Store Awareness or append every keystroke/update as a row.

**Pass condition:** Integration tests prove insert, newer replacement, stale-version rejection, binary round-trip, and load.

**Implementation Debrief requirements:** Explain version ordering and repository boundary.

### T026 — Single-flight room hydration

**Goal:** Load inactive document state into one new room before any joining client is served.

**Why this task exists:** Re-establish PostgreSQL→`Y.Doc` authority safely on room reopen.

**Files to inspect:** RoomManager, snapshot repo, persistence worker.

**Files likely to change:** RoomManager/lifecycle module, wiring, concurrency tests.

**Before implementation:** Explain inactive authority, first-join hydration, missing snapshot behavior, concurrent first joins, and load failure; wait for authorization.

**Implementation requirements:** Make get-or-create asynchronous and single-flight per `docId`; create a fresh `Y.Doc`; load/apply snapshot before exposing the room or handshaking; attach observers only in an order that does not mark hydration as a user edit; create Awareness and worker; fail all waiting joins cleanly if hydration fails.

**Context7 requirement:** REQUIRED — verify `Y.applyUpdate`, transaction origin, and document lifecycle APIs relevant to hydration.

**Depends on:** T025.

**Do not:** Serve an unhydrated room, fetch a snapshot separately in every client, or merge Awareness into the snapshot.

**Pass condition:** Tests prove persisted restoration, empty first open, one load for concurrent joins, and clean failure without leaked rooms.

**Implementation Debrief requirements:** Full authority transition, concurrency, and data-flow debrief.

### T027 — Last-client final flush and room destruction

**Goal:** Complete the active→inactive lifecycle on the last leave.

**Why this task exists:** Bound memory use and maximize graceful durability without overstating crash safety.

**Files to inspect:** Hydrated RoomManager, worker, Awareness cleanup.

**Files likely to change:** RoomManager/lifecycle tests and shutdown wiring.

**Implementation requirements:** On last leave, transition to closing; a new join must wait for final flush/destruction and then create/hydrate a fresh room rather than reviving the closing room; remove connection Awareness states; await `flushNow()` outside the sync hot path; detach observers; destroy worker/Awareness/`Y.Doc`; remove room. Add application shutdown that requests the same graceful flush for active rooms.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T026.

**Do not:** Leave rooms cached forever, drop dirty state on graceful close, or claim this protects hard crashes.

**Pass condition:** Tests prove final snapshot, destruction, manager removal, new-join race handling, and fresh hydration after closure.

**Implementation Debrief requirements:** Full teardown order and crash-window discussion.

### T028 — Persistence invariants and delayed-writer isolation

**Goal:** Verify restoration and prove by measurement that injected storage delay is not awaited by sync propagation.

**Why this task exists:** Protect the architectural reason for asynchronous persistence.

**Files to inspect:** Worker, RoomManager, repository, sync integration tests.

**Files likely to change:** Persistence/realtime integration tests and test fixtures.

**Implementation requirements:** Persist, destroy the original room, hydrate a new room, and compare state; inject controlled writer delay/failure while clients edit and assert propagation completes independently; verify Awareness is absent after rehydration.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T027.

**Do not:** Predetermine benchmark conclusions or use DB completion as the broadcast signal.

**Pass condition:** Restoration is exact and controlled delayed writes do not gate receiver application in the integration harness.

**Implementation Debrief requirements:** Explain evidence for restoration and hot-path isolation.

### T029 — Record room lifecycle and async persistence decisions

**Goal:** Create ADRs 004 and 005 from the implemented behavior.

**Why this task exists:** Preserve the authority, lifecycle, and durability rationale for interviews and maintenance.

**Files to inspect:** T024–T028 implementation/tests and `docs/AGENTS.md`.

**Files likely to change:** `docs/decisions/004-room-lifecycle.md`, `docs/decisions/005-async-persistence.md`.

**Implementation requirements:** Record context, chosen transitions/hot path, alternatives, consequences, crash-loss window, and test evidence.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T028.

**Do not:** Present periodic snapshots as zero-loss durability or a database as live authority during active rooms.

**Pass condition:** Both ADRs exactly match observed lifecycle and persistence behavior.

**Implementation Debrief requirements:** Short documentation debrief highlighting tradeoffs.

---

## Milestone 6 — Authentication and authorization

### T030 — Signup

**Goal:** Register a user with a securely hashed password.

**Why this task exists:** Establish registered identities used by collaboration sharing.

**Files to inspect:** User schema and Fastify app.

**Files likely to change:** Auth route/repository, package manifest, tests.

**Implementation requirements:** Validate normalized email/password policy; reject duplicates without storing plaintext; return safe user fields only.

**Context7 requirement:** REQUIRED — verify current supported Argon2 library hash/verify API and safe defaults.

**Depends on:** T005.

**Do not:** Add OAuth, email verification, password reset, or document limits.

**Pass condition:** New signup succeeds, duplicate email is handled, and stored hash verifies without appearing in responses.

**Implementation Debrief requirements:** Explain password boundary and failure handling.

### T031 — Login and JWT helpers

**Goal:** Verify credentials and issue/verify expiring JWTs.

**Why this task exists:** Provide stateless identity for REST and WebSocket authorization.

**Files to inspect:** Signup route/repository and environment example.

**Files likely to change:** Login route, `backend/src/auth/jwt.ts`, package manifest, environment example, tests.

**Implementation requirements:** Use secret/config from environment; include stable user ID and expiry; return the same unauthorized response for unknown email/wrong password; centralize sign/verify.

**Context7 requirement:** REQUIRED — verify current chosen JWT library sign/verify, expiry, algorithm, and typing APIs.

**Depends on:** T030.

**Do not:** Add refresh tokens, server sessions, or leak credential distinctions.

**Pass condition:** Correct credentials produce a verifiable token; invalid credentials/token/expiry fail safely.

**Implementation Debrief requirements:** Explain claims, signature verification, and expiry.

### T032 — REST authentication guard

**Goal:** Authenticate protected HTTP routes and expose typed user identity.

**Why this task exists:** Centralize consistent REST rejection and identity plumbing.

**Files to inspect:** JWT helper, app construction.

**Files likely to change:** Fastify auth guard/declarations and tests.

**Implementation requirements:** Parse `Authorization: Bearer`; verify; attach typed user ID; leave auth/health public.

**Context7 requirement:** REQUIRED — verify current Fastify request decoration and pre-handler typing APIs.

**Depends on:** T031.

**Do not:** Reimplement JWT verification or apply query-token semantics to REST.

**Pass condition:** Valid requests reach handlers with identity; missing/malformed/invalid tokens return 401.

**Implementation Debrief requirements:** Explain middleware order and trust boundary.

### T033 — Authorized document CRUD

**Goal:** Create, list, get, and owner-delete document metadata with access checks.

**Why this task exists:** Provide the real resources that authenticated rooms protect.

**Files to inspect:** Document/collaborator schema and auth guard.

**Files likely to change:** Document repository/routes and integration tests.

**Implementation requirements:** Owners create/delete; owners and collaborators list/get; authorization is performed server-side; deletion handles durable state/collaborator rows transactionally according to schema constraints.

**Context7 requirement:** REQUIRED — verify only current Drizzle query/transaction APIs needed for these operations.

**Depends on:** T032, T029.

**Do not:** Add rename, public access, document-count maximum, or link tokens.

**Pass condition:** Integration tests cover owner, collaborator, unrelated user, list isolation, and deletion rules.

**Implementation Debrief requirements:** Explain authorization predicates and deletion consistency.

### T034 — Share with registered collaborator by email

**Goal:** Let an owner add an existing registered user as a collaborator.

**Why this task exists:** Implement narrow user-to-user sharing without public-link infrastructure.

**Files to inspect:** User/document repositories and routes.

**Files likely to change:** Document sharing route/repository and tests.

**Implementation requirements:** `POST /documents/:docId/share` accepts collaborator email; owner only; require an existing user; insert idempotently; return safe document/collaborator metadata.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T033.

**Do not:** Call it link sharing; generate tokens/URLs; permit anonymous users.

**Pass condition:** Owner shares successfully, repeated share does not duplicate, non-owner is forbidden, unknown email is handled, and collaborator gains authorized metadata access.

**Implementation Debrief requirements:** Explain sharing semantics and idempotence.

### T035 — WebSocket authentication and document authorization

**Goal:** Reject unauthenticated or unauthorized upgrades before room state is exposed.

**Why this task exists:** Protect collaborative content and presence at the real-time boundary.

**Files to inspect:** WebSocket server, JWT helper, document repository, client wrapper.

**Files likely to change:** WebSocket upgrade/connection wiring, client token parameter, security integration tests.

**Implementation requirements:** Read `docId` and JWT query token; verify identity and owner/collaborator access before `RoomManager.join` or hydration; bind authorized identity to connection context; ensure Awareness display identity is server-governed or validated rather than trusted blindly; define safe rejection/close behavior.

**Context7 requirement:** REQUIRED — verify current Fastify WebSocket pre-validation/upgrade authentication APIs and close behavior.

**Depends on:** T034, T021.

**Do not:** Put JWT or `docId` into every binary frame, authorize only the REST bootstrap, or let rejected sockets create rooms.

**Pass condition:** Tests reject missing/invalid tokens and unrelated users; owner/collaborator work; rejected attempts create no room and receive no state.

**Implementation Debrief requirements:** Full handshake trust-boundary and failure-mode debrief.

---

## Milestone 7 — Minimal real frontend flow

### T036 — Authentication pages and token boundary

**Goal:** Add minimal signup/login navigation and authenticated API plumbing.

**Why this task exists:** Replace hardcoded identity without broad frontend state machinery.

**Files to inspect:** Frontend app and backend auth response shapes.

**Files likely to change:** Login/signup pages, router, API client/token store, tests.

**Implementation requirements:** Store and attach the JWT consistently; redirect after auth; handle expired/invalid tokens; keep forms accessible and minimal. Document the chosen browser storage tradeoff.

**Context7 requirement:** REQUIRED — verify current React Router APIs for the pinned version; use standard browser fetch/storage APIs.

**Depends on:** T031, T003.

**Do not:** Add global state libraries, OAuth, or unrelated polish.

**Pass condition:** Signup/login flow reaches an authenticated route and subsequent REST calls carry the token.

**Implementation Debrief requirements:** Explain token lifetime/storage and routing boundary.

### T037 — Dashboard and collaborator sharing UI

**Goal:** List/create/open documents and share by collaborator email.

**Why this task exists:** Expose only the document workflow needed to reach collaboration.

**Files to inspect:** Authorized document/share route shapes and frontend API client.

**Files likely to change:** Dashboard page, document API client, minimal share form/tests.

**Implementation requirements:** Render accessible loading/error/empty states; create without a count cap; link by real `docId`; expose owner-only email sharing where practical.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T036, T034.

**Do not:** Generate share links, add invite tokens, rename/version/history UI, or enforce a document maximum.

**Pass condition:** An authenticated user creates and opens documents; owner shares by registered email; collaborator sees the document.

**Implementation Debrief requirements:** Explain API-to-route data flow.

### T038 — Real document page integration

**Goal:** Connect route `docId`, JWT, provider, editor, and Awareness into the complete flow.

**Why this task exists:** Replace all milestone placeholders and exercise the architecture end to end.

**Files to inspect:** Editor/provider, token store, router/dashboard.

**Files likely to change:** Document page, routes, provider construction, editor/presence integration tests.

**Implementation requirements:** Authenticate before connecting; pass real `docId`/token only at connection setup; populate Awareness with verified user display data; clean up on route change; show connection/reconnecting state without claiming persistence beyond the tab.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T037, T035, T020, T022.

**Do not:** Add rich text or new product features.

**Pass condition:** Two registered owner/collaborator sessions share one document with sync, presence, cursors, authorization, and transient disconnect recovery.

**Implementation Debrief requirements:** Explain the complete browser→server→room→peer path.

---

## Milestone 8 — Verification and randomized correctness

### T039 — Full-system verification record

**Goal:** Record repeatable pass/fail evidence for every scoped user and architecture invariant.

**Why this task exists:** Prevent “done” from meaning only that a demo once appeared to work.

**Files to inspect:** `docs/SCOPE.md`, existing automated tests and commands.

**Files likely to change:** `docs/VERIFICATION.md` only, unless separately scoped defect tasks are created.

**Implementation requirements:** Verify signup/login; unlimited-by-policy document creation; collaborator-by-email sharing; unauthorized REST/WS rejection; room isolation; concurrent convergence/idempotence; Awareness cleanup/non-persistence; transient disconnect edits on both sides; active/inactive authority; final flush; hard-crash tradeoff wording; actual room destruction/reopen; real backend restart restoration.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T038, T028.

**Do not:** Fix unrelated defects ad hoc inside the verification task or claim unrun checks passed.

**Pass condition:** Every check has command/manual steps, observed result, and pass/fail; failures point to separately scoped follow-ups.

**Implementation Debrief requirements:** Summarize evidence and remaining failures without minimizing them.

### T040 — Seeded randomized convergence integration test

**Goal:** Stress this Yjs transport integration with repeatable generated operation sequences.

**Why this task exists:** Find sequencing/reconnect/cleanup defects beyond hand-authored cases.

**Files to inspect:** Provider/server integration harness and deterministic convergence tests.

**Files likely to change:** Randomized test harness and test output fixtures/logging.

**Before implementation:** Explain seeded generation, operation validity, delivery/reconnect scheduling, convergence oracle, reproducibility, and why the test validates integration rather than proving Yjs; wait for authorization.

**Implementation requirements:** Generate insert, delete, indexed insert, concurrent insert, temporary disconnect, local edit while disconnected, and reconnect; use many deterministic seeds; after delivery quiesces assert all clients and server text equal; on failure record seed, operation trace/count, replicas, and states.

**Context7 requirement:** REQUIRED — verify Yjs transaction/index behavior relevant to generating valid operations; no custom CRDT logic.

**Depends on:** T039.

**Do not:** Use nondeterministic randomness without recording a seed or claim a formal proof.

**Pass condition:** Configured seeded scenarios complete; report scenarios, operations, clients, seeds, and convergence failures with replay instructions.

**Implementation Debrief requirements:** Full harness model, oracle, limitations, and failure reproduction.

---

## Milestone 9 — Reproducible benchmarks and final documentation

### T041 — Benchmark harness and environment capture

**Goal:** Build a reproducible local harness using the real authenticated binary protocol and monotonic timing.

**Why this task exists:** Make later resume numbers traceable to raw evidence.

**Files to inspect:** Auth setup, provider/protocol helpers, randomized harness, server run commands.

**Files likely to change:** `benchmarks/` harness/scripts, `benchmarks/environment.json`, package scripts.

**Before implementation:** Explain each metric boundary, load-generation model, clock choice, warmup, sample correlation, environment controls, and limitations; wait for authorization.

**Implementation requirements:** Capture CPU, RAM, OS, Node/Yjs versions, server/client locality, document size, client count, operation count, duration, commit identifier if available, and exact commands. Use unique update/sample identifiers or another documented method to correlate sender creation with receiver application without changing production semantics.

**Context7 requirement:** REQUIRED — verify current Node monotonic timing and system-information APIs plus any Yjs update instrumentation API used.

**Depends on:** T040, T035.

**Do not:** Use wall-clock timestamps for latency, bypass auth/protocol, or commit fabricated/placeholding results.

**Pass condition:** A smoke run produces reproducible environment metadata and raw samples from the real path.

**Implementation Debrief requirements:** Full methodology and measurement-bias debrief.

### T042 — Concurrent editors, propagation, and apply latency

**Goal:** Measure concurrency behavior and two distinct latency distributions.

**Why this task exists:** Replace vague support/local-latency claims with correctly named evidence.

**Files to inspect:** T041 harness and metric definitions.

**Files likely to change:** Benchmark scenarios and `benchmarks/concurrency.json`, `benchmarks/propagation-latency.json`, `benchmarks/apply-latency.json`.

**Before implementation:** Reconfirm the concurrency ladder, reliability criterion, propagation boundary, apply-only boundary, percentile method, and trial plan with the developer; wait for authorization.

**Implementation requirements:** Run approximately 1, 10, 25, 50, and 100 simulated editors on one document, continuing higher only if useful; report largest configuration that completes reliably; measure sender update creation → server receive/apply/broadcast → receiver apply as end-to-end edit propagation latency; separately measure `applyUpdate` start→finish; report p50/p95/p99, samples, success/failure, duration, document/operation sizes.

**Context7 requirement:** NOT REQUIRED after T041's verified instrumentation; re-check only if APIs change.

**Depends on:** T041.

**Do not:** Call propagation latency “local apply latency,” state the system supports 100 editors unless results demonstrate it, or hide failed trials.

**Pass condition:** Raw JSON captures every configured run and summary percentiles can be regenerated from it.

**Implementation Debrief requirements:** Explain metric boundaries, reliability criterion, and actual findings without marketing inflation.

### T043 — Reconnect, convergence, and persistence-isolation benchmarks

**Goal:** Measure recovery/correctness and storage-delay impact separately.

**Why this task exists:** Support the project's strongest architecture claims with focused experiments.

**Files to inspect:** T040 randomized harness, T041 harness, persistence worker injection seam.

**Files likely to change:** Benchmark scenarios and `benchmarks/reconnect.json`, `benchmarks/convergence.json`, `benchmarks/persistence-isolation.json`.

**Before implementation:** Explain the reconnect timing start/end events, convergence oracle, repeated-trial plan, and controlled persistence-delay experiment; wait for authorization.

**Implementation requirements:** For reconnection, edit both live and disconnected replicas and measure successful socket reconnection→full convergence across repeated trials with p50/p95/p99. For convergence, record scenario count, operations/scenario, replicas, seeds, and failures. For persistence isolation, inject 0/50/100/250 ms write latency and compare propagation distributions. State results as measurements, including contrary results.

**Context7 requirement:** NOT REQUIRED after verified harness APIs.

**Depends on:** T042, T028.

**Do not:** Measure from reconnect attempt rather than successful reconnect, persist Awareness, predetermine isolation outcome, or omit failures.

**Pass condition:** All three raw files are reproducible, contain required metadata/results, and convergence is checked after each trial.

**Implementation Debrief requirements:** Full experiment design, actual findings, limitations, and interview questions.

### T044 — Architecture document and single-instance ADR

**Goal:** Document the stabilized implemented system and its explicit scaling boundary.

**Why this task exists:** Provide an interview-ready map after architecture is real, not speculative.

**Files to inspect:** Implemented modules, existing ADRs, scope, verification, benchmark methodology.

**Files likely to change:** `docs/ARCHITECTURE.md`, `docs/decisions/003-single-instance.md`.

**Implementation requirements:** Include runtime components, binary handshake, post-handshake update path, Awareness separation, active/inactive authority, room hydration/teardown, async persistence path, auth boundary, and failure/durability limits. In a clearly labeled future-design section compare document-aware routing, consistent hashing, cross-instance pub/sub, room migration/rebalancing, and failure/recovery tradeoffs without selecting a universal answer.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T043, T029, T011, T017.

**Do not:** Document unimplemented infrastructure as built or duplicate source-level details.

**Pass condition:** Diagrams/text agree with code, tests, scope, and ADRs; the single-instance ADR states consequences honestly.

**Implementation Debrief requirements:** Short documentation debrief and the key interview narrative.

### T045 — BENCHMARKS.md

**Goal:** Turn raw benchmark evidence into a reproducible, correctly qualified report.

**Why this task exists:** Let a recruiter trace every number to methodology and data.

**Files to inspect:** All `benchmarks/*.json`, harness commands, `docs/SCOPE.md` templates.

**Files likely to change:** `docs/BENCHMARKS.md` only; raw files only if rerunning a documented invalid experiment.

**Implementation requirements:** Document environment, exact commands, warmup/trials, workload, metric definitions, percentile calculation, raw paths, results, reliability criterion, failures, and limitations. Clearly separate edit propagation from Yjs apply latency and local environment results from production claims.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T043.

**Do not:** Cherry-pick runs, manufacture values, or publish resume templates as measurements.

**Pass condition:** Every reported value is reproducible from a named raw file and command.

**Implementation Debrief requirements:** Explain how to defend each number in an interview.

### T046 — Interview guide and final consistency audit

**Goal:** Create the interview guide and audit all project claims/docs against implementation and evidence.

**Why this task exists:** Finish with an explainable system and no contradictory or fabricated claims.

**Files to inspect:** All docs, ADRs, verification, benchmarks, and the important implementation modules.

**Files likely to change:** `docs/INTERVIEW-GUIDE.md`; corrections to existing documentation only when needed.

**Implementation requirements:** Cover CRDT/state-vector/update mental models, binary handshake, provider origins, Awareness, reconnect limits, room lifecycle, authority, async persistence/crash window, auth, test invariants, benchmarks, and future scaling tradeoffs. Audit share-by-email terminology; absence of document/room limits; benchmark-target language; propagation versus apply latency; transient versus persistent offline behavior; standard protocol framing/initiator; room create/hydrate/final-flush/destroy; Awareness non-persistence; auth; rich-text exclusion; and single-instance claims. Populate resume bullets only from measured results.

**Context7 requirement:** NOT REQUIRED.

**Depends on:** T044, T045.

**Do not:** Add features or obscure uncertainties.

**Pass condition:** `docs/INTERVIEW-GUIDE.md` exists; consistency search finds no prohibited/contradictory claims; all referenced commands/files exist; the developer can trace claims to tests or raw results.

**Implementation Debrief requirements:** Summarize the final explainability audit and any corrected claims.

---

## Milestone exit tests

```text
M0 → M1  foundation builds; database connects and migrates
M1 → M2  real-socket transport join/broadcast/isolation/leave test
M2 → M3  bidirectional binary handshake, Update propagation, convergence,
         idempotence, and two-tab CodeMirror validation
M3 → M4  Awareness propagation, cursor rendering, disconnect removal,
         and non-persistence tests
M4 → M5  temporary-disconnect edits on both sides converge after reconnect
M5 → M6  final flush, room destruction, snapshot hydration, and delayed-writer
         hot-path isolation tests
M6 → M7  REST and WebSocket authorization tests
M7 → M8  complete two-user owner/collaborator flow
M8 → M9  verification record and seeded randomized convergence suite
M9 → done raw benchmark artifacts, BENCHMARKS.md, ARCHITECTURE.md, five ADRs,
          INTERVIEW-GUIDE.md, and final consistency audit
```
