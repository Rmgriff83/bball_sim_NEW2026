// =============================================================================
// DefensiveMatchup.js — intelligent, scheme-aware defensive assignments
// =============================================================================
// Pure helpers (only import: the positions util). PlayExecutionEngine owns the
// per-possession state and calls these to build/resolve who guards whom based on
// the defensive scheme (man / zone / box-and-one), screens, and a user-override
// hierarchy. Layouts & behaviors are grounded in coaching references (2-3, 3-2,
// 1-3-1, 1-2-2 trap, box-and-one, switch/drop screen rules).
// =============================================================================

import { POSITION_INDEX, positionGroup, positionDistance } from '@/engine/util/positions'

const idOf = (p) => String(p?.id ?? '')
const posOf = (p) => p?.position ?? 'SF'
const overallOf = (p) => p?.overall_rating ?? p?.overallRating ?? 70

/** Read an attribute from any of the player's attribute buckets. */
function attr(player, name, fallback = 70) {
  const a = player?.attributes
  if (!a) return fallback
  for (const bucket of ['defense', 'physical', 'offense', 'mental']) {
    const v = a[bucket]?.[name]
    if (typeof v === 'number') return v
  }
  return fallback
}

function hasBadge(player, id) {
  const badges = player?.badges
  if (!Array.isArray(badges)) return false
  return badges.some((b) => (typeof b === 'string' ? b : b?.id) === id)
}

/** Composite defensive rating — averages core D attributes, falls back to overall. */
export function defenseRating(player) {
  const d = player?.attributes?.defense
  if (d) {
    const vals = [
      d.perimeterDefense, d.interiorDefense,
      d.helpDefenseIQ ?? d.defensiveIQ ?? d.defensive_iq,
      d.steal, d.block,
    ].filter((v) => typeof v === 'number')
    if (vals.length) return vals.reduce((s, v) => s + v, 0) / vals.length
  }
  return overallOf(player)
}

/** man / zone / box_one — drives how matchups resolve. */
export function schemeFamily(scheme) {
  if (scheme === 'box_and_one') return 'box_one'
  if (typeof scheme === 'string' && (scheme.startsWith('zone_') || scheme === 'half_court_trap')) {
    return 'zone'
  }
  return 'man' // man, drop_coverage, trap, press, switch_everything
}

// ---------------------------------------------------------------------------
// Man matchups (with user-override hierarchy)
// ---------------------------------------------------------------------------

/**
 * Build a complete, 1:1 offId→defId map.
 *  1. Honor each override only when its defender is on court AND eligible.
 *  2. Fill the rest (PG→C order) with the best available defender:
 *     exact position match > same group (min distance) > min distance,
 *     tie-broken by higher defense rating.
 *
 * @returns {Object<string,string>}
 */
export function assignManMatchups(offense, defense, { overrides = null } = {}) {
  const map = {}
  const used = new Set()
  const defById = new Map(defense.map((d) => [idOf(d), d]))

  // 1) User overrides take precedence whenever the chosen defender is on court.
  // NO eligibility gate here — the user may deliberately set a mismatch (e.g. a
  // PG on a center). Eligibility still governs the automatic fill in step 2.
  if (overrides) {
    for (const off of offense) {
      const want = overrides[idOf(off)]
      if (!want) continue
      const d = defById.get(String(want))
      if (d && !used.has(idOf(d))) {
        map[idOf(off)] = idOf(d)
        used.add(idOf(d))
      }
    }
  }

  // 2) Positional best-fit for the remainder.
  const remaining = offense.filter((o) => !(idOf(o) in map))
  remaining.sort((a, b) => (POSITION_INDEX[posOf(a)] ?? 2) - (POSITION_INDEX[posOf(b)] ?? 2))

  for (const off of remaining) {
    const offPos = posOf(off)
    const candidates = defense.filter((d) => !used.has(idOf(d)))
    if (candidates.length === 0) break
    candidates.sort((a, b) => {
      const exA = posOf(a) === offPos ? 1 : 0
      const exB = posOf(b) === offPos ? 1 : 0
      if (exA !== exB) return exB - exA
      const grpA = positionGroup(posOf(a)) === positionGroup(offPos) ? 1 : 0
      const grpB = positionGroup(posOf(b)) === positionGroup(offPos) ? 1 : 0
      if (grpA !== grpB) return grpB - grpA
      const distA = positionDistance(posOf(a), offPos)
      const distB = positionDistance(posOf(b), offPos)
      if (distA !== distB) return distA - distB
      return defenseRating(b) - defenseRating(a)
    })
    const picked = candidates[0]
    map[idOf(off)] = idOf(picked)
    used.add(idOf(picked))
  }

  return map
}

// ---------------------------------------------------------------------------
// Zone layouts (normalized 0-1, hoop at y≈0.9). Slots ordered top→bottom; the
// defender list (sorted PG→C) zips onto them so guards sit up top, bigs low.
// ---------------------------------------------------------------------------

