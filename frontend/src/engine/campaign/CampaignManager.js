// =============================================================================
// CampaignManager.js
// =============================================================================
// Campaign lifecycle orchestrator: creation, loading, season transitions.
// Ties together all engine modules (data, repositories, season, lineup, etc.)
// Translated from PHP:
//   - CampaignController.php (store, generateCampaignData)
//   - CampaignSeasonService.php (initializeSeason, generateSchedule)
//   - TeamSeeder.php, CoachSeeder.php, PlayerSeeder.php
// =============================================================================

import { TEAMS, SALARY_CAP, TEAM_TIERS } from '../data/teams'
import { baseSalaryForRating, veteranMinSalary } from '../data/salaryScale'
import { recomputeAllTimeHighs, recomputeHighsLeaders, mergeHighsBoards } from '../stats/careerHighs'
import { PlayerHeadshotRepository } from '../db/PlayerHeadshotRepository'
import {
  COACH_FIRST_NAMES,
  COACH_LAST_NAMES,
  COACH_TIER_RANGES,
  COACHES,
  FREE_AGENT_COACH_TIERS,
  masterCoachTier,
  generateCoachAttributes,
  calculateCoachSalary,
  findCoachForTeam,
  getCoachActionBudget,
  getCoachTrainBudget,
  computeCoachTier,
  getCoachTierKey,
  getCoachResignCost,
} from '../data/coaches'
// Pull scheme maps from the simulator's canonical source. The arrays exported
// from `data/coaches` use STRING values, so `Object.keys(arr)` returns "0",
// "1" etc. — which the simulator doesn't recognise as schemes. The maps below
// are keyed by the actual scheme name (`balanced`, `motion`, `man`, …) so
// `pickRandom(Object.keys(...))` gives a real scheme that the simulator can
// look up.
import { OFFENSIVE_SCHEMES, DEFENSIVE_SCHEMES } from '../simulation/CoachingEngine'
import { selectBestCoachingScheme, isCoachingSchemeValid } from '../coaching/CoachStrategyService'
import {
  ageCoachesAndRetire,
  expectedWinsForDirection,
  derivePlayoffDepth,
  evaluateCoachDecision,
  selectCoachForVacancy,
} from '../coaching/CoachLifecycleService'
import { analyzeTeamDirection, buildContext } from '../ai/AITradeService'
import { BreakingNewsService } from '../season/BreakingNewsService'
import { coachBadges } from '../data/coachBadges'
import { BADGES, BADGES_BY_POSITION } from '../data/badges'
import { BADGE_FITS } from '../data/badgeFits'
import { detectArchetype } from '../data/archetypes'
import {
  HISPANIC_FIRST_NAMES,
  HISPANIC_LAST_NAMES,
  pickNameForCountry,
} from '../data/playerNames'
import { generateLeagueRosters, generateFreeAgentPool, assignCampaignModes } from '../draft/LeagueRosterGenerator'

// Maps the per-campaign campaignMode to a coach tier. Replaces the static
// TEAM_TIERS lookup so a team's coach quality follows whatever role the
// campaign rolled them into instead of being permanently fixed to e.g. GSW/
// BOS/LAL = tier 1. Eliminates the double-stack where a TEAM_TIERS tier-1
// team that also drew `campaignMode: 'contender'` got both an elite roster
// AND an elite coach.
const MODE_TO_COACH_TIER = {
  contender: 1,
  average_strong: 2,
  middle: 2,
  average_weak: 3,
  rebuilder: 4,
}
import { listAvailableHeadshotFilenames } from '@/services/headshotResolver'
import { CampaignRepository } from '../db/CampaignRepository'
import { TeamRepository } from '../db/TeamRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { SeasonRepository } from '../db/SeasonRepository'
import { SeasonManager } from '../season/SeasonManager'
import {
  initializeTeamLineup,
  initializeUserTeamLineup,
} from '../ai/AILineupService'
import { generateAITargetMinutes } from '../simulation/SubstitutionEngine'
import { processSeasonEnd, processRetirements } from '../evolution/PlayerEvolution'
import { runAIRosterManagement, ensureMinimumRosters } from '../ai/AIContractService'
import { generateMotivations, getMarketSize } from '../ai/MotivationService'
import {
  generateAndSaveRookieClass,
  shouldGenerateGenerational,
  US_COLLEGES,
  INTERNATIONAL_ORIGINS,
} from '../draft/RookieGenerationService'
import { AwardService } from '../season/AwardService'
import { AllStarService } from '../season/AllStarService'
import { starPlayerIds, evaluateSubtasks } from '../season/OwnerSubtaskService'
import { combinedSatisfaction, injuryReliefWins, EXTEND_THRESHOLD } from '../season/OwnerService'
import { findOwnerForTeam, EXPECTATION_LABEL } from '../data/owners'
import {
  getEffectiveExpectation,
  effectiveOwner,
  updateOwnerExpectation,
  initOwnerExpectation,
} from '../season/OwnerExpectationService'
import { listCoachHeadshots } from '../../services/headshotPremades'
import {
  SCOUT_TIERS, PHYSICIAN_TIERS, STAFF_TRAINER_TIERS, ANALYST_TIERS,
  PERSONNEL_POOL_COUNTS, PERSONNEL_POOL_KEY,
} from '../data/personnelTiers'

// =============================================================================
// HELPERS
// =============================================================================

