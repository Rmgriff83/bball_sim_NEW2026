// =============================================================================
// LeagueRosterGenerator.js
// =============================================================================
// Generates a full procedural league (or fantasy free-agent pool) of veteran
// players for campaign init. Replaces the legacy `playersMaster` ingestion in
// CampaignManager.createCampaign() — see CampaignManager.generateVeteran() for
// the per-player generation engine this orchestrates.
//
// Design:
//   1. Randomly assign each team a campaign mode each new campaign:
//      'contender' (4-6 teams), 'rebuilder' (3-4 teams), 'average_strong'
//      and 'average_weak' (the rest). The user's team is always
//      'average_strong' so they don't get handed a tanked roster.
//   2. Each mode maps to a role-distribution blueprint over the 15-slot
//      ROSTER_POSITIONS layout (1 superstar / N starters / N rotation /
//      N bench). The mode also stamps team.aiDirection so the existing AI
//      services (AITradeService, AIContractService) immediately classify
//      the team correctly on Day 1 instead of treating every team as a
//      uniform "win-now" outfit.
//   3. Call generateVeteran() per slot with a target overall sampled from
//      the role band and a position fixed by the roster template.
//   4. After all 30 teams are generated, run validateAndRebalance() so the
//      league's overall histogram lands close to the target distribution
//      (6-8 superstars league-wide, 20-25 all-stars, etc.).
// =============================================================================

import { generateVeteran } from '../campaign/CampaignManager'

// Scan the headshots assets folder at build time so we know what custom
// portraits exist. Anything you drop into frontend/src/assets/headshots/
// becomes a candidate file. Sorted alphabetically so `headshot_1.svg`
// gets assigned before `headshot_2.svg`, etc. — pad future filenames to
// `headshot_01.svg` if you ever cross 10+ files (lexicographic sort puts
// `_10` before `_2` otherwise).
const _headshotModules = import.meta.glob('@/assets/headshots/*.svg', { eager: true })
const AVAILABLE_HEADSHOTS = Object.keys(_headshotModules)
  .map(path => path.split('/').pop())
  .sort()

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 15 unique jersey numbers per team — mirrors CampaignManager.generateJerseyNumbers
function generateJerseyNumbers() {
  const numbers = Array.from({ length: 100 }, (_, i) => i)
  shuffleArray(numbers)
  return numbers.slice(0, 15)
}

// Modes — drive both the roster blueprint AND team.aiDirection for the AI
// services. Kept lowercase strings so AI services that compare against
// 'rebuilding', 'contending', etc. need only a small mapping.
const MODE_TO_AI_DIRECTION = {
  contender: 'title_contender',
  average_strong: 'win_now',
  average_weak: 'ascending',
  rebuilder: 'rebuilding',
}

/**
 * Randomly classify each team for THIS campaign. Returns
 * { [abbreviation]: 'contender' | 'average_strong' | 'average_weak' | 'rebuilder' }.
 *
 *  - 4-6 random teams → contender
 *  - 3-4 random teams → rebuilder (different from contenders)
 *  - Remaining teams → split ~50/50 between average_strong / average_weak
 *  - The user's team (if provided) is always 'average_strong' so a new
 *    player isn't surprised by a Day-1 fire sale roster.
 *
 * Re-rolls per campaign so two playthroughs of the same userTeam land
 * different "contender" pools — drives replayability.
 */
function assignCampaignModes(teams, userTeamAbbreviation) {
  const modes = {}
  const numContenders = 4 + Math.floor(Math.random() * 3) // 4-6
  const numRebuilders = 3 + Math.floor(Math.random() * 2) // 3-4

  // Pool of teams eligible for random contender/rebuilder assignment.
  // User team is reserved as average_strong below.
  const pool = teams
    .map(t => t.abbreviation)
    .filter(abbr => abbr !== userTeamAbbreviation)

  shuffleArray(pool)

  for (let i = 0; i < numContenders && i < pool.length; i++) {
    modes[pool[i]] = 'contender'
  }
  for (let i = numContenders; i < numContenders + numRebuilders && i < pool.length; i++) {
    modes[pool[i]] = 'rebuilder'
  }
  for (let i = numContenders + numRebuilders; i < pool.length; i++) {
    // Even split: half average_strong, half average_weak — randomized so
    // there's variety in which "average" teams skew good vs. mediocre
    modes[pool[i]] = Math.random() < 0.5 ? 'average_strong' : 'average_weak'
  }

  if (userTeamAbbreviation) {
    modes[userTeamAbbreviation] = 'average_strong'
  }

  return modes
}

