// =============================================================================
// AITradeService.js
// =============================================================================
// Combined AI trade proposal generation and evaluation logic.
// Translated from PHP:
//   - backend/app/Services/AITradeProposalService.php
//   - backend/app/Services/AITradeEvaluationService.php
// =============================================================================

import { calculateRetentionScore } from './MotivationService';

const TRADE_DEADLINE_MONTH = 1; // January
const TRADE_DEADLINE_DAY = 6;

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const TOTAL_GAMES = 54;

// =============================================================================
// DIFFICULTY CONFIGURATION
// =============================================================================

const DIFFICULTY_CONFIGS = {
  rookie: {
    threshold_pct: 0.25,
    fairness_mult: 1.6,
    star_protection: 0.8,
    pick_sensitivity: 0.85,
  },
  pro: {
    threshold_pct: 0.15,
    fairness_mult: 1.0,
    star_protection: 1.0,
    pick_sensitivity: 1.0,
  },
  all_star: {
    threshold_pct: 0.10,
    fairness_mult: 0.7,
    star_protection: 1.25,
    pick_sensitivity: 1.15,
  },
  hall_of_fame: {
    threshold_pct: 0.05,
    fairness_mult: 0.45,
    star_protection: 1.5,
    pick_sensitivity: 1.30,
  },
};

// =============================================================================
// DIRECTION-SPECIFIC MULTIPLIERS
// =============================================================================

const DIRECTION_MULTIPLIERS = {
  title_contender: {
    starReceivePremium: 1.25,
    starGiveProtection: 1.35,
    youngReceiveDiscount: 0.95,
    youngGiveEase: 0.9,
    vetReceivePremium: 1.1,
    vetGiveEase: 0.85,
    pickReceiveDiscount: 0.65,
    pickGiveSensitivity: 0.75,
  },
  win_now: {
    starReceivePremium: 1.2,
    starGiveProtection: 1.25,
    youngReceiveDiscount: 1.0,
    youngGiveEase: 0.95,
    vetReceivePremium: 1.05,
    vetGiveEase: 0.9,
    pickReceiveDiscount: 0.75,
    pickGiveSensitivity: 0.85,
  },
  ascending: {
    starReceivePremium: 1.05,
    starGiveProtection: 1.1,
    youngReceiveDiscount: 1.2,
    youngGiveEase: 1.15,
    vetReceivePremium: 0.9,
    vetGiveEase: 0.85,
    pickReceiveDiscount: 1.2,
    pickGiveSensitivity: 1.3,
  },
  rebuilding: {
    starReceivePremium: 0.9,
    starGiveProtection: 0.85,
    youngReceiveDiscount: 1.25,
    youngGiveEase: 1.2,
    vetReceivePremium: 0.8,
    vetGiveEase: 0.75,
    pickReceiveDiscount: 1.4,
    pickGiveSensitivity: 1.5,
  },
};

// =============================================================================
// HELPER: Get player rating consistently
// =============================================================================

function getPlayerRating(player) {
  return player.overallRating ?? player.overall_rating ?? 75;
}

function getPlayerAge(player) {
  return player.age ?? 25;
}

function getPlayerPosition(player) {
  return player.position ?? '';
}

function getPlayerSecondaryPosition(player) {
  return player.secondaryPosition ?? player.secondary_position ?? '';
}

function getPlayerTradeValue(player) {
  return player.tradeValue ?? player.tradeValueTotal ?? getPlayerRating(player);
}

function getPlayerName(player) {
  const first = player.firstName ?? player.first_name ?? '';
  const last = player.lastName ?? player.last_name ?? '';
  return `${first} ${last}`.trim();
}

function getPlayerMorale(player) {
  return player.morale ?? player.personality?.morale ?? 80;
}

function getPlayerContractYears(player) {
  return player.contractYearsRemaining ?? player.contract_years_remaining ?? 2;
}

/**
 * Central gating function: is a player available for trade targeting?
 * Used by both user-targeting and AI-to-AI targeting.
 * @param {object} player
 * @param {Array} tradingBlock - Array of player IDs on the trading block
 * @returns {boolean}
 */
function isPlayerAvailableForTrade(player, tradingBlock = []) {
  const rating = getPlayerRating(player);
  // Low-rated players are always available
  if (rating < 82) return true;
  // Explicitly on the trading block
  if (tradingBlock.includes(player.id)) return true;
  // Low morale makes them available
  if (getPlayerMorale(player) < 50) return true;
  // Expiring contract
  if (getPlayerContractYears(player) === 1) return true;
  // Low retention flight risks — teams want to move unhappy stars
  if (player.motivations && calculateRetentionScore(player, {}) < 35) return true;
  // Otherwise protected
  return false;
}

/**
 * Compute which players an AI team would place on their trading block.
 * @param {object} params
 * @param {Array} params.roster - Team roster
 * @param {string} params.direction - Team direction archetype
 * @returns {Array} Array of player IDs
 */
export function computeAiTradingBlock({ roster, direction }) {
  const blockIds = [];
  for (const player of roster) {
    const morale = getPlayerMorale(player);
    const age = getPlayerAge(player);
    const years = getPlayerContractYears(player);
    const salary = player.contractSalary ?? player.contract_salary ?? 0;
    const rating = getPlayerRating(player);

    // Low morale players
    if (morale < 50) {
      blockIds.push(player.id);
      continue;
    }
    // Expiring contracts on rebuilding/ascending teams
    // But keep top-tier players the team has a good chance of re-signing
    if (years === 1 && ['rebuilding', 'ascending'].includes(direction)) {
      const retention = calculateRetentionScore(player, {});
      if (rating >= 78 && retention > 50) continue; // likely to re-sign, don't shop them
      blockIds.push(player.id);
      continue;
    }
    // Overpaid veterans (age >= 30, salary > 1.4x expected)
    if (age >= 30) {
      const expected = calculateExpectedSalary(null, rating);
      if (salary > expected * 1.4) {
        blockIds.push(player.id);
      }
    }
  }
  return blockIds;
}

// =============================================================================
// TRADE EVALUATION (from AITradeEvaluationService)
// =============================================================================

/**
 * Get difficulty configuration for trade evaluation.
 * @param {string} difficulty - 'rookie', 'pro', 'all_star', or 'hall_of_fame'
 * @returns {object}
 */
export function getDifficultyConfig(difficulty = 'pro') {
  return DIFFICULTY_CONFIGS[difficulty] ?? DIFFICULTY_CONFIGS.pro;
}

/**
 * Build context for trade evaluation from campaign/season data.
 * @param {object} params
 * @param {object} params.standings - { east: [...], west: [...] }
 * @param {Array} params.teams - Array of all team objects with abbreviation, id, etc.
 * @param {string} params.seasonPhase - e.g. 'regular_season', 'preseason'
 * @returns {object} context
 */
export function buildContext({ standings = { east: [], west: [] }, teams = [], seasonPhase = 'preseason' }) {
  let gamesPlayed = 0;
  const flat = {};

  for (const conf of ['east', 'west']) {
    for (const standing of standings[conf] ?? []) {
      const wins = standing.wins ?? 0;
      const losses = standing.losses ?? 0;
      gamesPlayed = Math.max(gamesPlayed, wins + losses);

      const teamId = standing.teamId ?? null;
      if (teamId) {
        // Find team abbreviation
        const team = teams.find(t => t.id === teamId || t.teamId === teamId);
        if (team) {
          flat[team.abbreviation] = { wins, losses };
        }
      }
    }
  }

  return {
    standings: flat,
    gamesPlayed,
    season_phase: seasonPhase,
  };
}