// Combined headshot pool (procedural + admin-authored premades). Resolved
// at module init since the underlying globs are eager-evaluated by the
// resolver. generatePlayer / generateVeteran read this directly when
// assigning each player's `headshot` filename — same pool the rookie
// generator uses so premades flow through both campaign init and rookie
// classes.
const HEADSHOT_FILENAMES = listAvailableHeadshotFilenames()

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clampRating(rating) {
  return Math.max(25, Math.min(99, rating))
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randFloat(min, max) {
  return min + Math.random() * (max - min)
}

/**
 * Determine which tier a team abbreviation belongs to.
 * @param {string} abbreviation
 * @returns {number} 1-4
 */
function getTeamTier(abbreviation) {
  for (const [tier, teams] of Object.entries(TEAM_TIERS)) {
    if (teams.includes(abbreviation)) {
      return Number(tier)
    }
  }
  return 3
}

// =============================================================================
// PROCEDURAL NAME GENERATION
// =============================================================================
// The raw arrays below are SEED material for a scrambler that builds a pool of
// thousands of unique made-up names. The scrambler runs once at module load
// time and the exported FIRST_NAMES / LAST_NAMES are the SCRAMBLED outputs —
// every consumer (generatePlayer, generateVeteran, RookieGenerationService)
// reads from those, so no player path ever ships a real-life name.
//
// Why scramble at runtime instead of hand-curating: keeps the seed lists tiny
// + maintainable while still producing 1000s of fictional combinations, and
// makes the IP-safety guarantee mechanical (you can't accidentally leak a real
// name through the system because no consumer touches the seed arrays).

const RAW_FIRST_NAMES = [
  'Marcus', 'Anthony', 'Jaylen', 'Derrick', 'Kyrie', 'James', 'Kevin', 'LeBroom', 'Steffen',
  'Damien', 'Devin', 'Luka', 'Giannis', 'Joel', 'Nikola', 'Jayson', 'Trae', 'Donovan',
  'Zion', 'Ja', 'Tyrese', 'Cade', 'Evan', 'Franz', 'Scottie', 'Paolo', 'Jalen', 'Desmond',
  'Darius', 'Brandon', 'Tyler', 'Cameron', 'Austin', 'Coby', 'Keldon', 'Anfernee', 'Josh',
  'DeAaron', 'Mikal', 'Miles', 'Patrick', 'Immanuel', 'RJ', 'Obi', 'Mitchell', 'Dillon',
  'Jarrett', 'Brook', 'Bobby', 'Khris', 'Jrue', 'Malcolm', 'Buddy', 'Terry', 'Spencer',
  'Russell', 'Draymond', 'Andrew', 'Jonathan', 'Klay', 'Chris', 'Deandre', 'Paul', 'Bradley',
  'Kyle', 'Fred', 'Pascal', 'OG', 'Gary', 'Precious', 'Thad', 'Wendell', 'Ayo',
  'Alex', 'DeMar', 'Zach', 'Lauri', 'Caris', 'Isaac', 'Deni', 'Rui',
  'Daniel', 'Corey', 'Monte', 'Bones', 'Aaron', 'Michael', 'Kentavious', 'Bruce', 'Rudy',
  'John', 'Jordan', 'Malik', 'Kelly', 'Reggie', 'Norman', 'Terance', 'Isaiah', 'Kawhi',
  'Victor', 'CJ', 'Larry', 'Herb', 'Jose', 'Trey', 'Jonas', 'Jaren',
  'Shai', 'Luguentz', 'Aleksej', 'Chet', 'Ousmane',
  'Tre', 'Onyeka', 'Bogdan', 'Clint', 'Jabari', 'AJ', 'Keegan', 'Domantas',
  'Myles', 'Bennedict', 'TJ', 'Chuma',
]

const RAW_LAST_NAMES = [
  'Smart', 'Edwards', 'Brown', 'Rose', 'Irving', 'Harden', 'Durant', 'James', 'Curry',
  'Lillard', 'Booker', 'Doncic', 'Antetokounmpo', 'Embiid', 'Jokic', 'Tatum', 'Young', 'Mitchell',
  'Williamson', 'Morant', 'Haliburton', 'Cunningham', 'Mobley', 'Wagner', 'Barnes', 'Banchero', 'Green', 'Bane',
  'Garland', 'Ingram', 'Herro', 'Johnson', 'Reaves', 'White', 'Porter', 'Simons', 'Hart',
  'Fox', 'Bridges', 'Williams', 'Quickley', 'Barrett', 'Toppin', 'Robinson', 'Brooks',
  'Allen', 'Lopez', 'Portis', 'Middleton', 'Holiday', 'Brogdon', 'Hield', 'Rozier', 'Dinwiddie',
  'Westbrook', 'Wiggins', 'Kuminga', 'Thompson', 'Paul', 'Ayton', 'George', 'Beal',
  'Lowry', 'VanVleet', 'Siakam', 'Anunoby', 'Trent', 'Achiuwa', 'Carter',
  'Caruso', 'DeRozan', 'LaVine', 'Vucevic', 'Markkanen', 'Fournier', 'LeVert', 'Okoro', 'Avdija',
  'Hachimura', 'Gafford', 'Kispert', 'Morris', 'Hyland', 'Gordon', 'Caldwell-Pope',
  'Gobert', 'Collins', 'Poole', 'Beasley', 'Olynyk', 'Jackson', 'Powell', 'Mann', 'Thomas', 'Leonard',
  'Wembanyama', 'McCollum', 'Nance', 'Jones', 'Alvarado', 'Murphy', 'Valanciunas',
  'Gilgeous-Alexander', 'Dort', 'Giddey', 'Bazley', 'Pokusevski', 'Holmgren', 'Joe', 'Dieng',
  'Okongwu', 'Bogdanovic', 'Capela', 'Smith', 'Griffin', 'Suggs', 'Murray', 'Sabonis',
  'Turner', 'Mathurin', 'Nesmith', 'McConnell', 'Nembhard', 'Duarte', 'Okeke', 'Blue'
]

// Split a name into [prefix, suffix] after the FIRST vowel cluster. The cluster
// boundary keeps suffixes pronounceable (consonant-onset) and gives prefixes a
// natural consonant-vowel-(consonant) shape. Falls back to a midpoint split if
// no vowel cluster boundary is found.
function _splitName(name) {
  if (!name || name.length < 3) return null
  const vowels = 'aeiouyAEIOUY'
  let inVowel = false
  for (let i = 1; i < name.length - 1; i++) {
    const isV = vowels.includes(name[i])
    if (isV) {
      inVowel = true
    } else if (inVowel) {
      return [name.slice(0, i), name.slice(i)]
    }
  }
  const mid = Math.max(2, Math.floor(name.length / 2))
  return [name.slice(0, mid), name.slice(mid)]
}

// Reject candidates that look unnatural. Tightened to cut the occasional
// awkward scrambler output: stricter length, must contain a vowel, no long
// consonant/vowel runs, no triple-repeated letter, no awkward final letter.
function _isPlausibleName(name) {
  if (name.length < 5 || name.length > 12) return false
  // Must contain at least one vowel
  if (!/[aeiouy]/i.test(name)) return false
  // No four consonants in a row
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(name)) return false
  // No three vowels in a row (reads as a typo)
  if (/[aeiou]{3,}/i.test(name)) return false
  // No same letter three times in a row
  if (/(.)\1\1/i.test(name)) return false
  // No starting with apostrophe/hyphen
  if (/^[-']/.test(name)) return false
  // Awkward final letters for an English-ish name
  if (/[jqvwxz]$/i.test(name)) return false
  return true
}

function _scrambleNamePool(rawNames) {
  const realLower = new Set(rawNames.map(n => n.toLowerCase()))
  const prefixes = new Set()
  const suffixes = new Set()
  for (const n of rawNames) {
    const parts = _splitName(n)
    if (!parts) continue
    const [pre, suf] = parts
    if (pre) prefixes.add(pre)
    if (suf) suffixes.add(suf.toLowerCase())
  }

  const pool = new Set()
  for (const pre of prefixes) {
    for (const suf of suffixes) {
      const candidate = pre + suf
      const formatted = candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase()
      if (!_isPlausibleName(formatted)) continue
      if (realLower.has(formatted.toLowerCase())) continue
      pool.add(formatted)
    }
  }
  // Shuffle the pool — the `for (pre) for (suf)` loop above plus Set
  // insertion-order iteration produces tight prefix clusters at the front
  // of the array (the first ~20 entries are all M-prefix names, then C-,
  // then B-, etc.). Without shuffling, any deterministic seed that walks
  // the front of the pool (e.g. generatePlayer's nameIdx) produces rosters
  // where every player's first name starts with the same letter.
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Real-feeling first / last names mixed into the exported pool below. Pure
// scrambler output reads as a 100% fictional league — atmospheric, but the
// names all sound unusual together. Salting in real-name buckets makes the
// league feel more grounded without re-introducing real NBA-player names.
//
// Two buckets so the proportion of each can be tuned independently:
//   NORMAL_*  — broadly common American/Anglo names
//   BLACK_*   — names commonly used in Black American communities (curated
//               to avoid direct overlap with current/recent NBA players)
const NORMAL_FIRST_NAMES = [
  'John', 'Michael', 'David', 'Robert', 'William', 'Richard', 'Thomas', 'Charles',
  'Christopher', 'Daniel', 'Matthew', 'Mark', 'Steven', 'Andrew', 'Joshua', 'Ryan',
  'Brian', 'Edward', 'Ronald', 'Timothy', 'Jeffrey', 'Jacob', 'Nicholas', 'Eric',
  'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Benjamin', 'Samuel', 'Gregory',
  'Frank', 'Raymond', 'Jack', 'Dennis', 'Tyler', 'Henry', 'Sean', 'Adam',
  'Nathan', 'Zachary', 'Walter', 'Peter', 'Harold', 'Carl', 'Arthur', 'Roger',
  'Joe', 'Dylan', 'Lucas', 'Owen', 'Caleb', 'Connor', 'Wyatt', 'Hunter',
  'Mason', 'Logan', 'Ethan', 'Noah', 'Liam', 'Ian', 'Eli', 'Brett',
  'Cole', 'Sean', 'Travis', 'Shane', 'Hayden', 'Holden', 'Levi', 'Pierce',
  'Wesley', 'Reid', 'Ross', 'Spencer', 'Garrett', 'Vincent', 'Theo', 'Max', 'Harrison',
  'AJ', 'PJ', 'CJ', 'DJ', 'Billy'
]

const NORMAL_LAST_NAMES = [
  'Smith', 'Johnson', 'Davis', 'Miller', 'Wilson', 'Anderson', 'Taylor', 'Moore',
  'Martin', 'Lee', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Nelson', 'Adams', 'Mitchell', 'Roberts',
  'Phillips', 'Evans', 'Turner', 'Parker', 'Collins', 'Stewart', 'Morris', 'Murphy',
  'Cook', 'Rogers', 'Reed', 'Bailey', 'Bell', 'Cooper', 'Howard', 'Ward',
  'Cox', 'Brooks', 'Gray', 'Watson', 'Price', 'Bennett', 'Wood', 'Barnes',
  'Ross', 'Henderson', 'Coleman', 'Jenkins', 'Perry', 'Powell', 'Long', 'Patterson',
  'Hughes', 'Foster', 'Sanders', 'Russell', 'Bryant', 'Murray', 'Webb', 'Snyder',
  'Hayes', 'Crawford', 'Knight', 'Lambert', 'Pierce', 'Burns', 'Stevens', 'Marshall',
  'Reynolds', 'Owens', 'Mason', 'Tucker', 'Hunter', 'Holland', 'Lawrence', 'Carter',
  'Connelly', 'Henderson', 'Griffin', 'Stills', 'Maroney', 'Trevey', 'Brent', 'Bendt',
  'Conner', 'Jerigan', 'Phillipson', 'Danielson', 'Daniels', 'Bongo'
]

// First names commonly used in Black American communities. Some overlap with
// the general American pool (Curtis, Andre, Marcus) because those names cross
// cultural lines, but the bucket leans toward names that lend the league a
// more representative feel. Filtered to avoid names of current / recent NBA
// stars that would create identifiability concerns.
const BLACK_FIRST_NAMES = [
  'Jamal', 'Tyrone', 'Darnell', 'DeAndre', 'Maurice', 'Reggie', 'Cedric',
  'Bryson', 'Otis', 'Curtis', 'Bernard', 'Dexter', 'Roscoe', 'Reginald',
  'Quincy', 'Damon', 'Lamar', 'Cornelius', 'Demetrius', 'Donte', 'Antoine',
  'Antwan', 'Tariq', 'Tavon', 'Terrence', 'Tyree', 'Tyrell', 'Vernon',
  'Wendell', 'Willie', 'Andre', 'Earl', 'Stanley', 'Melvin', 'Ervin',
  'Rashad', 'Marquis', 'Jermaine', 'Jamar', 'Jamir', 'Malachi', 'Malik',
  'Kareem', 'Khalil', 'Omar', 'Sterling', 'Trevon', 'Tre', 'Jaylin',
  'Marcellus', 'DeShawn', 'DeMarco', 'DeVonte', 'Jaheim', 'Keyshawn',
  'Rashawn', 'Tobias', 'Solomon', 'Terrell', 'Booker', 'Calvin', 'Gerald',
  'Leon', 'Lonnie', 'Rufus', 'Cyrus', 'Marquise', 'Demarius', 'Tyrese',
  'Jaxson', 'Trayvon', 'Devontae', 'Jamel', 'Cleophus', 'Jerome', 'Jerian',
  'Jaleel', 'JaMarcus', 'DeMarcus', 'Booby', 'Saddiq', 'Tre'
]

// Last names common across Black American communities. Many of these are
// shared with the general American pool culturally — included here as a
// second-bucket weight nudge rather than a strict ethnic divide.
const BLACK_LAST_NAMES = [
  'Washington', 'Jefferson', 'Jackson', 'Jackson Jr.', 'Booker', 'Mosley', 'Cummings',
  'Pinkston', 'Frazier', 'Gaines', 'Witherspoon', 'Lassiter', 'Pittman',
  'McNair', 'Boyd', 'Boykin', 'Carver', 'Christian', 'Cleveland', 'Coles',
  'Crockett', 'Duke', 'Fletcher', 'Floyd', 'Freeman', 'Gantt', 'Garner',
  'Givens', 'Grant', 'Greene', 'Hampton', 'Hardy', 'Harmon', 'Harvey',
  'Heath', 'Holmes', 'Jeffries', 'Jordan', 'Keys', 'Langston', 'Lawson',
  'Lemon', 'Mack', 'Madison', 'Massey', 'McCray', 'McKinney', 'McNeil',
  'Norris', 'Pace', 'Page', 'Paige', 'Pope', 'Prentice', 'Pryor',
  'Reese', 'Riggs', 'Roach', 'Rollins', 'Saunders', 'Shaw', 'Stafford',
  'Steele', 'Stokes', 'Sutton', 'Tate', 'Thurmond', 'Vance', 'Vaughn',
  'Waters', 'Wells', 'Whitaker', 'Wilkins', 'Woodson', 'Drummond', 'Cousins',
  'Orion', 'Essex', 'Bitamin', 'Betts', 'Baloney', 'Djboute', 'Djiat', 'Prince',
  'Strawberry', 'Bey', 'Delk', 'Henry Jr.', 'Django', 'KaBongo'
]

// Each real-name bucket is repeated N times when concatenating with the
// scrambled pool so it lands at roughly its target share of total picks.
// Tweaking the weight up/down is the per-bucket knob — independent of the
// scrambled pool's natural size (~3,400 entries).
//
// Tuning history:
//   14 → ~60% scrambled (too made-up-name soup)
//   30 → ~42% scrambled (better but still too noisy)
//   80 → ~22% scrambled (current — rosters read mostly grounded with
//                        scrambler adding occasional unusual surnames
//                        for variety)
const NORMAL_NAME_WEIGHT = 80
const BLACK_NAME_WEIGHT = 80
// Hispanic/Latino bucket (defined in ../data/playerNames). Weighted alongside
// the other two real-name buckets so domestic rosters reflect that demographic.
// A third real bucket also dilutes the scrambled share (~22% -> ~16%), which
// further reduces the occasional awkward fictional name.
const HISPANIC_NAME_WEIGHT = 55

function _mixRealNames(scrambled, buckets) {
  const pool = [...scrambled]
  for (const { names, weight } of buckets) {
    for (let i = 0; i < weight; i++) pool.push(...names)
  }
  return pool
}

// Build the scrambled pools once at module load. Both raw seed lists are
// combined with the coach-name pools so the scrambler has maximum variety.
// The exported arrays mix in real-name buckets at tunable rates so the
// league reads less uniformly fictional.
export const FIRST_NAMES = _mixRealNames(
  _scrambleNamePool([...RAW_FIRST_NAMES, ...COACH_FIRST_NAMES]),
  [
    { names: NORMAL_FIRST_NAMES,   weight: NORMAL_NAME_WEIGHT },
    { names: BLACK_FIRST_NAMES,    weight: BLACK_NAME_WEIGHT },
    { names: HISPANIC_FIRST_NAMES, weight: HISPANIC_NAME_WEIGHT },
  ],
)
export const LAST_NAMES = _mixRealNames(
  _scrambleNamePool([...RAW_LAST_NAMES, ...COACH_LAST_NAMES]),
  [
    { names: NORMAL_LAST_NAMES,   weight: NORMAL_NAME_WEIGHT },
    { names: BLACK_LAST_NAMES,    weight: BLACK_NAME_WEIGHT },
    { names: HISPANIC_LAST_NAMES, weight: HISPANIC_NAME_WEIGHT },
  ],
)

const PERSONALITY_TRAITS = ['team_player', 'ball_hog', 'mentor', 'hot_head', 'media_darling', 'quiet', 'leader', 'joker', 'competitor']
const MEDIA_PROFILES = ['low_key', 'normal', 'high_profile']

// 15-man roster position template: starters first (1 per position), then bench depth
// First 5 get starter-quality ratings; rest get bench-quality ratings
const ROSTER_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF', 'SG', 'PF']

// =============================================================================
// PLAYER GENERATION HELPERS
// =============================================================================

function getOverallRange(tier, isStarter, posIndex) {
  if (isStarter) {
    switch (tier) {
      case 1: return posIndex === 0 ? [85, 95] : [78, 88]
      case 2: return posIndex === 0 ? [80, 88] : [75, 84]
      case 3: return posIndex === 0 ? [76, 84] : [72, 80]
      case 4: return posIndex === 0 ? [72, 80] : [68, 76]
      default: return [70, 80]
    }
  }
  switch (tier) {
    case 1: return [72, 80]
    case 2: return [68, 77]
    case 3: return [65, 74]
    case 4: return [62, 72]
    default: return [65, 75]
  }
}

function generateAge(overall) {
  if (overall >= 85) return randInt(25, 32)
  if (overall >= 78) return randInt(23, 30)
  if (overall >= 72) return randInt(21, 28)
  return randInt(19, 26)
}

function getHeight(position) {
  switch (position) {
    case 'PG': return randInt(72, 76)   // 6'0" - 6'4"
    case 'SG': return randInt(74, 78)   // 6'2" - 6'6"
    case 'SF': return randInt(77, 81)   // 6'5" - 6'9"
    case 'PF': return randInt(79, 83)   // 6'7" - 6'11"
    case 'C':  return randInt(82, 88)   // 6'10" - 7'4"
    default:   return randInt(76, 80)
  }
}

function getWeight(position) {
  switch (position) {
    case 'PG': return randInt(175, 200)
    case 'SG': return randInt(185, 215)
    case 'SF': return randInt(210, 235)
    case 'PF': return randInt(225, 250)
    case 'C':  return randInt(240, 280)
    default:   return randInt(200, 230)
  }
}

function getSecondaryPosition(position) {
  const options = {
    PG: ['SG', null],
    SG: ['PG', 'SF', null],
    SF: ['SG', 'PF', null],
    PF: ['SF', 'C', null],
    C:  ['PF', null],
  }
  return pickRandom(options[position] ?? [null])
}

function generateJerseyNumbers() {
  const numbers = Array.from({ length: 100 }, (_, i) => i)
  shuffleArray(numbers)
  return numbers.slice(0, 15)
}

// =============================================================================
// ATTRIBUTE GENERATION (mirrors PlayerSeeder)
// =============================================================================

const OFFENSE_MODS = {
  PG: { threePoint: 5, midRange: 5, postScoring: -20, layup: 3, dunk: -5, ballHandling: 10, passing: 10, speedWithBall: 8 },
  SG: { threePoint: 8, midRange: 8, postScoring: -15, layup: 5, dunk: 0, ballHandling: 5, passing: 3, speedWithBall: 5 },
  SF: { threePoint: 3, midRange: 5, postScoring: -5, layup: 5, dunk: 3, ballHandling: 0, passing: 0, speedWithBall: 0 },
  PF: { threePoint: -5, midRange: 0, postScoring: 8, layup: 5, dunk: 8, ballHandling: -10, passing: -5, speedWithBall: -8 },
  C:  { threePoint: -15, midRange: -10, postScoring: 12, layup: 8, dunk: 10, ballHandling: -15, passing: -8, speedWithBall: -12 },
}

const DEFENSE_MODS = {
  PG: { perimeterD: 5, interiorD: -15, steal: 8, block: -20, defensiveIQ: 5 },
  SG: { perimeterD: 5, interiorD: -10, steal: 5, block: -15, defensiveIQ: 3 },
  SF: { perimeterD: 3, interiorD: 0, steal: 3, block: 0, defensiveIQ: 3 },
  PF: { perimeterD: -5, interiorD: 8, steal: -3, block: 8, defensiveIQ: 3 },
  C:  { perimeterD: -12, interiorD: 12, steal: -8, block: 15, defensiveIQ: 5 },
}

const PHYSICAL_MODS = {
  PG: { speed: 10, acceleration: 10, strength: -15, vertical: 0, stamina: 5 },
  SG: { speed: 8, acceleration: 8, strength: -8, vertical: 3, stamina: 3 },
  SF: { speed: 3, acceleration: 3, strength: 0, vertical: 3, stamina: 0 },
  PF: { speed: -5, acceleration: -5, strength: 8, vertical: 5, stamina: 0 },
  C:  { speed: -12, acceleration: -12, strength: 15, vertical: -3, stamina: -3 },
}

// Position bias for the additional canonical fields. Bigs have more interior
// scoring / rebounding; perimeter players have more handles / passing / steals.
const POST_MODS = {
  PG: -20, SG: -15, SF: -5, PF: 8, C: 12,
}
const REBOUND_MODS = {
  PG: -18, SG: -13, SF: -3, PF: 8, C: 14,
}
const STANDING_DUNK_MODS = {
  PG: -15, SG: -8, SF: 0, PF: 8, C: 12,
}
const DRIVING_DUNK_MODS = {
  PG: -8, SG: 3, SF: 5, PF: 5, C: 0,
}

// All four generate*Attributes functions emit ONLY canonical keys (defined in
// engine/data/attributeSchema.js). Legacy short-form keys (`dunk`, `passing`,
// `perimeterD`, `defensiveIQ`, `consistency`) are intentionally absent so
// generated players match the canonical shape used by master veterans —
// otherwise the scouting UI shows '?' for legacy duplicates that scout reveal
// never touches.
function generateOffenseAttributes(position, base, variance) {
  const mods = OFFENSE_MODS[position] ?? OFFENSE_MODS.SF
  const post = POST_MODS[position] ?? 0
  const stand = STANDING_DUNK_MODS[position] ?? 0
  const drive = DRIVING_DUNK_MODS[position] ?? 0
  const v = (m = 0) => clampRating(base + m + randInt(-variance, variance))
  return {
    closeShot:            v(mods.layup),
    midRange:             v(mods.midRange),
    threePoint:           v(mods.threePoint),
    freeThrow:            v(0),
    shotIQ:               v(0),
    offensiveConsistency: v(0),
    layup:                v(mods.layup),
    standingDunk:         v(stand),
    drivingDunk:          v(drive),
    postHook:             v(post),
    postFade:             v(post),
    postControl:          v(post),
    drawFoul:             v(0),
    hands:                v(0),
    ballHandling:         v(mods.ballHandling),
    speedWithBall:        v(mods.speedWithBall),
    passAccuracy:         v(mods.passing),
    passVision:           v(mods.passing),
    passIQ:               v(mods.passing),
  }
}

function generateDefenseAttributes(position, base, variance) {
  const mods = DEFENSE_MODS[position] ?? DEFENSE_MODS.SF
  const orb = (REBOUND_MODS[position] ?? 0) - 4 // ORebs slightly rarer than DRebs
  const drb = REBOUND_MODS[position] ?? 0
  const v = (m = 0) => clampRating(base + m + randInt(-variance, variance))
  return {
    interiorDefense:      v(mods.interiorD),
    perimeterDefense:     v(mods.perimeterD),
    steal:                v(mods.steal),
    block:                v(mods.block),
    offensiveRebound:     v(orb),
    defensiveRebound:     v(drb),
    helpDefenseIQ:        v(mods.defensiveIQ),
    passPerception:       v(0),
    defensiveConsistency: v(0),
  }
}

function generatePhysicalAttributes(position, base, variance) {
  const mods = PHYSICAL_MODS[position] ?? PHYSICAL_MODS.SF
  const v = (m = 0) => clampRating(base + m + randInt(-variance, variance))
  return {
    speed:        v(mods.speed),
    acceleration: v(mods.acceleration),
    strength:     v(mods.strength),
    vertical:     v(mods.vertical),
    stamina:      v(mods.stamina),
    hustle:       v(0),
    durability:   v(0),
  }
}

function generateMentalAttributes(base, variance) {
  const v = (m = 0) => clampRating(base + m + randInt(-variance, variance))
  return {
    basketballIQ: v(0),
    clutch:       v(0),
    workEthic:    clampRating(randInt(60, 95)),
    coachability: v(0),
    intangibles:  v(0),
  }
}

function generateAttributes(position, overall) {
  const variance = 12
  return {
    offense:  generateOffenseAttributes(position, overall, variance),
    defense:  generateDefenseAttributes(position, overall, variance),
    physical: generatePhysicalAttributes(position, overall, variance),
    mental:   generateMentalAttributes(overall, variance),
  }
}

// =============================================================================
// TENDENCIES, BADGES, PERSONALITY, CONTRACT
// =============================================================================

const POSITION_TENDENCIES = {
  PG: { threePoint: 0.35, midRange: 0.25, paint: 0.40 },
  SG: { threePoint: 0.45, midRange: 0.25, paint: 0.30 },
  SF: { threePoint: 0.35, midRange: 0.30, paint: 0.35 },
  PF: { threePoint: 0.25, midRange: 0.25, paint: 0.50 },
  C:  { threePoint: 0.10, midRange: 0.20, paint: 0.70 },
}

function generateTendencies(position) {
  const base = POSITION_TENDENCIES[position] ?? POSITION_TENDENCIES.SF
  return {
    shotSelection: {
      threePoint: Math.max(0.05, Math.min(0.60, base.threePoint + randInt(-10, 10) / 100)),
      midRange:   Math.max(0.10, Math.min(0.45, base.midRange   + randInt(-10, 10) / 100)),
      paint:      Math.max(0.20, Math.min(0.80, base.paint      + randInt(-10, 10) / 100)),
    },
    defensiveAggression: randInt(40, 90) / 100,
    passingWillingness: randInt(30, 80) / 100,
    helpDefenseFrequency: randInt(40, 80) / 100,
  }
}

function getBadgeLevel(overall) {
  const roll = randInt(1, 100)
  if (overall >= 90) {
    if (roll <= 20) return 'hof'
    if (roll <= 50) return 'gold'
    if (roll <= 80) return 'silver'
    return 'bronze'
  }
  if (overall >= 82) {
    if (roll <= 10) return 'hof'
    if (roll <= 35) return 'gold'
    if (roll <= 70) return 'silver'
    return 'bronze'
  }
  if (overall >= 75) {
    if (roll <= 5) return 'gold'
    if (roll <= 40) return 'silver'
    return 'bronze'
  }
  if (roll <= 20) return 'silver'
  return 'bronze'
}

// =============================================================================
// Attribute-driven badge assignment (replaces the old position-pool approach)
// =============================================================================
// Old generateBadges read only position + OVR. It pulled from a fixed
// 10-badge position pool, so every SG in the league sampled from the same
// list and synergies between teammates were nearly inevitable.
//
// pickBadgesByFit replaces that with a per-badge "fit recipe" (declared on
// each badge in engine/data/badges.js). Each badge scores against the
// player's attributes, vitals, position, and detected archetype. Badges
// with hard prereqs (e.g., Rim Protector needs `block >= 65`) can't fire
// when the player misses them; everything else is a soft weighted sample.
//
// Result: a 6'2" PG with low block/vertical can't get Rim Protector, while
// a 6'9" PF with elite passIQ + passVision can pick up Floor General even
// though it wasn't in the PF "pool" before. Cross-position outliers (point
// forwards, stretch fives, slashing wings) now look like themselves.
//
// Tuning knobs (set conservatively for first ship; revisit after telemetry):
const BADGE_FIT_BASELINE = 5            // tiny constant added to every badge's
                                        // raw score so neutrals can still fire
const BADGE_FIT_SAMPLE_EXP = 2          // weight exponent on the sampler; >1
                                        // leans picks toward top-fit but keeps
                                        // variety (Infinity → strict top-N)
const ARCHETYPE_BONUS_MULT = 1.3        // score multiplier for badges tagged
                                        // with the player's detected archetype

/** Safe-read a dotted "category.attr" path off `player.attributes`. */
function _readAttrPath(player, path) {
  const [category, key] = String(path).split('.')
  const v = player?.attributes?.[category]?.[key]
  return Number.isFinite(v) ? v : 0
}

/** Returns true iff every prereq in the list is satisfied by the player. */
function _meetsPrereqs(player, prereqs) {
  if (!Array.isArray(prereqs) || prereqs.length === 0) return true
  for (const req of prereqs) {
    // Prereqs can target attributes (`offense.threePoint`) or vitals
    // (`heightInches` / `weightLbs`). Inferred by the absence of a dot.
    const isVital = !String(req.key).includes('.')
    const value = isVital
      ? (player?.[req.key] ?? player?.[req.key === 'heightInches' ? 'height_inches' : 'weight_lbs'] ?? 0)
      : _readAttrPath(player, req.key)
    if (req.min != null && value < req.min) return false
    if (req.max != null && value > req.max) return false
  }
  return true
}

/** Vital contribution to a badge's fit score. Same shape as attribute
 *  weights but with explicit `min`/`max` thresholds. Above `min` (or below
 *  `max`) the per-unit weight is applied. */
function _vitalScore(player, key, rule) {
  const value = player?.[key] ?? player?.[key === 'heightInches' ? 'height_inches' : 'weight_lbs'] ?? 0
  if (rule?.min != null && value >= rule.min) return (value - rule.min) * (rule.weight ?? 0)
  if (rule?.max != null && value <= rule.max) return (rule.max - value) * (rule.weight ?? 0)
  return 0
}

/** Weighted sample without replacement. `scored` is `[{ id, score }, ...]`
 *  pre-filtered to score > 0. Returns up to `n` ids. Uses score^k as the
 *  draw weight so higher k => more deterministic picks. */
function _sampleNoReplace(scored, n, k = 2) {
  const pool = scored.map(s => ({ id: s.id, w: Math.pow(s.score, k) }))
  const picked = []
  while (pool.length > 0 && picked.length < n) {
    const total = pool.reduce((sum, p) => sum + p.w, 0)
    if (total <= 0) break
    let r = Math.random() * total
    let chosenIdx = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w
      if (r <= 0) { chosenIdx = i; break }
    }
    picked.push(pool[chosenIdx].id)
    pool.splice(chosenIdx, 1)
  }
  return picked
}

/** Badge count band keyed off OVR. Same buckets the legacy generateBadges
 *  used, with the user-requested adjustment of `0–4` for sub-70 OVR. */
function _badgeCountForOvr(overall) {
  if (overall >= 90) return randInt(8, 12)
  if (overall >= 85) return randInt(6, 10)
  if (overall >= 80) return randInt(5, 8)
  if (overall >= 75) return randInt(4, 7)
  if (overall >= 70) return randInt(3, 5)
  return randInt(0, 4)
}

/** Veteran count band — base + seasons-bonus, matching legacy
 *  generateVeteranBadges. Sub-70 OVR floor is 0 here too. */
function _veteranBadgeCountForOvr(overall, careerSeasons) {
  let baseCount, bonusCap
  if (overall >= 90)      { baseCount = randInt(7, 11); bonusCap = 5 }
  else if (overall >= 85) { baseCount = randInt(5, 8);  bonusCap = 4 }
  else if (overall >= 80) { baseCount = randInt(3, 6);  bonusCap = 3 }
  else if (overall >= 75) { baseCount = randInt(2, 4);  bonusCap = 2 }
  else if (overall >= 70) { baseCount = randInt(1, 3);  bonusCap = 2 }
  else                    { baseCount = randInt(0, 2);  bonusCap = 1 }
  const seasonBonus = Math.max(0, Math.min(bonusCap, Math.floor((careerSeasons ?? 0) / 2)))
  return baseCount + seasonBonus
}

/**
 * Attribute-driven badge picker. Returns `[{ id, level }, ...]`. Falls back
 * to the legacy position-pool shuffle when a player has no canonical
 * attributes (legacy/test data); production callers always pass a fully
 * normalized player so this fallback rarely fires.
 *
 * @param {object} player - Player object with `attributes`, `position`,
 *                          `overallRating`, `heightInches`, `weightLbs`.
 * @param {object} opts - { count, tier, archetype? }
 *   count   — how many badges to pick (already OVR-derived by caller)
 *   tier    — single tier applied to all picks (legacy convention)
 *   archetype — optional `{ id, name }` from detectArchetype; bumps tagged
 *               badges by ARCHETYPE_BONUS_MULT.
 */
function pickBadgesByFit(player, { count, tier, archetype = null }) {
  if (!Number.isFinite(count) || count <= 0) return []

  // Soft fallback for malformed players (no attributes yet).
  if (!player?.attributes || typeof player.attributes !== 'object') {
    const pool = BADGES_BY_POSITION[player?.position] ?? BADGES_BY_POSITION.SF
    return shuffleArray([...pool]).slice(0, count).map(id => ({ id, level: tier }))
  }

  const scored = []
  const archetypeName = archetype?.name ?? null
  for (const badge of BADGES) {
    const fit = BADGE_FITS[badge.id]
    if (!fit) continue   // badges without a fit recipe are skipped
    if (!_meetsPrereqs(player, fit.prereqs)) continue

    let s = BADGE_FIT_BASELINE
    for (const [path, weight] of Object.entries(fit.weights ?? {})) {
      const v = _readAttrPath(player, path)
      // Only above-baseline (>50) attributes pull score up — keeps the
      // sampler from being dominated by "nobody is bad enough at this".
      if (v > 50) s += (v - 50) * weight
    }
    for (const [key, rule] of Object.entries(fit.vitals ?? {})) {
      s += _vitalScore(player, key, rule)
    }
    const posMult = fit.positionMult?.[player.position] ?? 1.0
    s *= posMult
    if (archetypeName && Array.isArray(fit.archetypeTags) && fit.archetypeTags.includes(archetypeName)) {
      s *= ARCHETYPE_BONUS_MULT
    }
    if (s > 0) scored.push({ id: badge.id, score: s })
  }

  if (scored.length === 0) return []
  const ids = _sampleNoReplace(scored, count, BADGE_FIT_SAMPLE_EXP)
  return ids.map(id => ({ id, level: tier }))
}

function generateBadges(position, overall) {
  const availableBadges = BADGES_BY_POSITION[position] ?? BADGES_BY_POSITION.SF
  let numBadges
  if (overall >= 90) numBadges = randInt(8, 12)
  else if (overall >= 85) numBadges = randInt(6, 10)
  else if (overall >= 80) numBadges = randInt(5, 8)
  else if (overall >= 75) numBadges = randInt(4, 7)
  else if (overall >= 70) numBadges = randInt(3, 5)
  else numBadges = randInt(0, 4)   // <70 OVR now starts at 0 — deepest bench
                                   // players can have zero badges.

  const shuffled = shuffleArray([...availableBadges])
  const selected = shuffled.slice(0, Math.min(numBadges, shuffled.length))

  return selected.map(id => ({
    id,
    level: getBadgeLevel(overall),
  }))
}

function generatePersonality() {
  const numTraits = randInt(1, 3)
  const shuffled = shuffleArray([...PERSONALITY_TRAITS])
  const traits = shuffled.slice(0, numTraits)

  return {
    traits,
    morale: randInt(70, 95),
    chemistry: randInt(65, 90),
    mediaProfile: pickRandom(MEDIA_PROFILES),
  }
}

function calculateSalary(overall, age) {
  // Derives from the single rating→salary curve in data/salaryScale.js (real
  // 2025-26 scale) so generated/aging rosters share the SAME economy as free
  // agency, re-signs, and trade valuation. A small ±12% spread keeps contracts
  // from looking machine-stamped; age factors and a vet-min floor mirror the
  // valuation layer.
  let baseSalary = baseSalaryForRating(overall)
  baseSalary *= randInt(88, 112) / 100 // ±12% contract-to-contract variance

  // Age adjustment — young stars sign cheaper extensions; aging vets give
  // a modest discount but still command real money.
  if (age >= 33) baseSalary *= 0.90
  else if (age <= 23) baseSalary *= 0.78

  baseSalary = Math.max(veteranMinSalary({ careerSeasons: Math.max(0, age - 19) }), baseSalary)
  return Math.round(baseSalary / 10000) * 10000
}

function generateContract(overall, age) {
  const yearsRemaining = randInt(1, 4)
  const salary = calculateSalary(overall, age)

  const salaries = []
  for (let i = 0; i < yearsRemaining; i++) {
    salaries.push(Math.round(salary * (1 + 0.05 * i) / 10000) * 10000)
  }

  return {
    years: yearsRemaining,
    salary,
    details: {
      totalYears: yearsRemaining + randInt(0, 2),
      salaries,
      options: randInt(0, 1) ? { [`year${yearsRemaining + 1}`]: randInt(0, 1) ? 'player' : 'team' } : {},
      noTradeClause: overall >= 88 && !!randInt(0, 1),
      signedYear: 2025 - randInt(0, 3),
    },
  }
}

// =============================================================================
// AGE/EXPERIENCE-BASED HELPERS (shared across player-generation paths)
// =============================================================================

/**
 * Derive a realistic potential rating from overall and age. Younger players
 * have more headroom; veterans cap at or just below their current overall.
 * Extracted from prepareMasterPlayer so generateVeteran can reuse identical
 * logic to keep PlayerEvolution behavior consistent across the procedural
 * pipeline.
 */
function computePotentialFromAge(overall, age) {
  let floor, ceiling
  if (age <= 23) {
    floor = Math.round(overall * 1.05)
    ceiling = Math.round(overall * 1.20)
  } else if (age <= 26) {
    floor = Math.round(overall * 1.03)
    ceiling = Math.round(overall * 1.12)
  } else if (age <= 31) {
    floor = overall
    ceiling = Math.round(overall * 1.05)
  } else {
    floor = Math.max(25, overall - 3)
    ceiling = overall
  }
  return Math.min(99, randInt(floor, ceiling))
}

/**
 * Derive trade value from overall + age. Extracted from prepareMasterPlayer.
 * Returns { tradeValue, tradeValueTotal } — same tiered formula previously
 * applied to master players.
 */
function computeTradeValue(overall, age) {
  let tv
  if (overall >= 92)      tv = randFloat(25, 40)
  else if (overall >= 88) tv = randFloat(18, 28)
  else if (overall >= 84) tv = randFloat(12, 20)
  else if (overall >= 80) tv = randFloat(8, 14)
  else if (overall >= 76) tv = randFloat(5, 10)
  else if (overall >= 72) tv = randFloat(3, 7)
  else if (overall >= 68) tv = randFloat(1.5, 4)
  else                    tv = randFloat(0.5, 2)
  if (age <= 24) tv *= 1.15
  else if (age >= 32) tv *= 0.80
  return {
    tradeValue: Math.round(tv * 100) / 100,
    tradeValueTotal: Math.round(tv * randFloat(0.6, 0.9) * 100) / 100,
  }
}

/**
 * Badge count and tier mix for a veteran. Tightened distribution: superstars
 * stay loaded with badges (clearly differentiated), the middle tier is sparse
 * (so role players don't trigger constant synergies with everyone they share
 * the floor with), and bench guys are mostly bare. Each OVR band also caps
 * the careerSeasons bonus tighter than before so a 12-year vet bench player
 * doesn't pile up gold-tier badges from longevity alone.
 */
function generateVeteranBadges(position, overall, careerSeasons) {
  const availableBadges = BADGES_BY_POSITION[position] ?? BADGES_BY_POSITION.SF

  let baseCount, bonusCap
  if (overall >= 90)      { baseCount = randInt(7, 11); bonusCap = 5 }
  else if (overall >= 85) { baseCount = randInt(5, 8);  bonusCap = 4 }
  else if (overall >= 80) { baseCount = randInt(3, 6);  bonusCap = 3 }
  else if (overall >= 75) { baseCount = randInt(2, 4);  bonusCap = 2 }
  else if (overall >= 70) { baseCount = randInt(1, 3);  bonusCap = 2 }
  else                    { baseCount = randInt(0, 2);  bonusCap = 1 }

  const seasonBonus = Math.max(0, Math.min(bonusCap, Math.floor((careerSeasons ?? 0) / 2)))
  const numBadges = baseCount + seasonBonus

  if (numBadges <= 0) return []

  const shuffled = shuffleArray([...availableBadges])
  const selected = shuffled.slice(0, Math.min(numBadges, shuffled.length))

  return selected.map(id => ({
    id,
    level: getBadgeLevel(overall),
  }))
}

/**
 * Pick a realistic veteran age from a role band. Used by generateVeteran to
 * spread roster ages naturally instead of clustering everyone in the rookie
 * 18-22 window the base generator produces.
 */
function pickVeteranAge(role) {
  switch (role) {
    case 'superstar': return randInt(27, 32)
    case 'star':      return randInt(25, 31)
    case 'starter':   return randInt(24, 30)
    case 'rotation':  return randInt(22, 29)
    case 'bench':
    default: {
      // Bench bimodal: most are young (21-25), with a vet-min tail (32-37)
      const roll = randInt(1, 100)
      if (roll <= 25) return randInt(32, 37)
      return randInt(21, 26)
    }
  }
}

/**
 * Derive a plausible draft pick from a player's overall — mirrors the
 * tiered logic in randomizeDraftInfo but doesn't try to back-fit from age.
 * Returns { draftRound, draftPick } or { draftRound: null, draftPick: null }
 * for undrafted players.
 */
function pickDraftHistory(overall) {
  if (overall >= 88) return { draftRound: 1, draftPick: randInt(1, 5) }
  if (overall >= 82) return { draftRound: 1, draftPick: randInt(3, 14) }
  if (overall >= 76) return { draftRound: 1, draftPick: randInt(10, 30) }
  if (overall >= 70) {
    const r = randInt(1, 2)
    return { draftRound: r, draftPick: r === 1 ? randInt(15, 30) : randInt(31, 60) }
  }
  if (overall >= 60) return { draftRound: 2, draftPick: randInt(31, 60) }
  // 50/50 undrafted vs late 2nd
  if (randInt(0, 1) === 0) return { draftRound: null, draftPick: null }
  return { draftRound: 2, draftPick: randInt(45, 60) }
}

// =============================================================================
// CAMPAIGN MANAGER
// =============================================================================

/**
 * Create a new campaign with all 30 teams, coaches, rosters, season, and lineups.
 *
 * @param {Object} options
 * @param {string} options.name - Campaign name
 * @param {string} options.teamAbbreviation - User's chosen team abbreviation
 * @param {string} options.difficulty - 'rookie' | 'pro' | 'all_star' | 'hall_of_fame'
 * @param {string} [options.draftMode='standard'] - 'standard' | 'fantasy'
 * @param {number} [options.seasonLength=82] - Games per team in regular season
 * @returns {Promise<Object>} The created campaign object
 */
export async function createCampaign(options) {
  const {
    name,
    difficulty = 'pro',
    seasonLength = 82,
  } = options

  // Accept both camelCase and snake_case parameter names
  const teamAbbreviation = options.teamAbbreviation ?? options.team_abbreviation
  const draftMode = options.draftMode ?? options.draft_mode ?? 'standard'
  const customTeamName = options.customTeamName ?? options.custom_team_name ?? null

  const isFantasy = draftMode === 'fantasy'
  const campaignId = generateUUID()
  const startYear = 2025

  // -------------------------------------------------------------------------
  // 1. Create campaign record
  // -------------------------------------------------------------------------
  const campaign = {
    id: campaignId,
    name,
    currentDate: '2025-10-21',  // NBA season start
    gameYear: 1,
    phase: 'regular_season',
    difficulty,
    draftMode,
    draftCompleted: !isFantasy,
    settings: {
      autoSave: true,
      injuryFrequency: 'normal',
      tradeFrequency: 'normal',
      seasonLength,
      awardTokens: 0,
      scoutingPoints: 0,
      lastScoutingBiweek: 0,
      scoutedPlayers: {},
      // New campaigns are generated on the current salary scale already, so the
      // one-shot cap/contract rebase (rescaleContracts) skips them — this also
      // preserves the creation-time ±variance the migration would otherwise flatten.
      salaryCapRebaseDone: true,
    },
    lastPlayedAt: new Date().toISOString(),
  }

  await CampaignRepository.create(campaign)

  // -------------------------------------------------------------------------
  // 2. Generate all 30 teams with coaches
  // -------------------------------------------------------------------------
  // Pre-roll the per-campaign mode map BEFORE generating teams so coach tier
  // can be driven by campaignMode instead of the static TEAM_TIERS table.
  // We synthesize a lite team list from TEAMS since the real team records
  // don't exist yet — assignCampaignModes reads .abbreviation and .facilities
  // (the latter gates which teams are eligible for the 'contender' boost). The
  // same modes map is later threaded into generateLeagueRosters so it doesn't
  // re-roll a different assignment.
  const teamModes = isFantasy
    ? null
    : assignCampaignModes(
        TEAMS.map(t => ({ abbreviation: t.abbreviation, facilities: t.facilities })),
        teamAbbreviation
      )
  const teams = generateTeams(campaignId, teamModes)

  // Seed the user-facing free-agent coach pool (8 candidates across 3 tiers).
  campaign.settings.availableCoaches = generateCoachPool(teams)
  // Seed the parallel scout / physician / staff-trainer hire pools so users
  // browse a persistent roster instead of fresh random candidates every modal
  // open (matches the coach pool pattern).
  const personnelPools = {
    scout: generatePersonnelPool('scout'),
    physician: generatePersonnelPool('physician'),
    staff_trainer: generatePersonnelPool('staff_trainer'),
    analyst: generatePersonnelPool('analyst'),
  }
  campaign.settings[PERSONNEL_POOL_KEY.scout] = personnelPools.scout
  campaign.settings[PERSONNEL_POOL_KEY.physician] = personnelPools.physician
  campaign.settings[PERSONNEL_POOL_KEY.staff_trainer] = personnelPools.staff_trainer
  campaign.settings[PERSONNEL_POOL_KEY.analyst] = personnelPools.analyst

  // Distribute admin-authored coach headshots across every personnel slot
  // — coaches first, then scouts, physicians, staff trainers — so the
  // priority is honored when the pool is smaller than total demand.
  assignPersonnelHeadshots(teams, personnelPools)

  await TeamRepository.saveBulk(teams)
  await CampaignRepository.save(campaign)

  // -------------------------------------------------------------------------
  // 3. Find user's team
  // -------------------------------------------------------------------------
  const userTeam = teams.find(t => t.abbreviation === teamAbbreviation)
  if (!userTeam) {
    throw new Error(`Selected team "${teamAbbreviation}" not found`)
  }

  // The auto-generated coach is given a fixed 2-season contract for the user
  // team (AI teams keep the random 1-4 from generateCoach since their coach
  // contracts don't decrement). hiredSeason matches the current year so the
  // "Hired Season YYYY" line in the UI reads correctly from day one.
  // Stamp the per-season Coach Meeting budget here so the user starts the
  // campaign with free meetings available — without this the field was
  // undefined until the first season-rollover refill.
  if (userTeam.coach) {
    userTeam.coach.contractYearsRemaining = 2
    userTeam.coach.contract_years_remaining = 2
    userTeam.coach.hiredSeason = startYear
    userTeam.coach.actionsRemaining = getCoachActionBudget(userTeam.coach)
    userTeam.coach.trainActionsRemaining = getCoachTrainBudget(userTeam.coach)
    userTeam.coach.activeTraining = null
  }

  // Apply the optional user-team rename. Teams are persisted per-campaign,
  // so this only affects this campaign's record — the source teams.js file
  // and other campaigns are untouched.
  if (customTeamName && customTeamName.trim()) {
    userTeam.name = customTeamName.trim()
  }

  // -------------------------------------------------------------------------
  // 4. Generate procedural rosters for all 30 teams (or the fantasy pool)
  // -------------------------------------------------------------------------
  let allPlayers = []

  if (!isFantasy) {
    // Standard mode: generate ~450 procedural players (15 per team) with
    // realistic mode-driven talent distribution. Every team — including the
    // user's chosen team — is bucketed into contender/average/rebuilder
    // per-campaign for replay variety (contenders only from Elite/Strong-
    // facility teams), so picking a strong franchise can hand the user a
    // contender roster.
    const result = generateLeagueRosters(campaignId, teams, {
      startYear,
      userTeamAbbreviation: teamAbbreviation,
      // Reuse the same modes that drove coach tier assignment in
      // generateTeams above. Without this, the roster generator would
      // re-roll a different mode map, undoing the alignment between a
      // team's coach quality and its roster blueprint.
      modes: teamModes,
    })
    allPlayers = result.players
    // Persist the per-campaign mode map so it survives reload and is
    // available for any future UI ("3 contenders this season: …").
    campaign.settings = campaign.settings ?? {}
    campaign.settings.teamModes = result.modes

    await PlayerRepository.saveBulk(allPlayers)

    // Update team payroll from the generated roster. The mode assignment
    // (team.campaignMode, team.aiDirection) was already stamped on each team
    // object inside generateLeagueRosters — saveBulk below persists those too.
    for (const team of teams) {
      const teamPlayers = allPlayers.filter(p => p.teamId === team.id)
      const totalPayroll = teamPlayers.reduce((sum, p) => sum + (p.contractSalary ?? 0), 0)
      team.total_payroll = totalPayroll
      team.totalPayroll = totalPayroll
    }
    await TeamRepository.saveBulk(teams)
  } else {
    // Fantasy draft mode: generate a procedural free-agent pool the user/AI
    // will draft from.
    allPlayers = generateFreeAgentPool(campaignId, { startYear, count: 530 })
    await PlayerRepository.saveBulk(allPlayers)
  }

  // -------------------------------------------------------------------------
  // 5. Update campaign with user team reference
  // -------------------------------------------------------------------------
  campaign.teamId = userTeam.id
  campaign.teamAbbreviation = userTeam.abbreviation

  // -------------------------------------------------------------------------
  // 6. Initialize season 1 (schedule + standings)
  // -------------------------------------------------------------------------
  const seasonData = SeasonManager.initializeSeason(teams, startYear, campaignId)
  const gamesCreated = SeasonManager.generateSchedule(
    seasonData, teams, userTeam.id, startYear, '2025-10-21'
  )

  // Persist season data to IndexedDB
  await SeasonRepository.save({
    campaignId,
    year: startYear,
    ...seasonData,
  })

  campaign.currentSeasonYear = startYear

  // The user signs a 4-year GM contract with the team's owner (instead of just
  // "picking" a team). Years-remaining is derived from the season year, so this
  // stays correct across seasons without a decrement step. The owner evaluates
  // the GM at contract end — that lifecycle is Part 2; for now we just track it.
  campaign.settings.gmContract = {
    teamId: userTeam.id,
    teamAbbreviation: userTeam.abbreviation,
    signedSeasonYear: startYear,
    // The season the GM first took over THIS team. Unlike signedSeasonYear it
    // is preserved across re-signings (only resets on a team switch), so the
    // owner check-in greets a re-signed GM as a returning partner, not a
    // first-time hire.
    tenureStartYear: startYear,
    lengthYears: 4,
    status: 'active',
    // Part 2: running sub-task progress for the duration of this contract.
    progress: {
      allStarAppearances: 0,
      badgesAdded: 0,
      starPlayerIdsAtSign: starPlayerIds(allPlayers.filter(p => p.teamId === userTeam.id)),
      allStarCountedSeasons: [],
    },
  }

  // Owner expectation starts at the owner's static baseline and ratchets up at
  // each season end (see enterOffseason). Seeded here for a clean start; older
  // saves fall back via getEffectiveExpectation.
  {
    const seedOwner = findOwnerForTeam(userTeam.abbreviation)
    if (seedOwner) campaign.settings.ownerExpectation = initOwnerExpectation(seedOwner)
    // Ordered history of expectation tiers held during this contract. New tiers are
    // APPENDED (not swapped) when the bar rises, so coach sub-tasks accumulate
    // instead of wiping work the GM already invested in.
    campaign.settings.gmContract.expectationTiers = [campaign.settings.ownerExpectation?.tier ?? 'playoffs']
  }

  // -------------------------------------------------------------------------
  // 7. Initialize lineups + target minutes (standard mode only)
  // -------------------------------------------------------------------------
  if (!isFantasy) {
    // Initialize all AI team lineups and store in team records
    for (const team of teams) {
      const teamPlayers = allPlayers.filter(p => p.teamId === team.id)
      const { starters, subStrategy } = initializeTeamLineup(teamPlayers)

      // Generate target minutes for this team's roster
      const targetMinutes = generateAITargetMinutes(teamPlayers, starters, subStrategy)

      team.lineup_settings = {
        starters,
        subStrategy,
        target_minutes: targetMinutes,
      }
      // Pick offensive + defensive schemes that fit this team's roster rather
      // than copying whatever the coach was randomly generated with — coaches
      // are stamped with random scheme strings that may not even match the
      // simulator's scheme map. CoachStrategyService picks canonical scheme
      // keys (`three_point`, `motion`, `man`, …) the simulator understands.
      const schemeFit = selectBestCoachingScheme(teamPlayers, team.coach)
      team.coaching_scheme = {
        offensive: schemeFit.offensive,
        defensive: schemeFit.defensive,
        substitution: subStrategy,
      }
    }

    // Initialize user team lineup and store in campaign settings
    const userPlayers = allPlayers.filter(p => p.teamId === userTeam.id)
    const userStarters = initializeUserTeamLineup(userPlayers)
    const userTargetMinutes = generateAITargetMinutes(userPlayers, userStarters, 'staggered')
    campaign.settings.lineup = {
      starters: userStarters,
      target_minutes: userTargetMinutes,
      rotation: [],
    }

    // Persist updated team lineup settings
    await TeamRepository.saveBulk(teams)
  }

  // -------------------------------------------------------------------------
  // 8. Generate draft picks (5 years, rounds 1 & 2 for every team)
  // -------------------------------------------------------------------------
  const currentGameYear = campaign.gameYear ?? 1
  for (const team of teams) {
    const picks = []
    for (let yearOffset = 0; yearOffset < 5; yearOffset++) {
      const draftYear = currentGameYear + yearOffset
      for (const round of [1, 2]) {
        picks.push({
          id: generateUUID(),
          campaignId,
          originalTeamId: team.id,
          currentOwnerId: team.id,
          original_team_abbreviation: team.abbreviation,
          year: draftYear,
          round,
          pick_number: null,
          projected_position: null,
          isTraded: false,
          display_name: `${draftYear} Round ${round} (${team.abbreviation})`,
          trade_value: round === 1 ? 5 : 0.5,
        })
      }
    }
    team.draftPicks = picks
  }
  await TeamRepository.saveBulk(teams)

  // -------------------------------------------------------------------------
  // 9. Generate Year 1 rookie draft class (visible on Scouting page from day 1)
  //    draftYear = season year the rookie will FIRST PLAY (after being drafted
  //    at the end of the current season). This is the value AwardService /
  //    AllStarService / fetchRookieLeaders compare against currentSeasonYear.
  // -------------------------------------------------------------------------
  {
    const draftYear = startYear + 1
    const includeGenerational = shouldGenerateGenerational(campaign, draftYear)
    await generateAndSaveRookieClass(campaignId, draftYear, { includeGenerational })
    if (includeGenerational) {
      campaign.settings = campaign.settings ?? {}
      campaign.settings.lastGenerationalDraftYear = draftYear
    }
  }

  // -------------------------------------------------------------------------
  // 10. Save final campaign state
  // -------------------------------------------------------------------------
  await CampaignRepository.save(campaign)

  return {
    campaign,
    teams,
    players: allPlayers,
    gamesCreated,
    seasonData,
  }
}

/**
 * Load an existing campaign from IndexedDB.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} Campaign with related data
 */
export async function loadCampaign(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`)
  }

  // Normalize camelCase → snake_case for Vue views
  if (!campaign.draft_mode) campaign.draft_mode = campaign.draftMode
  if (!campaign.draft_completed && campaign.draftCompleted !== undefined) campaign.draft_completed = campaign.draftCompleted
  if (!campaign.game_year) campaign.game_year = campaign.gameYear
  if (!campaign.current_date) campaign.current_date = campaign.currentDate

  // Update last played time
  campaign.lastPlayedAt = new Date().toISOString()
  await CampaignRepository.save(campaign)

  // Load related data
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const year = campaign.currentSeasonYear ?? 2025
  const seasonData = await SeasonRepository.get(campaignId, year)

  // One-time migration: pre-existing campaigns predate the
  // motivation→strictness rename and the badges/headshot fields. Backfill
  // each coach in place so engine code can rely on the new shape.
  await migrateCoachesIfNeeded(teams)

  // Find user's team
  const userTeam = teams.find(t => t.id === campaign.teamId) ?? null

  return {
    campaign,
    teams,
    userTeam,
    seasonData,
    year,
  }
}

/**
 * Migrate coach records on existing campaigns to the current schema:
 *  - rename `attributes.motivation` → `attributes.strictness`
 *  - default `badges = []` if missing
 *  - default `headshot = null` if missing
 *
 * Idempotent — only writes back teams that actually changed.
 */
async function migrateCoachesIfNeeded(teams) {
  const dirty = []
  for (const team of teams ?? []) {
    if (!team?.coach) continue
    let changed = false

    // Rename motivation → strictness
    if (team.coach.attributes && Object.prototype.hasOwnProperty.call(team.coach.attributes, 'motivation')) {
      if (!Object.prototype.hasOwnProperty.call(team.coach.attributes, 'strictness')) {
        team.coach.attributes.strictness = team.coach.attributes.motivation
      }
      delete team.coach.attributes.motivation
      changed = true
    }

    // Default badges
    if (!Array.isArray(team.coach.badges)) {
      team.coach.badges = []
      changed = true
    }

    // Default headshot
    if (typeof team.coach.headshot === 'undefined') {
      team.coach.headshot = null
      changed = true
    }

    if (changed) dirty.push(team)
  }
  if (dirty.length > 0) {
    await TeamRepository.saveBulk(dirty)
  }
}

/**
 * Delete a campaign and all its associated data from IndexedDB.
 *
 * @param {string} campaignId
 * @returns {Promise<void>}
 */
export async function deleteCampaign(campaignId) {
  // clearCampaignData from GameDatabase handles teams, players, seasons, news, trades
  const { clearCampaignData } = await import('../db/GameDatabase')
  await clearCampaignData(campaignId)

  // Delete the campaign record itself
  await CampaignRepository.delete(campaignId)
}

/**
 * Archive season data (player stats, team records, coach career stats) before resetting.
 * Called before processSeasonEnd to preserve historical data.
 *
 * When `userTeamId` is provided, also returns a `newAchievements` array of
 * any championship / conference / playoff-berth feats the user just earned —
 * the caller writes those onto `campaign.achievements` and fires a toast.
 *
 * @param {string} campaignId
 * @param {number} currentYear
 * @param {Array} teams
 * @param {Array} allPlayers
 * @returns {Promise<void>}
 */
async function archiveSeasonData(campaignId, currentYear, teams, allPlayers, userTeamId = null) {
  const seasonData = await SeasonRepository.get(campaignId, currentYear)
  if (!seasonData) return { newAchievements: [] }

  // Pulled from the schedule's last completed game when we need to date-
  // stamp an achievement; same fallback shape AwardService uses
  // (`AwardService.js:76-77`).
  const _schedule = seasonData?.schedule || []
  const _lastPlayed = _schedule.filter(g => g.played).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
  const seasonEndDate = _lastPlayed?.date || `${currentYear + 1}-04-15`

  // Achievements accumulator — populated only for the user team (when
  // `userTeamId` is non-null). Returned to the caller for persistence
  // into campaign.achievements + toast surface.
  const newAchievements = []
  const _randomShort = () => Math.random().toString(36).slice(2, 8)
  const _pushAchievement = (type, team, label) => {
    newAchievements.push({
      id: `ach_${Date.now()}_${_randomShort()}`,
      type,
      year: currentYear,
      // In-game season-end date (context). The Recent Activity feed's "X ago"
      // uses createdAt (real wall-clock) instead — `date` is an in-game date
      // that sits ~months behind real time and would misreport recency.
      date: seasonEndDate,
      createdAt: new Date().toISOString(),
      teamId: team.id,
      teamAbbreviation: team.abbreviation,
      teamName: team.name,
      label,
      subtitle: `${currentYear}-${String((currentYear + 1) % 100).padStart(2, '0')} Season`,
    })
  }

  // 2A. Player season history
  const playerStats = seasonData.playerStats || {}
  // teamId → abbreviation for the multi-team season label. A player traded
  // mid-season archives "POR/DET" (current/last team first, then earlier
  // teams he recorded stats for) instead of only his end-of-season team.
  const _abbrByTeamId = new Map((teams || []).map(t => [String(t.id), t.abbreviation]))
  const _seasonTeamLabel = (player, stats) => {
    const current = player.teamAbbreviation
    const recorded = Array.isArray(stats?.teams)
      ? stats.teams.map(id => _abbrByTeamId.get(String(id))).filter(Boolean)
      : []
    if (recorded.length === 0) return current
    const others = [...new Set(recorded)].filter(a => a && a !== current).reverse()
    return [current, ...others].filter(Boolean).join('/') || current
  }
  for (const player of allPlayers) {
    const stats = playerStats[String(player.id)]
    if (!stats || !stats.gamesPlayed) continue

    player.seasonHistory = player.seasonHistory || []
    player.seasonHistory.push({
      year: currentYear,
      teamId: player.teamId,
      teamAbbreviation: _seasonTeamLabel(player, stats),
      stats: {
        gamesPlayed: stats.gamesPlayed ?? 0,
        points: stats.points ?? 0,
        rebounds: stats.rebounds ?? 0,
        assists: stats.assists ?? 0,
        steals: stats.steals ?? 0,
        blocks: stats.blocks ?? 0,
        turnovers: stats.turnovers ?? 0,
        minutesPlayed: stats.minutesPlayed ?? 0,
        fieldGoalsMade: stats.fieldGoalsMade ?? 0,
        fieldGoalsAttempted: stats.fieldGoalsAttempted ?? 0,
        threePointersMade: stats.threePointersMade ?? 0,
        threePointersAttempted: stats.threePointersAttempted ?? 0,
        freeThrowsMade: stats.freeThrowsMade ?? 0,
        freeThrowsAttempted: stats.freeThrowsAttempted ?? 0,
        offensiveRebounds: stats.offensiveRebounds ?? 0,
        defensiveRebounds: stats.defensiveRebounds ?? 0,
        personalFouls: stats.personalFouls ?? 0,
      },
      // This season's single-game bests (PTS/REB/AST/STL/BLK), archived alongside
      // the totals. careerHighs (live on the player) persists across seasons.
      seasonHighs: player.seasonHighs ?? {},
    })
    // Reset the running season highs so the new season starts fresh.
    player.seasonHighs = {}
  }

  // Campaign all-time highs: the best single game by ANYONE, derived from every
  // player's (now-final) careerHighs. Returned to the caller (enterOffseason) so
  // it persists on the campaign object IT saves — a separate write here would be
  // clobbered by enterOffseason's later campaign save.
  let allTimeHighs = null
  try {
    allTimeHighs = recomputeAllTimeHighs(allPlayers)
  } catch (highsErr) {
    console.warn('[CampaignManager] all-time highs recompute failed:', highsErr)
  }

  // 2B. Team season history
  const allStandings = [
    ...(seasonData.standings?.east || []),
    ...(seasonData.standings?.west || []),
  ]
  const teamStats = seasonData.teamStats || {}
  const bracket = seasonData.playoffBracket || null
  // Per-team playoff depth ('champion'|'finals'|'conf_finals'|'round2'|'round1')
  // derived from the bracket. teamStats.playoffResult is never populated, so without
  // this every non-champion playoff team was logged as "Missed playoffs" in history.
  const { depthByTeamId: playoffDepthByTeam } = derivePlayoffDepth(bracket)

  for (const team of teams) {
    team.seasonHistory = team.seasonHistory || []

    const standing = allStandings.find(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    )
    if (!standing) continue

    // Conference rank = position in standings array
    const confStandings = team.conference === 'east'
      ? (seasonData.standings?.east || [])
      : (seasonData.standings?.west || [])
    const confRank = confStandings.findIndex(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    ) + 1

    const ts = teamStats[team.id] || {}
    const isChampion = bracket?.champion?.teamId === team.id

    team.seasonHistory.push({
      year: currentYear,
      wins: standing.wins ?? 0,
      losses: standing.losses ?? 0,
      conferenceRank: confRank || null,
      playoffSeed: ts.playoffSeed ?? null,
      playoffResult: playoffDepthByTeam[team.id] ?? ts.playoffResult ?? null,
      champion: isChampion,
    })
  }

  // 2C. Coach career stats

  // Tally playoff wins/losses per team from the bracket
  const playoffRecord = {} // { [teamId]: { wins, losses } }
  if (bracket) {
    const allSeries = []
    for (const conf of ['east', 'west']) {
      const confData = bracket[conf]
      if (!confData) continue
      for (const round of ['round1', 'round2']) {
        if (confData[round]) allSeries.push(...confData[round])
      }
      if (confData.confFinals) allSeries.push(confData.confFinals)
    }
    if (bracket.finals) allSeries.push(bracket.finals)

    for (const series of allSeries) {
      if (!series || series.status !== 'complete') continue
      const t1Id = series.team1?.teamId
      const t2Id = series.team2?.teamId
      const t1Wins = series.team1Wins ?? 0
      const t2Wins = series.team2Wins ?? 0
      if (t1Id) {
        if (!playoffRecord[t1Id]) playoffRecord[t1Id] = { wins: 0, losses: 0 }
        playoffRecord[t1Id].wins += t1Wins
        playoffRecord[t1Id].losses += t2Wins
      }
      if (t2Id) {
        if (!playoffRecord[t2Id]) playoffRecord[t2Id] = { wins: 0, losses: 0 }
        playoffRecord[t2Id].wins += t2Wins
        playoffRecord[t2Id].losses += t1Wins
      }
    }
  }

  for (const team of teams) {
    if (!team.coach) continue

    const standing = allStandings.find(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    )
    if (!standing) continue

    // career_stats is the canonical nested shape. Wins / losses (regular and
    // playoff) are accumulated per game by `_updateCoachCareerStatsAfterGame`
    // in stores/game.js — we DON'T re-add the season's totals here or we'd
    // double-count. We only do the season-bounded bookkeeping below, plus
    // a reconciliation pass for legacy campaigns where some games may not
    // have been tracked per-game.
    const cs = team.coach.career_stats || {
      wins: team.coach.career_wins ?? 0,
      losses: team.coach.career_losses ?? 0,
      playoff_wins: team.coach.playoff_wins ?? 0,
      playoff_losses: team.coach.playoff_losses ?? 0,
      championships: team.coach.championships ?? 0,
      conference_titles: team.coach.conference_titles ?? 0,
      seasons_coached: team.coach.seasons_coached ?? 0,
    }

    // Reconciliation: ensure this season's W/L (per the standings + playoff
    // bracket) is fully reflected in the running tally. Catches games that
    // pre-date the per-game increment hook in `stores/game.js` (e.g. the
    // transition season after this code first ships). `_at_last_archive`
    // snapshots the cumulative totals at the END of each archive, so the
    // delta from the snapshot to now is "this season's tracked games".
    const baselineWins = cs.career_wins_at_last_archive ?? 0
    const baselineLosses = cs.career_losses_at_last_archive ?? 0
    const baselinePWins = cs.career_playoff_wins_at_last_archive ?? 0
    const baselinePLosses = cs.career_playoff_losses_at_last_archive ?? 0

    const trackedSeasonWins = (cs.wins ?? 0) - baselineWins
    const trackedSeasonLosses = (cs.losses ?? 0) - baselineLosses
    const expectedSeasonWins = standing.wins ?? 0
    const expectedSeasonLosses = standing.losses ?? 0
    if (trackedSeasonWins < expectedSeasonWins) {
      cs.wins = (cs.wins ?? 0) + (expectedSeasonWins - trackedSeasonWins)
    }
    if (trackedSeasonLosses < expectedSeasonLosses) {
      cs.losses = (cs.losses ?? 0) + (expectedSeasonLosses - trackedSeasonLosses)
    }

    const pr = playoffRecord[team.id]
    const expectedPlayoffWins = pr?.wins ?? 0
    const expectedPlayoffLosses = pr?.losses ?? 0
    const trackedPlayoffWins = (cs.playoff_wins ?? 0) - baselinePWins
    const trackedPlayoffLosses = (cs.playoff_losses ?? 0) - baselinePLosses
    if (trackedPlayoffWins < expectedPlayoffWins) {
      cs.playoff_wins = (cs.playoff_wins ?? 0) + (expectedPlayoffWins - trackedPlayoffWins)
    }
    if (trackedPlayoffLosses < expectedPlayoffLosses) {
      cs.playoff_losses = (cs.playoff_losses ?? 0) + (expectedPlayoffLosses - trackedPlayoffLosses)
    }

    cs.seasons_coached = (cs.seasons_coached ?? 0) + 1

    // Refresh percentages
    const totalGames = (cs.wins ?? 0) + (cs.losses ?? 0)
    cs.win_pct = totalGames > 0
      ? Math.round((cs.wins / totalGames) * 1000) / 1000
      : 0
    const totalPlayoffGames = (cs.playoff_wins ?? 0) + (cs.playoff_losses ?? 0)
    cs.playoff_win_pct = totalPlayoffGames > 0
      ? Math.round((cs.playoff_wins / totalPlayoffGames) * 1000) / 1000
      : 0

    const isChampion = bracket?.champion?.teamId === team.id
    if (isChampion) {
      cs.championships = (cs.championships ?? 0) + 1
    }

    // Conference title — coach earns this when their team wins their
    // conference finals series. Mirrors the franchise-history conf-titles
    // increment below; both share the same bracket source of truth.
    const coachConf = team.conference
    const coachConfWinnerId = bracket?.[coachConf]?.confFinals?.winner?.teamId ?? null
    if (coachConfWinnerId && coachConfWinnerId === team.id) {
      cs.conference_titles = (cs.conference_titles ?? 0) + 1
    }

    // Snapshot the post-archive totals so next season's reconciliation
    // knows what "this season" started from.
    cs.career_wins_at_last_archive = cs.wins ?? 0
    cs.career_losses_at_last_archive = cs.losses ?? 0
    cs.career_playoff_wins_at_last_archive = cs.playoff_wins ?? 0
    cs.career_playoff_losses_at_last_archive = cs.playoff_losses ?? 0

    team.coach.career_stats = cs
  }

  // 2D. Franchise history — persistent per-team aggregates that survive coach
  // changes. Lazy-init to match how `team.seasonHistory` is handled above; no
  // backfill for existing campaigns. Increments by this season's totals only,
  // so callers must not run archiveSeasonData twice for the same year.
  //
  // 2E (interleaved) — per-player career counters. Mirrors `coach.career_stats`
  // but scoped to the player's CURRENT team at archive time (matches what the
  // seasonHistory write at the top of this function already does). Same
  // `isChampion` / `isConfWinner` / `madePlayoffs` flags below feed both the
  // franchise_history update and the per-player bumps, so there's no second
  // bracket walk.
  //
  // 2F (interleaved) — for the user team only, push achievement entries the
  // caller will persist onto `campaign.achievements` and surface as toasts.
  for (const team of teams) {
    const standing = allStandings.find(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    )
    if (!standing) continue

    const fh = team.franchise_history || {
      championships: 0,
      conference_titles: 0,
      playoff_appearances: 0,
      regular_season: { wins: 0, losses: 0 },
      playoffs: { wins: 0, losses: 0 },
    }
    if (!fh.regular_season) fh.regular_season = { wins: 0, losses: 0 }
    if (!fh.playoffs) fh.playoffs = { wins: 0, losses: 0 }

    fh.regular_season.wins = (fh.regular_season.wins ?? 0) + (standing.wins ?? 0)
    fh.regular_season.losses = (fh.regular_season.losses ?? 0) + (standing.losses ?? 0)

    const pr = playoffRecord[team.id]
    fh.playoffs.wins = (fh.playoffs.wins ?? 0) + (pr?.wins ?? 0)
    fh.playoffs.losses = (fh.playoffs.losses ?? 0) + (pr?.losses ?? 0)

    // A team is "in the playoffs" iff the bracket walk above logged a
    // game for them. Same flag drives the player.playerCareer bump and
    // the franchise_history counter; cheap and avoids a second pass.
    const madePlayoffs = !!pr

    const isChampion = bracket?.champion?.teamId === team.id
    if (isChampion) {
      fh.championships = (fh.championships ?? 0) + 1
    }

    const conf = team.conference
    const confFinalsWinnerId = bracket?.[conf]?.confFinals?.winner?.teamId ?? null
    const isConfWinner = !!(confFinalsWinnerId && confFinalsWinnerId === team.id)
    if (isConfWinner) {
      fh.conference_titles = (fh.conference_titles ?? 0) + 1
    }
    if (madePlayoffs) {
      fh.playoff_appearances = (fh.playoff_appearances ?? 0) + 1
    }

    team.franchise_history = fh

    // Per-player career counters. Iterate the team's CURRENT roster only —
    // FAs and retirees skipped so they don't get credit for a team-wide
    // feat earned after they left. Mid-season trades are attributed to the
    // team the player is on at archive time (consistent with the
    // seasonHistory write earlier in this function).
    const roster = allPlayers.filter(p =>
      (p.teamId ?? p.team_id) === team.id &&
      !p.isRetired && !p.is_retired
    )
    for (const player of roster) {
      const pc = player.playerCareer || {
        championships: 0,
        conference_championships: 0,
        playoff_appearances: 0,
        regular_season_wins: 0,
        regular_season_losses: 0,
        playoff_wins: 0,
        playoff_losses: 0,
      }
      pc.regular_season_wins = (pc.regular_season_wins ?? 0) + (standing.wins ?? 0)
      pc.regular_season_losses = (pc.regular_season_losses ?? 0) + (standing.losses ?? 0)
      if (madePlayoffs) {
        pc.playoff_wins = (pc.playoff_wins ?? 0) + (pr.wins ?? 0)
        pc.playoff_losses = (pc.playoff_losses ?? 0) + (pr.losses ?? 0)
        pc.playoff_appearances = (pc.playoff_appearances ?? 0) + 1
      }
      if (isConfWinner) pc.conference_championships = (pc.conference_championships ?? 0) + 1
      if (isChampion) pc.championships = (pc.championships ?? 0) + 1
      player.playerCareer = pc
    }

    // User-team achievements — pushed in display priority order
    // (championship > conference > berth) so the toast queue + feed
    // both show the highest feat first when multiple fire in one year.
    if (userTeamId != null && team.id === userTeamId) {
      if (isChampion) _pushAchievement('championship', team, 'League Champions')
      if (isConfWinner) _pushAchievement('conference_championship', team, 'Conference Champions')
      if (madePlayoffs) _pushAchievement('playoff_berth', team, 'Playoff Berth')
    }
  }

  // Persist archived data
  await PlayerRepository.saveBulk(allPlayers)
  await TeamRepository.saveBulk(teams)

  return { newAchievements, allTimeHighs }
}

/**
 * Advance the campaign to the next season.
 * Processes end-of-season awards, player aging, contracts, and initializes the new season.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} Updated campaign with new season data
 */
export async function advanceToNextSeason(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`)
  }

  const currentYear = campaign.currentSeasonYear ?? 2025
  const nextYear = currentYear + 1
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // -------------------------------------------------------------------------
  // 1. Process end-of-season for all players (aging, retirement, contracts)
  // -------------------------------------------------------------------------
  const seasonEndResult = processSeasonEnd(
    allPlayers,
    {},
    campaign.difficulty ?? 'pro'
  )

  // Save updated players (retired players are excluded from the returned array)
  await PlayerRepository.saveBulk(
    seasonEndResult.players.map(p => ({
      ...p,
      campaignId,
    }))
  )

  // -------------------------------------------------------------------------
  // 2. Update campaign to next season
  // -------------------------------------------------------------------------
  campaign.gameYear = (campaign.gameYear ?? 1) + 1
  campaign.game_year = campaign.gameYear // keep the snake-case mirror in sync (campaign-card "Year N")
  campaign.currentSeasonYear = nextYear
  campaign.currentDate = `${nextYear}-10-21`

  // -------------------------------------------------------------------------
  // 3. Initialize the new season (schedule + standings)
  // -------------------------------------------------------------------------
  const seasonData = SeasonManager.initializeSeason(teams, nextYear, campaignId)

  const userTeam = teams.find(t => t.id === campaign.teamId)
  const userTeamId = userTeam?.id ?? campaign.teamId

  const gamesCreated = SeasonManager.generateSchedule(
    seasonData, teams, userTeamId, nextYear, `${nextYear}-10-21`
  )

  await SeasonRepository.save({
    campaignId,
    year: nextYear,
    ...seasonData,
  })

  // -------------------------------------------------------------------------
  // 4. Re-initialize all team lineups + target minutes for the new season
  // -------------------------------------------------------------------------
  const activePlayers = seasonEndResult.players

  for (const team of teams) {
    const teamPlayers = activePlayers.filter(p => p.teamId === team.id)
    const { starters, subStrategy } = initializeTeamLineup(teamPlayers)
    const targetMinutes = generateAITargetMinutes(teamPlayers, starters, subStrategy)

    team.lineup_settings = {
      starters,
      subStrategy,
      target_minutes: targetMinutes,
    }
  }
  await TeamRepository.saveBulk(teams)

  // Re-initialize user lineup
  const userPlayers = activePlayers.filter(p => p.teamId === userTeamId)
  if (userPlayers.length > 0) {
    const userStarters = initializeUserTeamLineup(userPlayers)
    const userTargetMinutes = generateAITargetMinutes(userPlayers, userStarters, 'staggered')
    campaign.settings = campaign.settings ?? {}
    campaign.settings.lineup = {
      starters: userStarters,
      target_minutes: userTargetMinutes,
      rotation: [],
    }
  }

  // -------------------------------------------------------------------------
  // 5. Save updated campaign
  // -------------------------------------------------------------------------
  await CampaignRepository.save(campaign)

  return {
    campaign,
    seasonData,
    gamesCreated,
    seasonEndResult: seasonEndResult.results,
    news: seasonEndResult.news,
  }
}

