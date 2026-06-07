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
  computeCoachTier,
} from '../data/coaches'
// Pull scheme maps from the simulator's canonical source. The arrays exported
// from `data/coaches` use STRING values, so `Object.keys(arr)` returns "0",
// "1" etc. — which the simulator doesn't recognise as schemes. The maps below
// are keyed by the actual scheme name (`balanced`, `motion`, `man`, …) so
// `pickRandom(Object.keys(...))` gives a real scheme that the simulator can
// look up.
import { OFFENSIVE_SCHEMES, DEFENSIVE_SCHEMES } from '../simulation/CoachingEngine'
import { selectBestCoachingScheme, isCoachingSchemeValid } from '../coaching/CoachStrategyService'
import { coachBadges } from '../data/coachBadges'
import { BADGES, BADGES_BY_POSITION } from '../data/badges'
import { generateLeagueRosters, generateFreeAgentPool } from '../draft/LeagueRosterGenerator'
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
import { generateAndSaveRookieClass, shouldGenerateGenerational } from '../draft/RookieGenerationService'
import { AwardService } from '../season/AwardService'
import { AllStarService } from '../season/AllStarService'
import { listCoachHeadshots } from '../../services/headshotPremades'
import {
  SCOUT_TIERS, PHYSICIAN_TIERS, STAFF_TRAINER_TIERS,
  PERSONNEL_POOL_COUNTS, PERSONNEL_POOL_KEY,
} from '../data/personnelTiers'

// =============================================================================
// HELPERS
// =============================================================================

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
  'Turner', 'Mathurin', 'Nesmith', 'McConnell', 'Nembhard', 'Duarte', 'Okeke',
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