/**
 * Analyze roster composition to produce metrics.
 * @param {Array} roster - Array of player objects
 * @returns {object} { starPower, coreAlignment, youthScore, avgOverall, avgCoreAge }
 */
export function analyzeRoster(roster) {
  if (!roster || roster.length === 0) {
    return {
      starPower: 0,
      coreAlignment: 0.5,
      youthScore: 0.5,
      avgOverall: 75,
      avgCoreAge: 27,
    };
  }

  // Sort by overall rating descending, take top 5 as "core"
  const sorted = [...roster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));
  const core = sorted.slice(0, Math.min(5, sorted.length));

  // Star power: 85+ = 1 star credit, 82+ = 0.5 credit, normalized /2
  let starCredits = 0;
  for (const player of core) {
    const rating = getPlayerRating(player);
    if (rating >= 85) {
      starCredits += 1.0;
    } else if (rating >= 82) {
      starCredits += 0.5;
    }
  }
  const starPower = Math.min(1.0, starCredits / 2.0);

  // Core ages
  const coreAges = core.map(p => getPlayerAge(p));

  // Core alignment: how tight is the age range? (<=3yrs = 1.0, >=10 = 0)
  let coreAlignment = 0.5;
  if (coreAges.length >= 2) {
    const ageRange = Math.max(...coreAges) - Math.min(...coreAges);
    coreAlignment = Math.max(0, 1.0 - (ageRange - 3) / 7);
  }

  // Youth score: avg core age mapped (22 -> 1.0, 32+ -> 0)
  const avgCoreAge = coreAges.length > 0
    ? coreAges.reduce((sum, a) => sum + a, 0) / coreAges.length
    : 27;
  const youthScore = Math.max(0, Math.min(1.0, (32 - avgCoreAge) / 10));

  // Full roster average
  let totalRating = 0;
  for (const player of roster) {
    totalRating += getPlayerRating(player);
  }
  const avgOverall = roster.length > 0 ? totalRating / roster.length : 75;

  return {
    starPower: Math.round(starPower * 100) / 100,
    coreAlignment: Math.round(coreAlignment * 100) / 100,
    youthScore: Math.round(youthScore * 100) / 100,
    avgOverall: Math.round(avgOverall * 10) / 10,
    avgCoreAge: Math.round(avgCoreAge * 10) / 10,
  };
}

/**
 * Analyze team direction using 4 archetypes.
 * Blends roster analysis with record (record weight increases as season progresses).
 * @param {object} team - Team object with abbreviation
 * @param {Array} teamRoster - Roster array for the team
 * @param {object} context - From buildContext()
 * @returns {string} 'title_contender' | 'win_now' | 'ascending' | 'rebuilding'
 */
export function analyzeTeamDirection(team, teamRoster, context) {
  const standings = context.standings;
  const gamesPlayed = context.gamesPlayed;

  const teamRecord = standings[team.abbreviation] ?? { wins: 0, losses: 0 };
  const wins = teamRecord.wins ?? 0;
  const losses = teamRecord.losses ?? 0;
  const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0.5;

  // Record weight increases as season progresses
  const recordWeight = Math.min(0.7, (gamesPlayed / TOTAL_GAMES) * 0.9);
  const rosterWeight = 1.0 - recordWeight;

  // Get roster analysis
  const rosterMetrics = analyzeRoster(teamRoster);

  // Compute blended scores for each archetype
  const recordStrength = winPct;
  const { starPower, youthScore, avgOverall } = rosterMetrics;

  // Title contender: multiple stars + strong record
  const contenderScore =
    (starPower * 0.5 + Math.min(1, (avgOverall - 72) / 10) * 0.3) * rosterWeight +
    (recordStrength > 0.6 ? recordStrength : recordStrength * 0.5) * recordWeight;

  // Win-now: decent star power + good (not elite) record
  const winNowScore =
    (starPower * 0.35 + Math.min(1, (avgOverall - 70) / 10) * 0.3) * rosterWeight +
    ((recordStrength > 0.45 && recordStrength <= 0.65) ? 0.7 : recordStrength * 0.4) * recordWeight;

  // Ascending: young core, values development
  const ascendingScore =
    (youthScore * 0.5 + (1 - starPower) * 0.2) * rosterWeight +
    ((recordStrength >= 0.35 && recordStrength <= 0.55) ? 0.6 : 0.3) * recordWeight;

  // Rebuilding: poor record + aging or weak roster
  const rebuildingScore =
    ((1 - Math.min(1, (avgOverall - 68) / 12)) * 0.4 + (1 - starPower) * 0.3) * rosterWeight +
    ((recordStrength < 0.4) ? (1 - recordStrength) : 0.2) * recordWeight;

  // Special overrides for clear-cut cases
  if (gamesPlayed >= 20) {
    const gamesRemaining = TOTAL_GAMES - gamesPlayed;
    const winsNeeded = 41 - wins;
    if (gamesRemaining > 0 && winsNeeded > gamesRemaining) {
      return 'rebuilding'; // Mathematically eliminated
    }
  }

  if (starPower >= 0.8 && winPct >= 0.65 && gamesPlayed >= 15) {
    return 'title_contender';
  }

  const scores = {
    title_contender: contenderScore,
    win_now: winNowScore,
    ascending: ascendingScore,
    rebuilding: rebuildingScore,
  };

  // Pick the highest scoring direction
  let bestDirection = 'ascending';
  let bestScore = -Infinity;
  for (const [direction, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestDirection = direction;
    }
  }

  return bestDirection;
}

/**
 * Calculate universal young player premium.
 * @param {number} age
 * @returns {number}
 */
function calculateYoungPlayerPremium(age) {
  if (age <= 22) return 1.25;
  if (age <= 25) return 1.15;
  if (age <= 27) return 1.0;
  if (age <= 30) return 0.90;
  return 0.75;
}

/**
 * Calculate expected salary based on overall rating and production.
 * @param {object|null} playerStats - Season stats
 * @param {number} overallRating
 * @returns {number}
 */
export function calculateExpectedSalary(playerStats, overallRating) {
  let ratingBase;
  if (overallRating >= 90) ratingBase = 40_000_000;
  else if (overallRating >= 85) ratingBase = 30_000_000;
  else if (overallRating >= 80) ratingBase = 20_000_000;
  else if (overallRating >= 75) ratingBase = 10_000_000;
  else if (overallRating >= 70) ratingBase = 5_000_000;
  else ratingBase = 2_000_000;

  if (playerStats && (playerStats.gamesPlayed ?? 0) >= 5) {
    const gp = playerStats.gamesPlayed;
    const ppg = (playerStats.points ?? 0) / gp;
    const rpg = (playerStats.rebounds ?? 0) / gp;
    const apg = (playerStats.assists ?? 0) / gp;

    const production = ppg + (apg * 0.5) + (rpg * 0.5);

    let expectedProduction;
    if (overallRating >= 90) expectedProduction = 35;
    else if (overallRating >= 85) expectedProduction = 25;
    else if (overallRating >= 80) expectedProduction = 18;
    else if (overallRating >= 75) expectedProduction = 12;
    else expectedProduction = 8;

    const productionRatio = Math.min(1.2, Math.max(0.8, production / Math.max(1, expectedProduction)));
    ratingBase *= productionRatio;
  }

  return ratingBase;
}

/**
 * Calculate contract value multiplier (bargain vs overpaid).
 * @param {number} actualSalary
 * @param {number} expectedSalary
 * @returns {number}
 */
