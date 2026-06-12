// =============================================================================
// Modern NBA player archetypes
// =============================================================================
// Each archetype declares a `matches(attributes, vitals, position)` predicate
// that returns true when a player's attribute + vital fingerprint fits the
// canonical real-NBA shape for that role. `detectArchetype` walks the list in
// order and returns the FIRST match — so the order below is the priority
// order. Specialists come before generalists so a clean Lead Guard isn't
// mis-classified as a Combo, etc.
//
// Used by `pickBadgesByFit` in CampaignManager: when a player matches an
// archetype, badges tagged with that archetype's name get a soft score
// bonus during the picking pass, nudging the loadout toward a coherent
// identity. Players who don't match any archetype get pure attribute-driven
// badge picks (fine — they're "role players without a label").
//
// To add an archetype, add a new entry in the right position-bias section
// (Backcourt / Wing / Frontcourt) — order within the section matters.

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
// `attributes.{category}.{key}` reader with a safe fallback. Players carry
// every canonical attribute (see attributeSchema.js) so this rarely returns
// the fallback in practice, but we never want a missing key to throw.
function attr(a, category, key, fallback = 0) {
  const v = a?.[category]?.[key]
  return Number.isFinite(v) ? v : fallback
}

// Position helpers — guard / wing / big buckets. Some archetypes match across
// position slots (e.g., 3-and-D Guard is mostly SG but a long PG fits too).
const isGuard = (p) => p === 'PG' || p === 'SG'
const isWing  = (p) => p === 'SG' || p === 'SF' || p === 'PF'
const isBig   = (p) => p === 'PF' || p === 'C'

// ---------------------------------------------------------------------------
// Archetypes — order = priority
// ---------------------------------------------------------------------------
//
// Each entry:
//   id:        kebab-case stable identifier (used by badge fit.archetypeTags)
//   name:      display string (also used as the tag key in badges.js)
//   bucket:    'backcourt' | 'wing' | 'frontcourt' — purely organizational
//   matches:   (attributes, vitals, position) => boolean
//
// Vitals shape: { heightInches, weightLbs }.

