// Tier configs for the non-coach personnel kinds:
//   - scout         (league scouting — campaign.settings.scout)
//   - physician     (player health/recovery — campaign.settings.trainer)
//   - staff_trainer (player development — campaign.settings.staff_trainer)
//   - analyst       (play-set analytics — campaign.settings.analyst)
//   - arena_manager (fandom protection/marketing — campaign.settings.arena_manager)
//
// Coaches have their own tier system in CampaignManager (FREE_AGENT_COACH_TIERS).
// These are extracted so CampaignManager can pre-generate hire pools at
// campaign creation AND the hire modals can read them for label/perk display
// without duplicating constants.

export const SCOUT_TIERS = {
  3: {
    cost: 1500,
    label: '3-Star Scout',
    rating: 70,
    perks: [
      { key: 'extra_reveals', label: 'Extra Reveals', description: 'Reveals 33% of attributes per scout action (3 actions to fully scout)', requiredLevel: 2 },
    ],
  },
  4: {
    cost: 2500,
    label: '4-Star Scout',
    rating: 85,
    perks: [
      { key: 'extra_reveals', label: 'Extra Reveals', description: 'Reveals 33% of attributes per scout action (3 actions to fully scout)', requiredLevel: 2 },
      { key: 'badge_reveal', label: 'Badge Intel', description: "35% chance per scout action to reveal a rookie's badges", requiredLevel: 3 },
      { key: 'morale_reveal', label: 'Personality Intel', description: "35% chance per scout action to reveal a rookie's morale/personality", requiredLevel: 3 },
    ],
  },
}

// Optional scout perks — rolled per generated candidate (either tier may or
// may not carry one), unlike the guaranteed tier perks above. Stored on the
// candidate/hired record in the same `{ key, requiredLevel }` shape, so every
// existing perk-gating read (isScoutPerkActive, hire modal, facilities slot)
// works unchanged. Old saves whose pools predate this simply never roll one.
export const SCOUT_OPTIONAL_PERKS = [
  {
    key: 'red_flag_intel',
    label: 'Insider Intel',
    description: 'Full scouting reports call out character and durability red flags buried in the numbers',
    requiredLevel: 3,
    chanceByTier: { 3: 0.5, 4: 0.75 },
  },
]

/** Roll the optional perks for one generated scout candidate of `tierNum`. */
export function rollOptionalScoutPerks(tierNum) {
  return SCOUT_OPTIONAL_PERKS
    .filter((p) => Math.random() < (p.chanceByTier?.[tierNum] ?? 0))
    .map(({ key, label, description, requiredLevel }) => ({ key, label, description, requiredLevel }))
}

// In-game called "Physician" but the singleton key in campaign.settings is
// `trainer` for backward compat. Kept the legacy storage name; tier exports
// use the user-facing label.
export const PHYSICIAN_TIERS = {
  3: {
    cost: 1500,
    label: '3-Star Physician',
    rating: 70,
    perks: [
      { key: 'fast_recovery', label: 'Fast Recovery', description: 'Players recover from injuries 10% faster', requiredLevel: 3 },
    ],
  },
  4: {
    cost: 2500,
    label: '4-Star Physician',
    rating: 85,
    perks: [
      { key: 'fast_recovery', label: 'Fast Recovery', description: 'Players recover from injuries 15% faster', requiredLevel: 3 },
      { key: 'injury_prevention', label: 'Injury Prevention', description: 'Players have 10% less risk of getting injured', requiredLevel: 4 },
    ],
  },
}

export const STAFF_TRAINER_TIERS = {
  3: {
    cost: 1500,
    label: '3-Star Trainer',
    rating: 70,
    perks: [
      { key: 'growth_boost', label: 'Enhanced Development', description: 'Players develop 5% faster from game performance', requiredLevel: 3 },
    ],
  },
  4: {
    cost: 2500,
    label: '4-Star Trainer',
    rating: 85,
    perks: [
      { key: 'growth_boost', label: 'Elite Development', description: 'Players develop 10% faster from game performance', requiredLevel: 3 },
      { key: 'fatigue_reduction', label: 'Conditioning Program', description: 'Players generate 5% less fatigue during games', requiredLevel: 4 },
    ],
  },
}

