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

// Display labels for the pregame song picker (arena-manager Game-Night DJ
// perk), keyed by filename stem. A track without an entry still works — the
// picker falls back to a prettified stem ("Hype Music 4") — so dropping new
// m4a files never requires touching this map. Labels render via $tDynamic
// and are enumerated in wl-i18n.config.js dynamicSources.
// NOTE: labels with apostrophes use double quotes (never escaped quotes) —
// the wl-i18n.config.js block regex doesn't handle escapes.
const TRACK_LABELS = {
  hype_music_3: 'Bball Sim Theme',
  hype_music_4: 'Zen Xylo',
  hype_music_5: 'Dingle Dorf',
  hype_music_6: "Wild'n Free",
}

// Stable per-track registry: id = filename stem (what campaign.settings.
// timeoutSong stores), label for the picker, url for playback/preview.
export const TIMEOUT_TRACKS = Object.entries(glob)
  .map(([path, url]) => {
    const stem = path.split('/').pop().replace(/\.m4a$/, '')
    const label = TRACK_LABELS[stem]
      ?? stem.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { id: stem, label, url }
  })
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

export function timeoutTrackById(id) {
  return TIMEOUT_TRACKS.find((t) => t.id === id) ?? null
}

// volume is the relative gain (0..1) under the user's master volume — kept a
// notch below the event SFX so the horn/whistle accents read over the bed.
export const TIMEOUT_MUSIC = { urls: Object.values(glob), volume: 0.5 }
