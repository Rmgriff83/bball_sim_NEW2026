// =============================================================================
// cloneForPersist.js
// =============================================================================
// A deep clone used right before writing to IndexedDB. Two jobs:
//   1. Strip Vue reactive proxies (idb's structured-clone throws on proxies).
//   2. Be fast on large payloads (season-10 rosters are MBs of JSON).
//
// `structuredClone` is ~2-4x faster than the JSON round-trip on big plain-object
// graphs, but it throws on anything non-cloneable (functions, symbols, some proxy
// edge cases). So we try it first and fall back to the previously-used
// JSON.parse(JSON.stringify(...)) — which is the known-good behavior — so this is
// never worse than before, just faster in the common case.
// =============================================================================

export function cloneForPersist(value) {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

export default cloneForPersist