// Analytics staff — unlocks the per-play-set analytics panels. Double-gated
// like every other staff kind: the hired analyst's TIER (tier 3 → postgame
// analytics for your own team; tier 4 → also the pregame OPPONENT report) AND
// the team's ANALYTICS facility level (`requiredLevel`, read from the perks
// stored at hire time — GameView + the staff card check it, mirroring
// scout/physician/staff-trainer). Analysts hired before this gating existed
// carry requiredLevel 1 and stay grandfathered until re-hired.
export const ANALYST_TIERS = {
  3: {
    cost: 1500,
    label: '3-Star Analyst',
    rating: 70,
    perks: [
      { key: 'postgame_analytics', label: 'Postgame Analytics', description: "See your team's efficiency by play set after games.", requiredLevel: 2 },
    ],
  },
  4: {
    cost: 2500,
    label: '4-Star Analyst',
    rating: 85,
    perks: [
      { key: 'postgame_analytics', label: 'Postgame Analytics', description: "See your team's efficiency by play set after games.", requiredLevel: 2 },
      { key: 'opponent_analytics', label: 'Opponent Scouting Report', description: "Scout the opponent's play-set tendencies before games.", requiredLevel: 3 },
    ],
  },
}

// Arena staff — protects and grows the team's fandom meter. The core Damage
// Control perk scales with the HIRED tier (loss-fandom mitigation lives in
// FandomService.LOSS_MITIGATION_BY_TIER, keyed by tier); Promo Machine and
// the optional Game-Night DJ variant gate on the ARENA facility level via
// the stored `requiredLevel`, mirroring every other staff kind.
export const ARENA_MANAGER_TIERS = {
  3: {
    cost: 1500,
    label: '3-Star Arena Manager',
    rating: 70,
    perks: [
      { key: 'arena_loss_mitigation', label: 'Damage Control', description: "Losses drag your fandom down 10% less (stacks with your arena's built-in protection)", requiredLevel: 1 },
    ],
  },
  4: {
    cost: 2500,
    label: '4-Star Arena Manager',
    rating: 85,
    perks: [
      { key: 'arena_loss_mitigation', label: 'Damage Control', description: "Losses drag your fandom down 15% less (stacks with your arena's built-in protection)", requiredLevel: 1 },
      { key: 'marketing_boost', label: 'Promo Machine', description: 'Marketing events boost fandom 25% more', requiredLevel: 2 },
    ],
  },
}

// Optional arena-manager perk — rolled per generated candidate like the
// scout's Insider Intel. Unlocks the pregame timeout-song picker once the
// Arena facility reaches Lv 3.
export const ARENA_MANAGER_OPTIONAL_PERKS = [
  {
    key: 'song_picker',
    label: 'Game-Night DJ',
    description: 'Pick the song that plays during your timeouts from the pregame screen',
    requiredLevel: 3,
    chanceByTier: { 3: 0.5, 4: 0.75 },
  },
]

// --- Breakthrough Training (staff-trainer optional perk) ---------------------
// Rolled onto generated 3★/4★ trainer candidates; consumed at training-claim
// time in stores/team.js `claimTrainingReward` (never by the sim). Perk copy
// differs per hire tier (like growth_boost); chances keyed by the HIRED
// trainer's tier. On proc the training reward jumps straight to the rolled
// tier (never worse than the normal weighted pick; per-player caps respected).
export const BADGE_BREAKTHROUGH_PERKS = {
  3: { key: 'badge_breakthrough', label: 'Breakthrough Training', description: 'Training rewards have a 5% chance to break through to Gold and 7% to Silver', requiredLevel: 3 },
  4: { key: 'badge_breakthrough', label: 'Breakthrough Training', description: 'Training rewards have a 7% chance to break through to Gold and 10% to Silver', requiredLevel: 3 },
}
export const BADGE_BREAKTHROUGH_CHANCES = {
  3: { gold: 0.05, silver: 0.07 },
  4: { gold: 0.07, silver: 0.10 },
}

// --- Candidate perk generation (2-perk hard cap) -----------------------------
// Every NEWLY generated candidate carries the tier's CORE perk(s) plus at most
// ONE rolled variant — never more than two perks total. Perk variety across a
// campaign comes from pool size + seasonal top-ups, not from stacking perks on
// a single hire. Already-hired staff and previously saved pool candidates keep
// whatever perk lists they were generated with (old 4★ scouts carry three).
const _tierPerk = (tiers, tierNum, key) => tiers[tierNum].perks.find((p) => p.key === key)

