// =============================================================================
// RookieGenerationService.js
// =============================================================================
// Generates 80 rookie prospects per draft class with tiered distributions,
// college/international diversity, and realistic name generation.
// =============================================================================

import { generatePlayer, FIRST_NAMES as FAKE_FIRST_NAMES, LAST_NAMES as FAKE_LAST_NAMES } from '../campaign/CampaignManager'
import { PlayerRepository } from '../db/PlayerRepository'

// Build list of available headshot filenames for random assignment to rookies
const headshotModules = import.meta.glob('@/assets/headshots/*.png', { eager: true })
const AVAILABLE_HEADSHOTS = Object.keys(headshotModules).map(k => k.split('/').pop())

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_CONFIG = [
  { name: 'franchise',   min: 2,  max: 3,  ovrMin: 72, ovrMax: 78, potMin: 88, potMax: 97, ageMin: 19, ageMax: 20, workEthicMin: 60, workEthicMax: 95 },
  { name: 'lottery',     min: 5,  max: 8,  ovrMin: 68, ovrMax: 74, potMin: 80, potMax: 90, ageMin: 19, ageMax: 21, workEthicMin: 60, workEthicMax: 95 },
  { name: 'firstRound',  min: 10, max: 15, ovrMin: 65, ovrMax: 72, potMin: 72, potMax: 82, ageMin: 19, ageMax: 22, workEthicMin: 55, workEthicMax: 90 },
  { name: 'secondRound', min: 15, max: 20, ovrMin: 60, ovrMax: 68, potMin: 65, potMax: 75, ageMin: 20, ageMax: 22, workEthicMin: 50, workEthicMax: 85 },
  { name: 'undrafted',   min: 30, max: 35, ovrMin: 55, ovrMax: 65, potMin: 58, potMax: 70, ageMin: 20, ageMax: 22, workEthicMin: 50, workEthicMax: 85 },
]

// A once-every-few-years can't-miss prospect. Replaces one franchise slot
// in a class when present. Higher floor, max potential, top work ethic.
const GENERATIONAL_TIER = {
  name: 'generational',
  ovrMin: 78, ovrMax: 82,
  potMin: 99, potMax: 99,
  ageMin: 18, ageMax: 19,
  workEthicMin: 85, workEthicMax: 99,
}

const POSITION_WEIGHTS = [
  { position: 'PG', weight: 0.20 },
  { position: 'SG', weight: 0.20 },
  { position: 'SF', weight: 0.25 },
  { position: 'PF', weight: 0.20 },
  { position: 'C',  weight: 0.15 },
]

const US_COLLEGES = [
  // Power 5
  'Duke', 'Kentucky', 'North Carolina', 'Kansas', 'UCLA', 'Michigan State', 'Gonzaga',
  'Villanova', 'Louisville', 'Syracuse', 'Indiana', 'Connecticut', 'Arizona', 'Florida',
  'Ohio State', 'Michigan', 'Texas', 'Georgetown', 'Wake Forest', 'Memphis', 'LSU',
  'Auburn', 'Baylor', 'Tennessee', 'Virginia', 'Wisconsin', 'Purdue', 'Iowa State',
  'Oregon', 'Maryland', 'Georgia Tech', 'Creighton', 'Marquette', 'Houston', 'USC',
  'Stanford', 'Notre Dame', 'Oklahoma', 'Arkansas', 'Alabama',
  // Mid-Majors
  'Dayton', 'Xavier', 'Butler', 'Providence', 'San Diego State', 'Saint Louis',
  'VCU', 'Wichita State', 'Murray State', 'Loyola Chicago', 'Saint Mary\'s',
  'BYU', 'Davidson', 'Belmont', 'Drake', 'Nevada', 'New Mexico',
  'Colorado State', 'Utah State', 'UNLV', 'Cincinnati', 'UCF', 'SMU',
  // Small Schools
  'Oral Roberts', 'Saint Peter\'s', 'Furman', 'Princeton', 'Colgate',
  'Iona', 'Vermont', 'Chattanooga', 'Northern Iowa', 'Middle Tennessee',
  'Hampton', 'Norfolk State', 'Grambling State', 'Howard', 'Florida Atlantic',
  'Kennesaw State', 'UNC Asheville', 'Fairleigh Dickinson', 'Montana State', 'Liberty',
]

