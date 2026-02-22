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
  OFFENSIVE_SCHEMES,
  DEFENSIVE_SCHEMES,
  COACH_TIER_RANGES,
  generateCoachAttributes,
  calculateCoachSalary,
} from '../data/coaches'
import { BADGES } from '../data/badges'
import { playersMaster } from '../data/players'
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
import { processSeasonEnd } from '../evolution/PlayerEvolution'
import { runAIRosterManagement, ensureMinimumRosters } from '../ai/AIContractService'
import { generateMotivations, getMarketSize } from '../ai/MotivationService'
import { generateAndSaveRookieClass } from '../draft/RookieGenerationService'
import { AwardService } from '../season/AwardService'
import { AllStarService } from '../season/AllStarService'

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
// MASTER PLAYER RANDOMIZATION
// =============================================================================
// Translated from PHP CampaignPlayerService::randomizePlayerData() and sub-methods.
// Called once per player during campaign initialization to add variety.

function randFloat(min, max) {
  return min + Math.random() * (max - min)
}

function normalRandom(mean, stddev) {
  const u1 = Math.max(0.0001, Math.random())
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stddev
}

/**
 * Infer age from ratings gap and generate a realistic birth date.
 * Matches PHP CampaignPlayerService::randomizeBirthDate()
 */
function randomizeBirthDate(data) {
  const ovr = data.overallRating ?? 70
  const potential = data.potentialRating ?? ovr
  const potentialGap = potential - ovr
  let age

  if (potentialGap >= 10) {
    age = randInt(19, 23)
  } else if (potentialGap >= 5 && ovr < 80) {
    age = randInt(20, 25)
  } else if (ovr >= 88 && potentialGap >= 3) {
    age = randInt(22, 27)
  } else if (ovr >= 88 && potentialGap < 3) {
    age = randInt(26, 32)
  } else if (ovr >= 78) {
    age = randInt(24, 32)
  } else if (ovr >= 68) {
    age = randInt(22, 34)
  } else if (potentialGap <= 0 && ovr < 65) {
    age = randInt(28, 36)
  } else {
    age = randInt(19, 24)
  }

  const birthYear = 2025 - age
  const month = randInt(1, 12)
  const maxDay = new Date(birthYear, month, 0).getDate() // last day of month
  const day = randInt(1, maxDay)
  const birthMonth = String(month).padStart(2, '0')
  const birthDay = String(day).padStart(2, '0')

  data.birthDate = `${birthYear}-${birthMonth}-${birthDay}`
  data._age = age
  return data
}

/**
 * Generate draft year, round, and pick based on age and ratings.
 * Matches PHP CampaignPlayerService::randomizeDraftInfo()
 */
function randomizeDraftInfo(data) {
  const age = data._age ?? 25
  const ovr = data.overallRating ?? 70
  const potential = data.potentialRating ?? ovr
  const combinedScore = ovr + (potential - ovr) * 0.5

  // Entry age: weighted random 19-22
  const entryRoll = randInt(1, 100)
  let entryAge
  if (entryRoll <= 40) entryAge = 19
  else if (entryRoll <= 70) entryAge = 20
  else if (entryRoll <= 90) entryAge = 21
  else entryAge = 22

  entryAge = Math.min(entryAge, age)
  const draftYear = 2025 - (age - entryAge)

  let draftRound, draftPick
  if (combinedScore >= 88) {
    draftRound = 1; draftPick = randInt(1, 5)
  } else if (combinedScore >= 82) {
    draftRound = 1; draftPick = randInt(3, 14)
  } else if (combinedScore >= 76) {
    draftRound = 1; draftPick = randInt(10, 30)
  } else if (combinedScore >= 70) {
    draftRound = randInt(1, 2)
    draftPick = draftRound === 1 ? randInt(15, 30) : randInt(31, 60)
  } else if (combinedScore >= 60) {
    draftRound = 2; draftPick = randInt(31, 60)
  } else {
    // 50% undrafted, 50% late 2nd round
    if (randInt(0, 1) === 0) {
      data.draftYear = null; data.draftRound = null; data.draftPick = null
      return data
    }
    draftRound = 2; draftPick = randInt(45, 60)
  }

  data.draftYear = draftYear
  data.draftRound = draftRound
  data.draftPick = draftPick
  return data
}