// 15-slot roster positions, mirroring CampaignManager's ROSTER_POSITIONS.
// Imported separately here so this module doesn't need to re-export from
// CampaignManager just for one constant.
const ROSTER_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF', 'SG', 'PF']

/**
 * Per-mode roster blueprints. Each entry is an array of 15 slots in roster
 * order (5 starters first, then 10 bench/rotation) describing the role band
 * and overall range we sample for that slot. The starter slots are sorted so
 * the highest overall lands on PG, but the 15-slot template's first five
 * already correspond to PG/SG/SF/PF/C — so we just assign the strongest band
 * to slot 0 and let the position template fill the rest.
 *
 * Modes:
 *   contender       — Tier 1: 1 superstar + star + 3 starters + 5 rotation + 5 bench
 *   average_strong  — Tier 2: 1 star + 3 starters + 5 rotation + 6 bench
 *   average_weak    — Tier 3: 1 borderline-star + 3 starters + 5 rotation + 6 bench
 *   rebuilder       — Tier 4: 0-1 star + 3 starters + 5 rotation + 6 bench
 */
function getRoleBlueprint(mode) {
  // Translate mode → legacy tier index used by the switch
  const tier = ({
    contender: 1,
    average_strong: 2,
    average_weak: 3,
    rebuilder: 4,
  })[mode] ?? 3

  // Blueprints intentionally bottom-heavy: stars + a small starter cluster at
  // the top, then a meaningful cliff into rotation (mostly 62-72) and a deep
  // bench (mostly 56-66). Real NBA rosters work the same way — most teams
  // have only 5-7 players above 75 OVR and a long tail of replacement-level
  // depth. Without that cliff the procedural league produces too many
  // "decent but unhappy" mid-tier players and the AI trade engine treats
  // every team as a buyer for them.
  switch (tier) {
    case 1:
      return [
        { role: 'superstar', min: 88, max: 94 },
        { role: 'star',      min: 84, max: 88 },
        { role: 'starter',   min: 77, max: 82 },
        { role: 'starter',   min: 77, max: 82 },
        { role: 'starter',   min: 77, max: 82 },
        { role: 'rotation',  min: 69, max: 75 },
        { role: 'rotation',  min: 69, max: 75 },
        { role: 'rotation',  min: 69, max: 75 },
        { role: 'rotation',  min: 69, max: 75 },
        { role: 'rotation',  min: 69, max: 75 },
        { role: 'bench',     min: 60, max: 67 },
        { role: 'bench',     min: 60, max: 67 },
        { role: 'bench',     min: 60, max: 67 },
        { role: 'bench',     min: 60, max: 67 },
        { role: 'bench',     min: 60, max: 67 },
      ]
    case 2:
      return [
        { role: 'star',      min: 82, max: 87 },
        { role: 'starter',   min: 75, max: 81 },
        { role: 'starter',   min: 75, max: 81 },
        { role: 'starter',   min: 75, max: 81 },
        { role: 'starter',   min: 73, max: 79 },
        { role: 'rotation',  min: 66, max: 72 },
        { role: 'rotation',  min: 66, max: 72 },
        { role: 'rotation',  min: 66, max: 72 },
        { role: 'rotation',  min: 66, max: 72 },
        { role: 'rotation',  min: 66, max: 72 },
        { role: 'bench',     min: 58, max: 65 },
        { role: 'bench',     min: 58, max: 65 },
        { role: 'bench',     min: 58, max: 65 },
        { role: 'bench',     min: 58, max: 65 },
        { role: 'bench',     min: 58, max: 65 },
      ]
    case 3:
      return [
        { role: 'star',      min: 78, max: 83 },
        { role: 'starter',   min: 72, max: 78 },
        { role: 'starter',   min: 72, max: 78 },
        { role: 'starter',   min: 72, max: 78 },
        { role: 'starter',   min: 70, max: 76 },
        { role: 'rotation',  min: 63, max: 70 },
        { role: 'rotation',  min: 63, max: 70 },
        { role: 'rotation',  min: 63, max: 70 },
        { role: 'rotation',  min: 63, max: 70 },
        { role: 'rotation',  min: 63, max: 70 },
        { role: 'bench',     min: 56, max: 63 },
        { role: 'bench',     min: 56, max: 63 },
        { role: 'bench',     min: 56, max: 63 },
        { role: 'bench',     min: 56, max: 63 },
        { role: 'bench',     min: 56, max: 63 },
      ]
    case 4:
    default:
      return [
        { role: 'starter',   min: 74, max: 79 },
        { role: 'starter',   min: 68, max: 74 },
        { role: 'starter',   min: 68, max: 74 },
        { role: 'starter',   min: 68, max: 74 },
        { role: 'starter',   min: 66, max: 72 },
        { role: 'rotation',  min: 60, max: 66 },
        { role: 'rotation',  min: 60, max: 66 },
        { role: 'rotation',  min: 60, max: 66 },
        { role: 'rotation',  min: 60, max: 66 },
        { role: 'rotation',  min: 60, max: 66 },
        { role: 'bench',     min: 54, max: 60 },
        { role: 'bench',     min: 54, max: 60 },
        { role: 'bench',     min: 54, max: 60 },
        { role: 'bench',     min: 54, max: 60 },
        { role: 'bench',     min: 54, max: 60 },
      ]
  }
}