const INTERNATIONAL_ORIGINS = [
  { country: 'France',    clubs: ['ASVEL (France)', 'Paris Basketball (France)', 'Metropolitans 92 (France)', 'Limoges CSP (France)'] },
  { country: 'Spain',     clubs: ['Real Madrid (Spain)', 'FC Barcelona (Spain)', 'Baskonia (Spain)', 'Valencia Basket (Spain)'] },
  { country: 'Australia', clubs: ['Melbourne United (Australia)', 'Sydney Kings (Australia)', 'Perth Wildcats (Australia)', 'NBL Academy (Australia)'] },
  { country: 'Serbia',    clubs: ['Partizan (Serbia)', 'Crvena Zvezda (Serbia)', 'Mega Basket (Serbia)'] },
  { country: 'Canada',    clubs: ['NBA Academy (Canada)', 'Orangeville Prep (Canada)', 'Montevideo (Canada)'] },
  { country: 'Germany',   clubs: ['Bayern Munich (Germany)', 'Alba Berlin (Germany)', 'Ratiopharm Ulm (Germany)'] },
  { country: 'Greece',    clubs: ['Olympiacos (Greece)', 'Panathinaikos (Greece)', 'AEK Athens (Greece)'] },
  { country: 'Nigeria',   clubs: ['NBA Academy Africa', 'Rivers Hoopers (Nigeria)'] },
  { country: 'Japan',     clubs: ['Alvark Tokyo (Japan)', 'Chiba Jets (Japan)', 'B.League Academy (Japan)'] },
  { country: 'Brazil',    clubs: ['Flamengo (Brazil)', 'Franca (Brazil)', 'Sao Paulo FC (Brazil)'] },
  { country: 'Turkey',    clubs: ['Fenerbahce (Turkey)', 'Anadolu Efes (Turkey)', 'Galatasaray (Turkey)'] },
  { country: 'Slovenia',  clubs: ['Cedevita Olimpija (Slovenia)', 'Union Olimpija (Slovenia)'] },
  { country: 'Croatia',   clubs: ['Cibona (Croatia)', 'Zadar (Croatia)'] },
  { country: 'Lithuania', clubs: ['Zalgiris Kaunas (Lithuania)', 'Rytas Vilnius (Lithuania)'] },
  { country: 'Cameroon',  clubs: ['NBA Academy Africa', 'Seeds Academy (Cameroon)'] },
  { country: 'Senegal',   clubs: ['NBA Academy Africa', 'SEED Academy (Senegal)'] },
  { country: 'Italy',     clubs: ['Virtus Bologna (Italy)', 'Olimpia Milano (Italy)'] },
  { country: 'Israel',    clubs: ['Maccabi Tel Aviv (Israel)', 'Hapoel Jerusalem (Israel)'] },
]

// Rookie names are pulled from the scrambled pool exported by CampaignManager
// (see FAKE_FIRST_NAMES / FAKE_LAST_NAMES at top of this file). The raw
// rookie-name arrays that used to live here contained NBA-derived names
// (Wembanyama, Chet, Scoot, etc.) — removed to avoid identifiability under
// publicity-rights law.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function clampRating(val) {
  return Math.max(25, Math.min(99, Math.round(val)))
}

/**
 * Distribute positions across a count of players using weighted random assignment.
 */
function distributePositions(count) {
  const positions = []
  // Guarantee at least some of each position
  const minPerPos = Math.max(1, Math.floor(count / 10))
  for (const { position } of POSITION_WEIGHTS) {
    for (let i = 0; i < minPerPos; i++) {
      positions.push(position)
    }
  }
  // Fill remaining with weighted random
  while (positions.length < count) {
    const roll = Math.random()
    let cumulative = 0
    for (const { position, weight } of POSITION_WEIGHTS) {
      cumulative += weight
      if (roll < cumulative) {
        positions.push(position)
        break
      }
    }
  }
  return shuffleArray(positions)
}

// ---------------------------------------------------------------------------
// Generational decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a draft class should include a generational prospect.
 *
 * Targets roughly one generational per 3-4 years:
 *   - Hard floor: at least 3 years between generationals
 *   - Year 3: ~40% chance
 *   - Year 4: ~70% chance
 *   - Year 5+: guaranteed
 * If no prior generational has been recorded, gives a 25% chance on the
 * first roll so an early-campaign player isn't denied one.
 *
 * @param {Object} campaign - Loaded campaign object (reads settings.lastGenerationalDraftYear)
 * @param {number} draftYear - The draft year being generated
 * @returns {boolean}
 */
export function shouldGenerateGenerational(campaign, draftYear) {
  const last = campaign?.settings?.lastGenerationalDraftYear
  if (typeof last !== 'number') {
    return Math.random() < 0.25
  }
  const yearsSince = draftYear - last
  if (yearsSince < 3) return false
  if (yearsSince >= 5) return true
  if (yearsSince === 3) return Math.random() < 0.40
  return Math.random() < 0.70 // yearsSince === 4
}

// ---------------------------------------------------------------------------
// Main Generation
// ---------------------------------------------------------------------------