/**
 * Reconstruct `player.awards` per-year arrays from persisted seasonData.
 * Idempotent — only runs once per campaign (gated by a settings flag) and
 * dedupes years if called again.
 *
 * Needed for campaigns that entered the offseason before per-year award
 * history was being recorded. Reads each archived season's `seasonAwards`
 * and `allStarRosters` and writes the years onto the corresponding players.
 */
export async function backfillPlayerAwards(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return
  if (campaign.settings?.awardsHistoryBackfilled) return

  const seasons = await SeasonRepository.getAllForCampaign(campaignId)
  if (!seasons || !seasons.length) return

  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  const playerMap = Object.fromEntries(allPlayers.map(p => [String(p.id), p]))

  const pushYear = (p, key, year) => {
    if (year == null) return
    if (!p.awards) p.awards = {}
    if (!Array.isArray(p.awards[key])) p.awards[key] = []
    if (!p.awards[key].includes(year)) p.awards[key].push(year)
  }

  for (const season of seasons) {
    const year = season.year
    if (!year) continue
    const awards = season.seasonAwards
    if (awards) {
      if (awards.mvp?.playerId) {
        const p = playerMap[String(awards.mvp.playerId)]
        if (p) pushYear(p, 'mvp', year)
      }
      if (awards.rookieOfTheYear?.playerId) {
        const p = playerMap[String(awards.rookieOfTheYear.playerId)]
        if (p) pushYear(p, 'rookie_of_the_year', year)
      }
      for (const tier of ['first', 'second', 'third']) {
        for (const e of (awards.allNba?.[tier] || [])) {
          const p = playerMap[String(e.playerId)]
          if (p) pushYear(p, `all_nba_${tier}`, year)
        }
      }
      for (const tier of ['first', 'second']) {
        for (const e of (awards.allDefense?.[tier] || [])) {
          const p = playerMap[String(e.playerId)]
          if (p) pushYear(p, `all_defense_${tier}`, year)
        }
        for (const e of (awards.allRookie?.[tier] || [])) {
          const p = playerMap[String(e.playerId)]
          if (p) pushYear(p, `all_rookie_${tier}`, year)
        }
      }
    }
    const allStarRosters = season?.allStarRosters?.allStars
    if (allStarRosters) {
      const ids = AllStarService._collectSelectedPlayerIds(allStarRosters)
      for (const pid of ids) {
        const p = playerMap[String(pid)]
        if (p) pushYear(p, 'all_star', year)
      }
    }
  }

  await PlayerRepository.saveBulk(allPlayers.map(p => ({ ...p, campaignId })))
  if (!campaign.settings) campaign.settings = {}
  campaign.settings.awardsHistoryBackfilled = true
  await CampaignRepository.save(campaign)
}

