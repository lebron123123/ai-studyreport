// Shared capacity contract for browser and server research storage.
// A study may be large, but no ordinary save should send the whole study body.
export const RESEARCH_LOGICAL_STATE_MAX_BYTES = 128 * 1024 * 1024;
export const RESEARCH_SAVE_ENVELOPE_MAX_BYTES = 20 * 1024 * 1024;
export const RESEARCH_OBJECT_UPLOAD_BATCH_BYTES = 1024 * 1024;
export const RESEARCH_OBJECT_UPLOAD_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
export const RESEARCH_RUN_OBJECT_MAX_BYTES = 256 * 1024 * 1024;

export const RESEARCH_STORAGE_CAPABILITIES = Object.freeze({
  protocol: 'parts-v1',
  logicalStateBytes: RESEARCH_LOGICAL_STATE_MAX_BYTES,
  uploadBatchBytes: RESEARCH_OBJECT_UPLOAD_BATCH_BYTES,
  saveEnvelopeBytes: RESEARCH_SAVE_ENVELOPE_MAX_BYTES,
  runObjectBytes: RESEARCH_RUN_OBJECT_MAX_BYTES
});
