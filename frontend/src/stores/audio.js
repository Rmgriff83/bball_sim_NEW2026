import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as engine from '@/services/audioEngine'
import { UI_SOUNDS } from '@/audio/sounds'
import { MUSIC, GAME_SFX } from '@/audio/tracks'

// Public audio API for the app. Holds the user preferences (enabled + volume,
// persisted to localStorage) and delegates actual sound production to the
// audioEngine. All play* methods are no-ops when sound is disabled.

const STORAGE_ENABLED = 'audio.enabled'
const STORAGE_VOLUME = 'audio.volume'

function loadEnabled() {
  const raw = localStorage.getItem(STORAGE_ENABLED)
  return raw === null ? true : raw === 'true' // default ON
}

function loadVolume() {
  const raw = parseFloat(localStorage.getItem(STORAGE_VOLUME))
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.6 // default 60%
}

export const useAudioStore = defineStore('audio', () => {
  const enabled = ref(loadEnabled())
  const volume = ref(loadVolume())

  // Background music currently playing (HTMLAudioElement handle).
  let musicHandle = null

  // Push current prefs into the engine.
  engine.setMasterVolume(volume.value)
  engine.setMuted(!enabled.value)

  function setEnabled(value) {
    enabled.value = !!value
    localStorage.setItem(STORAGE_ENABLED, String(enabled.value))
    engine.setMuted(!enabled.value)
    if (!enabled.value) stopMusic()
  }

  function setVolume(value) {
    volume.value = Math.max(0, Math.min(1, Number(value) || 0))
    localStorage.setItem(STORAGE_VOLUME, String(volume.value))
    engine.setMasterVolume(volume.value)
  }

  // Play a UI sound by key. Prefers an MP3 override (`file`) if present,
  // otherwise synthesizes the `synth` recipe.
  function play(key) {
    if (!enabled.value) return
    const def = UI_SOUNDS[key]
    if (!def) return
    engine.unlock()
    if (def.file) {
      engine.playClip(def.file, { volume: volume.value })
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

  return {
    enabled,
    volume,
    setEnabled,
    setVolume,
    play,
    affirm,
    cancel,
    navigate,
    purchase,
    suppressClickSound,
    playMusic,
    stopMusic,
    playGameSfx,
    stopGameSfx,
  }
})