/**
 * Generate a class of 80 rookie prospects for a draft year.
 *
 * @param {string} campaignId
 * @param {number} gameYear - The draft year / game year
 * @param {Set<string>} [existingNames] - Names already in use (collision avoidance)
 * @param {Object} [options]
 * @param {boolean} [options.includeGenerational] - If true, one franchise slot
 *   is upgraded to a generational prospect (99 potential, top work ethic).
 * @returns {Array} Array of 80 player objects ready for PlayerRepository
 */
export function generateRookieClass(campaignId, gameYear, existingNames = new Set(), options = {}) {
  const { includeGenerational = false } = options
  const rookies = []
  const usedNames = new Set(existingNames)
  const totalTarget = 80

  // Determine tier counts within allowed ranges
  const tierCounts = []
  let remaining = totalTarget

  for (let i = 0; i < TIER_CONFIG.length; i++) {
    const tier = TIER_CONFIG[i]
    if (i === TIER_CONFIG.length - 1) {
      // Last tier gets whatever remains
      tierCounts.push(Math.max(tier.min, Math.min(tier.max, remaining)))
    } else {
      const count = randInt(tier.min, tier.max)
      tierCounts.push(count)
      remaining -= count
    }
  }

  // Distribute positions across all 80 rookies
  const positions = distributePositions(totalTarget)
  let posIdx = 0

  // ~20% international
  const internationalCount = randInt(14, 18)
  const internationalIndices = new Set()
  const allIndices = Array.from({ length: totalTarget }, (_, i) => i)
  const shuffledIndices = shuffleArray(allIndices)
  for (let i = 0; i < internationalCount; i++) {
    internationalIndices.add(shuffledIndices[i])
  }

  let globalIdx = 0
  const usedHeadshots = new Set()
  const availableHeadshotPool = [...AVAILABLE_HEADSHOTS]

  // If a generational is requested, the first franchise slot is upgraded.
  let generationalRemaining = includeGenerational ? 1 : 0

  for (let tierIdx = 0; tierIdx < TIER_CONFIG.length; tierIdx++) {
    const baseTier = TIER_CONFIG[tierIdx]
    const count = tierCounts[tierIdx]

    for (let j = 0; j < count; j++) {
      const isGenerationalSlot =
        baseTier.name === 'franchise' && generationalRemaining > 0
      const tier = isGenerationalSlot ? GENERATIONAL_TIER : baseTier
      if (isGenerationalSlot) generationalRemaining--

      const position = positions[posIdx++] || 'SF'
      const isInternational = internationalIndices.has(globalIdx)

      // Generate OVR and POT within tier range
      const overall = randInt(tier.ovrMin, tier.ovrMax)
      const potential = randInt(
        Math.max(tier.potMin, overall),
        tier.potMax
      )
      const age = randInt(tier.ageMin, tier.ageMax)

      // Generate the base player using existing infrastructure
      const player = generatePlayer({
        campaignId,
        teamId: null,
        teamAbbreviation: 'FA',
        position,
        overall,
        jerseyNumber: randInt(0, 99),
        teamIndex: 100 + globalIdx, // offset to avoid collision with team roster generation
        posIndex: globalIdx,
      })

      // Override with rookie-specific values
      player.potentialRating = potential
      player.potential_rating = potential
      player.age = age
      const birthYear = 2025 - age
      const birthMonth = String(randInt(1, 12)).padStart(2, '0')
      const birthDay = String(randInt(1, 28)).padStart(2, '0')
      player.birthDate = `${birthYear}-${birthMonth}-${birthDay}`
      player.birth_date = player.birthDate
      // Stamp the draft year so the next birthday tick (which compares to
      // currentSeasonYear) doesn't immediately re-age the rookie before
      // their actual birthday in their first NBA season.
      player._lastBirthdayYear = gameYear

      // Rookie draft prospect flags
      player.isFreeAgent = 1
      player.isDraftProspect = true
      player.draftYear = gameYear
      player.teamId = null
      player.teamAbbreviation = 'FA'

      // No contract yet (assigned after draft)
      player.contractSalary = 0
      player.contract_salary = 0
      player.contractYearsRemaining = 0
      player.contract_years_remaining = 0
      player.contractDetails = null
      player.contract_details = null

      // Work ethic variance by tier
      player.attributes.mental.workEthic = randInt(tier.workEthicMin, tier.workEthicMax)

      // Career seasons = 0 (rookie)
      player.careerSeasons = 0
      player.career_seasons = 0

      // Generate unique name
      const { firstName, lastName } = generateUniqueName(isInternational, usedNames)
      player.firstName = firstName
      player.first_name = firstName
      player.lastName = lastName
      player.last_name = lastName
      player.name = `${firstName} ${lastName}`
      usedNames.add(player.name)

      // Assign a random headshot, avoiding duplicates within this class
      if (availableHeadshotPool.length > 0) {
        // Reset pool if we've used all available headshots
        if (usedHeadshots.size >= AVAILABLE_HEADSHOTS.length) {
          usedHeadshots.clear()
          availableHeadshotPool.length = 0
          availableHeadshotPool.push(...AVAILABLE_HEADSHOTS)
        }
        const remaining = availableHeadshotPool.filter(h => !usedHeadshots.has(h))
        const chosen = pickRandom(remaining.length > 0 ? remaining : availableHeadshotPool)
        player.headshot = chosen
        usedHeadshots.add(chosen)
      } else {
        player.headshot = null
      }

      // College / international origin
      if (isInternational) {
        const origin = pickRandom(INTERNATIONAL_ORIGINS)
        player.country = origin.country
        player.college = pickRandom(origin.clubs)
        player.hometown = null
      } else {
        player.country = 'United States'
        player.college = pickRandom(US_COLLEGES)
      }

      // Store tier info for scouting display
      player.rookieTier = tier.name
      if (isGenerationalSlot) {
        player.isGenerational = true
      }

      rookies.push(player)
      globalIdx++
    }
  }

  return rookies
}