function calculateContractValueMultiplier(actualSalary, expectedSalary) {
  if (expectedSalary <= 0) return 1.0;

  const ratio = actualSalary / expectedSalary;

  if (ratio <= 0.5) return 1.30;
  if (ratio <= 0.75) return 1.15;
  if (ratio <= 1.0) return 1.0;
  if (ratio <= 1.25) return 0.95;
  if (ratio <= 1.5) return 0.85;
  return 0.70;
}

/**
 * Calculate expiring contract bonus value.
 * @param {number} yearsRemaining
 * @param {number} salary
 * @param {string} teamDirection
 * @returns {number}
 */
function calculateExpiringContractValue(yearsRemaining, salary, teamDirection) {
  if (!['rebuilding', 'ascending'].includes(teamDirection)) return 0;
  if (yearsRemaining > 1) return 0;
  return Math.min(2.0, salary * 0.05 / 1_000_000);
}

/**
 * Calculate timeline fit for an incoming player relative to team's core age.
 * @param {number} playerAge
 * @param {string} direction
 * @param {Array} teamRoster
 * @returns {number}
 */
function calculateTimelineFit(playerAge, direction, teamRoster) {
  if (direction === 'rebuilding') return 1.0;

  const rosterMetrics = analyzeRoster(teamRoster);
  const coreAge = rosterMetrics.avgCoreAge ?? 27;
  const ageDiff = Math.abs(playerAge - coreAge);

  if (ageDiff <= 2) return 1.10;
  if (ageDiff <= 4) return 1.0;
  if (ageDiff <= 7) return 0.92;
  return 0.85;
}

/**
 * Check if team needs a specific position.
 * @param {Array} roster
 * @param {string} position
 * @returns {boolean}
 */
function hasPositionalNeed(roster, position) {
  if (!position) return false;

  let count = 0;
  for (const player of roster) {
    if (getPlayerPosition(player) === position || getPlayerSecondaryPosition(player) === position) {
      count++;
    }
  }

  return count <= 1;
}

/**
 * Check if assets include any draft picks.
 * @param {Array} assets
 * @returns {boolean}
 */
function hasPicksInAssets(assets) {
  return assets.some(a => a.type === 'pick');
}

/**
 * Check if assets include veterans (age >= 30).
 * @param {Array} assets
 * @param {function} getPlayerFn - Function to resolve player by ID
 * @returns {boolean}
 */
function hasVeterans(assets, getPlayerFn) {
  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (player && getPlayerAge(player) >= 30) return true;
    }
  }
  return false;
}

/**
 * Check if assets include star players (rating >= 82).
 * @param {Array} assets
 * @param {function} getPlayerFn
 * @returns {boolean}
 */
function hasStars(assets, getPlayerFn) {
  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (player && getPlayerRating(player) >= 82) return true;
    }
  }
  return false;
}

/**
 * Check if assets include young players (age <= 24).
 * @param {Array} assets
 * @param {function} getPlayerFn
 * @returns {boolean}
 */
function hasYoungPlayers(assets, getPlayerFn) {
  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (player && getPlayerAge(player) <= 24) return true;
    }
  }
  return false;
}

/**
 * Get rejection reason based on trade analysis.
 * @param {number} netValue
 * @param {string} direction
 * @param {object} proposal
 * @param {function} getPlayerFn
 * @returns {string}
 */
function getRejectReason(netValue, direction, proposal, getPlayerFn) {
  const deficit = Math.abs(netValue);

  if (direction === 'rebuilding') {
    if (!hasPicksInAssets(proposal.aiReceives)) {
      return "We're looking to acquire draft picks in any deal.";
    }
    if (hasVeterans(proposal.aiReceives, getPlayerFn)) {
      return "We're focused on building for the future with young talent.";
    }
    return "We'd need more young talent or draft compensation to make this work.";
  }

  if (direction === 'title_contender') {
    if (!hasStars(proposal.aiReceives, getPlayerFn)) {
      return 'We need proven stars who can help us compete for a championship.';
    }
    if (hasYoungPlayers(proposal.aiReceives, getPlayerFn) && !hasStars(proposal.aiReceives, getPlayerFn)) {
      return "We can't afford to take on unproven talent at this stage.";
    }
    return "The return doesn't match the caliber of player we'd be giving up.";
  }

  if (direction === 'win_now') {
    if (!hasStars(proposal.aiReceives, getPlayerFn)) {
      return 'We need proven players who can help us win now.';
    }
    return "The value isn't there for a win-now team like us.";
  }

  if (direction === 'ascending') {
    if (hasVeterans(proposal.aiReceives, getPlayerFn) && !hasPicksInAssets(proposal.aiReceives)) {
      return "We're building something special with our young core. We need picks or young talent.";
    }
    if (!hasYoungPlayers(proposal.aiReceives, getPlayerFn) && !hasPicksInAssets(proposal.aiReceives)) {
      return "We're focused on acquiring young talent and draft capital for our future.";
    }
    return "We don't see enough upside in this deal for our timeline.";
  }

  if (deficit > 5) {
    return "We'd need significantly more value to consider this trade.";
  }
  return "We don't see enough value in this proposal.";
}

/**
 * Calculate value of assets team is RECEIVING.
 * @param {object} params
 * @param {Array} params.assets - Assets being received
 * @param {string} params.direction - Team direction
 * @param {Array} params.teamRoster - AI team's roster
 * @param {object} params.diffConfig - Difficulty config
 * @param {function} params.getPlayerFn - Function(playerId) => player object
 * @param {function} params.getPlayerStatsFn - Function(playerId) => season stats or null
 * @param {function} params.getPickValueFn - Function(pickId) => numeric pick value
 * @returns {number}
 */
export function calculateReceivingValue({
  assets,
  direction,
  teamRoster,
  diffConfig,
  getPlayerFn,
  getPlayerStatsFn = () => null,
  getPickValueFn = () => 5,
}) {
  let value = 0;
  const mults = DIRECTION_MULTIPLIERS[direction] ?? DIRECTION_MULTIPLIERS.ascending;

  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (!player) continue;

      let baseValue = getPlayerTradeValue(player);
      const age = getPlayerAge(player);
      const rating = getPlayerRating(player);
      const salary = player.contractSalary ?? player.contract_salary ?? 0;
      const yearsRemaining = player.contractYearsRemaining ?? player.contract_years_remaining ?? 1;

      // Universal young player premium
      baseValue *= calculateYoungPlayerPremium(age);

      // Contract value adjustment
      const playerStats = getPlayerStatsFn(asset.playerId);
      const expectedSalary = calculateExpectedSalary(playerStats, rating);
      baseValue *= calculateContractValueMultiplier(salary, expectedSalary);

      // Expiring contract bonus
      baseValue += calculateExpiringContractValue(yearsRemaining, salary, direction);

      // Timeline fit
      baseValue *= calculateTimelineFit(age, direction, teamRoster);

      // Direction-specific multipliers
      if (rating >= 82) baseValue *= mults.starReceivePremium;
      if (age <= 24) baseValue *= mults.youngReceiveDiscount;
      if (age >= 30) baseValue *= mults.vetReceivePremium;

      // Positional need bonus
      if (hasPositionalNeed(teamRoster, player.position)) {
        baseValue *= 1.15;
      }

      // Retention risk discount for contract-year players
      if (yearsRemaining === 1 && player.motivations) {
        const retentionScore = calculateRetentionScore(player, {});
        // Low retention = risky acquisition. 50% → 0.75×, 30% → 0.65×
        const retentionMultiplier = 0.5 + (retentionScore / 100) * 0.5;
        baseValue *= retentionMultiplier;
      }

      value += baseValue;

    } else if (asset.type === 'pick') {
      let pickValue = getPickValueFn(asset.pickId);
      pickValue *= mults.pickReceiveDiscount;
      pickValue *= diffConfig.pick_sensitivity;
      value += pickValue;
    }
  }

  return Math.round(value * 100) / 100;
}