/**
 * Walk the user team's seasonHistory + per-year season records to derive
 * campaign achievements that pre-date the always-on writes in
 * `archiveSeasonData`. Idempotent — gated by
 * `campaign.settings.achievementsBackfilled`, so calling this on the
 * Dashboard or Campaigns view mount is safe / cheap on warm campaigns.
 *
 * Per-player career counters (`player.playerCareer.*`) are intentionally
 * NOT backfilled: the data required to attribute a championship to the
 * right players (roster snapshots per past season) was never captured.
 * Counters start at zero for legacy data; new seasons populate them.
 */
export async function backfillCampaignAchievements(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return
  if (campaign.settings?.achievementsBackfilled) return

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const userTeam = teams.find(t => t.id === campaign.teamId)
  if (!userTeam) return

  const history = Array.isArray(userTeam.seasonHistory) ? userTeam.seasonHistory : []
  // Order-stable date stamps so the feed sorts cleanly even when multiple
  // achievements share a year.
  const randomShort = () => Math.random().toString(36).slice(2, 8)

  const achievements = Array.isArray(campaign.achievements) ? campaign.achievements : []
  const seenKey = new Set(achievements.map(a => `${a.year}|${a.type}`))

  // Walk archived seasons for conference-title detection — best effort,
  // skip if the season was already compacted (no playoffBracket).
  const seasons = await SeasonRepository.getAllForCampaign(campaignId).catch(() => [])
  const seasonByYear = {}
  for (const s of seasons || []) {
    if (s && s.year != null) seasonByYear[s.year] = s
  }

  let playoffAppearancesBackfill = 0
  for (const entry of history) {
    const year = entry.year
    if (!year) continue
    const date = `${year + 1}-04-15`
    const subtitle = `${year}-${String((year + 1) % 100).padStart(2, '0')} Season`

    // Championship
    if (entry.champion && !seenKey.has(`${year}|championship`)) {
      achievements.push({
        id: `ach_${Date.now()}_${randomShort()}`,
        type: 'championship',
        year,
        date,
        teamId: userTeam.id,
        teamAbbreviation: userTeam.abbreviation,
        teamName: userTeam.name,
        label: 'League Champions',
        subtitle,
      })
      seenKey.add(`${year}|championship`)
    }

    // Conference championship — derive from per-year bracket if available.
    const season = seasonByYear[year]
    const bracket = season?.playoffBracket
    if (bracket && userTeam.conference) {
      const confWinnerId = bracket?.[userTeam.conference]?.confFinals?.winner?.teamId ?? null
      if (confWinnerId && confWinnerId === userTeam.id && !seenKey.has(`${year}|conference_championship`)) {
        achievements.push({
          id: `ach_${Date.now()}_${randomShort()}`,
          type: 'conference_championship',
          year,
          date,
          teamId: userTeam.id,
          teamAbbreviation: userTeam.abbreviation,
          teamName: userTeam.name,
          label: 'Conference Champions',
          subtitle,
        })
        seenKey.add(`${year}|conference_championship`)
      }
    }

    // Playoff berth (playoffSeed is non-null when the team qualified).
    if (entry.playoffSeed != null) {
      playoffAppearancesBackfill++
      if (!seenKey.has(`${year}|playoff_berth`)) {
        achievements.push({
          id: `ach_${Date.now()}_${randomShort()}`,
          type: 'playoff_berth',
          year,
          date,
          teamId: userTeam.id,
          teamAbbreviation: userTeam.abbreviation,
          teamName: userTeam.name,
          label: 'Playoff Berth',
          subtitle,
        })
        seenKey.add(`${year}|playoff_berth`)
      }
    }
  }

  // Stamp the derived playoff_appearances onto franchise_history when the
  // field is missing or zero (e.g. legacy campaigns that ran before the
  // counter was added).
  const fh = userTeam.franchise_history || null
  if (fh && (fh.playoff_appearances ?? 0) === 0 && playoffAppearancesBackfill > 0) {
    fh.playoff_appearances = playoffAppearancesBackfill
    await TeamRepository.save(userTeam)
  }

  campaign.achievements = achievements
  if (!campaign.settings) campaign.settings = {}
  campaign.settings.achievementsBackfilled = true
  await CampaignRepository.save(campaign)
}

