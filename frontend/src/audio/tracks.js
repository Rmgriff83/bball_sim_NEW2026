// MP3 resource registry — music and in-game noises.
//
// HOW TO ADD AUDIO:
//   1. Drop an .mp3 file into `frontend/src/assets/audio/`
//      (e.g. `homepage-theme.mp3`, `crowd-ambience.mp3`).
//   2. Reference its filename in the MUSIC or GAME_SFX maps below.
//   3. Play it via the audio store: `audioStore.playMusic('homepage')` /
//      `audioStore.playGameSfx('ambience', { loop: true })`.
//
// Files are auto-discovered at build time via Vite's glob import. `resolve()`
// returns the hashed asset URL when the file exists, or `null` when it doesn't
// yet — so referencing a not-yet-added track is a safe no-op (silent), never
// an error.

const modules = import.meta.glob('@/assets/audio/*.mp3', { eager: true })

// filename (e.g. 'homepage-theme.mp3') -> resolved URL, or null if absent.
function resolve(filename) {
  const entry = Object.entries(modules).find(
    ([path]) => path.split('/').pop() === filename
  )
  return entry ? entry[1].default : null
}

// Looping/background music (homepage, menus).
export const MUSIC = {
  homepage: resolve('homepage-theme.mp3'),
  // menu: resolve('menu-loop.mp3'),
}

// In-game sound effects / ambience (played during the game view).
export const GAME_SFX = {
  ambience: resolve('crowd-ambience.mp3'),
  // buzzer: resolve('buzzer.mp3'),
  // swish: resolve('swish.mp3'),

  // Live draft. Drop these files into src/assets/audio/ to enable them; until
  // then resolve() returns null and playback is a silent no-op (no build error).
  draftIntro: resolve('draft-intro.mp3'),   // ESPN-style start-of-draft sting
  onTheClock: resolve('on-the-clock.mp3'),  // a team goes on the clock
}