/**
 * Calculate value of assets team is GIVING UP.
 * @param {object} params - Same shape as calculateReceivingValue
 * @returns {number}
 */
export function calculateGivingValue({
  assets,
  direction,
  diffConfig,
  getPlayerFn,
  getPlayerStatsFn = () => null,
  getPickValueFn = () => 5,
}) {
  let value = 0;
  const mults = DIRECTION_MULTIPLIERS[direction] ?? DIRECTION_MULTIPLIERS.ascending;

  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (!player) continue;

      let baseValue = getPlayerTradeValue(player);
      const age = getPlayerAge(player);
      const rating = getPlayerRating(player);
      const salary = player.contractSalary ?? player.contract_salary ?? 0;

      // Universal young player premium (reluctance to trade young players)
      baseValue *= calculateYoungPlayerPremium(age);

      // Contract value (overpaid = easier to trade away)
      const playerStats = getPlayerStatsFn(asset.playerId);
      const expectedSalary = calculateExpectedSalary(playerStats, rating);
      baseValue *= calculateContractValueMultiplier(salary, expectedSalary);

      // Direction-specific giving multipliers
      if (rating >= 82) {
        baseValue *= mults.starGiveProtection;
        baseValue *= diffConfig.star_protection;
      }
      if (age <= 24) baseValue *= mults.youngGiveEase;
      if (age >= 30) baseValue *= mults.vetGiveEase;

      value += baseValue;

    } else if (asset.type === 'pick') {
      let pickValue = getPickValueFn(asset.pickId);
      pickValue *= mults.pickGiveSensitivity;
      pickValue *= diffConfig.pick_sensitivity;
      value += pickValue;
    }
  }

  return Math.round(value * 100) / 100;
}

/**
 * Evaluate a trade proposal from AI team's perspective.
 * Returns { decision, reason, team_direction, value_analysis }.
 *
 * @param {object} params
 * @param {object} params.proposal - { aiReceives: [...], aiGives: [...] }
 * @param {object} params.team - AI team object
 * @param {Array} params.teamRoster - AI team's roster
 * @param {string} params.difficulty - Campaign difficulty
 * @param {object} params.context - From buildContext()
 * @param {function} params.getPlayerFn - Function(playerId) => player object
 * @param {function} [params.getPlayerStatsFn] - Function(playerId) => stats or null
 * @param {function} [params.getPickValueFn] - Function(pickId) => numeric value
 * @returns {object}
 */
export function evaluateTrade({
  proposal,
  team,
  teamRoster,
  difficulty = 'pro',
  context,
  getPlayerFn,
  getPlayerStatsFn = () => null,
  getPickValueFn = () => 5,
}) {
  const diffConfig = getDifficultyConfig(difficulty);
  const teamDirection = analyzeTeamDirection(team, teamRoster, context);

  const receiving = calculateReceivingValue({
    assets: proposal.aiReceives,
    direction: teamDirection,
    teamRoster,
    diffConfig,
    getPlayerFn,
    getPlayerStatsFn,
    getPickValueFn,
  });

  const giving = calculateGivingValue({
    assets: proposal.aiGives,
    direction: teamDirection,
    diffConfig,
    getPlayerFn,
    getPlayerStatsFn,
    getPickValueFn,
  });

  const netValue = receiving - giving;
  const thresholdPct = diffConfig.threshold_pct;
  const fairnessMult = diffConfig.fairness_mult;
  const fairnessThreshold = Math.max(giving * thresholdPct * fairnessMult, 1);

  if (netValue >= -fairnessThreshold) {
    return {
      decision: 'accept',
      reason: null,
      team_direction: teamDirection,
      value_analysis: { receiving, giving, net: netValue },
    };
  }

  return {
    decision: 'reject',
    reason: getRejectReason(netValue, teamDirection, proposal, getPlayerFn),
    team_direction: teamDirection,
    value_analysis: { receiving, giving, net: netValue },
  };
}

/**
 * Get trade interest level for display.
 * Returns: 'high', 'medium', 'low', 'none'
 * @param {object} team
 * @param {Array} teamRoster
 * @param {object} context
 * @returns {string}
 */
export function getTradeInterest(team, teamRoster, context) {
  const direction = analyzeTeamDirection(team, teamRoster, context);

  const interestMap = {
    rebuilding: 'high',
    ascending: 'medium',
    win_now: 'medium',
    title_contender: 'low',
  };

  return interestMap[direction] ?? 'medium';
}

// =============================================================================
// TRADE PROPOSAL GENERATION (from AITradeProposalService)
// =============================================================================

/**
 * Get the trade deadline date for a season.
 * @param {number} seasonYear - The year the season started (e.g. 2025)
 * @returns {{ month: number, day: number, year: number }}
 */
export function getTradeDeadline(seasonYear) {
  // Season 2025 starts Oct 2025, deadline is Jan 6, 2026
  return {
    month: TRADE_DEADLINE_MONTH,
    day: TRADE_DEADLINE_DAY,
    year: seasonYear + 1,
  };
}

/**
 * Check if trades are allowed (before deadline).
 * @param {string} currentDate - ISO date string (e.g. '2026-01-03')
 * @param {number} seasonYear
 * @returns {boolean}
 */
export function isBeforeDeadline(currentDate, seasonYear) {
  const deadline = getTradeDeadline(seasonYear);
  const deadlineDate = new Date(deadline.year, deadline.month - 1, deadline.day);
  const current = new Date(currentDate);
  return current <= deadlineDate;
}

/**
 * Expire stale proposals past their expiration date.
 * Mutates proposals array in place (sets status to 'expired').
 * @param {Array} proposals - Array of proposal objects with status and expires_at
 * @param {string} currentDate - ISO date string
 * @returns {Array} expired proposals
 */
export function expireStaleProposals(proposals, currentDate) {
  const now = new Date(currentDate);
  const expired = [];

  for (const proposal of proposals) {
    if (proposal.status === 'pending' && new Date(proposal.expires_at) < now) {
      proposal.status = 'expired';
      proposal.resolved_at = currentDate;
      expired.push(proposal);
    }
  }

  return expired;
}

/**
 * Identify what the AI team needs based on direction and roster.
 * @param {string} direction
 * @param {Array} roster
 * @returns {object|null}
 */
export function identifyNeed(direction, roster) {
  if (['title_contender', 'win_now'].includes(direction)) {
    // Find weakest starting position
    let weakest = null;
    let weakestRating = 100;

    for (const pos of POSITIONS) {
      let bestAtPos = null;
      for (const p of roster) {
        if (getPlayerPosition(p) === pos || getPlayerSecondaryPosition(p) === pos) {
          const rating = getPlayerRating(p);
          if (!bestAtPos || rating > getPlayerRating(bestAtPos)) {
            bestAtPos = p;
          }
        }
      }

      const bestRating = bestAtPos ? getPlayerRating(bestAtPos) : 0;
      if (bestRating < weakestRating) {
        weakestRating = bestRating;
        weakest = pos;
      }
    }

    if (weakest && weakestRating < 80) {
      return { type: 'position', position: weakest, minRating: weakestRating + 2 };
    }

    return { type: 'star', minRating: 80 };
  }

  if (direction === 'rebuilding') {
    return { type: 'young', maxAge: 24 };
  }

  // Ascending: selective, need specific position upgrades
  let weakest = null;
  let weakestRating = 100;

  for (const pos of POSITIONS) {
    let bestAtPos = null;
    for (const p of roster) {
      if (getPlayerPosition(p) === pos || getPlayerSecondaryPosition(p) === pos) {
        const rating = getPlayerRating(p);
        if (!bestAtPos || rating > getPlayerRating(bestAtPos)) {
          bestAtPos = p;
        }
      }
    }

    const bestRating = bestAtPos ? getPlayerRating(bestAtPos) : 0;
    if (bestRating < weakestRating) {
      weakestRating = bestRating;
      weakest = pos;
    }
  }

  if (weakest) {
    return { type: 'position', position: weakest, minRating: Math.max(72, weakestRating + 2) };
  }

  return null;
}