export const ARCHETYPES = [
  // --- Backcourt ---------------------------------------------------------
  {
    id: 'lead-guard',
    name: 'Lead Guard',
    bucket: 'backcourt',
    matches(a, v, p) {
      // Pure point: elite vision + IQ + handles. Real comps: CP3,
      // Haliburton, Trae. PGs only — combo guards fall through to the
      // Combo Guard match below.
      if (p !== 'PG') return false
      return (
        attr(a, 'offense', 'passIQ') >= 80 &&
        attr(a, 'offense', 'passVision') >= 80 &&
        attr(a, 'mental', 'basketballIQ') >= 80 &&
        attr(a, 'offense', 'ballHandling') >= 78 &&
        attr(a, 'offense', 'midRange') >= 72
      )
    },
  },
  {
    id: 'combo-guard',
    name: 'Combo Guard',
    bucket: 'backcourt',
    matches(a, v, p) {
      // Microwave scorer with secondary playmaking. Real comps: Maxey,
      // Jordan Poole, Tyrese Maxey. Lives at PG/SG.
      if (!isGuard(p)) return false
      const scoring = (attr(a, 'offense', 'threePoint') + attr(a, 'offense', 'midRange') + attr(a, 'offense', 'shotIQ')) / 3
      return (
        scoring >= 76 &&
        attr(a, 'offense', 'ballHandling') >= 75 &&
        attr(a, 'physical', 'speedWithBall') >= 70 || // fast scorer
        (attr(a, 'offense', 'threePoint') >= 80 && attr(a, 'offense', 'midRange') >= 78 && isGuard(p))
      )
    },
  },
  {
    id: 'three-and-d-guard',
    name: '3-and-D Guard',
    bucket: 'backcourt',
    matches(a, v, p) {
      // Catch-and-shoot + on-ball perimeter D, low primary creation.
      // Real comps: Klay, Mikal Bridges (off-ball), Caruso.
      if (!isGuard(p)) return false
      return (
        attr(a, 'offense', 'threePoint') >= 78 &&
        attr(a, 'defense', 'perimeterDefense') >= 76 &&
        attr(a, 'offense', 'passIQ') < 80   // not a primary playmaker
      )
    },
  },
  {
    id: 'slasher',
    name: 'Slasher',
    bucket: 'backcourt',
    matches(a, v, p) {
      // Rim-attacking guard with weak outside shot. Real comps: Ja Morant,
      // Anthony Edwards (athletic version). Identifies on guards/wings.
      if (!isGuard(p) && p !== 'SF') return false
      return (
        attr(a, 'offense', 'drivingDunk') >= 78 &&
        attr(a, 'offense', 'drawFoul') >= 75 &&
        attr(a, 'physical', 'speed') >= 78 &&
        attr(a, 'physical', 'acceleration') >= 78 &&
        attr(a, 'offense', 'threePoint') <= 75
      )
    },
  },

  // --- Wing / Forward ----------------------------------------------------
  {
    id: 'two-way-wing',
    name: 'Two-Way Wing',
    bucket: 'wing',
    matches(a, v, p) {
      // Star-level both ways. Real comps: Kawhi, Tatum prime, OG. Broad
      // 78+ across shot creation, drive, and perimeter D.
      if (!isWing(p)) return false
      return (
        attr(a, 'offense', 'threePoint') >= 76 &&
        attr(a, 'offense', 'midRange') >= 75 &&
        attr(a, 'offense', 'drivingDunk') >= 75 &&
        attr(a, 'defense', 'perimeterDefense') >= 78 &&
        attr(a, 'mental', 'basketballIQ') >= 75
      )
    },
  },
  {
    id: 'point-forward',
    name: 'Point Forward',
    bucket: 'wing',
    matches(a, v, p) {
      // Tall ball-handler with elite vision. Real comps: LeBron, BI,
      // Luka-on-the-3, Lauri-as-PF. Lives at SF/PF.
      if (p !== 'SF' && p !== 'PF') return false
      return (
        attr(a, 'offense', 'passIQ') >= 78 &&
        attr(a, 'offense', 'passVision') >= 78 &&
        attr(a, 'offense', 'ballHandling') >= 72 &&
        (v?.heightInches ?? 78) >= 78  // 6'6"+
      )
    },
  },
  {
    id: 'three-and-d-wing',
    name: '3-and-D Wing',
    bucket: 'wing',
    matches(a, v, p) {
      // SF/PF version of 3-and-D. Real comps: PJ Tucker, Brandon Clarke,
      // Royce O'Neale. Catch-and-shoot + plus defender.
      if (p !== 'SF' && p !== 'PF') return false
      return (
        attr(a, 'offense', 'threePoint') >= 76 &&
        attr(a, 'defense', 'perimeterDefense') >= 76 &&
        attr(a, 'offense', 'passIQ') < 78
      )
    },
  },
  {
    id: 'slashing-wing',
    name: 'Slashing Wing',
    bucket: 'wing',
    matches(a, v, p) {
      // Bruising rim-attacker. Real comps: Zion, JB, post-OKC Jayson Brown.
      if (p !== 'SF' && p !== 'PF') return false
      return (
        attr(a, 'offense', 'drivingDunk') >= 80 &&
        attr(a, 'offense', 'drawFoul') >= 75 &&
        attr(a, 'physical', 'strength') >= 76 &&
        attr(a, 'offense', 'threePoint') < 78
      )
    },
  },
  {
    id: 'stretch-4',
    name: 'Stretch 4',
    bucket: 'wing',
    matches(a, v, p) {
      // Tall outside shooter, modest interior. Real comps: Markkanen,
      // KAT-as-4, Davis Bertans. PF/C with shooting.
      if (p !== 'PF' && p !== 'C') return false
      return (
        attr(a, 'offense', 'threePoint') >= 76 &&
        (v?.heightInches ?? 80) >= 80 &&
        attr(a, 'defense', 'interiorDefense') < 80
      )
    },
  },
  {
    id: 'power-forward-bruiser',
    name: 'Power Forward (Bruiser)',
    bucket: 'wing',
    matches(a, v, p) {
      // Banger 4 — strength, rebounding, no spacing. Real comps: Tucker
      // prime, J. Randle bully years.
      if (p !== 'PF' && p !== 'SF') return false
      return (
        attr(a, 'physical', 'strength') >= 78 &&
        attr(a, 'defense', 'interiorDefense') >= 76 &&
        attr(a, 'defense', 'defensiveRebound') >= 76 &&
        attr(a, 'offense', 'threePoint') < 68
      )
    },
  },

  // --- Frontcourt --------------------------------------------------------
  {
    id: 'point-center',
    name: 'Point Center',
    bucket: 'frontcourt',
    matches(a, v, p) {
      // Big with elite vision and IQ. Real comps: Jokić, Sabonis. Rare —
      // priority over the rest of the C archetypes so a Jokić shape doesn't
      // mis-classify as a Bruiser.
      if (p !== 'C' && p !== 'PF') return false
      return (
        attr(a, 'offense', 'passIQ') >= 78 &&
        attr(a, 'offense', 'passVision') >= 78 &&
        (v?.heightInches ?? 80) >= 81 &&
        attr(a, 'mental', 'basketballIQ') >= 82
      )
    },
  },
  {
    id: 'stretch-5',
    name: 'Stretch 5',
    bucket: 'frontcourt',
    matches(a, v, p) {
      // Floor-spacing big with rim deterrence. Real comps: Brook Lopez
      // modern, Myles Turner.
      if (p !== 'C') return false
      return (
        attr(a, 'offense', 'threePoint') >= 72 &&
        (v?.heightInches ?? 80) >= 82 &&
        attr(a, 'defense', 'block') >= 72
      )
    },
  },
  {
    id: 'drop-big',
    name: 'Drop Big',
    bucket: 'frontcourt',
    matches(a, v, p) {
      // Defensive anchor 5. Real comps: Gobert, Mobley, Walker Kessler-on-D.
      if (p !== 'C') return false
      return (
        attr(a, 'defense', 'block') >= 78 &&
        attr(a, 'defense', 'interiorDefense') >= 78 &&
        attr(a, 'defense', 'helpDefenseIQ') >= 76 &&
        attr(a, 'defense', 'perimeterDefense') < 75
      )
    },
  },
  {
    id: 'rim-runner',
    name: 'Rim Runner',
    bucket: 'frontcourt',
    matches(a, v, p) {
      // Vertical-spacing pick-and-roll diver. Real comps: Capela, Plumlee,
      // Walker Kessler on offense.
      if (p !== 'C' && p !== 'PF') return false
      return (
        attr(a, 'physical', 'vertical') >= 78 &&
        attr(a, 'offense', 'standingDunk') >= 78 &&
        attr(a, 'offense', 'hands') >= 72 &&
        attr(a, 'offense', 'threePoint') < 60
      )
    },
  },
  {
    id: 'old-school-bruiser',
    name: 'Old-School Bruiser',
    bucket: 'frontcourt',
    matches(a, v, p) {
      // Back-to-basket center. Real comps: Vučević on offense, Sabonis-
      // bruiser years.
      if (p !== 'C' && p !== 'PF') return false
      return (
        attr(a, 'offense', 'postHook') >= 75 &&
        attr(a, 'offense', 'postFade') >= 72 &&
        attr(a, 'offense', 'postControl') >= 72 &&
        attr(a, 'physical', 'strength') >= 76 &&
        attr(a, 'offense', 'threePoint') < 65
      )
    },
  },
  // ---------------------------------------------------------------------
  // Default / catch-all — MUST be last in the array so it only fires when
  // none of the specialist fingerprints above matched. Real-world parallel:
  // a generic rotation guy / glue guy / undrafted-camp body who hasn't yet
  // shown a defining skill. As the player's attributes grow (user spends
  // upgrade points, training pushes them past a specialist threshold),
  // re-running `detectArchetype` will promote them to a specific archetype
  // automatically — which is why the modal calls this live rather than
  // relying solely on the snapshot stored at generation time.
  // ---------------------------------------------------------------------
  {
    id: 'role-player',
    name: 'Role Player',
    bucket: 'utility',
    matches() {
      return true
    },
  },
]

/**
 * First-match archetype detector. Returns an archetype object (id, name,
 * bucket) when the player's fingerprint matches, or null when they don't
 * cleanly fit any canonical shape. Used by `pickBadgesByFit` to apply a
 * 1.3× score bonus to badges tagged for the matched archetype's name.
 */
export function detectArchetype(player) {
  if (!player?.attributes) return null
  const vitals = {
    heightInches: player.heightInches ?? player.height_inches ?? null,
    weightLbs: player.weightLbs ?? player.weight_lbs ?? null,
  }
  for (const arch of ARCHETYPES) {
    try {
      if (arch.matches(player.attributes, vitals, player.position)) {
        return { id: arch.id, name: arch.name, bucket: arch.bucket }
      }
    } catch {
      // A malformed player record shouldn't kill generation — just skip the
      // failing matcher and keep looking.
    }
  }
  return null
}

/**
 * The full set of archetype names — handy for badge files that want to
 * declare `archetypeTags` without typoing.
 */
export const ARCHETYPE_NAMES = ARCHETYPES.map(a => a.name)