const ZONE_LAYOUTS = {
  zone_2_3: [
    { x: 0.30, y: 0.32 }, { x: 0.70, y: 0.32 },          // guards (top)
    { x: 0.18, y: 0.70 }, { x: 0.82, y: 0.70 },          // forwards
    { x: 0.50, y: 0.80 },                                // center
  ],
  zone_3_2: [
    { x: 0.22, y: 0.32 }, { x: 0.50, y: 0.28 }, { x: 0.78, y: 0.32 }, // 3 across top
    { x: 0.34, y: 0.74 }, { x: 0.66, y: 0.74 },                       // 2 low
  ],
  zone_1_3_1: [
    { x: 0.50, y: 0.22 },                                              // top
    { x: 0.16, y: 0.50 }, { x: 0.50, y: 0.46 }, { x: 0.84, y: 0.50 }, // middle 3
    { x: 0.50, y: 0.80 },                                             // baseline
  ],
  half_court_trap: [
    { x: 0.50, y: 0.22 },                                              // point (1)
    { x: 0.26, y: 0.46 }, { x: 0.74, y: 0.46 },                       // wings (2)
    { x: 0.30, y: 0.74 }, { x: 0.70, y: 0.74 },                       // low (2)
  ],
}

const BOX_LAYOUT = [
  { x: 0.34, y: 0.42 }, { x: 0.66, y: 0.42 },  // high box
  { x: 0.34, y: 0.74 }, { x: 0.66, y: 0.74 },  // low box
]

function assignDefendersToSlots(defenders, slots) {
  // Sort top→bottom; defenders PG→C; zip so guards take the high slots.
  const orderedSlots = [...slots].sort((a, b) => a.y - b.y)
  const orderedDefs = [...defenders].sort(
    (a, b) => (POSITION_INDEX[posOf(a)] ?? 2) - (POSITION_INDEX[posOf(b)] ?? 2)
  )
  const anchors = []
  for (let i = 0; i < orderedSlots.length && i < orderedDefs.length; i++) {
    anchors.push({ defId: idOf(orderedDefs[i]), x: orderedSlots[i].x, y: orderedSlots[i].y })
  }
  return anchors
}

/** Zone anchors: [{ defId, x, y }] for the scheme's slots. */
export function buildZoneAnchors(defense, scheme) {
  const slots = ZONE_LAYOUTS[scheme] || ZONE_LAYOUTS.zone_2_3
  return assignDefendersToSlots(defense, slots)
}

/** Nearest zone anchor's defId to the actor's court position (area pick-up). */
export function zoneDefenderId(anchors, actorPos) {
  if (!anchors || anchors.length === 0) return null
  if (!actorPos) return anchors[0].defId
  let best = anchors[0]
  let bestD = Infinity
  for (const a of anchors) {
    const dx = a.x - actorPos.x
    const dy = a.y - actorPos.y
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = a }
  }
  return best.defId
}

// ---------------------------------------------------------------------------
// Box-and-one (hybrid): chaser man-locks the star, 4 play a zone box.
// ---------------------------------------------------------------------------

/** The offensive player the chaser denies — highest-rated guard/wing (the star). */
export function pickChaserTarget(offense) {
  const perimeter = offense.filter((o) => positionGroup(posOf(o)) !== 'big')
  const pool = perimeter.length ? perimeter : offense
  let star = pool[0]
  for (const o of pool) if (overallOf(o) > overallOf(star)) star = o
  return star ? idOf(star) : null
}

/**
 * Full box-and-one assignment.
 * @returns {{ chaser:{offId,defId}|null, anchors:Array<{defId,x,y}> }}
 */
export function assignBoxAndOne(offense, defense) {
  const starId = pickChaserTarget(offense)
  const star = offense.find((o) => idOf(o) === starId) || null
  // Best available perimeter defender chases the star (by defense rating).
  const perimeterDefs = defense.filter((d) => positionGroup(posOf(d)) !== 'big')
  const chaserPool = perimeterDefs.length ? perimeterDefs : defense
  let chaserDef = chaserPool[0]
  for (const d of chaserPool) if (defenseRating(d) > defenseRating(chaserDef)) chaserDef = d
  const chaser = star && chaserDef ? { offId: idOf(star), defId: idOf(chaserDef) } : null
  const boxDefenders = defense.filter((d) => idOf(d) !== (chaser ? chaser.defId : null))
  const anchors = assignDefendersToSlots(boxDefenders, BOX_LAYOUT)
  return { chaser, anchors }
}

// ---------------------------------------------------------------------------
// Screen switching (man family only)
// ---------------------------------------------------------------------------

/**
 * Probability that an on-ball screen causes a defensive switch.
 *  switch_everything → 1.0 ; drop_coverage → 0.0 (big drops) ;
 *  man/trap/press → modest base, up with screener strength, down with the
 *  on-ball defender's help IQ + Pick Dodger badge.
 */
export function screenSwitchChance(scheme, screener, onBallDefender) {
  if (scheme === 'switch_everything') return 1.0
  if (scheme === 'drop_coverage') return 0.0
  if (schemeFamily(scheme) !== 'man') return 0.0
  const strength = attr(screener, 'strength', 70)
  const helpIQ = attr(onBallDefender, 'helpDefenseIQ', attr(onBallDefender, 'defensiveIQ', 70))
  let chance = 0.18 + (strength - 70) / 400 - (helpIQ - 70) / 400
  if (hasBadge(onBallDefender, 'pick_dodger')) chance -= 0.1
  return Math.max(0, Math.min(0.6, chance))
}

export default {
  schemeFamily,
  defenseRating,
  assignManMatchups,
  buildZoneAnchors,
  zoneDefenderId,
  pickChaserTarget,
  assignBoxAndOne,
  screenSwitchChance,
}
