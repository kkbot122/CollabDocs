/**
 * Temporary text fixture for transport framing tests only.
 *
 * Remove or isolate this fixture when the Yjs protocol is introduced. It is
 * not an application protocol, and the connection's docId remains routing
 * metadata rather than being encoded into this payload.
 */
export const TEMPORARY_TRANSPORT_TEST_PAYLOAD = "collabdocs transport-test";
