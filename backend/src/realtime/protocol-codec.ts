import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awareness from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

export const syncProtocol = 0;
export const awarenessProtocol = 1;

export const REMOTE_UPDATE_ORIGIN = Symbol("remote-update");

function createSyncEncoder(): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, syncProtocol);
  return encoder;
}

function createAwarenessEncoder(): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, awarenessProtocol);
  return encoder;
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = createSyncEncoder();
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep2(
  doc: Y.Doc,
  encodedStateVector: Uint8Array,
): Uint8Array {
  const encoder = createSyncEncoder();
  sync.writeSyncStep2(encoder, doc, encodedStateVector);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = createSyncEncoder();
  sync.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessUpdate(
  awarenessState: awareness.Awareness,
  clientIds: number[],
): Uint8Array {
  const encoder = createAwarenessEncoder();
  encoding.writeVarUint8Array(
    encoder,
    awareness.encodeAwarenessUpdate(awarenessState, clientIds),
  );
  return encoding.toUint8Array(encoder);
}

export function readAwarenessFrame(
  frame: Uint8Array,
  awarenessState: awareness.Awareness,
  origin: unknown,
): void {
  const decoder = decoding.createDecoder(frame);
  const messageProtocol = decoding.readVarUint(decoder);

  if (messageProtocol !== awarenessProtocol) {
    throw new Error(`Unsupported protocol frame: ${messageProtocol}`);
  }

  const update = decoding.readVarUint8Array(decoder);
  if (decoding.hasContent(decoder)) {
    throw new Error("Unexpected trailing Awareness frame data");
  }

  awareness.applyAwarenessUpdate(awarenessState, update, origin);
}

/**
 * Read one composite sync frame and return any sync reply messages.
 * A SyncStep1 reply includes SyncStep2 followed by the local SyncStep1,
 * which is the client-server handshake ordering defined by y-protocols.
 */
export function readSyncFrame(
  frame: Uint8Array,
  doc: Y.Doc,
  transactionOrigin: unknown = REMOTE_UPDATE_ORIGIN,
): Uint8Array {
  const decoder = decoding.createDecoder(frame);
  const messageProtocol = decoding.readVarUint(decoder);

  if (messageProtocol !== syncProtocol) {
    throw new Error(`Unsupported protocol frame: ${messageProtocol}`);
  }

  const replyEncoder = createSyncEncoder();

  while (decoding.hasContent(decoder)) {
    const messageType = sync.readSyncMessage(
      decoder,
      replyEncoder,
      doc,
      transactionOrigin,
    );

    if (messageType === sync.messageYjsSyncStep1) {
      sync.writeSyncStep1(replyEncoder, doc);
    }
  }

  return encoding.length(replyEncoder) === 1
    ? new Uint8Array()
    : encoding.toUint8Array(replyEncoder);
}

export function isRemoteUpdateOrigin(origin: unknown): boolean {
  return origin === REMOTE_UPDATE_ORIGIN;
}
