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

// ---- Short sample playback via the AudioContext --------------------------
// Plays a downloaded sound FILE (e.g. the affirmation chime) through the same
// AudioContext as the synthesized sounds, rather than an HTMLAudioElement.
// This matters on iOS: HTMLAudioElement uses the "playback" audio session,
// which interrupts/ducks other apps' music; the AudioContext uses an ambient
// session that MIXES, so a short SFX no longer pauses the user's background
// music. Decoded buffers are cached so a sound only decodes once.
const sampleCache = new Map()

// Decode (and cache) a sample so the first `playSample` is instant. Best-effort.
export async function preloadSample(url) {
  if (!url) return null
  if (sampleCache.has(url)) return sampleCache.get(url)
  const c = ensureContext()
  if (!c) return null
  try {
    const res = await fetch(url)
    const arr = await res.arrayBuffer()
    // decodeAudioData is callback- or promise-based depending on the engine.
    const buffer = await new Promise((resolve, reject) => {
      const p = c.decodeAudioData(arr, resolve, reject)
      if (p?.then) p.then(resolve, reject)
    })
    sampleCache.set(url, buffer)
    return buffer
  } catch {
    sampleCache.set(url, null) // remember the failure so we fall back next time
    return null
  }
}

// Play a short sample file through the AudioContext (mixes with external audio).
// Falls back to playClip() if the file can't be decoded in this browser.
export function playSample(url, { volume: sampleVolume = 1 } = {}) {
  if (!url) return
  const c = ensureContext()
  if (!c || !masterGain) { playClip(url, { volume: sampleVolume }); return }

  const start = (buffer) => {
    if (!buffer) { playClip(url, { volume: sampleVolume }); return } // decode failed → HTMLAudio
    try {
      if (c.state === 'suspended') c.resume().catch(() => {})
      const src = c.createBufferSource()
      src.buffer = buffer
      const env = c.createGain()
      env.gain.value = Math.max(0, Math.min(1, sampleVolume))
      src.connect(env)
      env.connect(masterGain) // masterGain already applies user volume + mute
      src.start()
      src.onended = () => { try { src.disconnect(); env.disconnect() } catch { /* noop */ } }
    } catch {
      /* best-effort: never throw */
    }
  }

  if (sampleCache.has(url)) {
    start(sampleCache.get(url)) // instant (already decoded, or known-failed → fallback)
  } else {
    preloadSample(url).then(start).catch(() => playClip(url, { volume: sampleVolume }))
  }
}

// ---- Looping ambient beds via the AudioContext ----------------------------
// Gapless looped playback of a decoded sample (AudioBufferSourceNode.loop —
// HTMLAudioElement's `loop` has an audible seam on iOS/Android WebViews).
// Each loop gets its own gain node under masterGain, so beds can layer on
// top of one another and user mute/volume apply live. Short gain ramps on
// start/stop avoid clicks.
//
// Returns a handle whose `stop()` is idempotent and safe to call while the
// decode is still in flight (the loop then never starts). Decode failure →
// silent no-op handle: a seamed HTMLAudio fallback loop is worse than silence.
export function playLoop(url, { volume: loopVolume = 1, fadeS = 0.08 } = {}) {
  const handle = { stopped: false, _src: null, _env: null, stop: null }
  handle.stop = () => {
    handle.stopped = true
    const src = handle._src
    const env = handle._env
    if (!src || !env || !ctx) return
    handle._src = null
    handle._env = null
    try {
      const now = ctx.currentTime
      env.gain.cancelScheduledValues(now)
      env.gain.setValueAtTime(env.gain.value, now)
      env.gain.linearRampToValueAtTime(0, now + fadeS)
      src.stop(now + fadeS + 0.02)
      src.onended = () => { try { src.disconnect(); env.disconnect() } catch { /* noop */ } }
    } catch { /* best-effort */ }
  }

  if (!url) { handle.stopped = true; return handle }
  const c = ensureContext()
  if (!c || !masterGain) { handle.stopped = true; return handle }

  const start = (buffer) => {
    if (!buffer || handle.stopped) return // decode failed, or stopped before start
    try {
      if (c.state === 'suspended') c.resume().catch(() => {})
      const src = c.createBufferSource()
      src.buffer = buffer
      src.loop = true
      // AAC priming/padding can leave a few ms of silence at the buffer
      // edges; nudging the loop points inward keeps the seam inaudible.
      if (buffer.duration > 1) {
        src.loopStart = 0.03
        src.loopEnd = buffer.duration - 0.05
      }
      const env = c.createGain()
      const now = c.currentTime
      env.gain.setValueAtTime(0, now)
      env.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, loopVolume)), now + fadeS)
      src.connect(env)
      env.connect(masterGain) // masterGain applies user volume + mute live
      src.start(now)
      handle._src = src
      handle._env = env
    } catch { /* best-effort: never throw */ }
  }

  if (sampleCache.has(url)) {
    start(sampleCache.get(url))
  } else {
    preloadSample(url).then(start).catch(() => {})
  }
  return handle
}

export function stopLoop(handle) {
  if (handle?.stop) handle.stop()
}

// ---- Stoppable one-shot sample via the AudioContext -----------------------
// Like playSample (mixes with external audio via the ambient session, so it
// does NOT pause the user's background music), but returns a stop() handle so
// a longer clip — e.g. the timeout hype music — can be cut short when play
// resumes. Non-looping; ends on its own when the buffer finishes.
//
// Decode failure is a SILENT no-op (unlike playSample, which falls back to
// playClip/HTMLAudio): the whole reason to use this path is to avoid
// interrupting background audio, so an interrupting fallback would defeat it.
// Stop with stopLoop(handle) (same handle contract as playLoop).
export function playStoppableSample(url, { volume: sampleVolume = 1, fadeS = 0.06 } = {}) {
  const handle = { stopped: false, _src: null, _env: null, stop: null }
  handle.stop = () => {
    handle.stopped = true
    const src = handle._src
    const env = handle._env
    if (!src || !env || !ctx) return
    handle._src = null
    handle._env = null
    try {
      const now = ctx.currentTime
      env.gain.cancelScheduledValues(now)
      env.gain.setValueAtTime(env.gain.value, now)
      env.gain.linearRampToValueAtTime(0, now + fadeS)
      src.stop(now + fadeS + 0.02)
      src.onended = () => { try { src.disconnect(); env.disconnect() } catch { /* noop */ } }
    } catch { /* best-effort */ }
  }

  if (!url) { handle.stopped = true; return handle }
  const c = ensureContext()
  if (!c || !masterGain) { handle.stopped = true; return handle }

  const start = (buffer) => {
    if (!buffer || handle.stopped) return // decode failed, or stopped before start
    try {
      if (c.state === 'suspended') c.resume().catch(() => {})
      const src = c.createBufferSource()
      src.buffer = buffer
      const env = c.createGain()
      env.gain.value = Math.max(0, Math.min(1, sampleVolume))
      src.connect(env)
      env.connect(masterGain) // masterGain applies user volume + mute live
      src.start()
      src.onended = () => { try { src.disconnect(); env.disconnect() } catch { /* noop */ } }
      handle._src = src
      handle._env = env
    } catch { /* best-effort: never throw */ }
  }

  if (sampleCache.has(url)) {
    start(sampleCache.get(url))
  } else {
    preloadSample(url).then(start).catch(() => {})
  }
  return handle
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