/**
 * Generate trade value based on OVR with age modifier.
 * Matches PHP CampaignPlayerService::randomizeTradeValue()
 */
function randomizeTradeValue(data) {
  if (data.tradeValue != null) return data

  const ovr = data.overallRating ?? 70
  const age = data._age ?? 25
  let value

  if (ovr >= 92)      value = randFloat(25, 40)
  else if (ovr >= 88) value = randFloat(18, 28)
  else if (ovr >= 84) value = randFloat(12, 20)
  else if (ovr >= 80) value = randFloat(8, 14)
  else if (ovr >= 76) value = randFloat(5, 10)
  else if (ovr >= 72) value = randFloat(3, 7)
  else if (ovr >= 68) value = randFloat(1.5, 4)
  else                value = randFloat(0.5, 2)

  if (age <= 24) value *= 1.15
  else if (age >= 32) value *= 0.80

  data.tradeValue = Math.round(value * 100) / 100
  data.tradeValueTotal = Math.round(value * randFloat(0.6, 0.9) * 100) / 100
  return data
}

/**
 * Assign personality traits based on attributes and random selection.
 * Matches PHP CampaignPlayerService::randomizePersonalityTraits()
 */
function randomizePersonalityTraits(data) {
  const traits = data.personality?.traits ?? []
  if (traits.length > 0) return data

  const allTraits = ['competitor', 'leader', 'mentor', 'hot_head', 'ball_hog', 'team_player', 'joker', 'quiet', 'media_darling']

  const countRoll = randInt(1, 100)
  let numTraits
  if (countRoll <= 20) numTraits = 0
  else if (countRoll <= 60) numTraits = 1
  else if (countRoll <= 90) numTraits = 2
  else numTraits = 3

  if (numTraits === 0) return data

  const assignedTraits = []
  const ovr = data.overallRating ?? 70
  const age = data._age ?? 25
  const workEthic = data.attributes?.mental?.workEthic ?? 50
  const basketballIQ = data.attributes?.mental?.basketballIQ ?? 50

  if (workEthic >= 85 && randInt(1, 100) <= 40) {
    assignedTraits.push('competitor')
  }
  if (basketballIQ >= 85 && age >= 28 && randInt(1, 100) <= 30 && assignedTraits.length < numTraits) {
    assignedTraits.push('mentor')
  }
  if (basketballIQ >= 80 && ovr >= 82 && randInt(1, 100) <= 25 && assignedTraits.length < numTraits) {
    assignedTraits.push('leader')
  }

  const remainingPool = allTraits.filter(t => !assignedTraits.includes(t))
  shuffleArray(remainingPool)

  while (assignedTraits.length < numTraits && remainingPool.length > 0) {
    assignedTraits.push(remainingPool.shift())
  }

  // Conflict resolution
  const hasBallHog = assignedTraits.includes('ball_hog')
  const hasTeamPlayer = assignedTraits.includes('team_player')
  const hasHotHead = assignedTraits.includes('hot_head')
  const hasQuiet = assignedTraits.includes('quiet')

  if (hasBallHog && hasTeamPlayer) {
    const remove = randInt(0, 1) ? 'ball_hog' : 'team_player'
    assignedTraits.splice(assignedTraits.indexOf(remove), 1)
  }
  if (hasHotHead && hasQuiet) {
    const remove = randInt(0, 1) ? 'hot_head' : 'quiet'
    assignedTraits.splice(assignedTraits.indexOf(remove), 1)
  }

  if (!data.personality) data.personality = { morale: 80, chemistry: 75, mediaProfile: 'normal' }
  data.personality.traits = assignedTraits
  return data
}

/**
 * Generate realistic physical attributes from position-appropriate distributions.
 * Matches PHP CampaignPlayerService::randomizePhysicalAttributes()
 */
