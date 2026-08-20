import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

export const syncProtocol = 0;

export const NETWORK_ORIGIN = Symbol("network-update");

const createSyncEncoder = (): encoding.Encoder => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, syncProtocol);
  return encoder;
};

export const encodeSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = createSyncEncoder();
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

export const encodeSyncUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = createSyncEncoder();
  sync.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

export const readSyncFrame = (frame: Uint8Array, doc: Y.Doc): Uint8Array => {
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
      NETWORK_ORIGIN,
    );

    if (messageType === sync.messageYjsSyncStep1) {
      sync.writeSyncStep1(replyEncoder, doc);
    }
  }

  return encoding.length(replyEncoder) === 1
    ? new Uint8Array()
    : encoding.toUint8Array(replyEncoder);
};