// Combined name pools — mashes rookie-specific names with the AI-generation
// "fake" pool so a rookie can pair, e.g., a rookie first name with a fake
// last name (or vice versa). Deduped so popular names aren't over-weighted.
// Built lazily on first use to dodge a TDZ from the circular import between
// this module and CampaignManager (which imports generateAndSaveRookieClass).
let _combinedFirstNames = null
let _combinedLastNames = null
function getCombinedFirstNames() {
  // Use the scrambled pool exclusively. The raw ROOKIE_FIRST_NAMES still
  // contains real-derived names (Wembanyama, Chet, Scoot, etc.) so feeding
  // them straight in would reintroduce identifiability. The scrambled pool
  // from CampaignManager has thousands of unique made-up names already.
  if (!_combinedFirstNames) {
    _combinedFirstNames = [...(FAKE_FIRST_NAMES ?? [])]
  }
  return _combinedFirstNames
}
function getCombinedLastNames() {
  if (!_combinedLastNames) {
    _combinedLastNames = [...(FAKE_LAST_NAMES ?? [])]
  }
  return _combinedLastNames
}

/**
 * Generate a unique name that doesn't collide with existing players.
 */
function generateUniqueName(isInternational, usedNames) {
  let attempts = 0
  let firstName, lastName, fullName
  const firstPool = getCombinedFirstNames()
  const lastPool = getCombinedLastNames()

  do {
    firstName = pickRandom(firstPool)
    lastName = pickRandom(lastPool)
    fullName = `${firstName} ${lastName}`
    attempts++
  } while (usedNames.has(fullName) && attempts < 200)

  // If still colliding after 200 attempts, add a suffix
  if (usedNames.has(fullName)) {
    lastName = lastName + ' Jr.'
    fullName = `${firstName} ${lastName}`
  }

  return { firstName, lastName }
}

/**
 * Repair any rookie whose stored overallRating exceeds potentialRating.
 * Returns the count of fixes applied. Mutates the input array in place.
 */
function repairRookiePotentials(rookies) {
  let fixed = 0
  for (const r of rookies) {
    const ovr = r.overallRating ?? r.overall_rating ?? 0
    const pot = r.potentialRating ?? r.potential_rating ?? 0
    if (ovr > pot) {
      r.potentialRating = ovr
      r.potential_rating = ovr
      fixed++
    }
  }
  return fixed
}

/**
 * Generate rookie class and save to PlayerRepository.
 *
 * @param {string} campaignId
 * @param {number} gameYear
 * @param {Object} [options]
 * @param {boolean} [options.includeGenerational] - See generateRookieClass.
 * @returns {Promise<Array>} The generated rookies
 */
export async function generateAndSaveRookieClass(campaignId, gameYear, options = {}) {
  // Load existing player names to avoid collisions
  const existingPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  const existingNames = new Set(existingPlayers.map(p => p.name || `${p.firstName} ${p.lastName}`))

  // Don't regenerate if we already have prospects for this year
  const existingProspects = existingPlayers.filter(
    p => p.isDraftProspect && p.draftYear === gameYear
  )
  if (existingProspects.length > 0) {
    // Repair any pre-existing rookies whose overall exceeds their potential
    // (defensive — the generator guards against this, but stale data can drift).
    const fixed = repairRookiePotentials(existingProspects)
    if (fixed > 0) {
      await PlayerRepository.saveBulk(existingProspects.map(p => ({ ...p, campaignId })))
    }
    return existingProspects
  }

  const rookies = generateRookieClass(campaignId, gameYear, existingNames, options)
  repairRookiePotentials(rookies)
  await PlayerRepository.saveBulk(rookies)
  return rookies
}
