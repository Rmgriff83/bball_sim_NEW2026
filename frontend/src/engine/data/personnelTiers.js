// Tier configs for the three non-coach personnel kinds:
//   - scout         (league scouting — campaign.settings.scout)
//   - physician     (player health/recovery — campaign.settings.trainer)
//   - staff_trainer (player development — campaign.settings.staff_trainer)
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

// Number of candidates each pool ships with at campaign creation.
// Mirrors the existing modal generators (2 × 3-star + 1 × 4-star).
export const PERSONNEL_POOL_COUNTS = {
  scout: { 3: 2, 4: 1 },
  physician: { 3: 2, 4: 1 },
  staff_trainer: { 3: 2, 4: 1 },
  analyst: { 3: 2, 4: 1 },
}

// Storage-key mapping for the singleton currently-hired records in
// campaign.settings. Keeps the legacy key names so existing campaigns
// don't break.
export const PERSONNEL_SETTINGS_KEY = {
  scout: 'scout',
  physician: 'trainer',         // legacy name
  staff_trainer: 'staff_trainer',
  analyst: 'analyst',
}

// The matching pool key in campaign.settings. New at Phase 4 — coaches
// already had availableCoaches in this slot.
export const PERSONNEL_POOL_KEY = {
  scout: 'availableScouts',
  physician: 'availableTrainers',
  staff_trainer: 'availableStaffTrainers',
  analyst: 'availableAnalysts',
}
