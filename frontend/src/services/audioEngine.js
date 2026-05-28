// Low-level audio engine.
//
// Two responsibilities:
//   1. Synthesize short UI sounds via the Web Audio API (no asset files needed).
//   2. Play MP3 clips (music / game noises) via HTMLAudioElement.
//
// A single shared AudioContext is created lazily on first use. On iOS/Safari
// (including Capacitor's WKWebView) the context starts `suspended` and must be
// resumed from inside a user gesture — call `unlock()` once on first tap.
//
// Every public method is wrapped so a thrown WebAudio error can never break a
// user flow: audio is strictly best-effort.

let ctx = null
let masterGain = null
let muted = false
let volume = 1

function ensureContext() {
  if (ctx) return ctx
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    masterGain = ctx.createGain()
    masterGain.gain.value = muted ? 0 : volume
    masterGain.connect(ctx.destination)
  } catch {
    ctx = null
    masterGain = null
  }
  return ctx
}

// Resume the AudioContext. Safe to call repeatedly; the `once` gesture
// listener in main.js calls this on the first pointerdown.
export function unlock() {
  const c = ensureContext()
  if (c && c.state === 'suspended') {
    c.resume().catch(() => {})
  }
}

export function setMasterVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0))
  if (masterGain) masterGain.gain.value = muted ? 0 : volume
}

export function setMuted(value) {
  muted = !!value
  if (masterGain) masterGain.gain.value = muted ? 0 : volume
}

// Play a single synthesized tone.
//   freq      — pitch in Hz
//   duration  — seconds the tone sounds for
//   type      — oscillator wave: 'sine' | 'triangle' | 'square' | 'sawtooth'
//   gain      — peak amplitude (0–1), kept low for subtlety
//   attack    — fade-in seconds (soft click, not a pop)
//   release   — fade-out seconds
//   slideTo   — optional target Hz to glide to over the duration
//   delay     — seconds to wait before starting (for layered/sequenced tones)
export function playTone({
  freq = 440,
  duration = 0.08,
  type = 'sine',
  gain = 0.15,
  attack = 0.005,
  release = 0.04,
  slideTo = null,
  delay = 0,
} = {}) {
  const c = ensureContext()
  if (!c || !masterGain) return
  try {
    if (c.state === 'suspended') c.resume().catch(() => {})
    const start = c.currentTime + delay
    const osc = c.createOscillator()
    const env = c.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (slideTo != null) {
      osc.frequency.linearRampToValueAtTime(slideTo, start + duration)
    }

    // Attack → sustain → release envelope.
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(gain, start + attack)
    env.gain.setValueAtTime(gain, start + Math.max(attack, duration - release))
    env.gain.linearRampToValueAtTime(0, start + duration)

    osc.connect(env)
    env.connect(masterGain)
    osc.start(start)
    osc.stop(start + duration + 0.02)
    osc.onended = () => {
      try { osc.disconnect(); env.disconnect() } catch { /* noop */ }
    }
  } catch {
    /* best-effort: never throw */
  }
}

// Play a short burst of filtered white noise — the basis of a convincing
// "tap"/click (oscillators alone sound like beeps, not taps).
//   duration   — seconds
//   gain       — peak amplitude (0–1)
//   filterFreq — bandpass center frequency in Hz (the "color" of the tap)
//   q          — bandpass resonance; higher = more tonal/pitched
//   attack     — fade-in seconds (kept tiny for a sharp transient)
//   release    — fade-out seconds
//   delay      — seconds to wait before starting
export function playNoise({
  duration = 0.03,
  gain = 0.15,
  filterFreq = 1200,
  q = 0.8,
  attack = 0.001,
  release = 0.02,
  delay = 0,
} = {}) {
  const c = ensureContext()
  if (!c || !masterGain) return
  try {
    if (c.state === 'suspended') c.resume().catch(() => {})
    const start = c.currentTime + delay

    const frames = Math.max(1, Math.floor(c.sampleRate * duration))
    const buffer = c.createBuffer(1, frames, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

    const src = c.createBufferSource()
    src.buffer = buffer

    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = filterFreq
    filter.Q.value = q

    const env = c.createGain()
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(gain, start + attack)
    env.gain.linearRampToValueAtTime(0, start + duration)

    src.connect(filter)
    filter.connect(env)
    env.connect(masterGain)
    src.start(start)
    src.stop(start + duration + 0.02)
    src.onended = () => {
      try { src.disconnect(); filter.disconnect(); env.disconnect() } catch { /* noop */ }
    }
  } catch {
    /* best-effort: never throw */
  }
}

// Play a sequence of sounds (a "recipe"). Each entry is either a playTone()
// options object or, when `noise: true`, a playNoise() options object.
// `delay` sequences entries relative to now.
export function playRecipe(recipe) {
  if (!Array.isArray(recipe)) return
  for (const entry of recipe) {
    if (entry && entry.noise) playNoise(entry)
    else playTone(entry)
  }
}

// ---- MP3 clip playback (music / game noises) -----------------------------
// `url` is the resolved asset URL (or null if the file hasn't been added yet,
// in which case this is a safe no-op). Returns a handle for stopClip().
export function playClip(url, { loop = false, volume: clipVolume = 1 } = {}) {
  if (!url || typeof Audio === 'undefined') return null
  try {
    const el = new Audio(url)
    el.loop = loop
    el.volume = Math.max(0, Math.min(1, clipVolume)) * (muted ? 0 : volume)
    const playPromise = el.play()
    if (playPromise?.catch) playPromise.catch(() => {})
    return el
  } catch {
    return null
  }
}

export function stopClip(handle) {
  if (!handle) return
  try {
    handle.pause()
    handle.currentTime = 0
  } catch {
    /* noop */
  }
}