/**
 * Generate one team's 15-player roster using the per-campaign mode assignment.
 */
function generateTeamRoster({ campaignId, team, mode, startYear, usedNames }) {
  const blueprint = getRoleBlueprint(mode)
  const jerseyNumbers = generateJerseyNumbers()
  const players = []

  // Randomize which of the 5 starting positions receives each tier slot.
  // Without this, the slot-index-to-position mapping in ROSTER_POSITIONS
  // (PG, SG, SF, PF, C) combined with the blueprint's slot-index-to-role
  // band (superstar, star, starter, starter, starter) meant the star tier
  // ALWAYS landed on PG and the second-best slot ALWAYS landed on SG. Across
  // 30 teams that produced 30 star PGs + 30 star SGs at the top of the
  // league and zero stars at SF/PF/C. Shuffling per team distributes the
  // star tier across all five positions league-wide while keeping every
  // team's starting five at one of each position.
  const starterPositions = shuffleArray(['PG', 'SG', 'SF', 'PF', 'C'])

  for (let posIndex = 0; posIndex < ROSTER_POSITIONS.length; posIndex++) {
    // First 5 slots use the shuffled starter positions; bench/rotation
    // slots keep the existing template so per-position depth stays balanced
    // (the template intentionally over-indexes on wing depth — SG/SF/PF —
    // since real benches do too).
    const position = posIndex < 5 ? starterPositions[posIndex] : ROSTER_POSITIONS[posIndex]
    const { role, min, max } = blueprint[posIndex]
    const overall = randInt(min, max)

    const player = generateVeteran({
      campaignId,
      teamId: team.id,
      teamAbbreviation: team.abbreviation,
      position,
      overall,
      role,
      jerseyNumber: jerseyNumbers[posIndex],
      teamIndex: 0,           // name seed isn't used in vet path (usedNames handles uniqueness)
      posIndex,
      startYear,
      usedNames,
    })

    players.push(player)
  }

  return players
}

/**
 * Post-generation league histogram nudge. Counts overalls across the entire
 * generated league and promotes/demotes a few slots if we're outside the
 * target ranges. Touch is light — at most 2 promotions or demotions league-
 * wide — so the per-team tier structure is preserved.
 */
function validateAndRebalance(players) {
  const count90Plus = players.filter(p => p.overallRating >= 90).length

  // Target 3-6 superstars league-wide. The blueprints intentionally produce
  // a thinner top end (and a bigger 56-69 tail) so we don't aggressively
  // promote players just to hit a quota — promote at most 1 if we're
  // significantly short.
  if (count90Plus < 3) {
    const candidates = players
      .filter(p => p.overallRating >= 85 && p.overallRating < 90)
      .sort((a, b) => b.overallRating - a.overallRating)
    const promotions = Math.min(3 - count90Plus, 1, candidates.length)
    for (let i = 0; i < promotions; i++) {
      const p = candidates[i]
      const bump = randInt(2, 4)
      p.overallRating = Math.min(94, p.overallRating + bump)
      p.overall_rating = p.overallRating
    }
  }

  // If too many 90+ players, demote the lowest of them
  if (count90Plus > 7) {
    const excess = count90Plus - 6
    const candidates = players
      .filter(p => p.overallRating >= 90)
      .sort((a, b) => a.overallRating - b.overallRating)
    for (let i = 0; i < excess && i < candidates.length; i++) {
      const p = candidates[i]
      const drop = randInt(2, 4)
      p.overallRating = Math.max(85, p.overallRating - drop)
      p.overall_rating = p.overallRating
    }
  }
}

