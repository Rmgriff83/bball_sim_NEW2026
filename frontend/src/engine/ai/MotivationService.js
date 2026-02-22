// =============================================================================
// MotivationService.js
// =============================================================================
// Player motivation and retention scoring system.
// Each player has weighted motivations that drive free agency decisions,
// trade risk assessment, and re-sign negotiations.
// =============================================================================

// =============================================================================
// MARKET SIZE MAP
// =============================================================================

const MARKET_SIZE_MAP = {
  // Large markets
  NYK: 'large', NYM: 'large', // New York
  LAL: 'large', LAC: 'large', // Los Angeles
  CHI: 'large',               // Chicago
  HOU: 'large',               // Houston
  PHI: 'large',               // Philadelphia
  DAL: 'large',               // Dallas
  BOS: 'large',               // Boston
  GSW: 'large',               // Golden State
  MIA: 'large',               // Miami
  BKN: 'large',               // Brooklyn

  // Small markets
  MEM: 'small',
  OKC: 'small',
  NOP: 'small',
  MIL: 'small',
  SAC: 'small',
  CHA: 'small',
  IND: 'small',
  UTA: 'small',
  POR: 'small',
  ORL: 'small',
  SAS: 'small',
  MIN: 'small',
  CLE: 'small',
  DET: 'small',

  // Medium markets (everything else)
  ATL: 'medium',
  TOR: 'medium',
  DEN: 'medium',
  PHX: 'medium',
  WAS: 'medium',
  SEA: 'medium',
};

function getMarketSize(teamAbbreviation) {
  return MARKET_SIZE_MAP[teamAbbreviation] || 'medium';
}

// =============================================================================
// ARCHETYPE DEFINITIONS
// =============================================================================

const ARCHETYPES = {
  franchise_cornerstone: {
    label: 'Franchise Cornerstone',
    weights: { money: 0.5, winning: 0.6, loyalty: 0.9, role: 0.6, starPairing: 0.3, coaching: 0.5, market: 0.4, legacy: 0.8 },
  },
  ring_chaser: {
    label: 'Ring Chaser',
    weights: { money: 0.4, winning: 0.9, loyalty: 0.2, role: 0.5, starPairing: 0.8, coaching: 0.4, market: 0.3, legacy: 0.6 },
  },
  max_contract_hunter: {
    label: 'Max Contract Hunter',
    weights: { money: 0.95, winning: 0.4, loyalty: 0.2, role: 0.4, starPairing: 0.2, coaching: 0.2, market: 0.5, legacy: 0.3 },
  },
  competitor: {
    label: 'Competitor',
    weights: { money: 0.5, winning: 0.8, loyalty: 0.5, role: 0.8, starPairing: 0.4, coaching: 0.5, market: 0.2, legacy: 0.6 },
  },
  balanced: {
    label: 'Balanced',
    weights: { money: 0.6, winning: 0.6, loyalty: 0.5, role: 0.5, starPairing: 0.4, coaching: 0.4, market: 0.3, legacy: 0.4 },
  },
};

// =============================================================================
// MOTIVATION LABELS
// =============================================================================

const MOTIVATION_LABELS = {
  money: 'Financial Security',
  winning: 'Championship Contention',
  loyalty: 'Team Loyalty',
  role: 'Playing Role',
  starPairing: 'Star Teammates',
  coaching: 'Coaching Stability',
  market: 'Market Size',
  legacy: 'Legacy Building',
};

/**
 * Get display name for a motivation category.
 * @param {string} category
 * @returns {string}
 */
export function getMotivationLabel(category) {
  return MOTIVATION_LABELS[category] || category;
}

/**
 * Inspect a player's motivation weights and return the closest archetype label.
 * @param {object} player
 * @returns {string}
 */