/**
 * Enter the offseason phase: archive data, process season end, run AI contracts.
 * Does NOT start the new season — the user gets an interactive offseason period first.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} { campaign, seasonEndResult, aiContractResults, userExpiringPlayers }
 */
export async function enterOffseason(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Idempotency guard: if the campaign is already in any offseason sub-phase,
  // return early WITHOUT re-archiving / re-releasing players. Without this,
  // a UI re-trigger (e.g. the season-end modal popping up again because the
  // home view didn't recognise the new 'offseason_free_agency' phase) would
  // re-run the entire season-end flow and re-release every expiring contract.
  if (
    campaign.phase === 'offseason'
    || campaign.phase === 'offseason_free_agency'
    || campaign.phase === 'offseason_draft'
  ) {
    return {
      campaign,
      seasonEndResult: null,
      news: [],
      aiContractResults: { cuts: [], extensions: [], signings: [] },
      releasedUserPlayers: [],
      seasonAwards: null,
      newAchievements: [],
      alreadyEntered: true,
    }
  }

  const currentYear = campaign.currentSeasonYear ?? 2025
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 1. Archive season data (player/team history, coach career stats,
  //    player career counters, user-team achievements).
  const archiveResult = await archiveSeasonData(campaignId, currentYear, teams, allPlayers, campaign.teamId)
  const newAchievements = archiveResult?.newAchievements ?? []
  if (newAchievements.length > 0) {
    if (!Array.isArray(campaign.achievements)) campaign.achievements = []
    campaign.achievements.push(...newAchievements)
  }
  // Persist the recomputed campaign all-time highs on the campaign this function
  // saves below (set here so it isn't clobbered by that save). MERGE with the
  // stored board rather than overwrite: pruned retirees exist only in the
  // stored board, so a raw recompute from live players would drop their records.
  if (archiveResult?.allTimeHighs) {
    campaign.settings = campaign.settings ?? {}
    campaign.settings.allTimeHighs = mergeHighsBoards(
      campaign.settings.allTimeHighs ?? {},
      archiveResult.allTimeHighs,
    )
  }

  // 1b. Compute end-of-season awards (before stats are reset)
  const seasonData = await SeasonRepository.get(campaignId, currentYear)
  let seasonAwards = null
  if (seasonData) {
    const awardResults = AwardService.processSeasonAwards({
      seasonData, year: currentYear, allPlayers, teams, userTeamId: campaign.teamId,
    })
    AwardService.applyAwardsToPlayers(allPlayers, awardResults, currentYear)
    seasonAwards = awardResults

    // Record per-player All-Star awards (career count, year, team history).
    // Normally already done at selection time (mid-season, in stores/game.js);
    // this is an idempotent end-of-season safety net (guarded by
    // seasonData.allStarAwardsRecorded) for campaigns whose All-Star date was
    // crossed before mid-season recording existed. Mutated players are persisted
    // by the saveBulk below. Counts All-Star team selections only.
    const allStarRosters = seasonData?.allStarRosters?.allStars
    if (allStarRosters) {
      AllStarService.recordAllStarSelectionsForPlayers({
        seasonData,
        allPlayers,
        year: currentYear,
      })

      // Part 2: tally the user team's All-Star selections toward the GM
      // contract "Produce All-Stars" sub-task. This is now normally done at
      // selection time (mid-season, in stores/game.js) so the sub-task updates
      // immediately; this end-of-season call is an idempotent safety net for
      // campaigns whose All-Star date was crossed before mid-season tallying
      // existed. seasonData.allStarGmTallied guards against double counting —
      // in the normal flow it's already set and this is a no-op. Counts
      // All-Star team selections only (not Rising Stars, not All-League).
      const userTeamIdForAS = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id
      AllStarService.tallyUserAllStarsForGm({
        seasonData,
        gmContract: campaign.settings?.gmContract,
        userTeamId: userTeamIdForAS,
        year: currentYear,
      })
    }

    // Store awards on season data
    seasonData.seasonAwards = awardResults
    await SeasonRepository.save(seasonData)
  }

  // Save players with updated award counters
  await PlayerRepository.saveBulk(allPlayers.map(p => ({ ...p, campaignId })))

  // 2. Build team context map for motivation recalculation
  const standingsData = seasonData?.standings || { east: [], west: [] }
  const allStandingsEntries = [...(standingsData.east || []), ...(standingsData.west || [])]
  const playoffData = seasonData?.playoffs || null
  const playoffTeamIds = new Set()
  if (playoffData?.bracket) {
    // Collect all team IDs that appeared in the playoff bracket
    const collectBracketTeams = (bracket) => {
      if (!bracket) return
      for (const round of Object.values(bracket)) {
        if (Array.isArray(round)) {
          for (const series of round) {
            if (series.team1Id) playoffTeamIds.add(series.team1Id)
            if (series.team2Id) playoffTeamIds.add(series.team2Id)
          }
        }
      }
    }
    collectBracketTeams(playoffData.bracket.east)
    collectBracketTeams(playoffData.bracket.west)
  }
  const championTeamId = playoffData?.champion?.teamId ?? null

  const teamContextMap = {}
  for (const team of teams) {
    const abbr = team.abbreviation
    const standingsEntry = allStandingsEntries.find(s => s.teamId === team.id || s.team_id === team.id)
    const wins = standingsEntry?.wins ?? standingsEntry?.w ?? 0
    const losses = standingsEntry?.losses ?? standingsEntry?.l ?? 0
    const totalGames = wins + losses
    const teamRoster = allPlayers.filter(p => (p.teamAbbreviation ?? p.team_abbreviation) === abbr)

    teamContextMap[abbr] = {
      winPct: totalGames > 0 ? wins / totalGames : 0.5,
      madePlayoffs: playoffTeamIds.has(team.id),
      hasChampionship: team.id === championTeamId,
      marketSize: getMarketSize(abbr),
      coachStability: true, // TODO: track coach changes
      roster: teamRoster,
    }
  }

  // Process season end (aging, retirement, contract decrement, stat resets — injuries preserved)
  const seasonEndResult = processSeasonEnd(
    allPlayers,
    {},
    campaign.difficulty ?? 'pro',
    teamContextMap
  )

  // Save updated players (retired excluded)
  await PlayerRepository.saveBulk(
    seasonEndResult.players.map(p => ({ ...p, campaignId }))
  )

  // 3. Run AI roster management (cuts + re-signings + FA signings + backfill)
  const standings = seasonData?.standings || { east: [], west: [] }
  const userTeamId = campaign.teamId
  const aiTeams = teams.filter(t => t.id !== userTeamId)

  const aiContractResults = runAIRosterManagement({
    aiTeams,
    leaguePlayers: seasonEndResult.players,
    standings,
    allTeams: teams,
    seasonPhase: 'offseason',
    gameYear: campaign.gameYear ?? 1,
    // Offseason FA window handles re-signings & FA signings; only run cuts here.
    skipExtensions: true,
    skipSignings: true,
    skipBackfill: true,
  })

  // 4. All players with contract_years_remaining === 0 (not re-signed) → free agent
  let updatedPlayers = aiContractResults.updatedPlayers
  const releasedUserPlayers = []
  for (let i = 0; i < updatedPlayers.length; i++) {
    const p = updatedPlayers[i]
    if (p.teamId) {
      const years = p.contractYearsRemaining ?? p.contract_years_remaining ?? 0
      if (years === 0) {
        // Track user team players that are being released
        if (p.teamId === userTeamId) {
          releasedUserPlayers.push({
            id: p.id,
            name: p.name || `${p.firstName} ${p.lastName}`,
            position: p.position,
            overallRating: p.overallRating ?? p.overall_rating,
          })
        }
        updatedPlayers[i] = {
          ...p,
          isFreeAgent: 1,
          is_free_agent: 1,
          previousTeamId: p.teamId,
          previous_team_id: p.teamId,
          previousTeamAbbreviation: p.teamAbbreviation,
          previous_team_abbreviation: p.teamAbbreviation,
          teamId: null,
          team_id: null,
          teamAbbreviation: 'FA',
          team_abbreviation: 'FA',
        }
      }
    }
  }

  // 4b. Backfill is intentionally NOT run here — the offseason free-agency
  // window owns AI signings, and any team still short on bodies after the
  // window resolves will be filled in startNewSeason()'s safety-net backfill.

  // 4c. Retirement decisions — runs AFTER contract expiry/release so the
  // unsigned-FA factor in shouldRetire() can see who actually didn't get a
  // re-sign. Retirees are mutated in place (teamId cleared, contract zeroed,
  // isRetired flagged) and saved via the saveBulk below alongside the rest
  // of the league.
  const { retirees } = processRetirements(updatedPlayers, currentYear)
  if (retirees.length > 0) {
    updatedPlayers = updatedPlayers.map(p => {
      const retired = retirees.find(r => r.id === p.id)
      return retired ? retired : p
    })
  }

  // 4d. Prune retirees from the pool. Retired player objects have no UI
  // surface (the RetirementModal reads the denormalized pendingRetirements
  // snapshot stashed below), so keeping them only grows the players_fa sync
  // part and IndexedDB without bound (+~80/season). Their single-game records
  // are folded into the persistent settings.allTimeHighs board first, so the
  // All-Time records tab keeps them forever. The filter also sweeps any
  // pre-existing retirees (older saves, or rows resurrected by a stale cloud
  // pull), making the prune self-healing season over season.
  const prunedRetirees = updatedPlayers.filter(p => p.isRetired || p.is_retired)
  if (prunedRetirees.length > 0) {
    campaign.settings = campaign.settings ?? {}
    campaign.settings.allTimeHighs = mergeHighsBoards(
      campaign.settings.allTimeHighs ?? {},
      recomputeHighsLeaders(prunedRetirees, 'careerHighs'),
    )
    updatedPlayers = updatedPlayers.filter(p => !(p.isRetired || p.is_retired))
    await PlayerRepository.deleteBulk(campaignId, prunedRetirees.map(p => p.id))
    for (const p of prunedRetirees) {
      try {
        await PlayerHeadshotRepository.delete(campaignId, p.id)
      } catch { /* no headshot row — fine */ }
    }
  }

  await PlayerRepository.saveBulk(
    updatedPlayers.map(p => ({ ...p, campaignId }))
  )

  // 5. Update campaign phase
  campaign.phase = 'offseason'
  // Reset in-season deadlines for next season
  if (campaign.settings) {
    delete campaign.settings.trade_deadline_passed
    delete campaign.settings.resign_deadline_passed
    delete campaign.settings.trade_deadline_news_shown
    delete campaign.settings.deadline_warning_shown
    // Clear the prior cycle's draft lottery so THIS offseason runs a fresh one.
    // Without this, draftLotteryCompleted stays true season-over-season — the
    // lottery prompt is skipped and the mock board freezes at last year's order.
    delete campaign.settings.draftLottery
    delete campaign.settings.draftLotteryCompleted
  }

  // Stash retirement summaries for the offseason RetirementModal. The modal
  // reads from campaign.settings so the list survives a refresh. Cleared on
  // dismiss (CampaignHomeView sets retirementsDismissedYear).
  campaign.settings = campaign.settings ?? {}
  campaign.settings.pendingRetirements = retirees.map(r => ({
    id: r.id,
    name: r.name || `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
    position: r.position,
    age: r.age,
    overallRating: r.overallRating ?? r.overall_rating,
    primaryTeamAbbreviation: r.previousTeamAbbreviation,
    headshot: r.headshot ?? null,
    careerSeasons: r.retirementSummary?.careerSeasons ?? r.careerSeasons ?? r.career_seasons ?? 0,
    careerHighOvr: r.retirementSummary?.careerHighOvr,
    lastSeasonStats: r.retirementSummary?.lastSeasonStats,
  }))
  campaign.settings.pendingRetirementsYear = currentYear

  // ---------------------------------------------------------------------------
  // GM contract-end evaluation (Part 2). When the 4-year contract is up, the
  // owner judges the GM on overall wins (60%) + sub-tasks (40%) and decides
  // whether to extend. Stash the verdict for the offseason ContractDecisionModal
  // (mirrors the pendingRetirements stash + fire-once-by-year pattern). The
  // modal flow finalizes it (re-sign on extend, or team-switch if not).
  try {
    const gmc = campaign.settings.gmContract
    const userTeamId = campaign.teamId
    const userTeam = teams.find(t => t.id === userTeamId) ?? null
    const owner = findOwnerForTeam(userTeam?.abbreviation)
    if (owner) {
      // Final-standings record for the user team this season.
      const stEntry = allStandingsEntries.find(s => (s.teamId ?? s.team_id) === userTeamId)
      const currentWins = stEntry?.wins ?? stEntry?.w ?? 0
      const currentLosses = stEntry?.losses ?? stEntry?.l ?? 0

      // The LIVE (pre-update) expectation drives both the contract judgment and
      // the satisfaction blend; it's raised for next season further down.
      const eff = getEffectiveExpectation(campaign, owner)
      const effOwner = effectiveOwner(owner, eff.tier)

      // --- Contract-end evaluation (only when the 4-year deal is up) ---
      const signedYear = gmc?.signedSeasonYear ?? null
      const lengthYears = gmc?.lengthYears ?? 2
      const expired = signedYear != null && (currentYear - signedYear + 1) >= lengthYears
      if (gmc && gmc.status === 'active' && expired) {
        const userRoster = updatedPlayers.filter(p => p.teamId === userTeamId)
        const payroll = userRoster.reduce(
          (s, p) => s + (p.contractSalary ?? p.contract_salary ?? 0), 0
        )
        // Prior contract season (exclude the just-finished one to avoid double count).
        const hist = userTeam?.seasonHistory ?? userTeam?.season_history ?? []
        const lastSeason = (Array.isArray(hist) ? hist : [])
          .filter(h => (h.year ?? 0) !== currentYear)
          .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0] ?? null

        // THIS season's playoff outcome (its seasonHistory entry was written earlier
        // in this flow) — so a deep run / championship counts in the very year it
        // happens. A title fully satisfies the wins category despite a soft record.
        const curEntry = (Array.isArray(hist) ? hist : [])
          .find(h => (h.year ?? 0) === currentYear) ?? null
        const currentPlayoff = curEntry ? {
          champion: curEntry.champion === true,
          playoffResult: curEntry.playoffResult ?? null,
          playoffSeed: curEntry.playoffSeed ?? null,
          madePlayoffs: curEntry.playoffSeed != null || curEntry.madePlayoffs === true,
        } : null

        const subResult = evaluateSubtasks({
          owner,
          expectation: eff.tier,
          expectationTiers: gmc?.expectationTiers ?? [eff.tier],
          roster: userRoster,
          draftPicks: userTeam?.draftPicks ?? [],
          facilities: userTeam?.facilities ?? null,
          settings: campaign.settings,
          payroll,
          progress: gmc.progress ?? {},
          userTeamId,
          coach: userTeam?.coach ?? null,
          salaryCap: SALARY_CAP,
        })
        // Soften the win bar if the GM lost star talent to injury this season.
        const injuryRelief = injuryReliefWins({
          roster: userRoster,
          teamGames: currentWins + currentLosses,
          starPlayerIdsAtSign: gmc?.progress?.starPlayerIdsAtSign ?? [],
          currentYear,
        })
        const sat = combinedSatisfaction({
          owner: effOwner,
          expectedWins: eff.expectedWins,
          currentWins,
          currentLosses,
          lastSeason,
          currentPlayoff,
          injuryRelief,
          subtaskScore: subResult.subtaskScore,
        })

        // Patience tilts the bar: a ruthless owner (1) demands more, a patient
        // owner (5) forgives more.
        const patience = Math.max(1, Math.min(5, owner.patience ?? 3))
        const threshold = EXTEND_THRESHOLD + (3 - patience) * 5
        const decision = sat.value >= threshold ? 'extend' : 'not_extended'

        campaign.settings.pendingContractDecision = {
          decision,
          combined: sat.value,
          satisfactionLabel: sat.label,
          satisfactionColor: sat.color,
          winsSatisfaction: sat.winsSatisfaction,
          subtaskScore: sat.subtaskScore,
          threshold,
          ownerFirstName: owner.firstName,
          ownerLastName: owner.lastName,
          ownerName: `${owner.firstName} ${owner.lastName}`,
          expectation: eff.tier,
          expectationLabel: eff.label,
          subtasks: subResult.subtasks.map(t => ({
            id: t.id, label: t.label, met: t.met, global: !!t.global, progress: t.progress ?? null,
          })),
          metCount: subResult.metCount,
          total: subResult.total,
          year: currentYear,
          teamId: userTeamId,
          teamAbbreviation: userTeam?.abbreviation ?? gmc.teamAbbreviation,
          signedYear,
          lengthYears,
        }
        campaign.settings.pendingContractDecisionYear = currentYear
        // Lock the contract so this fires once; the modal flow re-activates it
        // (re-sign) or repoints the user to a new team (not extended).
        gmc.status = decision === 'extend' ? 'extend_offered' : 'expired'
      }

      // --- Raise the owner's expectation for NEXT season (every season; only
      // ratchets up). Fire-once-by-year so re-entry can't double-bump. ---
      if (campaign.settings.ownerExpectation?.lastEvaluatedYear !== currentYear) {
        const updated = updateOwnerExpectation(eff, currentWins)
        campaign.settings.ownerExpectation = {
          tier: updated.tier,
          expectedWins: updated.expectedWins,
          lastEvaluatedYear: currentYear,
        }
        // Append the new tier to the contract's history so its coach sub-tasks are
        // added on top of (not in place of) the ones already in progress.
        if (updated.tier && gmc) {
          const tiers = Array.isArray(gmc.expectationTiers) ? gmc.expectationTiers : [eff.tier]
          if (!tiers.includes(updated.tier)) tiers.push(updated.tier)
          gmc.expectationTiers = tiers
        }
      }
    }
  } catch (err) {
    console.warn('[CampaignManager] owner evaluation failed (non-fatal):', err?.message || err)
  }

  await CampaignRepository.save(campaign)

  return {
    campaign,
    seasonEndResult: seasonEndResult.results,
    news: seasonEndResult.news,
    aiContractResults: {
      cuts: aiContractResults.cuts,
      extensions: aiContractResults.extensions,
      signings: aiContractResults.signings,
    },
    releasedUserPlayers,
    seasonAwards,
    // Surfaced via toast + persisted onto campaign.achievements above.
    newAchievements,
    retirees: campaign.settings.pendingRetirements,
  }
}

/**
 * Build a fresh 4-year GM contract for `team`, seeding sub-task progress from the
 * given roster. Used by both re-sign (extension) and team-switch. The contract is
 * dated to the UPCOMING season (currentYear + 1) since this runs during the
 * offseason before startNewSeason bumps the year.
 *
 * `tenureStartYear` marks the season the GM first took over THIS team. A re-sign
 * passes the existing contract's value (continuation → "welcome back"); a team
 * switch passes the upcoming year (new owner → first meeting). Defaults to the
 * upcoming season when not supplied.
 */
function _buildFreshGmContract(team, userPlayers, currentYear, tenureStartYear = null, startTier = null) {
  const signedSeasonYear = currentYear + 1
  const baseTier = startTier ?? findOwnerForTeam(team.abbreviation)?.expectation ?? 'playoffs'
  return {
    teamId: team.id,
    teamAbbreviation: team.abbreviation,
    signedSeasonYear,
    tenureStartYear: tenureStartYear ?? signedSeasonYear,
    lengthYears: 4,
    status: 'active',
    // Fresh contract → fresh tier history (clean slate for this deal).
    expectationTiers: [baseTier],
    progress: {
      allStarAppearances: 0,
      badgesAdded: 0,
      starPlayerIdsAtSign: starPlayerIds(userPlayers),
      allStarCountedSeasons: [],
    },
  }
}

/**
 * Re-sign the user's GM contract with the SAME team after an extension offer
 * (Part 2 contract-decision flow). Resets the contract window + sub-task progress
 * and clears the pending decision. The +1 GM Level bump is handled by the caller
 * (auth store) so this stays free of profile concerns.
 *
 * @param {string} campaignId
 * @returns {Promise<{ campaign: object, gmContract: object }>}
 */
export async function resignGmContract(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  const currentYear = campaign.currentSeasonYear ?? 2025
  const userTeamId = campaign.teamId
  const [team, userPlayers] = await Promise.all([
    TeamRepository.get(campaignId, userTeamId),
    PlayerRepository.getByTeam(campaignId, userTeamId),
  ])
  campaign.settings = campaign.settings ?? {}
  // Re-sign = continuation with the SAME owner, so carry the existing tenure
  // start forward (falls back to the prior signed year, then the upcoming
  // season for older saves) instead of resetting it. This keeps the owner
  // check-in greeting a returning GM as a partner, not a brand-new hire.
  const priorContract = campaign.settings.gmContract ?? null
  const tenureStartYear =
    priorContract?.tenureStartYear ?? priorContract?.signedSeasonYear ?? (currentYear + 1)
  // Re-sign keeps the SAME owner and the ratcheted ownerExpectation persists, so the
  // fresh contract's tier history starts at the CURRENT (live) tier — not the static
  // baseline — keeping coach sub-tasks consistent with the standing mandate.
  const resignAbbr = team?.abbreviation ?? campaign.teamAbbreviation
  const resignTier = getEffectiveExpectation(campaign, findOwnerForTeam(resignAbbr)).tier
  campaign.settings.gmContract = _buildFreshGmContract(
    team ?? { id: userTeamId, abbreviation: campaign.teamAbbreviation },
    userPlayers ?? [],
    currentYear,
    tenureStartYear,
    resignTier
  )
  delete campaign.settings.pendingContractDecision
  delete campaign.settings.pendingContractDecisionYear
  await CampaignRepository.save(campaign)
  return { campaign, gmContract: campaign.settings.gmContract }
}

/**
 * Repoint the user-GM to a NEW team in the same campaign after the owner declined
 * to extend (Part 2). Inherits the new team's roster/coach/facilities, clears the
 * user's hired staff (fresh start), resets the user lineup, and signs a fresh
 * 4-year contract with the new owner. Tokens + GM Level (profile-global) are
 * untouched. The old team simply reverts to AI control.
 *
 * @param {string} campaignId
 * @param {string} newTeamAbbreviation
 * @returns {Promise<{ campaign: object, team: object }>}
 */
export async function switchUserTeam(campaignId, newTeamAbbreviation) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const newTeam = teams.find(t => t.abbreviation === newTeamAbbreviation)
  if (!newTeam) throw new Error(`Team ${newTeamAbbreviation} not found in campaign`)
  const currentYear = campaign.currentSeasonYear ?? 2025

  // Repoint the user to the new franchise.
  campaign.teamId = newTeam.id
  campaign.teamAbbreviation = newTeam.abbreviation
  campaign.settings = campaign.settings ?? {}

  // Reset hired staff — fresh start with the new owner (tokens + GM Level live on
  // the profile and are untouched).
  delete campaign.settings.scout
  delete campaign.settings.trainer
  delete campaign.settings.staff_trainer
  delete campaign.settings.analyst

  // Fresh user lineup from the inherited roster.
  const userPlayers = await PlayerRepository.getByTeam(campaignId, newTeam.id)
  const userStarters = initializeUserTeamLineup(userPlayers ?? [])
  const userTargetMinutes = generateAITargetMinutes(userPlayers ?? [], userStarters, 'staggered')
  campaign.settings.lineup = {
    starters: userStarters,
    target_minutes: userTargetMinutes,
    rotation: [],
  }

  // New 4-year GM contract with the new owner.
  campaign.settings.gmContract = _buildFreshGmContract(newTeam, userPlayers ?? [], currentYear)
  delete campaign.settings.pendingContractDecision
  delete campaign.settings.pendingContractDecisionYear

  // Reset owner expectation to the NEW owner's baseline (it ratchets up over
  // future seasons). Otherwise the prior franchise's expectation would carry
  // over and the new owner's welcome / check-in would state the wrong mandate.
  const newOwner = findOwnerForTeam(newTeam.abbreviation)
  if (newOwner) campaign.settings.ownerExpectation = initOwnerExpectation(newOwner)
  else delete campaign.settings.ownerExpectation

  // Clear the new-job welcome marker so the new owner's welcome fires once.
  delete campaign.settings.ownerWelcomeShownKey

  await CampaignRepository.save(campaign)
  return { campaign, team: newTeam }
}

/**
 * Start a new season after the offseason period.
 * Releases any remaining expired-contract players and initializes the new season.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} { campaign, seasonData, gamesCreated, releasedPlayers }
 */
export async function startNewSeason(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Accept the legacy 'offseason' marker plus the new sub-phases
  // ('offseason_free_agency', 'offseason_draft') so a manual draft completion
  // doesn't strand the campaign in 'offseason_draft'.
  const allowedPhases = new Set(['offseason', 'offseason_free_agency', 'offseason_draft'])
  if (!allowedPhases.has(campaign.phase)) {
    throw new Error('Campaign must be in offseason phase to start a new season')
  }

  // Required-coach gate: the user must have a head coach signed before any
  // new season can begin. The button in CampaignHomeView is also disabled in
  // this state; this throw is the backstop.
  const userTeamForCoachCheck = await TeamRepository.get(campaignId, campaign.teamId)
  if (!userTeamForCoachCheck?.coach) {
    throw new Error('You must sign a head coach before starting a new season.')
  }

  const currentYear = campaign.currentSeasonYear ?? 2025
  const nextYear = currentYear + 1

  // 1. Release un-re-signed expired contracts (including user team)
  let allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  const releasedPlayers = []

  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i]
    const years = p.contractYearsRemaining ?? p.contract_years_remaining ?? 1
    if (years === 0 && p.teamId) {
      releasedPlayers.push({
        id: p.id,
        name: p.name || `${p.firstName} ${p.lastName}`,
        teamId: p.teamId,
        teamAbbreviation: p.teamAbbreviation,
      })
      allPlayers[i] = {
        ...p,
        isFreeAgent: 1,
        is_free_agent: 1,
        teamId: null,
        team_id: null,
        teamAbbreviation: 'FA',
        team_abbreviation: 'FA',
      }
    }
  }

  // 1b. Backfill AI teams to 14 players after expired-contract releases
  const teams0 = await TeamRepository.getAllForCampaign(campaignId)
  const userTeamId0 = campaign.teamId
  const aiTeams0 = teams0.filter(t => t.id !== userTeamId0)
  const backfillResult = ensureMinimumRosters({
    aiTeams: aiTeams0,
    leaguePlayers: allPlayers,
  })
  allPlayers = backfillResult.updatedPlayers

  await PlayerRepository.saveBulk(
    allPlayers.map(p => ({ ...p, campaignId }))
  )

  // 2. Update campaign to next season
  campaign.gameYear = (campaign.gameYear ?? 1) + 1
  campaign.game_year = campaign.gameYear // keep the snake-case mirror in sync (campaign-card "Year N")
  campaign.currentSeasonYear = nextYear
  campaign.currentDate = `${nextYear}-10-21`
  campaign.phase = 'regular_season'

  // 3. Load current teams and re-read players (may have changed during offseason)
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 3b. Degrade ONLY the user's current team's facilities by 1 (min 1) each
  // season. AI teams keep their facilities. After a team switch, campaign.teamId
  // already points at the NEW team, so the new team starts degrading and the
  // former user team (now an AI team) stops — automatically.
  const userTeam = teams.find(t => t.id === campaign.teamId)
  const userTeamFacilitiesBefore = userTeam?.facilities ? { ...userTeam.facilities } : {}
  if (userTeam?.facilities) {
    for (const key of ['training', 'medical', 'scouting', 'analytics']) {
      if (userTeam.facilities[key] > 1) {
        userTeam.facilities[key] = userTeam.facilities[key] - 1
      }
    }
  }
  const userTeamFacilitiesAfter = userTeam?.facilities ? { ...userTeam.facilities } : {}

  // 3b-bis. Reset per-play-set analytics for every team — analytics are
  // season-scoped and restart from the new season's games only.
  for (const team of teams) {
    team.playAnalytics = { season: nextYear, plays: {} }
  }

  await TeamRepository.saveBulk(teams)

  // 3c. Reset scouting points and scouted players for the new season
  campaign.settings = campaign.settings ?? {}
  campaign.settings.scoutingPoints = 0
  campaign.settings.lastScoutingBiweek = 0
  campaign.settings.scoutedPlayers = {}

  // 3c-bis. Clear any unviewed retirement list from the offseason that just
  // ended. Belt-and-suspenders alongside the modal's own dismissal — if the
  // user closed the tab without clicking Continue, the next regular season
  // shouldn't re-pop last year's modal.
  campaign.settings.pendingRetirements = []

  // 3d. Decrement scout contract (2-season contracts)
  if (campaign.settings.scout) {
    campaign.settings.scout.contractYears -= 1
    if (campaign.settings.scout.contractYears <= 0) {
      delete campaign.settings.scout
    }
  }

  // 3d-bis. Decrement analyst contract (2-season contracts), same as scout.
  if (campaign.settings.analyst) {
    campaign.settings.analyst.contractYears -= 1
    if (campaign.settings.analyst.contractYears <= 0) {
      delete campaign.settings.analyst
    }
  }

  // 3e. HEAD-COACH LIFECYCLE — aging→retirement (applies to EVERYONE incl. the
  //     user), AI fire/extend/retain decisions (AI-only; the user keeps manual
  //     hire/fire/resign), and filling AI vacancies from the shared pool. Fired
  //     and let-walk coaches return to `availableCoaches` so any team (incl. the
  //     user) can hire them — coaches are persistent objects that live in exactly
  //     one place: a team, or the pool.
  const userTeamIdForCoach = campaign.teamId
  const coachNewsDate = `${currentYear}-07-01`
  const coachNews = []
  let coachPool = campaign.settings.availableCoaches ?? []

  // Just-completed season records + playoff depth for the evaluation blend.
  const prevSeasonData = await SeasonRepository.get(campaignId, currentYear)
  const prevStandings = prevSeasonData?.standings ?? { east: [], west: [] }
  const { depthByTeamId: coachPlayoffDepth, playoffTeamIds: coachPlayoffTeams } =
    derivePlayoffDepth(prevSeasonData?.playoffBracket ?? null)
  const coachWinsByTeam = {}
  for (const s of [...(prevStandings.east || []), ...(prevStandings.west || [])]) {
    const tid = s.teamId ?? s.team_id
    if (tid != null) coachWinsByTeam[tid] = s.wins ?? 0
  }
  const coachContext = buildContext({ standings: prevStandings, teams, seasonPhase: 'regular_season' })
  const coachRostersByTeam = new Map()
  for (const p of allPlayers) {
    const tid = p.teamId ?? p.team_id
    if (tid == null) continue
    if (!coachRostersByTeam.has(tid)) coachRostersByTeam.set(tid, [])
    coachRostersByTeam.get(tid).push(p)
  }
  // User team carries its live (dynamic) owner expectation so its coach-facing
  // direction matches how the franchise is actually trending.
  const _coachUserTeam = teams.find(t => t.id === campaign.teamId)
  const _coachUserTier = _coachUserTeam
    ? getEffectiveExpectation(campaign, findOwnerForTeam(_coachUserTeam.abbreviation)).tier
    : null
  const directionForTeam = (team) => {
    const t = (_coachUserTier && team.id === campaign.teamId)
      ? { ...team, effectiveExpectation: _coachUserTier }
      : team
    return analyzeTeamDirection(t, coachRostersByTeam.get(team.id) ?? [], coachContext)
  }

  // Return-to-pool shape: stamp a hireCost from tier, drop per-team-only fields.
  const releaseToPool = (coach) => {
    const { actionsRemaining, trainActionsRemaining, activeTraining, hiredSeason, seasonsWithTeam, ...rest } = coach
    return { ...rest, hireCost: FREE_AGENT_COACH_TIERS[getCoachTierKey(coach)].hireCost }
  }
  // Hire shape: drop hireCost, give a fresh contract + reset per-season budgets.
  const hydrateHire = (candidate) => {
    const { hireCost: _drop, ...rest } = candidate
    const term = randInt(3, 4)
    const c = { ...rest, hiredSeason: nextYear, seasonsWithTeam: 0, activeTraining: null, contractYearsRemaining: term, contract_years_remaining: term }
    c.actionsRemaining = getCoachActionBudget(c)
    c.trainActionsRemaining = getCoachTrainBudget(c)
    return c
  }
  const refillBudgets = (coach) => {
    coach.actionsRemaining = getCoachActionBudget(coach)
    coach.trainActionsRemaining = getCoachTrainBudget(coach)
  }

  // (0) Seed existing-campaign coaches that pre-date the lifecycle fields. Coaches
  //     generated before `age`/`seasonsWithTeam` existed get a one-time backfill
  //     here (idempotent — only fills what's missing) so they don't all read as
  //     the same default age and retire in lockstep. Age is anchored to how long
  //     they've coached so veterans read older. New coaches already carry `age`.
  const _coachSeasons = (c) => c?.career_stats?.seasons_coached ?? c?.seasons_coached ?? 0
  const _seedCoachFields = (c) => {
    if (!c) return
    if (c.age == null) c.age = Math.max(40, Math.min(68, 46 + _coachSeasons(c) + randInt(-2, 2)))
    if (c.seasonsWithTeam == null) c.seasonsWithTeam = Math.max(1, Math.min(_coachSeasons(c), 6))
  }
  for (const t of teams) if (t.coach) _seedCoachFields(t.coach)
  for (const c of coachPool) _seedCoachFields(c)

  // (1) Age all coaches (employed + pool) and process retirements.
  const employedEntries = teams.filter(t => t.coach).map(t => ({ teamId: t.id, coach: t.coach }))
  const { retiredEmployed, retiredPooledIds } = ageCoachesAndRetire({
    employed: employedEntries,
    pooled: coachPool,
  })
  coachPool = coachPool.filter(c => !retiredPooledIds.has(c.id))
  for (const { teamId, coach } of retiredEmployed) {
    const team = teams.find(t => t.id === teamId)
    if (team) team.coach = null
    coachNews.push(BreakingNewsService.coachRetired({ coachName: coach.name, teamName: team?.name ?? '', date: coachNewsDate }))
  }

  // (2) Contract decrement + AI fire/extend/retain. User team is manual-only.
  for (const team of teams) {
    if (!team.coach) continue
    const coach = team.coach
    const yearsLeft = (coach.contractYearsRemaining ?? coach.contract_years_remaining ?? 1) - 1

    if (team.id === userTeamIdForCoach) {
      if (yearsLeft <= 0) {
        // Contract up. Don't silently drop the coach — stash it + flag a pending
        // decision so the campaign home can prompt the user to re-sign (at the
        // resign cost) or hire a replacement. Coach is still cleared off the team
        // so an ignored prompt doesn't grant a free season of coaching.
        campaign.settings = campaign.settings ?? {}
        campaign.settings.pendingCoachDecision = {
          coach: { ...coach },
          resignCost: getCoachResignCost(coach),
          year: campaign.currentSeasonYear,
          teamId: userTeamIdForCoach,
        }
        team.coach = null
      } else {
        coach.contractYearsRemaining = yearsLeft
        coach.contract_years_remaining = yearsLeft
        refillBudgets(coach)
      }
      continue
    }

    const direction = directionForTeam(team)
    const { decision, reason } = evaluateCoachDecision({
      direction,
      actualWins: coachWinsByTeam[team.id] ?? 0,
      expectedWins: expectedWinsForDirection(direction),
      seasonHistory: team.seasonHistory ?? [],
      madePlayoffs: coachPlayoffTeams.has(team.id),
      playoffResult: coachPlayoffDepth[team.id] ?? null,
      contractYearsLeft: yearsLeft,
      seasonsWithTeam: coach.seasonsWithTeam ?? 1,
    })

    if (decision === 'fire') {
      coachPool.push(releaseToPool(coach))
      team.coach = null
      coachNews.push(BreakingNewsService.coachFired({ coachName: coach.name, teamName: team.name, reason, date: coachNewsDate }))
    } else if (decision === 'extend') {
      const term = randInt(3, 4)
      coach.contractYearsRemaining = term
      coach.contract_years_remaining = term
      coach.seasonsWithTeam = (coach.seasonsWithTeam ?? 1) + 1
      refillBudgets(coach)
      coachNews.push(BreakingNewsService.coachExtended({ coachName: coach.name, teamName: team.name, date: coachNewsDate }))
    } else { // retain
      const keep = Math.max(1, yearsLeft)
      coach.contractYearsRemaining = keep
      coach.contract_years_remaining = keep
      coach.seasonsWithTeam = (coach.seasonsWithTeam ?? 1) + 1
      refillBudgets(coach)
    }
  }

  // (3) Fill AI vacancies from the pool (the user hires manually during offseason).
  for (const team of teams) {
    if (team.coach || team.id === userTeamIdForCoach) continue
    const direction = directionForTeam(team)
    let hired = selectCoachForVacancy({ direction, pool: coachPool })
    if (hired) {
      coachPool = coachPool.filter(c => c.id !== hired.id)
    } else {
      // Pool exhausted — generate a fresh first-time coach.
      const usedNames = new Set(teams.filter(t => t.coach?.name).map(t => t.coach.name))
      hired = generateFreeAgentCoach('good', usedNames, null)
    }
    team.coach = hydrateHire(hired)
    coachNews.push(BreakingNewsService.coachHired({ coachName: team.coach.name, teamName: team.name, date: coachNewsDate }))
  }

  // 3f. Top up the free-agent coach pool back to its tier targets (and cap it so
  //     accumulated fired coaches don't let it balloon over the seasons).
  campaign.settings.availableCoaches = topUpCoachPool(coachPool, teams)
  campaign.settings.pendingCoachChanges = coachNews

  // 4. Initialize new season (schedule + standings)
  const seasonData = SeasonManager.initializeSeason(teams, nextYear, campaignId)
  const userTeamId = campaign.teamId
  const gamesCreated = SeasonManager.generateSchedule(
    seasonData, teams, userTeamId, nextYear, `${nextYear}-10-21`
  )

  await SeasonRepository.save({
    campaignId,
    year: nextYear,
    ...seasonData,
  })

  // 5. Generate next year's rookie class (viewable on Scouting page throughout
  //    the season). draftYear = season year they'll first play (nextYear + 1),
  //    since they're drafted at the end of nextYear's season.
  {
    const draftYear = nextYear + 1
    const includeGenerational = shouldGenerateGenerational(campaign, draftYear)
    await generateAndSaveRookieClass(campaignId, draftYear, { includeGenerational })
    if (includeGenerational) {
      campaign.settings = campaign.settings ?? {}
      campaign.settings.lastGenerationalDraftYear = draftYear
    }
  }

  // 6. Re-initialize all team lineups + target minutes, and refresh coaching
  // schemes. AI teams ALWAYS get a fresh scheme picked by CoachStrategyService
  // (so trades and draft picks during the offseason actually shift their
  // play style). The user team only gets auto-init when the stored scheme
  // is missing or invalid — manual selections in the Coach Settings tab
  // are preserved across seasons.
  const userTeamIdForScheme = campaign.teamId
  for (const team of teams) {
    const teamPlayers = allPlayers.filter(p => p.teamId === team.id)
    if (teamPlayers.length === 0) continue
    const { starters, subStrategy } = initializeTeamLineup(teamPlayers)
    const targetMinutes = generateAITargetMinutes(teamPlayers, starters, subStrategy)
    team.lineup_settings = {
      starters,
      subStrategy,
      target_minutes: targetMinutes,
    }

    const isUserTeam = team.id === userTeamIdForScheme
    const shouldReplaceScheme = !isUserTeam || !isCoachingSchemeValid(team.coaching_scheme)
    if (shouldReplaceScheme) {
      const schemeFit = selectBestCoachingScheme(teamPlayers, team.coach, team.coaching_scheme)
      team.coaching_scheme = {
        offensive: schemeFit.offensive,
        defensive: schemeFit.defensive,
        substitution: subStrategy,
      }
    } else {
      // User kept their selections — just refresh sub strategy from the
      // newly-computed lineup so it tracks lineup changes.
      team.coaching_scheme = {
        ...team.coaching_scheme,
        substitution: team.coaching_scheme.substitution || subStrategy,
      }
    }
  }
  await TeamRepository.saveBulk(teams)

  // Re-initialize user lineup
  const userPlayers = allPlayers.filter(p => p.teamId === userTeamId)
  if (userPlayers.length > 0) {
    const userStarters = initializeUserTeamLineup(userPlayers)
    const userTargetMinutes = generateAITargetMinutes(userPlayers, userStarters, 'staggered')
    campaign.settings = campaign.settings ?? {}
    campaign.settings.lineup = {
      starters: userStarters,
      target_minutes: userTargetMinutes,
      rotation: [],
    }
  }

  // 7. Save campaign
  await CampaignRepository.save(campaign)

  return {
    campaign,
    seasonData,
    gamesCreated,
    releasedPlayers,
    facilitiesBefore: userTeamFacilitiesBefore,
    facilitiesAfter: userTeamFacilitiesAfter,
    coachCarousel: coachNews,
  }
}

// =============================================================================
// TEAM + COACH GENERATION
// =============================================================================

/**
 * Generate all 30 teams with coaches for a campaign.
 * Each team gets an ID, coach data, and default financial info.
 *
 * @param {string} campaignId
 * @param {Object} [modes] - Optional pre-rolled `{abbreviation: campaignMode}`
 *   map. When provided, coach tier is derived from the team's campaignMode
 *   instead of the static TEAM_TIERS table — prevents elite teams from
 *   double-stacking elite coaches every campaign.
 * @returns {Array} Array of 30 team objects ready for IndexedDB
 */
export function generateTeams(campaignId, modes = null) {
  const usedCoachNames = new Set()

  const teams = TEAMS.map((template, index) => {
    const teamId = generateUUID()
    // Prefer the campaignMode-driven coach tier when modes were pre-rolled
    // by the caller. Fall back to the legacy static TEAM_TIERS lookup only
    // when no modes are supplied (e.g. tests or callers that haven't migrated).
    const tier = modes
      ? (MODE_TO_COACH_TIER[modes[template.abbreviation]] ?? 3)
      : getTeamTier(template.abbreviation)

    // Generate coach for this team. Pass the team's abbreviation so the coach
    // generator can look up a master-defined coach in coaches.js (carries
    // identity fields like name, headshot, starter badges). Teams with no
    // master entry fall back to a randomly-named coach.
    const coach = generateCoach(tier, index, usedCoachNames, template?.abbreviation)

    return {
      campaignId,
      id: teamId,
      name: template.name,
      city: template.city,
      abbreviation: template.abbreviation,
      conference: template.conference,
      division: template.division,
      primary_color: template.primary_color,
      secondary_color: template.secondary_color,
      facilities: template.facilities,
      salaryCap: SALARY_CAP,
      salary_cap: SALARY_CAP,
      totalPayroll: 0,
      total_payroll: 0,
      luxuryTaxBill: 0,
      luxury_tax_bill: 0,
      coach,
      lineup_settings: null,
      coaching_scheme: {
        offensive: coach.offensiveScheme,
        defensive: coach.defensiveScheme,
        substitution: 'staggered',
      },
      updatedAt: new Date().toISOString(),
    }
  })

  // Coaches alone here — scout/physician/staff_trainer pools are generated
  // by generateCampaign() one level up, after all teams exist. Headshot
  // assignment happens there too so the priority distribution can see every
  // personnel kind at once.
  return teams
}

/**
 * Generate a hire pool for a non-coach personnel kind (scout / physician /
 * staff_trainer). Mirrors the modal generators' shape so HireXModal can
 * read this pool directly. Each candidate gets a stable id so the headshot
 * editor and IDB-based custom edits can target them.
 *
 * @param {'scout'|'physician'|'staff_trainer'} kind
 * @returns {Array} pool of candidate objects
 */
function generatePersonnelPool(kind) {
  const tiers = kind === 'scout' ? SCOUT_TIERS
    : kind === 'physician' ? PHYSICIAN_TIERS
    : kind === 'analyst' ? ANALYST_TIERS
    : STAFF_TRAINER_TIERS
  const counts = PERSONNEL_POOL_COUNTS[kind] || {}
  const used = new Set()
  const pool = []

  function randomName() {
    let name
    do {
      const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
      const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
      name = `${first} ${last}`
    } while (used.has(name))
    used.add(name)
    return name
  }

  for (const tierKey of Object.keys(counts)) {
    const tierNum = Number(tierKey)
    const tier = tiers[tierNum]
    if (!tier) continue
    for (let i = 0; i < counts[tierKey]; i++) {
      pool.push({
        id: generateUUID(),
        name: randomName(),
        tier: tierNum,
        cost: tier.cost,
        label: tier.label,
        rating: tier.rating,
        perks: tier.perks,
        headshot: null,    // filled in by assignPersonnelHeadshots below
      })
    }
  }
  return pool
}

/**
 * Distribute admin-authored coach-headshots files across every personnel
 * kind that exists at campaign creation: coaches first, then scouts, then
 * physicians, then staff trainers. Within each group, master/curated
 * filenames are excluded from the shared pool so they can't end up
 * doubled-up. Shuffled order; cycles with repetition when the pool is
 * smaller than total demand. Pool allowed to be empty — those personnel
 * stay headshot-less and their avatars fall back to the UserCog icon.
 *
 * @param {Array} teams - generated team list (every team.coach gets a turn)
 * @param {Object} pools - { scout, physician, staff_trainer } pool arrays
 */
function assignPersonnelHeadshots(teams, pools) {
  // Filenames already claimed by master coaches — keep them out of the
  // random pool so a master portrait can't be re-used by a free-agent coach
  // or a scout/physician/trainer.
  const masterUsed = new Set(
    teams
      .map(t => t?.coach?.headshot)
      .filter(Boolean)
      .map(s => String(s).toLowerCase()),
  )
  const allFiles = listCoachHeadshots().filter(name => !masterUsed.has(name.toLowerCase()))
  if (allFiles.length === 0) return

  const shuffled = [...allFiles]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Distribute in priority order, cycling through `shuffled` when demand
  // exceeds supply so every personnel slot still gets a face.
  let cursor = 0
  const claim = () => {
    const file = shuffled[cursor % shuffled.length]
    cursor++
    return file
  }

  // 1) Coaches (one per team, skip masters which already have a face).
  for (const team of teams) {
    if (!team?.coach) continue
    if (team.coach.headshot) continue
    team.coach.headshot = claim()
  }
  // 2) Scouts, 3) Physicians, 4) Staff trainers, 5) Analysts — pool order.
  for (const kind of ['scout', 'physician', 'staff_trainer', 'analyst']) {
    for (const candidate of (pools[kind] || [])) {
      candidate.headshot = claim()
    }
  }
}

/**
 * Generate a coach for a team.
 *
 * @param {number} tier - Team tier (1-4)
 * @param {number} index - Team index for name assignment
 * @param {Set} usedNames - Set of already-used "first last" name strings
 * @returns {Object} Coach object
 */
/**
 * Random head-coach age. Clusters in the prime 45–60 band with rare young
 * up-and-comers and older veterans. Age never degrades attributes — it only
 * drives retirement in CoachLifecycleService.
 */
function generateCoachAge() {
  const r = Math.random()
  if (r < 0.10) return randInt(36, 44)   // young up-and-comer
  if (r < 0.80) return randInt(45, 60)   // prime
  if (r < 0.95) return randInt(61, 66)   // veteran
  return randInt(67, 70)                 // elder
}

function generateCoach(tier, index, usedNames, teamAbbreviation = null) {
  // If a master coach is defined for this team in coaches.js, use their
  // identity (name, headshot, starter badges) verbatim — that's the override
  // path for hand-curated coach personas. Otherwise fall back to the
  // scrambled FIRST_NAMES / LAST_NAMES pool (same fictional-name pool used
  // for players) so generated coaches don't ship real-world identities.
  const masterCoach = findCoachForTeam(teamAbbreviation)

  // Prefer the master entry's authored overall / attributes when present so the
  // set coach is fully deterministic (and the campaign-create modal can preview
  // exactly what gets generated). Teams without a master entry — and free agents
  // — keep the tier-driven random roll.
  const range = COACH_TIER_RANGES[tier] ?? COACH_TIER_RANGES[3]
  const overall = masterCoach?.overall ?? randInt(range[0], range[1])
  const attributes = masterCoach?.attributes
    ? { ...masterCoach.attributes }
    : generateCoachAttributes(overall)
  const salary = calculateCoachSalary(overall)
  const offensiveScheme = pickRandom(Object.keys(OFFENSIVE_SCHEMES))
  const defensiveScheme = pickRandom(Object.keys(DEFENSIVE_SCHEMES))

  let firstName, lastName, fullName
  if (masterCoach) {
    firstName = masterCoach.firstName
    lastName = masterCoach.lastName
    fullName = `${firstName} ${lastName}`
    usedNames.add(fullName)
  } else {
    let attempts = 0
    do {
      firstName = FIRST_NAMES[(index + attempts) % FIRST_NAMES.length]
      lastName = LAST_NAMES[(index + attempts) % LAST_NAMES.length]
      fullName = `${firstName} ${lastName}`
      attempts++
    } while (usedNames.has(fullName) && attempts < 100)
    usedNames.add(fullName)
  }

  // Master-seeded badges. Master entries carry `{ id, level }` (matching the
  // player-badge shape). Bare strings are accepted as a shorthand and default
  // to 'bronze'. Each is tagged source: 'master' so we can distinguish them
  // from purchased badges later.
  const masterBadgeEntries = Array.isArray(masterCoach?.badges) ? masterCoach.badges : []
  const seededBadges = masterBadgeEntries.map(entry => {
    if (typeof entry === 'string') {
      return { id: entry, level: 'bronze', source: 'master' }
    }
    return {
      id: entry.id,
      level: entry.level ?? 'bronze',
      source: 'master',
    }
  })

  // Master-seeded headshot filename (e.g. 'gregg_popovich.png'). Maps to a
  // file dropped into frontend/src/assets/coach-headshots/. CoachAvatar falls
  // back to the UserCog icon when the file isn't present. Coaches without
  // a master headshot get one assigned by the post-pass below in
  // assignCoachHeadshots() — after all teams have been generated so the
  // shuffle can spread the pool across every unassigned coach at once.
  const headshot = masterCoach?.headshot ?? null

  const contractYears = randInt(1, 4)
  const coach = {
    id: generateUUID(),
    firstName,
    lastName,
    name: fullName,
    age: generateCoachAge(),
    overallRating: overall,
    overall_rating: overall,
    attributes,
    offensiveScheme,
    offensive_scheme: offensiveScheme,
    defensiveScheme,
    defensive_scheme: defensiveScheme,
    contractYearsRemaining: contractYears,
    contract_years_remaining: contractYears,
    contractSalary: salary,
    contract_salary: salary,
    headshot,
    badges: seededBadges,
    // Career stats start at zero
    career_wins: 0,
    career_losses: 0,
    playoff_wins: 0,
    playoff_losses: 0,
    championships: 0,
    conference_titles: 0,
    seasons_coached: 0,
  }
  // Stamp the canonical tier so downstream lookups (action budget, hire cost,
  // UI badges) don't have to re-infer from OVR+badges every read.
  coach.tier = computeCoachTier(coach)
  return coach
}

// =============================================================================
// FREE-AGENT COACH POOL
// =============================================================================

/**
 * Generate a single free-agent coach for the user-facing hire pool. Mirrors
 * generateCoach but draws OVR / badge counts from the tier config in
 * coaches.js and stamps a `hireCost` so the modal can paywall premium tiers.
 *
 * @param {string} tierKey   - 'free' | 'good' | 'really_good'
 * @param {Set} usedNames    - mutated with the chosen "First Last"
 * @param {Object|null} masterCandidate - optional master-list entry whose
 *   identity (name, headshot, badges) should override random gen
 * @returns {Object} coach object with hireCost
 */
function generateFreeAgentCoach(tierKey, usedNames, masterCandidate = null) {
  const tierConfig = FREE_AGENT_COACH_TIERS[tierKey]
  if (!tierConfig) throw new Error(`Unknown free-agent coach tier: ${tierKey}`)

  const overall = randInt(tierConfig.overallRange[0], tierConfig.overallRange[1])
  const attributes = generateCoachAttributes(overall)
  const salary = calculateCoachSalary(overall)
  const offensiveScheme = pickRandom(Object.keys(OFFENSIVE_SCHEMES))
  const defensiveScheme = pickRandom(Object.keys(DEFENSIVE_SCHEMES))

  let firstName, lastName, fullName
  let seededBadges = []
  let headshot = null

  if (masterCandidate) {
    firstName = masterCandidate.firstName
    lastName = masterCandidate.lastName
    fullName = `${firstName} ${lastName}`
    headshot = masterCandidate.headshot ?? null
    const masterBadgeEntries = Array.isArray(masterCandidate.badges) ? masterCandidate.badges : []
    seededBadges = masterBadgeEntries.map(entry => {
      if (typeof entry === 'string') {
        return { id: entry, level: 'bronze', source: 'master' }
      }
      return { id: entry.id, level: entry.level ?? 'bronze', source: 'master' }
    })
    usedNames.add(fullName)
  } else {
    let attempts = 0
    do {
      // Same scrambled fictional pool used by player generation — keeps
      // free-agent coaches off the real-name list when no master candidate
      // is supplied.
      firstName = pickRandom(FIRST_NAMES)
      lastName = pickRandom(LAST_NAMES)
      fullName = `${firstName} ${lastName}`
      attempts++
    } while (usedNames.has(fullName) && attempts < 100)
    usedNames.add(fullName)

    // Random badge generation per tier
    const badgeCount = randInt(tierConfig.minBadges, tierConfig.maxBadges)
    if (badgeCount > 0 && tierConfig.badgeLevels.length > 0) {
      const badgeOptions = [...coachBadges].sort(() => Math.random() - 0.5)
      for (let i = 0; i < badgeCount && i < badgeOptions.length; i++) {
        seededBadges.push({
          id: badgeOptions[i].id,
          level: pickRandom(tierConfig.badgeLevels),
          source: 'generated',
        })
      }
    }
  }

  return {
    id: generateUUID(),
    firstName,
    lastName,
    name: fullName,
    age: generateCoachAge(),
    overallRating: overall,
    overall_rating: overall,
    attributes,
    offensiveScheme,
    offensive_scheme: offensiveScheme,
    defensiveScheme,
    defensive_scheme: defensiveScheme,
    contractSalary: salary,
    contract_salary: salary,
    headshot,
    badges: seededBadges,
    // Tier is authoritative for free-agent coaches — the generator picks an
    // OVR + badge set from this tier's config, so we record the tier directly
    // rather than re-inferring it from the score.
    tier: tierKey,
    hireCost: tierConfig.hireCost,
    career_stats: {
      wins: 0,
      losses: 0,
      playoff_wins: 0,
      playoff_losses: 0,
      championships: 0,
      conference_titles: 0,
      seasons_coached: 0,
    },
  }
}

/**
 * Build the initial free-agent coach pool. Master-list coaches whose `team`
 * abbreviation isn't currently assigned to any team are inserted into the tier
 * matching their badge count first; remaining slots are random-generated.
 *
 * @param {Array} teams - generated team list (post-generateTeams)
 * @returns {Array} pool of FREE_AGENT_POOL_SIZE coach objects
 */
function generateCoachPool(teams) {
  const usedNames = new Set()
  for (const team of teams) {
    if (team.coach?.name) usedNames.add(team.coach.name)
  }

  const assignedAbbreviations = new Set(teams.map(t => t.abbreviation))
  const unassignedMasters = COACHES.filter(c => !assignedAbbreviations.has(c.team))

  // Bucket unassigned masters by their natural tier (badge count)
  const masterByTier = { free: [], good: [], really_good: [] }
  for (const m of unassignedMasters) {
    masterByTier[masterCoachTier(m)].push(m)
  }

  const pool = []
  for (const tierKey of ['free', 'good', 'really_good']) {
    const tierConfig = FREE_AGENT_COACH_TIERS[tierKey]
    for (let i = 0; i < tierConfig.count; i++) {
      const master = masterByTier[tierKey].shift() ?? null
      pool.push(generateFreeAgentCoach(tierKey, usedNames, master))
    }
  }
  return pool
}

/**
 * Refill an existing pool back to the per-tier counts. Existing entries are
 * preserved (so users see a stable list); only missing slots are generated.
 * Called from enterOffseason after coaches have been hired or expired.
 *
 * @param {Array} existingPool - current campaign.settings.availableCoaches
 * @param {Array} teams        - all teams (for name-collision avoidance)
 * @returns {Array} updated pool padded to FREE_AGENT_POOL_SIZE entries
 */
function topUpCoachPool(existingPool, teams) {
  const counts = { free: 0, good: 0, really_good: 0 }
  for (const c of existingPool || []) {
    if (c.hireCost === 0) counts.free++
    else if (c.hireCost === FREE_AGENT_COACH_TIERS.good.hireCost) counts.good++
    else if (c.hireCost === FREE_AGENT_COACH_TIERS.really_good.hireCost) counts.really_good++
  }

  const usedNames = new Set()
  for (const team of teams) {
    if (team.coach?.name) usedNames.add(team.coach.name)
  }
  for (const c of existingPool || []) {
    if (c.name) usedNames.add(c.name)
  }

  const assignedAbbreviations = new Set(teams.map(t => t.abbreviation))
  const unassignedMasters = COACHES.filter(
    c => !assignedAbbreviations.has(c.team) && !usedNames.has(`${c.firstName} ${c.lastName}`)
  )
  const masterByTier = { free: [], good: [], really_good: [] }
  for (const m of unassignedMasters) {
    masterByTier[masterCoachTier(m)].push(m)
  }

  const additions = []
  for (const tierKey of ['free', 'good', 'really_good']) {
    const tierConfig = FREE_AGENT_COACH_TIERS[tierKey]
    const needed = Math.max(0, tierConfig.count - counts[tierKey])
    for (let i = 0; i < needed; i++) {
      const master = masterByTier[tierKey].shift() ?? null
      additions.push(generateFreeAgentCoach(tierKey, usedNames, master))
    }
  }

  let pool = [...(existingPool || []), ...additions]

  // Cap the pool. Fired coaches return to the market each offseason, so without
  // a ceiling the unemployed list would balloon over many seasons. Keep the
  // most desirable candidates (overall, lightly penalized by age — older
  // unemployed coaches "step away") and drop the rest as quiet retirements.
  if (pool.length > MAX_COACH_POOL) {
    pool = pool
      .map(c => ({ c, keep: (c.overallRating ?? c.overall_rating ?? 60) - Math.max(0, (c.age ?? 50) - 60) * 1.5 }))
      .sort((a, b) => b.keep - a.keep)
      .slice(0, MAX_COACH_POOL)
      .map(x => x.c)
  }

  return pool
}

// Maximum size of the unemployed coach pool. The per-tier `count` targets in
// FREE_AGENT_COACH_TIERS sum to 8 (the minimum supply); fired coaches push the
// pool above that, and this caps the accumulation.
const MAX_COACH_POOL = 16

// =============================================================================
// ROSTER GENERATION
// =============================================================================

/**
 * Generate a full 15-player roster for a team.
 *
 * @param {string} campaignId
 * @param {string|null} teamId - Team ID (null for fantasy draft free agents)
 * @param {string} teamAbbreviation - Team abbreviation (used for name seeding)
 * @param {number} tier - Team tier (1-4)
 * @param {number} teamIndex - Index used for deterministic name assignment
 * @returns {Array} Array of 15 player objects
 */
export function generateRoster(campaignId, teamId, teamAbbreviation, tier, teamIndex) {
  const jerseyNumbers = generateJerseyNumbers()
  const players = []

  for (let posIndex = 0; posIndex < ROSTER_POSITIONS.length; posIndex++) {
    const position = ROSTER_POSITIONS[posIndex]
    const isStarter = posIndex < 5
    const overallRange = getOverallRange(tier, isStarter, posIndex)
    const overall = randInt(overallRange[0], overallRange[1])

    const player = generatePlayer({
      campaignId,
      teamId,
      teamAbbreviation,
      position,
      overall,
      jerseyNumber: jerseyNumbers[posIndex],
      teamIndex,
      posIndex,
    })

    players.push(player)
  }

  return players
}

/**
 * Generate a single player with realistic basketball attributes.
 *
 * @param {Object} options
 * @param {string} options.campaignId
 * @param {string|null} options.teamId
 * @param {string} [options.teamAbbreviation]
 * @param {string} options.position - Primary position
 * @param {number} options.overall - Target overall rating
 * @param {number} [options.jerseyNumber]
 * @param {number} [options.teamIndex=0] - Used for name seeding
 * @param {number} [options.posIndex=0] - Used for name seeding
 * @returns {Object} Player object ready for IndexedDB
 */
export function generatePlayer(options) {
  const {
    campaignId,
    teamId = null,
    teamAbbreviation = '',
    position,
    overall,
    jerseyNumber = randInt(0, 99),
  } = options
  // (teamIndex/posIndex used to seed a deterministic name; names are now chosen
  // by nationality via pickNameForCountry, so those options are no longer read.)

  const potential = Math.min(99, overall + randInt(-5, 15))
  const age = generateAge(overall)
  const heightInches = getHeight(position)
  const weightLbs = getWeight(position)
  const secondaryPosition = getSecondaryPosition(position)
  const attributes = generateAttributes(position, overall)
  const tendencies = generateTendencies(position)
  // Attribute-driven badge pick — detects archetype, scores all 76 badges
  // by attribute + vital fit, samples weighted by score. Synthesizes a
  // minimal player-shaped object since the broader player record below
  // hasn't been assembled yet.
  const fitPlayer = { attributes, position, heightInches, weightLbs, overallRating: overall }
  const archetype = detectArchetype(fitPlayer)
  const badges = pickBadgesByFit(fitPlayer, {
    count: _badgeCountForOvr(overall),
    tier: getBadgeLevel(overall),
    archetype,
  })
  const personality = generatePersonality()
  const contract = generateContract(overall, age)

  // Origin (college or international club + country). Determined BEFORE the name
  // so international players get a culturally-matching name. Matches the rookie
  // class's ~25% international rate so the season-1 league mix has the same
  // domestic/international ratio as the rookie classes that follow.
  // RookieGenerationService also fills these fields for new draftees, so
  // every player in the system carries `country` + `college`.
  let country
  let college
  if (Math.random() < 0.25) {
    const origin = INTERNATIONAL_ORIGINS[randInt(0, INTERNATIONAL_ORIGINS.length - 1)]
    country = origin.country
    college = origin.clubs[randInt(0, origin.clubs.length - 1)]
  } else {
    country = 'United States'
    college = US_COLLEGES[randInt(0, US_COLLEGES.length - 1)]
  }

  // Nationality-aware name. International countries draw from their own pool;
  // US (incl. the Hispanic bucket) draws from the mixed domestic pool. Dedup is
  // handled here when a `usedNames` set is supplied (e.g. league generation);
  // the scrambler is already shuffled so the old deterministic seed is obsolete.
  const { firstName, lastName } = pickNameForCountry({
    country,
    usedNames: options.usedNames,
    domesticFirst: FIRST_NAMES,
    domesticLast: LAST_NAMES,
  })

  // Assign a random headshot from the combined catalog (procedural pool +
  // admin-authored premades). Random per call — slight collision risk
  // across a 225-player league but plenty of variety in the underlying
  // pool. Null fallback only if both sources happen to be empty (would
  // indicate a build pipeline issue, not a real-world scenario).
  const headshot = HEADSHOT_FILENAMES.length > 0
    ? HEADSHOT_FILENAMES[randInt(0, HEADSHOT_FILENAMES.length - 1)]
    : null

  // Birth date: current year minus age, with random day offset
  const birthYear = 2025 - age
  const birthMonth = String(randInt(1, 12)).padStart(2, '0')
  const birthDay = String(randInt(1, 28)).padStart(2, '0')
  const birthDate = `${birthYear}-${birthMonth}-${birthDay}`

  const playerId = generateUUID()

  return {
    // IndexedDB keys
    campaignId,
    id: playerId,

    // Core identity
    teamId,
    teamAbbreviation,
    isFreeAgent: teamId ? 0 : 1,
    firstName,
    first_name: firstName,
    lastName,
    last_name: lastName,
    name: `${firstName} ${lastName}`,
    position,
    secondaryPosition,
    secondary_position: secondaryPosition,
    jerseyNumber,
    jersey_number: jerseyNumber,
    heightInches,
    height_inches: heightInches,
    height: `${Math.floor(heightInches / 12)}'${heightInches % 12}"`,
    weightLbs,
    weight_lbs: weightLbs,
    weight: weightLbs,
    birthDate,
    birth_date: birthDate,
    age,
    country,
    college,
    // Assigned at generation so the roster ships with faces. Resolved to
    // an actual SVG URL by headshotResolver.resolveHeadshotSrc using the
    // combined procedural + premade map.
    headshot,
    // Stamp the season the player entered so the first birthday tick
    // doesn't immediately re-age them. Uses 2025 as the league baseline
    // (matches the birthYear math above).
    _lastBirthdayYear: 2025,

    // Ratings
    overallRating: overall,
    overall_rating: overall,
    potentialRating: potential,
    potential_rating: potential,

    // Attributes & gameplay
    attributes,
    tendencies,
    badges,
    // Canonical NBA archetype detected from the attribute + vital
    // fingerprint at generation time. Used by PlayerDetailModal's header
    // chip and (optionally) by future UIs. Null when the player doesn't
    // cleanly match any of the 14 archetypes in engine/data/archetypes.js
    // — fine for league filler "role players without a label."
    archetype: archetype?.name ?? null,
    personality,

    // Contract
    contractYearsRemaining: contract.years,
    contract_years_remaining: contract.years,
    contractSalary: contract.salary,
    contract_salary: contract.salary,
    contractDetails: contract.details,
    contract_details: contract.details,

    // Status
    isInjured: false,
    is_injured: false,
    injuryDetails: null,
    injury_details: null,
    fatigue: 0,

    // Evolution tracking
    developmentHistory: [],
    development_history: [],
    streakData: null,
    streak_data: null,
    recentPerformances: [],
    recent_performances: [],
    // Single-game highs (PTS/REB/AST/STL/BLK). careerHighs persists across
    // seasons; seasonHighs resets each offseason. Both fill in as games are played.
    careerHighs: {},
    seasonHighs: {},
    upgradePoints: 0,
    upgrade_points: 0,
    offenseUpgradePoints: 0,
    offense_upgrade_points: 0,
    defenseUpgradePoints: 0,
    defense_upgrade_points: 0,
    gamesPlayedThisSeason: 0,
    games_played_this_season: 0,
    minutesPlayedThisSeason: 0,
    minutes_played_this_season: 0,
    careerSeasons: 0,
    career_seasons: 0,

    // Awards
    championships: 0,
    allStarSelections: 0,
    all_star_selections: 0,
    mvpAwards: 0,
    mvp_awards: 0,
    finalsMvpAwards: 0,
    finals_mvp_awards: 0,
    rookieOfTheYear: 0,
    rookie_of_the_year: 0,
    allNbaSelections: 0,
    all_nba_selections: 0,
    allNbaFirstTeam: 0,
    all_nba_first_team: 0,
    allRookieTeam: 0,
    all_rookie_team: 0,
    allDefensiveTeam: 0,
    all_defensive_team: 0,

    updatedAt: new Date().toISOString(),
  }
}

/**
 * Generate a veteran (non-rookie) player. Wrapper around generatePlayer() that
 * post-adjusts age, careerSeasons, potential, badges, contract, name, draft
 * history, motivations, and tradeValue so the result resembles a player who's
 * been in the league for `careerSeasons` years. Used by LeagueRosterGenerator
 * to populate campaign rosters from scratch (replaces the legacy master-player
 * ingestion path).
 *
 * @param {Object} options
 * @param {string} options.campaignId
 * @param {string|null} options.teamId
 * @param {string} [options.teamAbbreviation]
 * @param {string} options.position
 * @param {number} options.overall - Target overall rating
 * @param {string} options.role - 'superstar'|'star'|'starter'|'rotation'|'bench'
 * @param {number} [options.careerSeasons] - If omitted, derived from age band
 * @param {number} [options.jerseyNumber]
 * @param {Set<string>} [options.usedNames] - Collision-avoidance set
 * @param {number} [options.startYear=2025]
 * @returns {Object} Player object ready for IndexedDB
 */
export function generateVeteran(options) {
  const {
    role = 'rotation',
    startYear = 2025,
  } = options
  // Note: `options.usedNames` (if present) is consumed by generatePlayer below,
  // which now owns nationality-aware name selection + dedup.

  // 1. Base shape from generatePlayer
  const base = generatePlayer(options)

  // 2. Age + careerSeasons from role band
  const age = pickVeteranAge(role)
  const careerSeasons = options.careerSeasons != null
    ? options.careerSeasons
    : Math.max(0, Math.min(18, age - 19 + randInt(-1, 1)))

  // 3. Realistic birth date for the new age
  const birthYear = startYear - age
  const birthMonth = String(randInt(1, 12)).padStart(2, '0')
  const birthDay = String(randInt(1, 28)).padStart(2, '0')
  const birthDate = `${birthYear}-${birthMonth}-${birthDay}`

  // 4. Age-banded potential (replaces the rookie-style +random formula)
  const overall = base.overallRating
  const potentialRating = computePotentialFromAge(overall, age)

  // 5. Badge sheet that scales with experience — attribute-driven via
  //    `pickBadgesByFit`. Veteran band uses _veteranBadgeCountForOvr
  //    (base + seasons-bonus). Archetype detection runs against the
  //    base player's attributes + vitals.
  const position = base.position
  const archetype = detectArchetype(base)
  const badges = pickBadgesByFit(base, {
    count: _veteranBadgeCountForOvr(overall, careerSeasons),
    tier: getBadgeLevel(overall),
    archetype,
  })

  // 6. Contract using the canonical age-modulated salary formula
  const contract = generateContract(overall, age)

  // 7. Re-derive motivations now that we know the age
  const motivations = generateMotivations({
    age,
    overallRating: overall,
    personality: base.personality,
  })

  // 8. Trade value tier
  const { tradeValue, tradeValueTotal } = computeTradeValue(overall, age)

  // 9. Draft history: tier from overall, year from careerSeasons
  const { draftRound, draftPick } = pickDraftHistory(overall)
  const draftYear = startYear - careerSeasons

  // 10. Name already chosen (nationality-aware + deduped) inside generatePlayer
  // via pickNameForCountry, using the `usedNames` set passed through `options`.
  // No second re-roll here — that used to re-pick from the US pool and undo an
  // international player's culturally-matched name.
  const firstName = base.firstName
  const lastName = base.lastName

  return {
    ...base,
    firstName,
    first_name: firstName,
    lastName,
    last_name: lastName,
    name: `${firstName} ${lastName}`,
    age,
    birthDate,
    birth_date: birthDate,
    _lastBirthdayYear: startYear,
    potentialRating,
    potential_rating: potentialRating,
    badges,
    // Canonical archetype detected from the player's attribute + vital
    // fingerprint. May differ from the base record's archetype if the
    // veteran age-shifts revealed a clearer fit.
    archetype: archetype?.name ?? null,
    motivations,
    contractYearsRemaining: contract.years,
    contract_years_remaining: contract.years,
    contractSalary: contract.salary,
    contract_salary: contract.salary,
    contractDetails: contract.details,
    contract_details: contract.details,
    tradeValue,
    tradeValueTotal,
    draftYear,
    draftRound,
    draftPick,
    careerSeasons,
    career_seasons: careerSeasons,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * List all campaigns, sorted by last played.
 * @returns {Promise<Array>}
 */
export async function listCampaigns() {
  const campaigns = await CampaignRepository.getAll()

  // Enrich each campaign with its team data and snake_case aliases for the UI
  for (const campaign of campaigns) {
    // Add snake_case aliases for camelCase properties
    if (!campaign.game_year) campaign.game_year = campaign.gameYear
    if (!campaign.last_played_at) campaign.last_played_at = campaign.lastPlayedAt
    if (!campaign.draft_mode) campaign.draft_mode = campaign.draftMode
    if (!campaign.draft_completed && campaign.draftCompleted !== undefined) campaign.draft_completed = campaign.draftCompleted

    // Attach team data for the campaign list cards
    if (!campaign.team && campaign.teamId) {
      const team = await TeamRepository.get(campaign.id, campaign.teamId)
      if (team) {
        // All-time regular-season record across the WHOLE campaign: completed
        // seasons (accumulated in franchise_history) PLUS the in-progress
        // season's standings. The current season is only folded in OUTSIDE the
        // offseason — once a season is archived into franchise_history its
        // seasonData still exists, so adding it then would double-count.
        const fhRs = team.franchise_history?.regular_season ?? { wins: 0, losses: 0 }
        let wins = fhRs.wins ?? 0
        let losses = fhRs.losses ?? 0
        const isOffseason = String(campaign.phase || '').startsWith('offseason')
        const seasonYear = campaign.currentSeasonYear ?? campaign.current_season_year ?? null
        if (!isOffseason && seasonYear != null) {
          try {
            const seasonData = await SeasonRepository.get(campaign.id, seasonYear)
            const standing = [
              ...(seasonData?.standings?.east || []),
              ...(seasonData?.standings?.west || []),
            ].find(s => (s.teamId ?? s.team_id) === team.id || s.teamAbbreviation === team.abbreviation)
            if (standing) {
              wins += standing.wins ?? 0
              losses += standing.losses ?? 0
            }
          } catch { /* best-effort — fall back to franchise_history only */ }
        }
        campaign.team = {
          id: team.id,
          name: team.name,
          city: team.city,
          abbreviation: team.abbreviation,
          primary_color: team.primary_color ?? team.primaryColor,
          secondary_color: team.secondary_color ?? team.secondaryColor,
          franchise_history: team.franchise_history ?? null,
          allTimeRecord: { wins, losses },
        }
      }
    }
  }

  return campaigns.sort((a, b) => {
    const dateA = a.lastPlayedAt ? new Date(a.lastPlayedAt) : new Date(0)
    const dateB = b.lastPlayedAt ? new Date(b.lastPlayedAt) : new Date(0)
    return dateB - dateA
  })
}
