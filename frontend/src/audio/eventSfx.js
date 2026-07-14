// Event-keyed sound pools for in-game moments.
//
// Each key maps to a POOL of asset URLs; playback (audio store
// `playEventSfx`) picks one at random so repeated events have natural
// variation instead of a single canned sound. Simulation keyframes declare
// the moment via an optional `sfx: '<eventKey>'` field (stamped by
// PlayExecutionEngine on presentation keyframes) and GameView's keyframe
// watcher fires the pool — adding a NEW event sound is purely data:
//   1. drop files into src/assets/audio/sfx/ matching a glob below
//   2. add the pool entry here
//   3. stamp `sfx: '<key>'` on the relevant engine keyframe
//
// Files are eagerly glob-imported so Vite hashes/bundles them and the PWA
// precaches them (m4a is in the workbox globPatterns). AAC/m4a decodes
// natively in every target browser via decodeAudioData. An empty pool (no
// files yet) is a safe no-op, mirroring tracks.js.

// Each pool: { urls: [...], volume } — volume is the per-event gain (0..1)
// relative to the user's master volume, so long/loud beds (crowd cheers)
// don't bury short accents (swishes).
const pool = (glob, volume = 1) => ({ urls: Object.values(glob), volume })

const EVENT_SFX = {
  // Made basket — ball dropping through the net. 7 swish variants.
  made_shot: pool(import.meta.glob('@/assets/audio/sfx/swish_*.m4a', { eager: true, query: '?url', import: 'default' })),

  // Crowd erupting right after a make (stamped on the swish-through
  // keyframe → starts ~0.28s after the swish). Quieter than the swish so
  // it reads as a bed, not a blast; variants join via crowd_cheer_N.m4a.
  crowd_cheer: pool(import.meta.glob('@/assets/audio/sfx/crowd_cheer_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.55),

  // Missed basket — rim clank. Stamped on the same rim-arrival keyframe
  // that carries made_shot on makes, so make/miss sounds land at the
  // identical moment of ball-meets-rim. 5 variants (miss_N.m4a).
  missed_shot: pool(import.meta.glob('@/assets/audio/sfx/miss_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.75),

  // Blocked shot — the swat. Stamped on the shot's release keyframe (the
  // "swatted away!" text moment, i.e. contact), not the deflection landing.
  // Variants join via block_N.m4a.
  block: pool(import.meta.glob('@/assets/audio/sfx/block_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.75),

  // Referee whistle — every dead-ball call: shooting fouls, reach-in fouls,
  // and-1 contact, and balls tipped out of bounds. Slightly under the swish
  // gain (a whistle is piercing by nature). Variants join via whistle_N.m4a.
  foul_whistle: pool(import.meta.glob('@/assets/audio/sfx/whistle_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.6),

  // Steal — the pick-pocket moment. Stamped on the action keyframe whose
  // text announces the steal (outcome 'stolen'). Variants join via steal_N.m4a.
  steal: pool(import.meta.glob('@/assets/audio/sfx/steal_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.75),

  // Timeout air horn — blasts ~0.5s after the whistle when a timeout starts
  // (GameView schedules it in startTimeoutSequence). Well under the other
  // accents — the source sample is HOT. Variants join via airhorn_N.mp3.
  timeout_airhorn: pool(import.meta.glob('@/assets/audio/sfx/airhorn_*.mp3', { eager: true, query: '?url', import: 'default' }), 0.15),

  // Future pools (add files + engine keyframe stamps when ready):
  // rim_bounce:   pool(import.meta.glob('@/assets/audio/sfx/rim_*.m4a',     { eager: true, query: '?url', import: 'default' })),
}

export default EVENT_SFX