/**
 * Find user players that match the AI team's need.
 * @param {Array} userRoster
 * @param {object} need
 * @param {string} direction
 * @returns {Array}
 */
export function findTargetPlayers(userRoster, need, direction, tradingBlock = []) {
  const targets = [];

  for (const player of userRoster) {
    // Gate: skip protected players
    if (!isPlayerAvailableForTrade(player, tradingBlock)) continue;

    const rating = getPlayerRating(player);
    const age = getPlayerAge(player);
    const position = getPlayerPosition(player);
    const secondaryPosition = getPlayerSecondaryPosition(player);

    switch (need.type) {
      case 'position': {
        const neededPos = need.position ?? '';
        if ((position === neededPos || secondaryPosition === neededPos) && rating >= (need.minRating ?? 70)) {
          targets.push(player);
        }
        break;
      }
      case 'star':
        if (rating >= (need.minRating ?? 80)) {
          targets.push(player);
        }
        break;
      case 'young':
        if (age <= (need.maxAge ?? 24) && rating >= 70) {
          targets.push(player);
        }
        break;
    }
  }

  // Sort by trade value descending
  targets.sort((a, b) => getPlayerTradeValue(b) - getPlayerTradeValue(a));

  return targets.slice(0, 3);
}

/**
 * Build what the AI will offer in return.
 * @param {object} params
 * @param {Array} params.aiRoster
 * @param {object} params.targetPlayer
 * @param {string} params.direction
 * @param {Array} params.teamPicks - Array of pick objects available for trade
 * @param {function} params.getPlayerFn
 * @returns {object|null} { assets: [...] } or null
 */
