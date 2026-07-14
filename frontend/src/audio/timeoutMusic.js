// Timeout hype music — one random track per timeout, started ~3.5s into the
// timeout sequence (after the whistle + air horn), played once (no loop),
// and hard-stopped the moment play resumes. Playback runs through audio
// store `startTimeoutMusic()` / `stopTimeoutMusic()` (a stoppable
// engine.playClip handle).
//
// Adding tracks is purely data: drop hype_music_N.m4a into
// src/assets/audio/timeout/ — the glob auto-discovers it and the random pick
// rotates through the pool. Files are eagerly glob-imported so Vite
// hashes/bundles them and the PWA precaches them (m4a is in the workbox
// globPatterns). An empty pool is a safe no-op, mirroring eventSfx.js.
const glob = import.meta.glob('@/assets/audio/timeout/hype_music_*.m4a', { eager: true, query: '?url', import: 'default' })

// volume is the relative gain (0..1) under the user's master volume — kept a
// notch below the event SFX so the horn/whistle accents read over the bed.
export const TIMEOUT_MUSIC = { urls: Object.values(glob), volume: 0.5 }