export function getArchetypeLabel(player) {
  if (!player.motivations) return 'Unknown';

  let bestMatch = 'balanced';
  let bestScore = Infinity;

  for (const [key, archetype] of Object.entries(ARCHETYPES)) {
    let distance = 0;
    for (const cat of Object.keys(archetype.weights)) {
      const playerWeight = player.motivations[cat]?.weight ?? 0.5;
      distance += Math.abs(playerWeight - archetype.weights[cat]);
    }
    if (distance < bestScore) {
      bestScore = distance;
      bestMatch = key;
    }
  }

  return ARCHETYPES[bestMatch].label;
}

// =============================================================================
// MOTIVATION GENERATION
// =============================================================================

/**
 * Generate motivation profile for a player based on archetype selection.
 * @param {object} player - Player object with traits, age, rating
 * @returns {object} motivations object
 */
export function generateMotivations(player) {
  const age = player.age ?? 25;
  const rating = player.overallRating ?? player.overall_rating ?? 75;
  const traits = player.personality?.traits ?? [];

  // Build weighted selection pool
  const pool = {
    balanced: 40,
    franchise_cornerstone: 10,
    ring_chaser: 10,
    max_contract_hunter: 10,
    competitor: 10,
  };

  // Trait-based adjustments
  if (traits.includes('competitor')) {
    pool.competitor += 30;
  }
  if (traits.includes('leader')) {
    pool.franchise_cornerstone += 30;
  }

  // Age-based adjustments
  if (age >= 32) {
    pool.ring_chaser += 20;
  }

  // Rating-based adjustments
  if (rating >= 85) {
    pool.max_contract_hunter += 10;
    pool.franchise_cornerstone += 10;
  }

  // Weighted random selection
  const totalWeight = Object.values(pool).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  let selectedKey = 'balanced';
  for (const [key, weight] of Object.entries(pool)) {
    roll -= weight;
    if (roll <= 0) {
      selectedKey = key;
      break;
    }
  }

  const archetype = ARCHETYPES[selectedKey];
  const motivations = {};

  for (const [cat, baseWeight] of Object.entries(archetype.weights)) {
    const variance = (Math.random() - 0.5) * 0.3; // ±0.15
    const weight = Math.min(1.0, Math.max(0.05, baseWeight + variance));
    motivations[cat] = {
      weight: Math.round(weight * 100) / 100,
      satisfaction: 0.5,
    };
  }

  return motivations;
}

// =============================================================================
// SATISFACTION RECALCULATION
// =============================================================================

/**
 * Recalculate satisfaction values for all motivation categories.
 * @param {object} player - Player with motivations
 * @param {object} context - Team/season context
 * @returns {object} Updated motivations object (mutates player.motivations in place)
 */