export const PERSONNEL_CANDIDATE_PERKS = {
  scout: {
    3: {
      core: [_tierPerk(SCOUT_TIERS, 3, 'extra_reveals')],
      variantChance: 0.5,
      variants: [{ weight: 1, perk: SCOUT_OPTIONAL_PERKS[0] }],
    },
    4: {
      core: [_tierPerk(SCOUT_TIERS, 4, 'extra_reveals')],
      variantChance: 1,
      variants: [
        { weight: 1, perk: _tierPerk(SCOUT_TIERS, 4, 'badge_reveal') },
        { weight: 1, perk: _tierPerk(SCOUT_TIERS, 4, 'morale_reveal') },
        { weight: 1, perk: SCOUT_OPTIONAL_PERKS[0] },
      ],
    },
  },
  physician: {
    3: { core: PHYSICIAN_TIERS[3].perks, variantChance: 0, variants: [] },
    4: {
      core: [_tierPerk(PHYSICIAN_TIERS, 4, 'fast_recovery')],
      variantChance: 1,
      variants: [{ weight: 1, perk: _tierPerk(PHYSICIAN_TIERS, 4, 'injury_prevention') }],
    },
  },
  staff_trainer: {
    3: {
      core: [_tierPerk(STAFF_TRAINER_TIERS, 3, 'growth_boost')],
      variantChance: 0.5,
      variants: [{ weight: 1, perk: BADGE_BREAKTHROUGH_PERKS[3] }],
    },
    4: {
      core: [_tierPerk(STAFF_TRAINER_TIERS, 4, 'growth_boost')],
      variantChance: 1,
      variants: [
        { weight: 1, perk: _tierPerk(STAFF_TRAINER_TIERS, 4, 'fatigue_reduction') },
        { weight: 1, perk: BADGE_BREAKTHROUGH_PERKS[4] },
      ],
    },
  },
  analyst: {
    3: { core: ANALYST_TIERS[3].perks, variantChance: 0, variants: [] },
    4: {
      core: [_tierPerk(ANALYST_TIERS, 4, 'postgame_analytics')],
      variantChance: 1,
      variants: [{ weight: 1, perk: _tierPerk(ANALYST_TIERS, 4, 'opponent_analytics') }],
    },
  },
  arena_manager: {
    3: {
      core: [_tierPerk(ARENA_MANAGER_TIERS, 3, 'arena_loss_mitigation')],
      variantChance: 0.5,
      variants: [{ weight: 1, perk: ARENA_MANAGER_OPTIONAL_PERKS[0] }],
    },
    4: {
      core: [_tierPerk(ARENA_MANAGER_TIERS, 4, 'arena_loss_mitigation')],
      variantChance: 1,
      variants: [
        { weight: 1, perk: _tierPerk(ARENA_MANAGER_TIERS, 4, 'marketing_boost') },
        { weight: 1, perk: ARENA_MANAGER_OPTIONAL_PERKS[0] },
      ],
    },
  },
}

/**
 * Roll the full perk list for one generated candidate. Returns fresh copies
 * ({ key, label, description, requiredLevel }) — never the shared consts —
 * capped at core + 1 variant (≤2 perks for every current kind/tier).
 */
export function generateCandidatePerks(kind, tierNum) {
  const copy = ({ key, label, description, requiredLevel }) => ({ key, label, description, requiredLevel })
  const cfg = PERSONNEL_CANDIDATE_PERKS[kind]?.[Number(tierNum)]
  if (!cfg) {
    const tiers = {
      scout: SCOUT_TIERS, physician: PHYSICIAN_TIERS,
      staff_trainer: STAFF_TRAINER_TIERS, analyst: ANALYST_TIERS,
      arena_manager: ARENA_MANAGER_TIERS,
    }[kind]
    return (tiers?.[tierNum]?.perks ?? []).map(copy)
  }
  const perks = cfg.core.map(copy)
  if (cfg.variants.length && Math.random() < cfg.variantChance) {
    const total = cfg.variants.reduce((sum, v) => sum + (v.weight ?? 1), 0)
    let r = Math.random() * total
    let pick = cfg.variants[cfg.variants.length - 1].perk
    for (const v of cfg.variants) {
      r -= v.weight ?? 1
      if (r <= 0) { pick = v.perk; break }
    }
    perks.push(copy(pick))
  }
  return perks
}

// Number of candidates each pool ships with at campaign creation AND the
// per-tier target the season-rollover top-up refills to. Two of each tier so
// the perk-variant spread (one variant per candidate) stays browsable.
export const PERSONNEL_POOL_COUNTS = {
  scout: { 3: 2, 4: 2 },
  physician: { 3: 2, 4: 2 },
  staff_trainer: { 3: 2, 4: 2 },
  analyst: { 3: 2, 4: 2 },
  arena_manager: { 3: 2, 4: 2 },
}

// Storage-key mapping for the singleton currently-hired records in
// campaign.settings. Keeps the legacy key names so existing campaigns
// don't break.
export const PERSONNEL_SETTINGS_KEY = {
  scout: 'scout',
  physician: 'trainer',         // legacy name
  staff_trainer: 'staff_trainer',
  analyst: 'analyst',
  arena_manager: 'arena_manager',
}

// The matching pool key in campaign.settings. New at Phase 4 — coaches
// already had availableCoaches in this slot.
export const PERSONNEL_POOL_KEY = {
  scout: 'availableScouts',
  physician: 'availableTrainers',
  staff_trainer: 'availableStaffTrainers',
  analyst: 'availableAnalysts',
  arena_manager: 'availableArenaManagers',
}
