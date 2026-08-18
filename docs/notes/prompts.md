## For normal tasks
We are starting T00X from docs/TASKS.md.

Read:
- docs/AGENTS.md
- only the T00X section of docs/TASKS.md
- files explicitly listed under "Files to inspect" for T001

Do not implement later tasks or introduce dependencies/features belonging
to future milestones.

Before modifying anything, briefly tell me:

1. what T00X is trying to accomplish,
2. which files you expect to modify,
3. what the pass condition is.

Then implement T00X.

After implementation:

1. run the exact pass-condition checks,
2. fix issues only within T00X's scope,
3. show me the test/build results,
4. provide the Implementation Debrief required by AGENTS.md,
5. tell me which 1–3 files I should inspect to understand this task.

Do not start T00X+1.

Stop after T00X is complete.

## For teach before tasks 
We are starting T013 from docs/TASKS.md.

Read:
- docs/AGENTS.md
- only the T013 section of docs/TASKS.md
- the files listed under "Files to inspect"

This task has a Before implementation gate.

DO NOT WRITE OR MODIFY CODE YET.

Use Context7 exactly as required by T013.

Teach me the mechanism I need to understand before implementation.

Specifically explain:

- what a Yjs state vector represents,
- SyncStep1,
- SyncStep2,
- Update messages,
- why the handshake is bidirectional,
- how readSyncMessage participates,
- the binary frame structure,
- how transaction origin prevents an echo loop,
- what invariants the tests for this task need to prove.

Use one small concrete example involving two Y.Doc replicas.

Then show me the proposed data flow for T013 and the files that will
eventually be changed.

Stop after teaching me. Do not implement T013 until I explicitly tell you
to continue.

## Task that will require the learning prompt
| Task     | What you should learn first                |
| -------- | ------------------------------------------ |
| **T013** | Yjs binary sync protocol                   |
| **T015** | Custom client sync provider                |
| **T018** | Awareness protocol                         |
| **T019** | Client Awareness                           |
| **T022** | State-vector reconnect                     |
| **T024** | Async persistence state machine            |
| **T026** | Room hydration + single-flight concurrency |
| **T040** | Seeded randomized convergence testing      |
| **T041** | Benchmark methodology                      |
| **T042** | Concurrency/latency measurement            |
| **T043** | Reconnect/persistence experiments          |

