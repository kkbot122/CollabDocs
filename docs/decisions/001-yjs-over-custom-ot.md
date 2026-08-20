# ADR 001: Use Yjs instead of custom OT

## Context

CollabDocs needs collaborative plain-text editing over the raw WebSocket
transport established in T013 and T014. The client needs a shared document
model that can merge concurrent edits, reconcile state during the initial
handshake, and expose one document to both the sync provider and CodeMirror.

The project is intentionally narrow: it needs deterministic collaboration
behavior that can be explained and tested, not a new operational
implementation of a text collaboration algorithm.

## Decision

Use Yjs v13 (`yjs@13.6.32`) as the document model and bind its plain
`Y.Text("content")` to CodeMirror 6 with `y-codemirror.next@0.3.6`.

The existing `SyncProvider` owns the client `Y.Doc`. The editor receives that
provider and binds to the provider's existing `Y.Text`; it never creates a
second document. The binding uses `yCollab(ytext, null, { undoManager: false
})`, so document synchronization is enabled while Awareness, remote cursors,
and editor undo integration remain outside T017.

The provider continues to use the project's standard `y-protocols/sync`
binary frames over the existing WebSocket wrapper. CodeMirror is an editor
binding only; it is not a transport or synchronization provider.

## Alternatives considered

### Custom operational transform

Rejected. It would require designing, testing, and maintaining an operation
format, transformation rules, concurrency handling, and recovery behavior.
That would duplicate the core problem Yjs already solves and would violate the
project's Yjs-only CRDT decision.

### Custom client-side Y.Text-to-editor glue

Rejected. `y-codemirror.next` is the maintained CodeMirror 6 binding for Yjs
v13. Hand-written glue would duplicate its transaction and position mapping
logic and make cleanup/concurrent-edit behavior harder to audit.

### `y-websocket`

Rejected. The project already has a deliberately implemented raw WebSocket
transport and server protocol. Replacing it would obscure the T013/T014 wire
contract and introduce a second provider architecture.

## Consequences

Positive consequences:

- CodeMirror and the network share one Yjs client replica.
- Concurrent edits use Yjs's deterministic merge behavior.
- The editor remains independent from socket framing and React lifecycle
  details.
- The standard binding owns Y.Text observation and removes its observer when
  the CodeMirror view is destroyed.

Tradeoffs and limits:

- The initial client document is in-memory only; persistent offline storage is
  out of scope.
- Awareness and remote selections are deliberately deferred to T018–T020.
- Reconnection/backoff is deliberately deferred to T021.
- Rich text is not part of this decision; T017 binds one plain Y.Text.

## Compatibility evidence

The upstream `y-codemirror.next` package metadata reports version `0.3.6`,
peer dependencies `yjs ^13.5.6`, `@codemirror/state ^6.0.0`, and
`@codemirror/view ^6.0.0`. This project uses Yjs `13.6.32`,
`@codemirror/state 6.7.1`, and `@codemirror/view 6.43.9`.

The upstream binding source shows that `yCollab` accepts a `Y.Text`, an
Awareness value, and optional `{ undoManager }`. Its sync plugin always binds
the Y.Text; Awareness is only used to add remote-selection plugins when a
truthy Awareness object is provided. Its plugin `destroy()` method removes
the Y.Text observer, and CodeMirror's `EditorView.destroy()` invokes that
plugin cleanup.

Sources:

- [y-codemirror.next upstream README](https://github.com/yjs/y-codemirror.next/blob/main/README.md)
- [y-codemirror.next v0.3.6 package metadata](https://registry.npmjs.org/y-codemirror.next/0.3.6)
- [y-codemirror.next upstream source](https://github.com/yjs/y-codemirror.next/tree/main/src)
- [CodeMirror documentation](https://codemirror.net/docs/)

## Test evidence

The frontend test suite and production build pass. The browser validation uses
two tabs connected to the same hardcoded `t017-demo-document` through the
existing backend WebSocket server; typing in either CodeMirror instance is
expected to update the other.
