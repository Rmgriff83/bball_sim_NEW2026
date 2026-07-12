import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as engine from '@/services/audioEngine'
import { UI_SOUNDS } from '@/audio/sounds'
import { MUSIC, GAME_SFX } from '@/audio/tracks'
import EVENT_SFX from '@/audio/eventSfx'
import AMBIENT_SFX from '@/audio/ambientSfx'

// Public audio API for the app. Holds the user preferences (enabled + volume,
// persisted to localStorage) and delegates actual sound production to the
// audioEngine. All play* methods are no-ops when sound is disabled.

const STORAGE_ENABLED = 'audio.enabled'
const STORAGE_VOLUME = 'audio.volume'
const STORAGE_GAME_MUTED = 'audio.gameMuted'

function loadEnabled() {
  const raw = localStorage.getItem(STORAGE_ENABLED)
  return raw === null ? true : raw === 'true' // default ON
}

function loadGameMuted() {
  return localStorage.getItem(STORAGE_GAME_MUTED) === 'true' // default OFF
}

function loadVolume() {
  const raw = parseFloat(localStorage.getItem(STORAGE_VOLUME))
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.6 // default 60%
}

export const useAudioStore = defineStore('audio', () => {
  const enabled = ref(loadEnabled())
  const volume = ref(loadVolume())

  // Game-presentation mute: silences in-game event SFX + ambient beds ONLY.
  // UI sounds, menu music, and one-shot stingers stay on the global
  // `enabled` flag — this is the in-game speaker toggle, not a master mute.
  const gameMuted = ref(loadGameMuted())

  function toggleGameMuted() {
    gameMuted.value = !gameMuted.value
    localStorage.setItem(STORAGE_GAME_MUTED, String(gameMuted.value))
    if (gameMuted.value) stopAllAmbient()
    return gameMuted.value
  }

  // Background music currently playing (HTMLAudioElement handle).
  let musicHandle = null

  // Push current prefs into the engine.
  engine.setMasterVolume(volume.value)
  engine.setMuted(!enabled.value)

  function setEnabled(value) {
    enabled.value = !!value
    localStorage.setItem(STORAGE_ENABLED, String(enabled.value))
    engine.setMuted(!enabled.value)
    if (!enabled.value) {
      stopMusic()
      stopAllAmbient()
    }
  }

  function setVolume(value) {
    volume.value = Math.max(0, Math.min(1, Number(value) || 0))
    localStorage.setItem(STORAGE_VOLUME, String(volume.value))
    engine.setMasterVolume(volume.value)
  }

  // Warm-decode file-based UI sounds once (first gesture) so the first play
  // isn't delayed by the fetch+decode.
  let _samplesPreloaded = false
  function _preloadFileSounds() {
    if (_samplesPreloaded) return
    _samplesPreloaded = true
    for (const def of Object.values(UI_SOUNDS)) {
      if (def?.file) engine.preloadSample(def.file)
    }
  }

  // Play a UI sound by key. Prefers a downloaded sound file (`file`) if present,
  // otherwise synthesizes the `synth` recipe. File sounds play through the
  // AudioContext (via playSample) so they mix with — rather than interrupt —
  // any background music playing on the device.
  function play(key) {
    if (!enabled.value) return
    const def = UI_SOUNDS[key]
    if (!def) return
    engine.unlock()
    if (def.file) {
      _preloadFileSounds()
      engine.playSample(def.file, { volume: def.volume ?? 1 })
    } else if (def.synth) {
      engine.playRecipe(def.synth)
    }
  }

  // The generic tap (`navigate`) is played for every button click by a global
  // listener in main.js. A click that has its own dedicated sound — a purchase
  // (cha-ching) or a modal dismissal (cancel) — calls `suppressClickSound()`
  // synchronously during the click so that the global listener, which runs
  // afterward as the event bubbles to document, skips the generic tap. The
  // flag is one-shot and self-clears on the next tick as a safety net.
  let suppressNextClickSound = false
  function suppressClickSound() {
    suppressNextClickSound = true
    setTimeout(() => { suppressNextClickSound = false }, 0)
  }

  // Convenience wrappers for the named UI sounds.
  function affirm() { play('affirm') }
  function cancel() { suppressClickSound(); play('cancel') }
  function navigate() {
    if (suppressNextClickSound) { suppressNextClickSound = false; return }
    play('navigate')
  }
  function purchase() { play('purchase') }
  // Tertiary tap — fires for events the user didn't trigger (e.g. AI draft
  // picks). No click-suppression needed since it's not called from a click.
  function tertiary() { play('tertiary') }

  // ---- Music (homepage / menus) ----
  function playMusic(key, { loop = true } = {}) {
    if (!enabled.value) return
    const url = MUSIC[key]
    if (!url) return // file not added yet — safe no-op
    engine.unlock()
    stopMusic()
    musicHandle = engine.playClip(url, { loop, volume: volume.value })
  }

  function stopMusic() {
    engine.stopClip(musicHandle)
    musicHandle = null
  }

  // ---- In-game SFX / ambience ----
  function playGameSfx(key, { loop = false } = {}) {
    if (!enabled.value) return null
    const url = GAME_SFX[key]
    if (!url) return null // file not added yet — safe no-op
    engine.unlock()
    return engine.playClip(url, { loop, volume: volume.value })
  }

  function stopGameSfx(handle) {
    engine.stopClip(handle)
  }

  // ---- Event SFX (simulation-keyframe sounds: swish, whistle, ...) ----
  // Pools of short samples played through the AudioContext (decoded
  // AudioBuffers → new BufferSource per play): zero-latency, overlapping,
  // and mixed off the main thread — never touches the sim worker.

  // Warm-decode every pool once per session so the first in-game play is
  // instant. Idempotent (engine caches decodes); call on game start.
  let _eventSfxPreloaded = false
  function preloadEventSfx() {
    if (_eventSfxPreloaded || !enabled.value) return
    _eventSfxPreloaded = true
    for (const poolDef of Object.values(EVENT_SFX)) {
      for (const url of poolDef.urls) engine.preloadSample(url)
    }
  }

  // Play a random variant from the event's pool at the pool's gain. Unknown
  // key or empty pool (files not added yet) is a safe no-op.
  function playEventSfx(key) {
    if (!enabled.value || gameMuted.value) return
    const poolDef = EVENT_SFX[key]
    if (!poolDef || poolDef.urls.length === 0) return
    engine.unlock()
    preloadEventSfx()
    const url = poolDef.urls[Math.floor(Math.random() * poolDef.urls.length)]
    engine.playSample(url, { volume: poolDef.volume ?? 1 })
  }

  // ---- Ambient loops (layered in-game beds: court noise, crowd, ...) ----
  // Gapless Web Audio loops (engine.playLoop), one active handle per layer
  // key. Layers mix independently under the master gain; GameView wires each
  // key's start/stop to the game state it belongs to (see audio/ambientSfx.js).
  const _ambientHandles = new Map()

  // Warm-decode every layer once per session so a loop starts instantly.
  let _ambientPreloaded = false
  function preloadAmbientSfx() {
    if (_ambientPreloaded || !enabled.value) return
    _ambientPreloaded = true
    for (const layer of Object.values(AMBIENT_SFX)) {
      for (const url of layer.urls) engine.preloadSample(url)
    }
  }

  // Start a layer's loop (random variant). Idempotent — already-playing key,
  // unknown key, empty pool, or disabled audio are all safe no-ops.
  function startAmbient(key) {
    if (!enabled.value || gameMuted.value) return
    if (_ambientHandles.has(key)) return
    const layer = AMBIENT_SFX[key]
    if (!layer || layer.urls.length === 0) return
    engine.unlock()
    preloadAmbientSfx()
    const url = layer.urls[Math.floor(Math.random() * layer.urls.length)]
    _ambientHandles.set(key, engine.playLoop(url, { volume: layer.volume ?? 1 }))
  }

  function stopAmbient(key) {
    const handle = _ambientHandles.get(key)
    if (!handle) return
    _ambientHandles.delete(key)
    engine.stopLoop(handle)
  }

  function stopAllAmbient() {
    for (const key of [..._ambientHandles.keys()]) stopAmbient(key)
  }

  return {
    enabled,
    volume,
    gameMuted,
    toggleGameMuted,
    setEnabled,
    setVolume,
    play,
    affirm,
    cancel,
    navigate,
    purchase,
    tertiary,
    suppressClickSound,
    playMusic,
    stopMusic,
    playGameSfx,
    stopGameSfx,
    preloadEventSfx,
    playEventSfx,
    preloadAmbientSfx,
    startAmbient,
    stopAmbient,
    stopAllAmbient,
  }
})