export function buildAiOffer({ aiRoster, targetPlayer, direction, teamPicks = [], getPlayerFn }) {
  const targetValue = getPlayerTradeValue(targetPlayer);
  const assets = [];

  // Sort AI roster by rating (offer mid-tier players, not their stars)
  const sortedRoster = [...aiRoster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  let candidates;

  // For rebuilders, offer veterans first
  if (direction === 'rebuilding') {
    const vets = sortedRoster.filter(p => getPlayerAge(p) >= 28);
    candidates = vets.length > 0 ? vets : sortedRoster;
  } else {
    // Skip the top 3 players (protect stars)
    candidates = sortedRoster.slice(3);
    if (candidates.length === 0) {
      candidates = sortedRoster.slice(1);
    }
  }

  // Find a suitable player to offer
  for (const candidate of candidates) {
    const candidateValue = getPlayerTradeValue(candidate);

    if (candidateValue >= targetValue * 0.5 && candidateValue <= targetValue * 1.5) {
      assets.push({ type: 'player', playerId: candidate.id });
      break;
    }
  }

  if (assets.length === 0) {
    // Couldn't find a suitable player -- try offering picks instead
    if (teamPicks.length > 0) {
      assets.push({ type: 'pick', pickId: teamPicks[0].id });
    }
  }

  // If the AI offer seems light, add a pick to sweeten
  if (assets.length === 1 && assets[0].type === 'player') {
    const offeredPlayer = getPlayerFn(assets[0].playerId);
    const offeredValue = offeredPlayer ? getPlayerTradeValue(offeredPlayer) : 0;

    if (offeredValue < targetValue * 0.8 && teamPicks.length > 0) {
      assets.push({ type: 'pick', pickId: teamPicks[0].id });
    }
  }

  return assets.length > 0 ? { assets } : null;
}

/**
 * Generate a human-readable reason for the AI's proposal.
 * @param {string} direction
 * @param {object} target - Target player
 * @param {object} need
 * @returns {string}
 */
export function generateProposalReason(direction, target, need) {
  const playerName = getPlayerName(target);

  const reasons = {
    title_contender: `We believe ${playerName} is the missing piece for a championship run.`,
    win_now: `Adding ${playerName} would give us the boost we need to compete this season.`,
    ascending: `${playerName} fits our timeline perfectly and would help accelerate our build.`,
    rebuilding: `We think ${playerName} has the kind of upside we're looking for in our rebuild.`,
  };

  return reasons[direction] ?? `We see ${playerName} as a great fit for our team going forward.`;
}

/**
 * Generate weekly AI trade proposals to the user.
 *
 * @param {object} params
 * @param {Array} params.aiTeams - Array of AI team objects (with abbreviation, id, etc.)
 * @param {Array} params.userRoster - User's roster array
 * @param {object} params.standings - { east: [...], west: [...] }
 * @param {Array} params.allTeams - All teams for context
 * @param {string} params.currentDate - ISO date string
 * @param {number} params.seasonYear
 * @param {string} params.difficulty
 * @param {string} params.seasonPhase
 * @param {Array} params.pendingProposals - Existing pending proposals
 * @param {function} params.getTeamRosterFn - (teamAbbr) => roster array
 * @param {function} params.getPlayerFn - (playerId) => player object
 * @param {function} params.getTeamPicksFn - (teamId) => array of pick objects
 * @param {function} [params.getPlayerStatsFn]
 * @param {function} [params.getPickValueFn]
 * @returns {Array} Array of new proposals
 */
export function generateWeeklyProposals({
  aiTeams,
  userRoster,
  standings,
  allTeams,
  currentDate,
  seasonYear,
  difficulty = 'pro',
  seasonPhase = 'regular_season',
  pendingProposals = [],
  getTeamRosterFn,
  getPlayerFn,
  getTeamPicksFn = () => [],
  getPlayerStatsFn = () => null,
  getPickValueFn = () => 5,
  userTradingBlock = [],
}) {
  if (!userRoster || userRoster.length === 0) return [];

  // Check trade deadline
  if (!isBeforeDeadline(currentDate, seasonYear)) return [];

  const deadline = getTradeDeadline(seasonYear);
  const deadlineDate = new Date(deadline.year, deadline.month - 1, deadline.day);
  const current = new Date(currentDate);
  const daysUntilDeadline = Math.ceil((deadlineDate - current) / (1000 * 60 * 60 * 24));
  const isDeadlineMonth = daysUntilDeadline >= 0 && daysUntilDeadline <= 30;

  const context = buildContext({ standings, teams: allTeams, seasonPhase });
  const newProposals = [];

  // Pre-compute cooldown: 30-day window for rejected/expired proposals
  const cooldownDays = 30;
  const cooldownCutoff = new Date(current);
  cooldownCutoff.setDate(cooldownCutoff.getDate() - cooldownDays);

  // Track team+player combos that were rejected recently (block exact repeat offers)
  // Also track teams on cooldown (any rejection in the last 30 days)
  // Use String() coercion on IDs to prevent type mismatches (number vs string from IndexedDB)
  const rejectedTeamPlayerCombos = new Set(); // "teamId::playerId"
  const recentlyDeclinedTeams = new Set();
  for (const p of pendingProposals) {
    const wasDeclined = p.status === 'rejected' || p.status === 'expired';
    if (!wasDeclined) continue;

    // Use resolved_at (when user rejected), falling back to expires_at
    const resolvedDate = p.resolved_at ? new Date(p.resolved_at) : new Date(p.expires_at);
    if (resolvedDate < cooldownCutoff) continue;

    recentlyDeclinedTeams.add(String(p.proposing_team_id));

    const receives = p.proposal?.aiReceives ?? [];
    for (const a of receives) {
      if (a.type === 'player' && a.playerId) {
        rejectedTeamPlayerCombos.add(`${p.proposing_team_id}::${a.playerId}`);
      }
    }
  }

  for (const aiTeam of aiTeams) {
    const teamIdStr = String(aiTeam.id);

    // Skip if team already has a pending proposal
    const hasPending = pendingProposals.some(
      p => String(p.proposing_team_id) === teamIdStr && p.status === 'pending'
    );
    if (hasPending) continue;

    // Cooldown: skip teams whose proposal was rejected/expired within the last 30 days
    if (recentlyDeclinedTeams.has(teamIdStr)) continue;

    const aiRoster = getTeamRosterFn(aiTeam.abbreviation);
    if (!aiRoster || aiRoster.length === 0) continue;

    const direction = analyzeTeamDirection(aiTeam, aiRoster, context);

    // Probability check
    let baseProbability = 0.15;
    if (isDeadlineMonth) {
      if (['title_contender', 'win_now'].includes(direction)) {
        baseProbability *= 3.0;
      } else {
        baseProbability *= 2.0;
      }
    }

    if (Math.random() * 100 > baseProbability * 100) continue;

    // Identify team's need
    const need = identifyNeed(direction, aiRoster);
    if (!need) continue;

    // Find user players that fill the need
    const targetPlayers = findTargetPlayers(userRoster, need, direction, userTradingBlock);
    if (targetPlayers.length === 0) continue;

    // Filter out players this team already had rejected for (exact team+player combo, 30-day cooldown)
    let filteredTargets = targetPlayers.filter(p =>
      !rejectedTeamPlayerCombos.has(`${teamIdStr}::${p.id}`)
    );

    // Retention-based targeting: skip very happy players, prefer unhappy ones
    filteredTargets = filteredTargets.filter(p => {
      if (!p.motivations) return true; // No data = default targeting
      const retention = calculateRetentionScore(p, {});
      return retention <= 80; // Skip very happy players (unlikely to move)
    });
    if (filteredTargets.length === 0) continue;

    // Sort: prefer lower retention (disgruntled players more likely to be poached)
    filteredTargets.sort((a, b) => {
      const retA = a.motivations ? calculateRetentionScore(a, {}) : 50;
      const retB = b.motivations ? calculateRetentionScore(b, {}) : 50;
      return retA - retB;
    });

    // Pick the best target
    const target = filteredTargets[0];

    // Find AI players to offer in return
    const teamPicks = getTeamPicksFn(aiTeam.id);
    const aiOffer = buildAiOffer({
      aiRoster,
      targetPlayer: target,
      direction,
      teamPicks,
      getPlayerFn,
    });
    if (!aiOffer) continue;

    // Verify the AI would accept its own proposal
    const verification = evaluateTrade({
      proposal: {
        aiReceives: [{ type: 'player', playerId: target.id }],
        aiGives: aiOffer.assets,
      },
      team: aiTeam,
      teamRoster: aiRoster,
      difficulty,
      context,
      getPlayerFn,
      getPlayerStatsFn,
      getPickValueFn,
    });

    if (verification.decision !== 'accept') continue;

    // Build the proposal
    const expiresAt = new Date(current);
    expiresAt.setDate(expiresAt.getDate() + 3);

    const proposal = {
      proposing_team_id: aiTeam.id,
      proposing_team_abbreviation: aiTeam.abbreviation,
      proposing_team_name: `${aiTeam.city} ${aiTeam.name}`,
      status: 'pending',
      proposal: {
        aiGives: aiOffer.assets,
        aiReceives: [{ type: 'player', playerId: target.id }],
      },
      reason: generateProposalReason(direction, target, need),
      expires_at: expiresAt.toISOString(),
      targetPlayer: target,
    };

    newProposals.push(proposal);
  }

  return newProposals;
}

/**
 * Process trade deadline events (approaching + passed).
 * Returns news events and state changes.
 * @param {object} params
 * @param {string} params.currentDate
 * @param {number} params.seasonYear
 * @param {object} params.settings - Campaign settings (mutated in place)
 * @returns {object} { newsEvents: [...], settingsChanged: boolean }
 */
export function processTradeDeadlineEvents({ currentDate, seasonYear, settings = {} }) {
  const deadline = getTradeDeadline(seasonYear);
  const deadlineDate = new Date(deadline.year, deadline.month - 1, deadline.day);
  const current = new Date(currentDate);
  const newsEvents = [];
  let settingsChanged = false;

  // Approaching warning: 16 days before deadline
  const warningDate = new Date(deadlineDate);
  warningDate.setDate(warningDate.getDate() - 16);

  if (current >= warningDate && !(settings.trade_deadline_warned ?? false)) {
    const daysUntil = Math.ceil((deadlineDate - current) / (1000 * 60 * 60 * 24));

    newsEvents.push({
      event_type: 'trade',
      headline: 'Trade deadline approaching',
      body: `The January 6th trade deadline is ${daysUntil} days away. Teams are expected to increase activity.`,
      game_date: currentDate,
    });

    settings.trade_deadline_warned = true;
    settingsChanged = true;
  }

  // Deadline passed
  if (current > deadlineDate && !(settings.trade_deadline_passed ?? false)) {
    newsEvents.push({
      event_type: 'trade',
      headline: 'Trade deadline has passed',
      body: 'The trade deadline has officially passed. No more trades can be made this season.',
      game_date: currentDate,
    });

    settings.trade_deadline_passed = true;
    settingsChanged = true;
  }

  return { newsEvents, settingsChanged };
}

// =============================================================================
// AI-TO-AI TRADING
// =============================================================================

const LUXURY_TAX_LINE = 165_000_000;

/**
 * Find target players from any roster that match a team's need.
 * Adapts findTargetPlayers() for bilateral AI-to-AI use.
 */
function _findTargetPlayersFromRoster(roster, need, direction, tradingBlock = []) {
  const targets = [];

  for (const player of roster) {
    // Gate: skip protected players
    if (!isPlayerAvailableForTrade(player, tradingBlock)) continue;

    const rating = getPlayerRating(player);
    const age = getPlayerAge(player);
    const position = getPlayerPosition(player);
    const secondaryPosition = getPlayerSecondaryPosition(player);

    switch (need.type) {
      case 'position': {
        const neededPos = need.position ?? '';
        if ((position === neededPos || secondaryPosition === neededPos) && rating >= (need.minRating ?? 70)) {
          targets.push(player);
        }
        break;
      }
      case 'star':
        if (rating >= (need.minRating ?? 80)) {
          targets.push(player);
        }
        break;
      case 'young':
        if (age <= (need.maxAge ?? 24) && rating >= 70) {
          targets.push(player);
        }
        break;
    }
  }

  // Sort by trade value descending
  targets.sort((a, b) => getPlayerTradeValue(b) - getPlayerTradeValue(a));

  return targets.slice(0, 3);
}

/**
 * Calculate team payroll from roster.
 */
function _calculateTeamPayroll(roster) {
  return roster.reduce((sum, p) => sum + (p.contractSalary ?? p.contract_salary ?? 0), 0);
}

/**
 * Attempt to find a mutually acceptable AI-to-AI trade between two teams.
 * Returns trade object or null.
 */
function _findAiToAiTrade({
  team1, team1Roster, team1Dir, team1Picks,
  team2, team2Roster, team2Dir, team2Picks,
  team1TradingBlock = [], team2TradingBlock = [],
  context, difficulty, getPlayerFn,
}) {
  const diffConfig = getDifficultyConfig(difficulty);
  const need1 = identifyNeed(team1Dir, team1Roster);
  const need2 = identifyNeed(team2Dir, team2Roster);

  if (!need1 && !need2) return null;

  // Find targets: what team1 wants from team2's roster and vice versa
  const targets1 = need1 ? _findTargetPlayersFromRoster(team2Roster, need1, team1Dir, team2TradingBlock) : [];
  const targets2 = need2 ? _findTargetPlayersFromRoster(team1Roster, need2, team2Dir, team1TradingBlock) : [];

  const patterns = [];

  // Pattern A: Player-for-player swap (both found targets)
  if (targets1.length > 0 && targets2.length > 0) {
    patterns.push({ type: 'swap', target1: targets1[0], target2: targets2[0] });
  }

  // Pattern B: Player-for-picks (rebuilder sells veteran to contender)
  if (targets1.length > 0 &&
      ['title_contender', 'win_now'].includes(team1Dir) &&
      ['rebuilding', 'ascending'].includes(team2Dir) &&
      team1Picks.length > 0) {
    // Team1 (contender) wants a player from team2 (rebuilder), pays with picks
    const veteran = targets1[0];
    if (getPlayerAge(veteran) >= 26 && getPlayerRating(veteran) >= 74) {
      patterns.push({ type: 'player_for_picks', buyer: 'team1', seller: 'team2', target: veteran });
    }
  }
  if (targets2.length > 0 &&
      ['title_contender', 'win_now'].includes(team2Dir) &&
      ['rebuilding', 'ascending'].includes(team1Dir) &&
      team2Picks.length > 0) {
    // Team2 (contender) wants a player from team1 (rebuilder), pays with picks
    const veteran = targets2[0];
    if (getPlayerAge(veteran) >= 26 && getPlayerRating(veteran) >= 74) {
      patterns.push({ type: 'player_for_picks', buyer: 'team2', seller: 'team1', target: veteran });
    }
  }

  // Pattern C: Player + pick for player (one side found target, value gap)
  if (targets1.length > 0 && targets2.length === 0 && team2Picks.length > 0) {
    patterns.push({ type: 'player_plus_pick', upgrader: 'team1', target: targets1[0] });
  }
  if (targets2.length > 0 && targets1.length === 0 && team1Picks.length > 0) {
    patterns.push({ type: 'player_plus_pick', upgrader: 'team2', target: targets2[0] });
  }

  // Try each pattern until one works
  for (const pattern of patterns) {
    let team1Gives = [];
    let team2Gives = [];

    if (pattern.type === 'swap') {
      team1Gives = [{ type: 'player', playerId: pattern.target2.id }];
      team2Gives = [{ type: 'player', playerId: pattern.target1.id }];

      // If value gap > 30%, losing side sweetens with a pick
      const val1 = getPlayerTradeValue(pattern.target1); // team2 gives this to team1
      const val2 = getPlayerTradeValue(pattern.target2); // team1 gives this to team2
      if (val1 > 0 && val2 > 0) {
        const ratio = val2 / val1;
        if (ratio < 0.7 && team1Picks.length > 0) {
          // Team1 is getting more value, sweeten with a pick
          team1Gives.push({ type: 'pick', pickId: team1Picks[0].id });
        } else if (ratio > 1.3 && team2Picks.length > 0) {
          // Team2 is getting more value, sweeten with a pick
          team2Gives.push({ type: 'pick', pickId: team2Picks[0].id });
        }
      }
    } else if (pattern.type === 'player_for_picks') {
      const isBuyerTeam1 = pattern.buyer === 'team1';
      const buyerPicks = isBuyerTeam1 ? team1Picks : team2Picks;

      const picksToGive = [{ type: 'pick', pickId: buyerPicks[0].id }];
      if (getPlayerRating(pattern.target) >= 78 && buyerPicks.length > 1) {
        picksToGive.push({ type: 'pick', pickId: buyerPicks[1].id });
      }

      if (isBuyerTeam1) {
        team1Gives = picksToGive;
        team2Gives = [{ type: 'player', playerId: pattern.target.id }];
      } else {
        team2Gives = picksToGive;
        team1Gives = [{ type: 'player', playerId: pattern.target.id }];
      }
    } else if (pattern.type === 'player_plus_pick') {
      const isUpgraderTeam1 = pattern.upgrader === 'team1';
      // Upgrader gets the better player, gives a lesser player + pick
      const upgraderRoster = isUpgraderTeam1 ? team1Roster : team2Roster;
      const upgraderPicks = isUpgraderTeam1 ? team1Picks : team2Picks;

      // Find a lesser player from upgrader's roster to send back
      const sorted = [...upgraderRoster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));
      const candidates = sorted.slice(3); // Skip top 3
      const targetVal = getPlayerTradeValue(pattern.target);
      let sendBack = null;
      for (const c of candidates) {
        const cVal = getPlayerTradeValue(c);
        if (cVal >= targetVal * 0.4 && cVal <= targetVal * 0.85) {
          sendBack = c;
          break;
        }
      }
      if (!sendBack) continue;

      if (isUpgraderTeam1) {
        team1Gives = [
          { type: 'player', playerId: sendBack.id },
          { type: 'pick', pickId: upgraderPicks[0].id },
        ];
        team2Gives = [{ type: 'player', playerId: pattern.target.id }];
      } else {
        team2Gives = [
          { type: 'player', playerId: sendBack.id },
          { type: 'pick', pickId: upgraderPicks[0].id },
        ];
        team1Gives = [{ type: 'player', playerId: pattern.target.id }];
      }
    }

    if (team1Gives.length === 0 || team2Gives.length === 0) continue;

    // Cap check: ensure neither team exceeds luxury tax after the trade
    let team1IncomingSalary = 0, team1OutgoingSalary = 0;
    let team2IncomingSalary = 0, team2OutgoingSalary = 0;
    for (const a of team2Gives) {
      if (a.type === 'player') {
        const p = getPlayerFn(a.playerId);
        if (p) team1IncomingSalary += (p.contractSalary ?? p.contract_salary ?? 0);
      }
    }
    for (const a of team1Gives) {
      if (a.type === 'player') {
        const p = getPlayerFn(a.playerId);
        if (p) {
          team1OutgoingSalary += (p.contractSalary ?? p.contract_salary ?? 0);
          team2IncomingSalary += (p.contractSalary ?? p.contract_salary ?? 0);
        }
      }
    }
    for (const a of team2Gives) {
      if (a.type === 'player') {
        const p = getPlayerFn(a.playerId);
        if (p) team2OutgoingSalary += (p.contractSalary ?? p.contract_salary ?? 0);
      }
    }

    const team1Payroll = _calculateTeamPayroll(team1Roster);
    const team2Payroll = _calculateTeamPayroll(team2Roster);
    if (team1Payroll + team1IncomingSalary - team1OutgoingSalary > LUXURY_TAX_LINE) continue;
    if (team2Payroll + team2IncomingSalary - team2OutgoingSalary > LUXURY_TAX_LINE) continue;

    // Evaluate from both perspectives
    const eval1 = evaluateTrade({
      proposal: { aiReceives: team2Gives, aiGives: team1Gives },
      team: team1,
      teamRoster: team1Roster,
      difficulty,
      context,
      getPlayerFn,
    });

    const eval2 = evaluateTrade({
      proposal: { aiReceives: team1Gives, aiGives: team2Gives },
      team: team2,
      teamRoster: team2Roster,
      difficulty,
      context,
      getPlayerFn,
    });

    if (eval1.decision === 'accept' && eval2.decision === 'accept') {
      return { team1Gives, team2Gives };
    }
  }

  return null;
}