function randomizePhysicalAttributes(data) {
  const position = data.position ?? 'SF'

  const positionProfiles = {
    PG: { hMean: 74, hStd: 2.0, hMin: 70, hMax: 78, wMean: 190, wStd: 12, wMin: 165, wMax: 215 },
    SG: { hMean: 76, hStd: 1.8, hMin: 72, hMax: 80, wMean: 200, wStd: 12, wMin: 175, wMax: 225 },
    SF: { hMean: 79, hStd: 1.8, hMin: 75, hMax: 83, wMean: 220, wStd: 12, wMin: 200, wMax: 250 },
    PF: { hMean: 81, hStd: 1.8, hMin: 77, hMax: 85, wMean: 240, wStd: 12, wMin: 215, wMax: 265 },
    C:  { hMean: 83, hStd: 2.0, hMin: 79, hMax: 88, wMean: 255, wStd: 15, wMin: 225, wMax: 285 },
  }

  const profile = positionProfiles[position] ?? positionProfiles.SF

  const height = Math.max(profile.hMin, Math.min(profile.hMax, Math.round(normalRandom(profile.hMean, profile.hStd))))
  data.heightInches = height

  const heightOffset = height - profile.hMean
  const weightMean = profile.wMean + heightOffset * 5
  const weight = Math.max(profile.wMin, Math.min(profile.wMax, Math.round(normalRandom(weightMean, profile.wStd))))
  data.weightLbs = weight

  let wingspanBase = height + randInt(0, 5)
  if (position === 'C' || position === 'PF') wingspanBase += randInt(0, 2)
  data.wingspanInches = wingspanBase

  return data
}

/**
 * Assign college and hometown if missing.
 * Matches PHP CampaignPlayerService::randomizeBioData()
 */
function randomizeBioData(data) {
  const country = data.country ?? 'United States'
  const isInternational = country !== 'United States'

  if (!data.college) {
    if (isInternational) {
      data.college = randInt(0, 1) ? 'International' : 'Overseas Academy'
    } else {
      const colleges = [
        'Duke', 'Kentucky', 'North Carolina', 'Kansas', 'UCLA',
        'Michigan State', 'Gonzaga', 'Villanova', 'Louisville', 'Syracuse',
        'Indiana', 'Connecticut', 'Arizona', 'Florida', 'Ohio State',
        'Michigan', 'Texas', 'Georgetown', 'Wake Forest', 'Memphis',
        'LSU', 'Auburn', 'Baylor', 'Tennessee', 'Virginia',
        'Wisconsin', 'Purdue', 'Iowa State', 'Oregon', 'Maryland',
        'Georgia Tech', 'Creighton', 'Marquette', 'San Diego State', 'Houston',
        'USC', 'Stanford', 'Notre Dame', 'Oklahoma', 'Arkansas',
        'Alabama', 'Dayton', 'Xavier', 'Butler', 'Providence',
      ]
      data.college = pickRandom(colleges)
    }
  }

  if (!data.hometown && !isInternational) {
    const hometowns = [
      'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'New York, NY',
      'Philadelphia, PA', 'Atlanta, GA', 'Detroit, MI', 'Memphis, TN',
      'Miami, FL', 'Dallas, TX', 'Oakland, CA', 'Indianapolis, IN',
      'Baltimore, MD', 'Charlotte, NC', 'Milwaukee, WI', 'St. Louis, MO',
      'Cleveland, OH', 'New Orleans, LA', 'Minneapolis, MN', 'Phoenix, AZ',
      'San Antonio, TX', 'Washington, DC', 'Denver, CO', 'Seattle, WA',
      'Boston, MA', 'Raleigh, NC', 'Nashville, TN', 'Jacksonville, FL',
      'Columbus, OH', 'Sacramento, CA', 'Las Vegas, NV', 'Louisville, KY',
      'Compton, CA', 'Brooklyn, NY', 'Akron, OH',
    ]
    data.hometown = pickRandom(hometowns)
  }

  return data
}

/**
 * Apply all randomization steps to a master player entry.
 * Matches PHP CampaignPlayerService::randomizePlayerData()
 */
