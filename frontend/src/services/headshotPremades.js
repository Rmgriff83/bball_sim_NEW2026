// Eager-glob the player premade folder so any SVG the admin saves on
// /admin/headshots (Players tab) is included at build time. Each premade
// SVG carries the full <g data-layer="..." data-*="..."> metadata that the
// composer stamps, so picking one is just configFromSvg(svgContent) in
// HeadshotEditorView. New premades require a deploy — same lifecycle as
// the bundled headshot-layers/ variant files.
//
// Coaches do NOT use a premade pool. Their finished headshots live in
// frontend/src/assets/coach-headshots/ as either admin-authored SVGs
// (created via the Coaches tab Create New Headshot button) or legacy
// master-coach PNGs. They're enumerated by listCoachHeadshots() below for
// CampaignManager's random-per-coach assignment and rendered by
// CoachAvatar.vue. There's no swap-to-premade UX on the user side for
// coaches — users just edit layers/colors of their assigned headshot.

const PLAYER_RAW = import.meta.glob(
  '@/assets/headshots-premade/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)

const COACH_HEADSHOT_SVG_RAW = import.meta.glob(
  '@/assets/coach-headshots/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)

// PNG URLs (not raw content) — legacy master-coach portraits. Eager-loaded
// for module URLs that CoachAvatar can drop into an <img src>.
const COACH_HEADSHOT_PNG_MODULES = import.meta.glob(
  '@/assets/coach-headshots/*.png',
  { eager: true },
)

function _toEntries(raw) {
  return Object.entries(raw)
    .map(([path, svgContent]) => {
      const name = path.split('/').pop().replace(/\.svg$/, '')
      return { name, svgContent }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/**
 * Player premades. Defaults to 'player' for back-compat with callers that
 * don't specify (the user-facing HeadshotEditorView's bottom strip on the
 * player customize screen).
 */
export function listPremades(audience = 'player') {
  if (audience === 'coach') return []   // coaches don't have premades
  return _toEntries(PLAYER_RAW)
}

/**
 * Enumerate every coach-headshot filename under coach-headshots/ — both
 * admin-authored SVGs (saved via the Coaches tab) and legacy master-coach
 * PNGs. Used by CampaignManager.generateCoach() for the random-per-coach
 * assignment pass and by CoachAvatar for filename resolution.
 *
 * Returns just the bare filenames (e.g. ['coach_001.svg', 'gregg_popovich.png']).
 */
export function listCoachHeadshots() {
  const names = new Set()
  for (const path of Object.keys(COACH_HEADSHOT_SVG_RAW)) {
    names.add(path.split('/').pop())
  }
  for (const path of Object.keys(COACH_HEADSHOT_PNG_MODULES)) {
    names.add(path.split('/').pop())
  }
  return [...names].sort()
}

/**
 * Look up a single player premade by slug. Used by HeadshotEditorView's
 * coach load path... wait, coaches don't use premades anymore. Kept on
 * the player side for the user editor's premade picker / coach editor
 * loading is via the resolver instead.
 */
export function getPremadeBySlug(slug) {
  for (const [path, svgContent] of Object.entries(PLAYER_RAW)) {
    const name = path.split('/').pop().replace(/\.svg$/, '')
    if (name === slug) return { name, svgContent }
  }
  return null
}

/**
 * Resolve a coach-headshot filename to renderable bytes/URL.
 *   - SVG → { kind: 'svg', svgContent } so consumers can render inline
 *     or convert to a data URL.
 *   - PNG → { kind: 'png', url } module URL for direct <img src>.
 *   - Missing → null (fall back to UserCog icon at the caller).
 */
export function getCoachHeadshotByName(filename) {
  if (!filename) return null
  const lower = String(filename).toLowerCase()
  // SVG match by basename
  for (const [path, svgContent] of Object.entries(COACH_HEADSHOT_SVG_RAW)) {
    if (path.split('/').pop().toLowerCase() === lower) {
      return { kind: 'svg', svgContent }
    }
  }
  // PNG match by basename
  for (const [path, mod] of Object.entries(COACH_HEADSHOT_PNG_MODULES)) {
    if (path.split('/').pop().toLowerCase() === lower) {
      return { kind: 'png', url: mod.default ?? mod }
    }
  }
  return null
}