// Reject candidates that look unnatural (3+ consonants in a row, etc.).
function _isPlausibleName(name) {
  if (name.length < 4 || name.length > 13) return false
  // No four consonants in a row
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(name)) return false
  // No starting with apostrophe/hyphen
  if (/^[-']/.test(name)) return false
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
  return [...pool]
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
  'Wesley', 'Reid', 'Ross', 'Spencer', 'Garrett', 'Vincent', 'Theo', 'Max',
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
  'Connelly', 'Henderson', 'Griffin', 'Stills', 'Maroney', 'Trevey', 'Brent', 'Bendt'
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
  'Jaxson', 'Trayvon', 'Devontae', 'Jamel', 'Cleophus', 'Jerome',
]

// Last names common across Black American communities. Many of these are
// shared with the general American pool culturally — included here as a
// second-bucket weight nudge rather than a strict ethnic divide.
const BLACK_LAST_NAMES = [
  'Washington', 'Jefferson', 'Jackson', 'Booker', 'Mosley', 'Cummings',
  'Pinkston', 'Frazier', 'Gaines', 'Witherspoon', 'Lassiter', 'Pittman',
  'McNair', 'Boyd', 'Boykin', 'Carver', 'Christian', 'Cleveland', 'Coles',
  'Crockett', 'Duke', 'Fletcher', 'Floyd', 'Freeman', 'Gantt', 'Garner',
  'Givens', 'Grant', 'Greene', 'Hampton', 'Hardy', 'Harmon', 'Harvey',
  'Heath', 'Holmes', 'Jeffries', 'Jordan', 'Keys', 'Langston', 'Lawson',
  'Lemon', 'Mack', 'Madison', 'Massey', 'McCray', 'McKinney', 'McNeil',
  'Norris', 'Pace', 'Page', 'Paige', 'Pope', 'Prentice', 'Pryor',
  'Reese', 'Riggs', 'Roach', 'Rollins', 'Saunders', 'Shaw', 'Stafford',
  'Steele', 'Stokes', 'Sutton', 'Tate', 'Thurmond', 'Vance', 'Vaughn',
  'Waters', 'Wells', 'Whitaker', 'Wilkins', 'Woodson', 'Drummond',
]

// Each real-name bucket is repeated N times when concatenating with the
// scrambled pool so it lands at roughly its target share of total picks.
// Tweaking the weight up/down is the per-bucket knob — independent of the
// scrambled pool's natural size (~3,400 entries).
const NORMAL_NAME_WEIGHT = 14
const BLACK_NAME_WEIGHT = 14

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
    { names: NORMAL_FIRST_NAMES, weight: NORMAL_NAME_WEIGHT },
    { names: BLACK_FIRST_NAMES,  weight: BLACK_NAME_WEIGHT },
  ],
)
export const LAST_NAMES = _mixRealNames(
  _scrambleNamePool([...RAW_LAST_NAMES, ...COACH_LAST_NAMES]),
  [
    { names: NORMAL_LAST_NAMES, weight: NORMAL_NAME_WEIGHT },
    { names: BLACK_LAST_NAMES,  weight: BLACK_NAME_WEIGHT },
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

function generateBadges(position, overall) {
  const availableBadges = BADGES_BY_POSITION[position] ?? BADGES_BY_POSITION.SF
  let numBadges
  if (overall >= 90) numBadges = randInt(8, 12)
  else if (overall >= 85) numBadges = randInt(6, 10)
  else if (overall >= 80) numBadges = randInt(5, 8)
  else if (overall >= 75) numBadges = randInt(4, 7)
  else if (overall >= 70) numBadges = randInt(3, 5)
  else numBadges = randInt(1, 4)

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
  // Bands tuned so league avg payroll lands near the $136M cap with realistic
  // spread. With the bottom-heavy talent distribution (more players in 56-69
  // OVR, fewer in 70-82), the LOW-end salary tiers had to be pulled up to
  // keep total payrolls realistic — real NBA bench guys earn $3-8M, not
  // minimum, and there are a lot of bench guys per roster now.
  let baseSalary
  if (overall >= 92)      baseSalary = randInt(45000000, 55000000)
  else if (overall >= 88) baseSalary = randInt(35000000, 47000000)
  else if (overall >= 84) baseSalary = randInt(24000000, 36000000)
  else if (overall >= 80) baseSalary = randInt(15000000, 25000000)
  else if (overall >= 76) baseSalary = randInt(9000000, 17000000)
  else if (overall >= 72) baseSalary = randInt(6000000, 12000000)
  else if (overall >= 68) baseSalary = randInt(4000000, 8000000)
  else if (overall >= 64) baseSalary = randInt(2500000, 5000000)
  else if (overall >= 60) baseSalary = randInt(1800000, 3500000)
  else                    baseSalary = randInt(1100000, 2500000)

  // Age adjustment — young stars sign cheaper extensions; aging vets give
  // a modest discount but not as steep as before so 33+ vets still command
  // real money.
  if (age >= 33) baseSalary = Math.round(baseSalary * 0.90)
  else if (age <= 23) baseSalary = Math.round(baseSalary * 0.75)

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
 * @param {number} [options.seasonLength=54] - Games per team in regular season
 * @returns {Promise<Object>} The created campaign object
 */
export async function createCampaign(options) {
  const {
    name,
    difficulty = 'pro',
    seasonLength = 54,
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
      lastScoutingWeek: 0,
      scoutedPlayers: {},
    },
    lastPlayedAt: new Date().toISOString(),
  }

  await CampaignRepository.create(campaign)

  // -------------------------------------------------------------------------
  // 2. Generate all 30 teams with coaches
  // -------------------------------------------------------------------------
  const teams = generateTeams(campaignId)

  // Seed the user-facing free-agent coach pool (8 candidates across 3 tiers).
  campaign.settings.availableCoaches = generateCoachPool(teams)
  // Seed the parallel scout / physician / staff-trainer hire pools so users
  // browse a persistent roster instead of fresh random candidates every modal
  // open (matches the coach pool pattern).
  const personnelPools = {
    scout: generatePersonnelPool('scout'),
    physician: generatePersonnelPool('physician'),
    staff_trainer: generatePersonnelPool('staff_trainer'),
  }
  campaign.settings[PERSONNEL_POOL_KEY.scout] = personnelPools.scout
  campaign.settings[PERSONNEL_POOL_KEY.physician] = personnelPools.physician
  campaign.settings[PERSONNEL_POOL_KEY.staff_trainer] = personnelPools.staff_trainer

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
    // realistic mode-driven talent distribution. The user's chosen team is
    // always 'average_strong' so a new player isn't handed a fire-sale
    // roster; the other 29 teams are randomly bucketed into
    // contender/average/rebuilder per-campaign for replay variety.
    const result = generateLeagueRosters(campaignId, teams, {
      startYear,
      userTeamAbbreviation: teamAbbreviation,
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
 * @param {string} campaignId
 * @param {number} currentYear
 * @param {Array} teams
 * @param {Array} allPlayers
 * @returns {Promise<void>}
 */
async function archiveSeasonData(campaignId, currentYear, teams, allPlayers) {
  const seasonData = await SeasonRepository.get(campaignId, currentYear)
  if (!seasonData) return

  // 2A. Player season history
  const playerStats = seasonData.playerStats || {}
  for (const player of allPlayers) {
    const stats = playerStats[String(player.id)]
    if (!stats || !stats.gamesPlayed) continue

    player.seasonHistory = player.seasonHistory || []
    player.seasonHistory.push({
      year: currentYear,
      teamId: player.teamId,
      teamAbbreviation: player.teamAbbreviation,
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
    })
  }

  // 2B. Team season history
  const allStandings = [
    ...(seasonData.standings?.east || []),
    ...(seasonData.standings?.west || []),
  ]
  const teamStats = seasonData.teamStats || {}
  const bracket = seasonData.playoffBracket || null

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
      playoffResult: ts.playoffResult ?? null,
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
  for (const team of teams) {
    const standing = allStandings.find(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    )
    if (!standing) continue

    const fh = team.franchise_history || {
      championships: 0,
      conference_titles: 0,
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

    if (bracket?.champion?.teamId === team.id) {
      fh.championships = (fh.championships ?? 0) + 1
    }

    const conf = team.conference
    const confFinalsWinnerId = bracket?.[conf]?.confFinals?.winner?.teamId ?? null
    if (confFinalsWinnerId && confFinalsWinnerId === team.id) {
      fh.conference_titles = (fh.conference_titles ?? 0) + 1
    }

    team.franchise_history = fh
  }

  // Persist archived data
  await PlayerRepository.saveBulk(allPlayers)
  await TeamRepository.saveBulk(teams)
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
      alreadyEntered: true,
    }
  }

  const currentYear = campaign.currentSeasonYear ?? 2025
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 1. Archive season data (player/team history, coach career stats)
  await archiveSeasonData(campaignId, currentYear, teams, allPlayers)

  // 1b. Compute end-of-season awards (before stats are reset)
  const seasonData = await SeasonRepository.get(campaignId, currentYear)
  let seasonAwards = null
  if (seasonData) {
    const awardResults = AwardService.processSeasonAwards({
      seasonData, year: currentYear, allPlayers, teams, userTeamId: campaign.teamId,
    })
    AwardService.applyAwardsToPlayers(allPlayers, awardResults, currentYear)
    seasonAwards = awardResults

    // Also fix: increment allStarSelections (currently never done)
    const allStarRosters = seasonData?.allStarRosters?.allStars
    if (allStarRosters) {
      const ids = AllStarService._collectSelectedPlayerIds(allStarRosters)
      const playerMap = Object.fromEntries(allPlayers.map(p => [String(p.id), p]))
      for (const pid of ids) {
        const p = playerMap[pid]
        if (p) {
          p.allStarSelections = (p.allStarSelections ?? 0) + 1
          p.all_star_selections = p.allStarSelections
          if (!p.awards) p.awards = {}
          if (!Array.isArray(p.awards.all_star)) p.awards.all_star = []
          p.awards.all_star.push(currentYear)
        }
      }
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
    const retireeIds = new Set(retirees.map(r => r.id))
    updatedPlayers = updatedPlayers.map(p => {
      const retired = retirees.find(r => r.id === p.id)
      return retired ? retired : p
    })
    void retireeIds // for readability — already used via .find above
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
    retirees: campaign.settings.pendingRetirements,
  }
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
  campaign.currentSeasonYear = nextYear
  campaign.currentDate = `${nextYear}-10-21`
  campaign.phase = 'regular_season'

  // 3. Load current teams and re-read players (may have changed during offseason)
  const teams = await TeamRepository.getAllForCampaign(campaignId)
  allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 3b. Degrade all teams' facilities by 1 (min 1) for the new season
  const userTeamFacilitiesBefore = {}
  for (const team of teams) {
    if (team.facilities) {
      if (team.id === campaign.teamId) {
        Object.assign(userTeamFacilitiesBefore, team.facilities)
      }
      for (const key of ['training', 'medical', 'scouting', 'analytics']) {
        if (team.facilities[key] > 1) {
          team.facilities[key] = team.facilities[key] - 1
        }
      }
    }
  }
  const userTeam = teams.find(t => t.id === campaign.teamId)
  const userTeamFacilitiesAfter = userTeam?.facilities ? { ...userTeam.facilities } : {}
  await TeamRepository.saveBulk(teams)

  // 3c. Reset scouting points and scouted players for the new season
  campaign.settings = campaign.settings ?? {}
  campaign.settings.scoutingPoints = 0
  campaign.settings.lastScoutingWeek = 0
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

  // 3e. Decrement user-team coach contract. AI team coach contracts are NOT
  //     decremented (frozen by design; only the user's coach uses the
  //     hire/fire system). When a contract hits 0 the coach is cleared and
  //     the user must hire a replacement before the next season can start.
  const userTeamForCoach = teams.find(t => t.id === campaign.teamId)
  if (userTeamForCoach?.coach) {
    const remaining = (userTeamForCoach.coach.contractYearsRemaining ?? userTeamForCoach.coach.contract_years_remaining ?? 0) - 1
    if (remaining <= 0) {
      userTeamForCoach.coach = null
    } else {
      userTeamForCoach.coach.contractYearsRemaining = remaining
      userTeamForCoach.coach.contract_years_remaining = remaining
      // Refill the per-season "Coach Meeting" action budget for the new
      // season. Tier-driven (free=1, good=3, really_good=5).
      userTeamForCoach.coach.actionsRemaining = getCoachActionBudget(userTeamForCoach.coach)
    }
    await TeamRepository.save(userTeamForCoach)
  }

  // 3f. Top up the free-agent coach pool back to its tier targets.
  campaign.settings.availableCoaches = topUpCoachPool(
    campaign.settings.availableCoaches ?? [],
    teams
  )

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
 * @returns {Array} Array of 30 team objects ready for IndexedDB
 */
export function generateTeams(campaignId) {
  const usedCoachNames = new Set()

  const teams = TEAMS.map((template, index) => {
    const teamId = generateUUID()
    const tier = getTeamTier(template.abbreviation)

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
  // 2) Scouts, 3) Physicians, 4) Staff trainers — pool order is the spec.
  for (const kind of ['scout', 'physician', 'staff_trainer']) {
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
function generateCoach(tier, index, usedNames, teamAbbreviation = null) {
  const range = COACH_TIER_RANGES[tier] ?? COACH_TIER_RANGES[3]
  const overall = randInt(range[0], range[1])
  const attributes = generateCoachAttributes(overall)
  const salary = calculateCoachSalary(overall)
  const offensiveScheme = pickRandom(Object.keys(OFFENSIVE_SCHEMES))
  const defensiveScheme = pickRandom(Object.keys(DEFENSIVE_SCHEMES))

  // If a master coach is defined for this team in coaches.js, use their
  // identity (name, headshot, starter badges) verbatim — that's the override
  // path for hand-curated coach personas. Otherwise fall back to the
  // scrambled FIRST_NAMES / LAST_NAMES pool (same fictional-name pool used
  // for players) so generated coaches don't ship real-world identities.
  const masterCoach = findCoachForTeam(teamAbbreviation)

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

  const coach = {
    id: generateUUID(),
    firstName,
    lastName,
    name: fullName,
    overallRating: overall,
    overall_rating: overall,
    attributes,
    offensiveScheme,
    offensive_scheme: offensiveScheme,
    defensiveScheme,
    defensive_scheme: defensiveScheme,
    contractYearsRemaining: randInt(1, 4),
    contract_years_remaining: randInt(1, 4),
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

  return [...(existingPool || []), ...additions]
}

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
    teamIndex = 0,
    posIndex = 0,
  } = options

  const potential = Math.min(99, overall + randInt(-5, 15))
  const age = generateAge(overall)
  const heightInches = getHeight(position)
  const weightLbs = getWeight(position)
  const secondaryPosition = getSecondaryPosition(position)
  const attributes = generateAttributes(position, overall)
  const tendencies = generateTendencies(position)
  const badges = generateBadges(position, overall)
  const personality = generatePersonality()
  const contract = generateContract(overall, age)

  // Generate name using deterministic seed based on team/position index
  const nameIdx = teamIndex * 15 + posIndex
  const firstName = FIRST_NAMES[nameIdx % FIRST_NAMES.length]
  const lastName = LAST_NAMES[(nameIdx + 7) % LAST_NAMES.length]

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
    usedNames,
  } = options

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

  // 5. Badge sheet that scales with experience
  const position = base.position
  const badges = generateVeteranBadges(position, overall, careerSeasons)

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

  // 10. Name with collision avoidance against any caller-supplied set.
  // generatePlayer's deterministic name seed can collide across many calls;
  // for a 450-player league we want unique full names where feasible.
  let firstName = base.firstName
  let lastName = base.lastName
  if (usedNames) {
    let attempts = 0
    while (usedNames.has(`${firstName} ${lastName}`) && attempts < 20) {
      firstName = pickRandom(FIRST_NAMES)
      lastName = pickRandom(LAST_NAMES)
      attempts++
    }
    usedNames.add(`${firstName} ${lastName}`)
  }

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
        campaign.team = {
          id: team.id,
          name: team.name,
          city: team.city,
          abbreviation: team.abbreviation,
          primary_color: team.primary_color ?? team.primaryColor,
          secondary_color: team.secondary_color ?? team.secondaryColor,
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
