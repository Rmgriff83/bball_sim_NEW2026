// Looping ambient sound LAYERS for live games.
//
// Each key names a game STATE the loop belongs to; GameView decides when a
// state is active and calls audio store startAmbient(key) / stopAmbient(key).
// Layers are independent Web Audio loops mixed under the master gain, so any
// number can play on top of one another (a whole-game crowd bed + a
// play-active court bed + ...). Each pool holds variant urls — startAmbient
// picks one at random per start.
//
// Adding a NEW layer is purely data:
//   1. drop files into src/assets/audio/ambient/ matching a glob below
//   2. add the pool entry here
//   3. wire the start/stop signal in GameView (a watch on the state flag)
//
// Files are eagerly glob-imported so Vite hashes/bundles them and the PWA
// precaches them. Loops play via audioEngine.playLoop (AudioBufferSourceNode,
// gapless — HTMLAudio's loop seam is audible on iOS/Android WebViews).

const pool = (glob, volume = 1) => ({ urls: Object.values(glob), volume })

const AMBIENT_SFX = {
  // On-court noise (dribbles, sneakers) — loops while a play is actively
  // animating; stops at segment breaks, quarter breaks, pause, game end.
  // Variants join via play_active_N.m4a.
  play_active: pool(import.meta.glob('@/assets/audio/ambient/play_active_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.85),

  // Arena crowd murmur — loops for the WHOLE game presentation, breaks
  // included (starts when animation mode opens, stops at box score / leaving
  // the view). Sits just under the play_active bed. Variants join via
  // game_crowd_N.m4a.
  game_crowd: pool(import.meta.glob('@/assets/audio/ambient/game_crowd_*.m4a', { eager: true, query: '?url', import: 'default' }), 0.7),
}

export default AMBIENT_SFX
