// =============================================================================
// RookieGenerationService.js
// =============================================================================
// Generates 80 rookie prospects per draft class with tiered distributions,
// college/international diversity, and realistic name generation.
// =============================================================================

import { generatePlayer } from '../campaign/CampaignManager'
import { PlayerRepository } from '../db/PlayerRepository'

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

const ROOKIE_FIRST_NAMES = [
  'Jaylen', 'Tyrese', 'Jalen', 'Cam', 'Dereck', 'Scoot', 'Amen', 'Ausar',
  'Chet', 'Jarace', 'GG', 'Keyonte', 'Gradey', 'Bilal', 'Kobe', 'Brandin',
  'Brice', 'Terquavion', 'Jordan', 'Dariq', 'Leonard', 'Kris', 'Tristan',
  'Jaime', 'Olivier', 'Zach', 'Colby', 'Cason', 'Maxwell', 'Adem',
  'Dillon', 'Trevon', 'Keon', 'Nick', 'Andre', 'Toumani', 'Moussa',
  'Ibrahima', 'Rayan', 'Hugo', 'Ousmane', 'Killian', 'Theo', 'Victor',
  'Alexandre', 'Yuki', 'Rui', 'Kai', 'Matheus', 'Gui', 'Deni',
  'Marcus', 'Anthony', 'DeAndre', 'Malik', 'Trey', 'Xavier', 'Caleb',
  'Isaiah', 'Josiah', 'Elijah', 'Micah', 'Darius', 'Quincy', 'Amari',
  'Jaylin', 'Tariq', 'Marquis', 'Donovan', 'Javonte', 'Kendall', 'Dashawn',
  'Rasheed', 'Kofi', 'Ayo', 'Chima', 'Emeka', 'Bam', 'Precious',
  'Jett', 'Reed', 'Stone', 'Cash', 'Ace', 'Knox', 'Cruz',
  'Blake', 'Bryce', 'Cole', 'Drew', 'Grant', 'Reece', 'Tate', 'Wade',
]

const ROOKIE_LAST_NAMES = [
  'Thompson', 'Walker', 'Henderson', 'Watkins', 'Dixon', 'Pierce', 'Lively',
  'Whitmore', 'Miller', 'Sensabaugh', 'Jackson', 'Filipowski', 'Dick', 'Coulibaly',
  'Bufkin', 'Podziemski', 'Hawkins', 'Wallace', 'Livingston', 'Washington',
  'Daniels', 'Risacher', 'Da Silva', 'Sarr', 'Buzelis', 'Castle', 'Topic',
  'Clingan', 'Edey', 'Missi', 'Sallis', 'Sheddon', 'Sheppard', 'Reed',
  'Mitchell', 'Diallo', 'Diabate', 'Traore', 'Maledon', 'Bamba',
  'Camara', 'Ndiaye', 'Kawamura', 'Hachimura', 'Watanabe', 'Santos',
  'Silva', 'Avdija', 'Bazley', 'Okpala', 'Kuminga',
  'Brooks', 'Coleman', 'Foster', 'Harris', 'Jenkins', 'King', 'Lewis',
  'Morgan', 'Nelson', 'Owens', 'Patterson', 'Reynolds', 'Shaw', 'Tucker',
  'Underwood', 'Vaughn', 'Webb', 'Young', 'Zhang', 'Adams', 'Banks',
  'Chambers', 'Douglas', 'Ellis', 'Floyd', 'Gordon', 'Hunt', 'Ingram',
  'Jefferson', 'Knight', 'Lambert', 'Mason', 'Newton', 'Oliver', 'Price',
  'Quinn', 'Roberts', 'Sanders', 'Taylor', 'Upton', 'Vincent', 'Watts',
]

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
// Main Generation
// ---------------------------------------------------------------------------

/**
 * Generate a class of 80 rookie prospects for a draft year.
 *
 * @param {string} campaignId
 * @param {number} gameYear - The draft year / game year
 * @param {Set<string>} [existingNames] - Names already in use (collision avoidance)
 * @returns {Array} Array of 80 player objects ready for PlayerRepository
 */
export function generateRookieClass(campaignId, gameYear, existingNames = new Set()) {
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

  for (let tierIdx = 0; tierIdx < TIER_CONFIG.length; tierIdx++) {
    const tier = TIER_CONFIG[tierIdx]
    const count = tierCounts[tierIdx]

    for (let j = 0; j < count; j++) {
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

      rookies.push(player)
      globalIdx++
    }
  }

  return rookies
}

/**
 * Generate a unique name that doesn't collide with existing players.
 */
function generateUniqueName(isInternational, usedNames) {
  let attempts = 0
  let firstName, lastName, fullName

  do {
    firstName = pickRandom(ROOKIE_FIRST_NAMES)
    lastName = pickRandom(ROOKIE_LAST_NAMES)
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
 * Generate rookie class and save to PlayerRepository.
 *
 * @param {string} campaignId
 * @param {number} gameYear
 * @returns {Promise<Array>} The generated rookies
 */
export async function generateAndSaveRookieClass(campaignId, gameYear) {
  // Load existing player names to avoid collisions
  const existingPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  const existingNames = new Set(existingPlayers.map(p => p.name || `${p.firstName} ${p.lastName}`))

  // Don't regenerate if we already have prospects for this year
  const existingProspects = existingPlayers.filter(
    p => p.isDraftProspect && p.draftYear === gameYear
  )
  if (existingProspects.length > 0) {
    return existingProspects
  }

  const rookies = generateRookieClass(campaignId, gameYear, existingNames)
  await PlayerRepository.saveBulk(rookies)
  return rookies
}