function randomizePlayerData(data) {
  // Deep clone to avoid mutating the original master data
  data = JSON.parse(JSON.stringify(data))
  data = randomizeBirthDate(data)
  data = randomizeDraftInfo(data)
  data = randomizeTradeValue(data)
  data = randomizePersonalityTraits(data)
  data = randomizePhysicalAttributes(data)
  data = randomizeBioData(data)
  data.jerseyNumber = randInt(0, 99)
  delete data._age
  return data
}

/**
 * Convert a randomized master player entry into a full IndexedDB player object.
 * This is the master-data equivalent of generatePlayer().
 */
function prepareMasterPlayer(masterData, campaignId, teamId, teamAbbreviation) {
  const playerId = generateUUID()
  const age = masterData._age ?? (masterData.birthDate ? (2025 - parseInt(masterData.birthDate.substring(0, 4))) : 25)
  const heightInches = masterData.heightInches ?? 78
  const weightLbs = masterData.weightLbs ?? 210
  const overall = masterData.overallRating ?? 75
  const position = masterData.position ?? 'SF'
  const salary = masterData.contractSalary ?? calculateSalary(overall, age)
  const contractYears = randInt(1, 4)
  const contractDetailsObj = {
    totalYears: randInt(2, 5),
    salaries: [salary],
    options: {},
    noTradeClause: false,
  }

  // Generate attributes/tendencies/badges/personality when master data is missing them
  const attrs = masterData.attributes ?? generateAttributes(position, overall)
  const tends = masterData.tendencies ?? generateTendencies(position)
  const bdgs = (masterData.badges && masterData.badges.length > 0)
    ? masterData.badges
    : generateBadges(position, overall)
  const pers = (masterData.personality && masterData.personality.traits?.length > 0)
    ? masterData.personality
    : generatePersonality()

  // Generate motivations when missing
  const motivations = masterData.motivations ?? generateMotivations({
    age, overallRating: overall, personality: pers,
  })

  // Generate potential with upside when missing
  const potentialDefault = Math.min(99, overall + randInt(0, 6))
  const potentialRating = masterData.potentialRating ?? potentialDefault

  // Generate trade value when missing
  let tradeValue = masterData.tradeValue
  let tradeValueTotal = masterData.tradeValueTotal
  if (tradeValue == null) {
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
    tradeValue = Math.round(tv * 100) / 100
    tradeValueTotal = Math.round(tv * randFloat(0.6, 0.9) * 100) / 100
  }

  return {
    // IndexedDB keys
    campaignId,
    id: playerId,

    // Core identity — preserved from master data
    teamId,
    teamAbbreviation,
    isFreeAgent: teamId ? 0 : 1,
    firstName: masterData.firstName,
    first_name: masterData.firstName,
    lastName: masterData.lastName,
    last_name: masterData.lastName,
    name: `${masterData.firstName} ${masterData.lastName}`,
    position,
    secondaryPosition: masterData.secondaryPosition ?? null,
    secondary_position: masterData.secondaryPosition ?? null,
    jerseyNumber: masterData.jerseyNumber,
    jersey_number: masterData.jerseyNumber,
    heightInches,
    height_inches: heightInches,
    height: `${Math.floor(heightInches / 12)}'${heightInches % 12}"`,
    weightLbs,
    weight_lbs: weightLbs,
    weight: weightLbs,
    wingspanInches: masterData.wingspanInches ?? heightInches + randInt(0, 5),
    birthDate: masterData.birthDate,
    birth_date: masterData.birthDate,
    age,
    country: masterData.country ?? 'United States',
    college: masterData.college ?? null,
    hometown: masterData.hometown ?? null,
    draftYear: masterData.draftYear ?? null,
    draftRound: masterData.draftRound ?? null,
    draftPick: masterData.draftPick ?? null,

    // Ratings — preserved from master data
    overallRating: overall,
    overall_rating: overall,
    potentialRating,
    potential_rating: potentialRating,
    archetype: masterData.archetype ?? null,

    // Attributes & gameplay — generated when missing from master data
    attributes: attrs,
    tendencies: tends,
    badges: bdgs,
    personality: pers,
    motivations,

    // Contract
    contractYearsRemaining: contractYears,
    contract_years_remaining: contractYears,
    contractSalary: salary,
    contract_salary: salary,
    contractDetails: contractDetailsObj,
    contract_details: contractDetailsObj,
    tradeValue,
    tradeValueTotal,
    injuryRisk: masterData.injuryRisk ?? 'M',

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

// =============================================================================
// RANDOM PLAYER GENERATION DATA (used as fallback / fantasy fill)
// =============================================================================
// Mirrors the PHP PlayerSeeder arrays and logic.

const FIRST_NAMES = [
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

const LAST_NAMES = [
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

const BADGES_BY_POSITION = {
  PG: ['dimer', 'floor_general', 'pick_and_roll_maestro', 'ankle_breaker', 'quick_first_step', 'tight_handles', 'needle_threader', 'handles_for_days', 'space_creator', 'clamps'],
  SG: ['catch_and_shoot', 'deadeye', 'corner_specialist', 'clutch_shooter', 'difficult_shots', 'green_machine', 'clamps', 'interceptor', 'tireless_shooter', 'ankle_breaker'],
  SF: ['catch_and_shoot', 'slithery_finisher', 'contact_finisher', 'clamps', 'interceptor', 'rebound_chaser', 'corner_specialist', 'deadeye', 'pro_touch', 'chase_down_artist'],
  PF: ['contact_finisher', 'putback_boss', 'rim_protector', 'box', 'rebound_chaser', 'brick_wall', 'post_lockdown', 'intimidator', 'catch_and_shoot', 'pick_and_roll_maestro'],
  C: ['rim_protector', 'intimidator', 'box', 'rebound_chaser', 'post_lockdown', 'brick_wall', 'worm', 'pogo_stick', 'lob_city_finisher', 'putback_boss'],
}

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

function generateOffenseAttributes(position, base, variance) {
  const mods = OFFENSE_MODS[position] ?? OFFENSE_MODS.SF
  return {
    threePoint:   clampRating(base + mods.threePoint   + randInt(-variance, variance)),
    midRange:     clampRating(base + mods.midRange     + randInt(-variance, variance)),
    postScoring:  clampRating(base + mods.postScoring  + randInt(-variance, variance)),
    layup:        clampRating(base + mods.layup        + randInt(-variance, variance)),
    dunk:         clampRating(base + mods.dunk         + randInt(-variance, variance)),
    ballHandling: clampRating(base + mods.ballHandling + randInt(-variance, variance)),
    passing:      clampRating(base + mods.passing      + randInt(-variance, variance)),
    speedWithBall:clampRating(base + mods.speedWithBall+ randInt(-variance, variance)),
  }
}

function generateDefenseAttributes(position, base, variance) {
  const mods = DEFENSE_MODS[position] ?? DEFENSE_MODS.SF
  return {
    perimeterD:  clampRating(base + mods.perimeterD  + randInt(-variance, variance)),
    interiorD:   clampRating(base + mods.interiorD   + randInt(-variance, variance)),
    steal:       clampRating(base + mods.steal       + randInt(-variance, variance)),
    block:       clampRating(base + mods.block       + randInt(-variance, variance)),
    defensiveIQ: clampRating(base + mods.defensiveIQ + randInt(-variance, variance)),
  }
}

function generatePhysicalAttributes(position, base, variance) {
  const mods = PHYSICAL_MODS[position] ?? PHYSICAL_MODS.SF
  return {
    speed:        clampRating(base + mods.speed        + randInt(-variance, variance)),
    acceleration: clampRating(base + mods.acceleration + randInt(-variance, variance)),
    strength:     clampRating(base + mods.strength     + randInt(-variance, variance)),
    vertical:     clampRating(base + mods.vertical     + randInt(-variance, variance)),
    stamina:      clampRating(base + mods.stamina      + randInt(-variance, variance)),
  }
}

function generateMentalAttributes(base, variance) {
  return {
    basketballIQ: clampRating(base + randInt(-variance, variance)),
    consistency:  clampRating(base + randInt(-variance, variance)),
    clutch:       clampRating(base + randInt(-variance, variance)),
    workEthic:    clampRating(randInt(60, 95)),
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
  let baseSalary
  if (overall >= 92)      baseSalary = randInt(40000000, 50000000)
  else if (overall >= 88) baseSalary = randInt(30000000, 42000000)
  else if (overall >= 84) baseSalary = randInt(20000000, 32000000)
  else if (overall >= 80) baseSalary = randInt(12000000, 22000000)
  else if (overall >= 76) baseSalary = randInt(6000000, 14000000)
  else if (overall >= 72) baseSalary = randInt(3000000, 8000000)
  else if (overall >= 68) baseSalary = randInt(1500000, 4000000)
  else                    baseSalary = randInt(900000, 2000000)

  // Age adjustment
  if (age >= 33) baseSalary = Math.round(baseSalary * 0.85)
  else if (age <= 23) baseSalary = Math.round(baseSalary * 0.7)

  return Math.round(baseSalary / 10000) * 10000
}

function generateContract(overall, age) {
  const yearsRemaining = randInt(1, 4)
  const salary = calculateSalary(overall, age)

  const salaries = []
  for (let i = 0; i <= yearsRemaining; i++) {
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
  await TeamRepository.saveBulk(teams)

  // -------------------------------------------------------------------------
  // 3. Find user's team
  // -------------------------------------------------------------------------
  const userTeam = teams.find(t => t.abbreviation === teamAbbreviation)
  if (!userTeam) {
    throw new Error(`Selected team "${teamAbbreviation}" not found`)
  }

  // -------------------------------------------------------------------------
  // 4. Load master players and assign to teams
  // -------------------------------------------------------------------------
  let allPlayers = []

  // Build team abbreviation → team ID lookup
  const teamsByAbbr = {}
  for (const team of teams) {
    teamsByAbbr[team.abbreviation] = team
  }

  if (!isFantasy) {
    // Standard mode: load master players, randomize, assign to teams by teamAbbreviation
    for (const masterEntry of playersMaster) {
      const randomized = randomizePlayerData(masterEntry)
      const abbr = randomized.teamAbbreviation
      const team = teamsByAbbr[abbr]

      if (team) {
        const player = prepareMasterPlayer(randomized, campaignId, team.id, abbr)
        allPlayers.push(player)
      } else {
        // Player's team not found (e.g. free agent or unknown abbreviation) — add as free agent
        const player = prepareMasterPlayer(randomized, campaignId, null, abbr)
        player.isFreeAgent = 1
        allPlayers.push(player)
      }
    }
    await PlayerRepository.saveBulk(allPlayers)

    // Update team payroll from master players
    for (const team of teams) {
      const teamPlayers = allPlayers.filter(p => p.teamId === team.id)
      const totalPayroll = teamPlayers.reduce((sum, p) => sum + (p.contractSalary ?? 0), 0)
      team.total_payroll = totalPayroll
      team.totalPayroll = totalPayroll
    }
    await TeamRepository.saveBulk(teams)
  } else {
    // Fantasy draft mode: load all master players as free agents
    for (const masterEntry of playersMaster) {
      const randomized = randomizePlayerData(masterEntry)
      const player = prepareMasterPlayer(randomized, campaignId, null, 'FA')
      player.isFreeAgent = 1
      allPlayers.push(player)
    }
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
      team.coaching_scheme = {
        offensive: team.coach?.offensiveScheme ?? 'balanced',
        defensive: team.coach?.defensiveScheme ?? 'man_to_man',
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
  // -------------------------------------------------------------------------
  await generateAndSaveRookieClass(campaignId, 1)

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

    const cs = team.coach.career_stats || {}
    cs.seasons_coached = (cs.seasons_coached ?? 0) + 1
    cs.wins = (cs.wins ?? 0) + (standing.wins ?? 0)
    cs.losses = (cs.losses ?? 0) + (standing.losses ?? 0)
    const totalGames = cs.wins + cs.losses
    cs.win_pct = totalGames > 0 ? Math.round((cs.wins / totalGames) * 1000) / 1000 : 0

    // Playoff record
    const pr = playoffRecord[team.id]
    if (pr) {
      cs.playoff_wins = (cs.playoff_wins ?? 0) + pr.wins
      cs.playoff_losses = (cs.playoff_losses ?? 0) + pr.losses
    }
    const totalPlayoffGames = (cs.playoff_wins ?? 0) + (cs.playoff_losses ?? 0)
    cs.playoff_win_pct = totalPlayoffGames > 0
      ? Math.round(((cs.playoff_wins ?? 0) / totalPlayoffGames) * 1000) / 1000
      : 0

    const isChampion = bracket?.champion?.teamId === team.id
    if (isChampion) {
      cs.championships = (cs.championships ?? 0) + 1
    }

    team.coach.career_stats = cs
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
 * Enter the offseason phase: archive data, process season end, run AI contracts.
 * Does NOT start the new season — the user gets an interactive offseason period first.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} { campaign, seasonEndResult, aiContractResults, userExpiringPlayers }
 */
export async function enterOffseason(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

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
    AwardService.applyAwardsToPlayers(allPlayers, awardResults)
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
          teamId: null,
          teamAbbreviation: 'FA',
        }
      }
    }
  }

  // 4b. Backfill AI teams to 14 players after expired-contract releases
  const backfillResult = ensureMinimumRosters({
    aiTeams,
    leaguePlayers: updatedPlayers,
  })
  updatedPlayers = backfillResult.updatedPlayers
  aiContractResults.signings.push(...backfillResult.signings)

  await PlayerRepository.saveBulk(
    updatedPlayers.map(p => ({ ...p, campaignId }))
  )

  // 5. Update campaign phase
  campaign.phase = 'offseason'
  // Reset trade deadline for next season
  if (campaign.settings) {
    delete campaign.settings.trade_deadline_passed
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

  if (campaign.phase !== 'offseason') {
    throw new Error('Campaign must be in offseason phase to start a new season')
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
        teamId: null,
        teamAbbreviation: 'FA',
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

  // 3d. Decrement scout contract (2-season contracts)
  if (campaign.settings.scout) {
    campaign.settings.scout.contractYears -= 1
    if (campaign.settings.scout.contractYears <= 0) {
      delete campaign.settings.scout
    }
  }

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

  // 5. Generate next year's rookie class (viewable on Scouting page throughout the season)
  const newGameYear = campaign.gameYear
  await generateAndSaveRookieClass(campaignId, newGameYear)

  // 6. Re-initialize all team lineups + target minutes
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

  return TEAMS.map((template, index) => {
    const teamId = generateUUID()
    const tier = getTeamTier(template.abbreviation)

    // Generate coach for this team
    const coach = generateCoach(tier, index, usedCoachNames)

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
}

/**
 * Generate a coach for a team.
 *
 * @param {number} tier - Team tier (1-4)
 * @param {number} index - Team index for name assignment
 * @param {Set} usedNames - Set of already-used "first last" name strings
 * @returns {Object} Coach object
 */
function generateCoach(tier, index, usedNames) {
  const range = COACH_TIER_RANGES[tier] ?? COACH_TIER_RANGES[3]
  const overall = randInt(range[0], range[1])
  const attributes = generateCoachAttributes(overall)
  const salary = calculateCoachSalary(overall)
  const offensiveScheme = pickRandom(OFFENSIVE_SCHEMES)
  const defensiveScheme = pickRandom(DEFENSIVE_SCHEMES)

  // Generate unique name
  let firstName, lastName, fullName
  let attempts = 0
  do {
    firstName = COACH_FIRST_NAMES[
      (index + attempts) % COACH_FIRST_NAMES.length
    ]
    lastName = COACH_LAST_NAMES[
      (index + attempts) % COACH_LAST_NAMES.length
    ]
    fullName = `${firstName} ${lastName}`
    attempts++
  } while (usedNames.has(fullName) && attempts < 100)
  usedNames.add(fullName)

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
    contractYearsRemaining: randInt(1, 4),
    contract_years_remaining: randInt(1, 4),
    contractSalary: salary,
    contract_salary: salary,
    // Career stats start at zero
    career_wins: 0,
    career_losses: 0,
    playoff_wins: 0,
    playoff_losses: 0,
    championships: 0,
    seasons_coached: 0,
  }
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