export function recalculateSatisfaction(player, context) {
  if (!player.motivations) return player.motivations;

  const {
    teamWinPct = 0.5,
    madePlayoffs = false,
    playerStats = null,
    teamRoster = [],
    teamMarketSize = 'medium',
    yearsWithTeam = 1,
    coachStability = true,
    hasChampionship = false,
    contractSalary = 0,
    expectedSalary = 0,
    offerSalary = null,
  } = context;

  const salary = offerSalary ?? contractSalary;

  // money: ratio of pay to market value
  if (player.motivations.money) {
    player.motivations.money.satisfaction = expectedSalary > 0
      ? Math.min(1, Math.max(0, salary / expectedSalary))
      : 0.5;
  }

  // winning: team win% weighted + playoffs bonus
  if (player.motivations.winning) {
    player.motivations.winning.satisfaction = (teamWinPct * 0.7) + (madePlayoffs ? 0.3 : 0);
  }

  // loyalty: grows with tenure
  if (player.motivations.loyalty) {
    player.motivations.loyalty.satisfaction = Math.min(1, yearsWithTeam * 0.15 + 0.2);
  }

  // role: based on minutes share
  if (player.motivations.role) {
    const gp = playerStats?.gamesPlayed ?? 0;
    const totalMinutes = playerStats?.minutes ?? playerStats?.minutesPlayed ?? 0;
    const avgMinutes = gp > 0 ? totalMinutes / gp : 15;
    player.motivations.role.satisfaction = Math.min(1, Math.max(0.2, avgMinutes / 30));
  }

  // starPairing: count high-rated teammates
  if (player.motivations.starPairing) {
    const stars = teamRoster.filter(t => {
      if (t.id === player.id) return false;
      return (t.overallRating ?? t.overall_rating ?? 0) >= 80;
    }).length;
    if (stars >= 3) player.motivations.starPairing.satisfaction = 1.0;
    else if (stars === 2) player.motivations.starPairing.satisfaction = 0.8;
    else if (stars === 1) player.motivations.starPairing.satisfaction = 0.5;
    else player.motivations.starPairing.satisfaction = 0.2;
  }

  // coaching: stability
  if (player.motivations.coaching) {
    player.motivations.coaching.satisfaction = coachStability ? 0.7 : 0.4;
  }

  // market: city size
  if (player.motivations.market) {
    if (teamMarketSize === 'large') player.motivations.market.satisfaction = 0.8;
    else if (teamMarketSize === 'medium') player.motivations.market.satisfaction = 0.5;
    else player.motivations.market.satisfaction = 0.3;
  }

  // legacy: championship impact
  if (player.motivations.legacy) {
    if (hasChampionship) player.motivations.legacy.satisfaction = 0.9;
    else if (teamWinPct > 0.6) player.motivations.legacy.satisfaction = 0.5;
    else player.motivations.legacy.satisfaction = 0.3;
  }

  return player.motivations;
}

// =============================================================================
// RETENTION SCORE
// =============================================================================

/**
 * Calculate retention score (0–100) for a player with their current team.
 * @param {object} player - Player with motivations
 * @param {object} context - Team/season context
 * @param {number|null} salaryOverride - Override salary for "what-if" scenarios
 * @returns {number} 0–100 retention percentage
 */
export function calculateRetentionScore(player, context = {}, salaryOverride = null) {
  if (!player.motivations) return 50; // Default neutral if no motivations

  // Build context with salary override
  const effectiveContext = salaryOverride != null
    ? { ...context, offerSalary: salaryOverride }
    : context;

  // Recalculate satisfaction with current context
  recalculateSatisfaction(player, effectiveContext);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [, data] of Object.entries(player.motivations)) {
    weightedSum += data.weight * data.satisfaction;
    totalWeight += data.weight;
  }

  if (totalWeight === 0) return 50;

  let score = (weightedSum / totalWeight) * 100;

  // Incumbent bonus: +12 points for staying with current team
  score += 12;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// =============================================================================
// WEIGHT SHIFT HELPERS (season-end)
// =============================================================================

/**
 * Apply career-event weight shifts to a player's motivations.
 * Called during season-end processing.
 * @param {object} player
 * @param {object} events - { age, wasTraded, wonChampionship }
 */
export function applyWeightShifts(player, events = {}) {
  if (!player.motivations) return;

  const { age = 25, wasTraded = false, wonChampionship = false } = events;

  // Older players care more about winning
  if (age >= 32 && player.motivations.winning) {
    player.motivations.winning.weight = Math.min(1, player.motivations.winning.weight + 0.05);
  }

  // Traded players lose loyalty
  if (wasTraded && player.motivations.loyalty) {
    player.motivations.loyalty.weight = Math.max(0.05, player.motivations.loyalty.weight - 0.15);
  }

  // Championship winners shift priorities
  if (wonChampionship) {
    if (player.motivations.money) {
      player.motivations.money.weight = Math.min(1, player.motivations.money.weight + 0.05);
    }
    if (player.motivations.winning) {
      player.motivations.winning.weight = Math.max(0.1, player.motivations.winning.weight - 0.03);
    }
  }
}

// =============================================================================
// EXPORTS FOR AI SERVICES
// =============================================================================

export { getMarketSize, MARKET_SIZE_MAP };