/**
 * Assign available custom-headshot PNG files to the highest-OVR players in
 * the league. With N files available and N+M players, the N best players
 * (by overall rating, tiebreak by id for determinism) get the headshots in
 * filename order. Any player not assigned a headshot just renders the
 * default lucide icon. No-op if the headshots folder is empty.
 */
function assignHeadshotsByOverall(players) {
  if (!AVAILABLE_HEADSHOTS.length || !players.length) return
  const sorted = [...players].sort((a, b) => {
    const ratingDelta = (b.overallRating ?? 0) - (a.overallRating ?? 0)
    if (ratingDelta !== 0) return ratingDelta
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
  const limit = Math.min(AVAILABLE_HEADSHOTS.length, sorted.length)
  for (let i = 0; i < limit; i++) {
    sorted[i].headshot = AVAILABLE_HEADSHOTS[i]
  }
}

/**
 * Generate the full league: ~450 players across 30 teams. Each player is a
 * fully-formed IndexedDB-ready record with attributes, badges, contract,
 * motivations, draft history, etc.
 *
 * Side effects: stamps `team.aiDirection` AND `team.campaignMode` on each
 * input team so the AI services can read it directly. Caller is expected
 * to persist the teams to IndexedDB after this returns.
 *
 * @param {string} campaignId
 * @param {Array} teams - The 30 generated teams (must have id + abbreviation)
 * @param {Object} [opts]
 * @param {number} [opts.startYear=2025]
 * @param {string} [opts.userTeamAbbreviation] - User's team is always 'average_strong'
 * @returns {{ players: Array, modes: Object }} Players (15×teams.length) and the mode map
 */
export function generateLeagueRosters(campaignId, teams, opts = {}) {
  const { startYear = 2025, userTeamAbbreviation = null } = opts
  const usedNames = new Set()
  const allPlayers = []

  // Per-campaign mode assignment — different teams are contenders/rebuilders
  // every playthrough so the league doesn't feel scripted.
  const modes = assignCampaignModes(teams, userTeamAbbreviation)

  for (const team of teams) {
    const mode = modes[team.abbreviation] ?? 'average_weak'
    // Stamp the team record so AI + UI can read campaign mode directly
    team.campaignMode = mode
    team.aiDirection = MODE_TO_AI_DIRECTION[mode] ?? 'ascending'

    const roster = generateTeamRoster({ campaignId, team, mode, startYear, usedNames })
    allPlayers.push(...roster)
  }

  validateAndRebalance(allPlayers)
  tagInitialRookies(allPlayers, startYear)
  assignHeadshotsByOverall(allPlayers)

  return { players: allPlayers, modes }
}

/**
 * Post-generation rookie tagging. The initial 450-player league is built
 * entirely with `generateVeteran` calls, so no one ends up with
 * `draftYear === startYear` — which means ROY / All-Rookie awards have no
 * eligible candidates in the first season and the campaign's first
 * postseason ceremony quietly skips them. (Previously deliberate — when
 * the league seeded from real NBA names we didn't want to fake-flag a
 * 26-year-old as a rookie. With pure procedural generation that
 * concern's gone.)
 *
 * Picks up to `target` of the youngest players league-wide (age <=
 * `maxAge`) and stamps them as current-year rookies. Tiebreak by overall
 * descending so the highest-impact young players carry the tag — keeps
 * the ROY race feeling competitive in year 1.
 *
 * Only mutates two fields:
 *  - `draftYear` / `draft_year` → drives AwardService's ROY + All-Rookie
 *    eligibility predicates (filters on `draftYear === currentSeasonYear`).
 *  - `careerSeasons` / `career_seasons` → resets to 0 so age-banded
 *    development helpers (PlayerEvolution / DevelopmentCalculator) treat
 *    them as true year-one players.
 *
 * Attributes, contracts, salaries, and badges are intentionally left
 * untouched — the underlying `generateVeteran` shape for a 19-22yr
 * player already passes for a rookie. A future pass could swap in
 * rookie-scale contracts if that's the next sore spot, but it isn't
 * blocking ROY / All-Rookie surfacing today.
 */
function tagInitialRookies(allPlayers, startYear, { target = 30, maxAge = 22 } = {}) {
  const eligible = allPlayers
    .filter(p => (p?.age ?? 99) <= maxAge)
    .sort((a, b) => {
      const ageDelta = (a.age ?? 99) - (b.age ?? 99)
      if (ageDelta !== 0) return ageDelta
      return (b.overallRating ?? 0) - (a.overallRating ?? 0)
    })
  const toTag = eligible.slice(0, target)
  for (const p of toTag) {
    p.draftYear = startYear
    p.draft_year = startYear
    p.careerSeasons = 0
    p.career_seasons = 0
  }
}

/**
 * Generate a free-agent pool for Fantasy Draft mode. Uses the same role-
 * distribution logic as a full league (so the draft pool has realistic talent
 * spread), but every player has teamId=null, isFreeAgent=1, contractSalary=0,
 * and no contractDetails.
 *
 * @param {string} campaignId
 * @param {Object} [opts]
 * @param {number} [opts.startYear=2025]
 * @param {number} [opts.count=530] - Total pool size (mirrors the legacy master pool)
 * @returns {Array}
 */
export function generateFreeAgentPool(campaignId, { startYear = 2025, count = 530 } = {}) {
  const usedNames = new Set()
  const pool = []

  // First, generate the equivalent of 30 teams' worth of players (450) so the
  // talent histogram matches a real league. Then top up with ~80 bench/min-
  // salary fillers so the pool size matches the legacy master pool size.
  // Mode layout mirrors a typical campaign: ~5 contenders, ~12 average_strong,
  // ~9 average_weak, ~4 rebuilders.
  const modeLayout = [
    ...Array(5).fill('contender'),
    ...Array(12).fill('average_strong'),
    ...Array(9).fill('average_weak'),
    ...Array(4).fill('rebuilder'),
  ]

  for (let i = 0; i < modeLayout.length; i++) {
    const placeholderTeam = { id: null, abbreviation: 'FA' }
    const roster = generateTeamRoster({
      campaignId,
      team: placeholderTeam,
      mode: modeLayout[i],
      startYear,
      usedNames,
    })
    for (const p of roster) {
      // Detach from the placeholder team, but PRESERVE the contract that
      // generateVeteran assigned — those salaries are the player's market
      // value and the fantasy-draft UI displays them on each row. When the
      // user drafts a player in finalizeDraft, the contract follows them
      // onto the new team as their starting deal.
      p.teamId = null
      p.team_id = null
      p.teamAbbreviation = 'FA'
      p.team_abbreviation = 'FA'
      p.isFreeAgent = 1
      p.is_free_agent = 1
    }
    pool.push(...roster)
  }

  validateAndRebalance(pool)

  // Top up to target count with deep-bench fillers
  const fillerNeeded = Math.max(0, count - pool.length)
  for (let i = 0; i < fillerNeeded; i++) {
    const position = pickRandom(['PG', 'SG', 'SF', 'PF', 'C'])
    const overall = randInt(58, 67)
    const player = generateVeteran({
      campaignId,
      teamId: null,
      teamAbbreviation: 'FA',
      position,
      overall,
      role: 'bench',
      jerseyNumber: randInt(0, 99),
      teamIndex: 0,
      posIndex: i,
      startYear,
      usedNames,
    })
    // Deep-bench filler — keeps the generateVeteran-assigned contract intact
    // so the fantasy-draft UI shows a market-value salary for every row. The
    // generator already produces vet-min-ish salaries for OVR 58-67 players.
    player.isFreeAgent = 1
    player.is_free_agent = 1
    player.teamId = null
    player.team_id = null
    player.teamAbbreviation = 'FA'
    player.team_abbreviation = 'FA'
    pool.push(player)
  }

  // Top free agents get the custom headshots too — once they're drafted
  // the headshot follows the player to whatever team takes them.
  assignHeadshotsByOverall(pool)

  return pool
}
