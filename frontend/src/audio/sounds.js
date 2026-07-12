// Synthesized UI sound definitions.
//
// Each key maps to a recipe: an array of tone objects played together/sequenced
// (see `playTone` in services/audioEngine.js for the available fields — freq,
// duration, type, gain, attack, release, slideTo, delay).
//
// To TUNE a sound, edit its `synth` array.
// To REPLACE a synth with an MP3 later, add a `file:` path resolved from the
// audio registry (see audio/tracks.js) — the store prefers `file` over `synth`.
//
// Sounds are intentionally quiet and short: subtle feedback, not alarms.

import affirmFile from '@/assets/audio/affirmation.flac'

export const UI_SOUNDS = {
  // Affirmation: meaningful confirmations (campaign select, attribute upgrade,
  // scout use). Plays the supplied audio file. Swap the import above to change
  // it, or replace `file` with a `synth` recipe to go back to a synthesized one.
  // `volume` is the per-sound gain (0..1) under the user's master volume.
  affirm: {
    file: affirmFile,
    volume: 0.7,
  },

  // Cancellation / dismissal: a gentle downward blip.
  cancel: {
    synth: [
      { freq: 320, duration: 0.12, type: 'sine', gain: 0.14, slideTo: 220 },
    ],
    // file: null,
  },

  // The generic UI tap — played on every button click (and tab navigation).
  // A plain, subtle *tap*: a short filtered noise click.
  navigate: {
    synth: [
      { noise: true, duration: 0.018, gain: 0.13, filterFreq: 1700, q: 0.6 },
    ],
    // file: null,
  },

  // Tertiary tap — ambient "something happened" feedback for events the user
  // didn't directly cause (currently AI draft picks). Same noise-click family
  // as `navigate` so it feels consistent, but darker (lower filter freq) and
  // slightly longer so it can be distinguished from a user tap.
  tertiary: {
    synth: [
      { noise: true, duration: 0.022, gain: 0.11, filterFreq: 1100, q: 0.6 },
    ],
    // file: null,
  },

  // Purchase / spending tokens: a "cha-ching" cash-register chime.
  // A short noise "cha" transient, then two bright bell-like tones ringing up.
  purchase: {
    synth: [
      // "cha" — percussive transient
      { noise: true, duration: 0.03, gain: 0.16, filterFreq: 3200, q: 0.5 },
      { freq: 1050, duration: 0.07, type: 'triangle', gain: 0.13, release: 0.05 },
      // "ching" — higher, longer ringing bell (layered partials for shimmer)
      { freq: 1400, duration: 0.30, type: 'triangle', gain: 0.14, delay: 0.08, attack: 0.002, release: 0.26 },
      { freq: 2100, duration: 0.28, type: 'sine', gain: 0.06, delay: 0.08, attack: 0.002, release: 0.25 },
    ],
    // file: null,
  },

  // Draft room — "you're on the clock": a confident two-note rise.
  draftStart: {
    synth: [
      { freq: 523.25, duration: 0.12, type: 'triangle', gain: 0.14, release: 0.08 },
      { freq: 783.99, duration: 0.18, type: 'triangle', gain: 0.14, delay: 0.1, attack: 0.002, release: 0.14 },
    ],
    // file: null,
  },

  // Draft room — per-second countdown tick during the final 10 seconds.
  // A short, dry blip; intentionally a touch sharper than the generic tap.
  draftTick: {
    synth: [
      { freq: 880, duration: 0.07, type: 'sine', gain: 0.12, release: 0.05 },
    ],
    // file: null,
  },
}
