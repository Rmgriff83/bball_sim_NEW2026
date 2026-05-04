/**
 * Coach badge master list. Each badge has four levels (bronze → silver → gold
 * → HOF) and the effect strength scales with level — same model as player
 * badges in `engine/data/badges.js` so the UI / aggregation patterns line up.
 *
 * Effects are aggregated per owned badge by `getCoachPerks()` in
 * `engine/coaching/CoachPerks.js` (it reads `def.effects[entry.level]`).
 *
 * Two ways a coach earns a badge:
 *  - Master-seeded: pre-populated in `coaches.js` via `COACHES[i].badges`,
 *    e.g. `[{ id: 'defensive_mastermind', level: 'gold' }]`. Stored on
 *    `coach.badges` with `source: 'master'`.
 *  - User-purchased: bought through the Coach Badge Store. Each purchase
 *    advances the badge to the next level (or unlocks at bronze if not owned).
 *    Stored with `source: 'purchased'` and a `purchasedAt` timestamp.
 *
 * Both paths share the same level slot — i.e. a coach can't have the same
 * badge at two levels simultaneously; upgrading replaces the previous level.
 */
export const COACH_BADGE_LEVELS = ['bronze', 'silver', 'gold', 'hof']

/**
 * Return the next level after `current`, or null if the badge is already at
 * the max tier (HOF). `null` input → 'bronze' (initial unlock).
 */
export function nextCoachBadgeLevel(current) {
  if (!current) return 'bronze'
  const idx = COACH_BADGE_LEVELS.indexOf(current)
  if (idx < 0 || idx === COACH_BADGE_LEVELS.length - 1) return null
  return COACH_BADGE_LEVELS[idx + 1]
}

export const coachBadges = [
  {
    id: 'player_whisperer',
    name: 'Player Whisperer',
    category: 'development',
    description: 'Monthly player development boost for everyone on the roster.',
    effects: {
      bronze: { developmentBonus: 0.025 },
      silver: { developmentBonus: 0.05 },
      gold:   { developmentBonus: 0.08 },
      hof:    { developmentBonus: 0.12 },
    },
    cost: { bronze: 800, silver: 1500, gold: 2500, hof: 4500 },
  },
  {
    id: 'late_game_genius',
    name: 'Late-Game Genius',
    category: 'gameManagement',
    description: 'Boosts your team\'s shot probability in clutch time.',
    effects: {
      bronze: { clutchShotBonus: 0.01 },
      silver: { clutchShotBonus: 0.02 },
      gold:   { clutchShotBonus: 0.035 },
      hof:    { clutchShotBonus: 0.05 },
    },
    cost: { bronze: 800, silver: 1500, gold: 2500, hof: 4500 },
  },
  {
    id: 'defensive_mastermind',
    name: 'Defensive Mastermind',
    category: 'defensiveIQ',
    description: 'Defensive scheme effectiveness boosted as if defensiveIQ were higher.',
    effects: {
      bronze: { defensiveIQBoost: 4 },
      silver: { defensiveIQBoost: 8 },
      gold:   { defensiveIQBoost: 12 },
      hof:    { defensiveIQBoost: 18 },
    },
    cost: { bronze: 800, silver: 1500, gold: 2500, hof: 4500 },
  },
  {
    id: 'offensive_mastermind',
    name: 'Offensive Mastermind',
    category: 'offensiveIQ',
    description: 'Offensive scheme effectiveness boosted as if offensiveIQ were higher.',
    effects: {
      bronze: { offensiveIQBoost: 4 },
      silver: { offensiveIQBoost: 8 },
      gold:   { offensiveIQBoost: 12 },
      hof:    { offensiveIQBoost: 18 },
    },
    cost: { bronze: 800, silver: 1500, gold: 2500, hof: 4500 },
  },
  {
    id: 'players_coach',
    name: "Player's Coach",
    category: 'strictness',
    description: 'Softens strictness penalties on low-work-ethic stars.',
    effects: {
      bronze: { strictnessSoften: 0.25 },
      silver: { strictnessSoften: 0.5 },
      gold:   { strictnessSoften: 0.75 },
      hof:    { strictnessSoften: 1.0 },
    },
    cost: { bronze: 800, silver: 1500, gold: 2500, hof: 4500 },
  },
]