/**
 * Process AI-to-AI trades for a weekly cycle.
 * Called once per Monday boundary during the regular season.
 *
 * @param {object} params
 * @param {Array} params.aiTeams - AI team objects (with draftPicks)
 * @param {Array} params.allPlayers - All league players
 * @param {object} params.standings - { east: [], west: [] }
 * @param {Array} params.allTeams - All teams for context
 * @param {string} params.currentDate - ISO date string
 * @param {number} params.seasonYear
 * @param {string} params.difficulty
 * @returns {object} { trades, playerMoves, pickMoves, newsEvents }
 */
export function processAiToAiTrades({
  aiTeams,
  allPlayers,
  standings,
  allTeams,
  currentDate,
  seasonYear,
  difficulty = 'pro',
}) {
  const empty = { trades: [], playerMoves: [], pickMoves: [], newsEvents: [] };

  // Gate: must be before trade deadline
  if (!isBeforeDeadline(currentDate, seasonYear)) return empty;

  const context = buildContext({ standings, teams: allTeams, seasonPhase: 'regular_season' });

  // Build player lookup
  const playerMap = new Map();
  for (const p of allPlayers) {
    playerMap.set(p.id, p);
  }
  const getPlayerFn = (id) => playerMap.get(id) ?? null;

  // Build team info: direction, roster, picks
  const teamInfoMap = new Map();
  for (const team of aiTeams) {
    const roster = allPlayers.filter(p =>
      (p.teamId === team.id || p.team_id === team.id) &&
      (p.isFreeAgent !== 1 && p.is_free_agent !== 1)
    );
    const dir = analyzeTeamDirection(team, roster, context);
    const picks = (team.draftPicks || []).filter(pk =>
      (pk.currentOwnerId ?? pk.current_owner_id) === team.id
    );
    const tradingBlock = team.tradingBlock || computeAiTradingBlock({ roster, direction: dir });
    teamInfoMap.set(team.id, { team, roster, dir, picks, tradingBlock });
  }

  // Deadline proximity multiplier
  const deadline = getTradeDeadline(seasonYear);
  const deadlineDate = new Date(deadline.year, deadline.month - 1, deadline.day);
  const current = new Date(currentDate);
  const daysUntilDeadline = Math.ceil((deadlineDate - current) / (1000 * 60 * 60 * 24));
  const nearDeadline = daysUntilDeadline >= 0 && daysUntilDeadline <= 30;

  // Shuffle teams for randomness
  const shuffled = [...aiTeams].sort(() => Math.random() - 0.5);
  const tradedTeams = new Set();
  const trades = [];
  const playerMoves = [];
  const pickMoves = [];
  const newsEvents = [];

  // Iterate unique pairs
  for (let i = 0; i < shuffled.length && trades.length < 3; i++) {
    for (let j = i + 1; j < shuffled.length && trades.length < 3; j++) {
      const t1 = shuffled[i];
      const t2 = shuffled[j];

      if (tradedTeams.has(t1.id) || tradedTeams.has(t2.id)) continue;

      const info1 = teamInfoMap.get(t1.id);
      const info2 = teamInfoMap.get(t2.id);
      if (!info1 || !info2 || info1.roster.length < 8 || info2.roster.length < 8) continue;

      // Probability gate
      let probability = 0.08;
      if (nearDeadline) {
        if (['title_contender', 'win_now'].includes(info1.dir) ||
            ['title_contender', 'win_now'].includes(info2.dir)) {
          probability *= 2;
        } else {
          probability *= 1.5;
        }
      }
      if (Math.random() > probability) continue;

      // Attempt to find a deal
      const deal = _findAiToAiTrade({
        team1: info1.team, team1Roster: info1.roster, team1Dir: info1.dir, team1Picks: info1.picks,
        team2: info2.team, team2Roster: info2.roster, team2Dir: info2.dir, team2Picks: info2.picks,
        team1TradingBlock: info1.tradingBlock, team2TradingBlock: info2.tradingBlock,
        context, difficulty, getPlayerFn,
      });

      if (!deal) continue;

      tradedTeams.add(t1.id);
      tradedTeams.add(t2.id);

      // Build structured trade record
      const trade = {
        team1: { id: t1.id, abbreviation: t1.abbreviation, city: t1.city, name: t1.name },
        team2: { id: t2.id, abbreviation: t2.abbreviation, city: t2.city, name: t2.name },
        team1Gives: deal.team1Gives,
        team2Gives: deal.team2Gives,
      };
      trades.push(trade);

      // Track player moves
      for (const a of deal.team1Gives) {
        if (a.type === 'player') {
          playerMoves.push({
            playerId: a.playerId,
            fromTeamId: t1.id,
            toTeamId: t2.id,
            fromAbbr: t1.abbreviation,
            toAbbr: t2.abbreviation,
          });
        }
        if (a.type === 'pick') {
          pickMoves.push({ pickId: a.pickId, fromTeamId: t1.id, toTeamId: t2.id });
        }
      }
      for (const a of deal.team2Gives) {
        if (a.type === 'player') {
          playerMoves.push({
            playerId: a.playerId,
            fromTeamId: t2.id,
            toTeamId: t1.id,
            fromAbbr: t2.abbreviation,
            toAbbr: t1.abbreviation,
          });
        }
        if (a.type === 'pick') {
          pickMoves.push({ pickId: a.pickId, fromTeamId: t2.id, toTeamId: t1.id });
        }
      }

      // Generate news headline (from perspective of team receiving higher-rated player)
      const team1ReceivesPlayers = deal.team2Gives.filter(a => a.type === 'player');
      const team2ReceivesPlayers = deal.team1Gives.filter(a => a.type === 'player');
      let headlineTeam, otherTeam, receivedAssets, sentAssets;

      const bestRating1 = team1ReceivesPlayers.reduce((max, a) => {
        const p = getPlayerFn(a.playerId);
        return p ? Math.max(max, getPlayerRating(p)) : max;
      }, 0);
      const bestRating2 = team2ReceivesPlayers.reduce((max, a) => {
        const p = getPlayerFn(a.playerId);
        return p ? Math.max(max, getPlayerRating(p)) : max;
      }, 0);

      if (bestRating1 >= bestRating2) {
        headlineTeam = trade.team1;
        otherTeam = trade.team2;
        receivedAssets = deal.team2Gives;
        sentAssets = deal.team1Gives;
      } else {
        headlineTeam = trade.team2;
        otherTeam = trade.team1;
        receivedAssets = deal.team1Gives;
        sentAssets = deal.team2Gives;
      }

      const formatAssetList = (assets) => {
        return assets.map(a => {
          if (a.type === 'player') {
            const p = getPlayerFn(a.playerId);
            return p ? getPlayerName(p) : 'Unknown';
          }
          // Find pick display name
          const allPicks = [...info1.picks, ...info2.picks];
          const pk = allPicks.find(x => x.id === a.pickId);
          return pk?.display_name || 'Draft Pick';
        }).join(', ');
      };

      const receivedName = formatAssetList(receivedAssets);
      const sentList = formatAssetList(sentAssets);
      const receivedList = formatAssetList(receivedAssets);

      newsEvents.push({
        event_type: 'trade',
        headline: `${headlineTeam.name} acquire ${receivedName} from ${otherTeam.name}`,
        body: `The ${headlineTeam.city} ${headlineTeam.name} have traded ${sentList} to the ${otherTeam.city} ${otherTeam.name} in exchange for ${receivedList}.`,
        date: currentDate,
      });
    }
  }

  return { trades, playerMoves, pickMoves, newsEvents };
}
