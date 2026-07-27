// =============================================================================
// FinanceManager.js
// =============================================================================
// Team finance management: salary cap, contracts, free agents, payroll.
// Translated from PHP: backend/app/Services/FinanceService.php
// =============================================================================

import { SALARY_CAP as DEFAULT_SALARY_CAP, veteranMinSalary } from '../data/salaryScale';
import { playerMarketValue } from '../ai/ResignValuationService';

const DEFAULT_FREE_AGENT_SALARY = 8_000_000; // $8M — last-ditch fallback only
const DEFAULT_FREE_AGENT_YEARS = 2;
const MAX_ROSTER_SIZE = 15;

// =============================================================================
// COMPOSITE ATTRIBUTE SCORES
// =============================================================================

/**
 * Calculate composite shooting score from attributes.
 * @param {object} attributes - Player attributes (nested structure)
 * @returns {number|null}
 */
export function calculateShootingScore(attributes) {
  const offense = attributes?.offense ?? {};
  const values = [
    offense.threePoint,
    offense.midRange,
    offense.closeShot,
    offense.freeThrow,
  ].filter(v => v != null);

  return values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/**
 * Calculate composite playmaking score.
 * @param {object} attributes
 * @returns {number|null}
 */
export function calculatePlaymakingScore(attributes) {
  const offense = attributes?.offense ?? {};
  const values = [
    offense.passAccuracy,
    offense.passVision,
    offense.ballHandling,
    offense.passIQ,
  ].filter(v => v != null);

  return values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/**
 * Calculate composite defense score.
 * @param {object} attributes
 * @returns {number|null}
 */
export function calculateDefenseScore(attributes) {
  const defense = attributes?.defense ?? {};
  const values = [
    defense.perimeterDefense,
    defense.interiorDefense,
    defense.helpDefenseIQ,
    defense.defensiveConsistency,
  ].filter(v => v != null);

  return values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/**
 * Calculate composite athleticism score.
 * @param {object} attributes
 * @returns {number|null}
 */
export function calculateAthleticismScore(attributes) {
  const physical = attributes?.physical ?? {};
  const values = [
    physical.speed,
    physical.acceleration,
    physical.vertical,
    physical.strength,
  ].filter(v => v != null);

  return values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/**
 * Calculate composite rebounding score.
 * @param {object} attributes
 * @returns {number|null}
 */
export function calculateReboundingScore(attributes) {
  const defense = attributes?.defense ?? {};
  const values = [
    defense.offensiveRebound,
    defense.defensiveRebound,
  ].filter(v => v != null);

  return values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format height in inches to readable string.
 * @param {number|null} heightInches
 * @returns {string|null}
 */
export function formatHeight(heightInches) {
  if (!heightInches) return null;
  const feet = Math.floor(heightInches / 12);
  const inches = heightInches % 12;
  return `${feet}'${inches}"`;
}

/**
 * Calculate age from birth date string.
 * @param {string|null} birthDate - ISO date string
 * @returns {number}
 */
export function calculateAgeFromBirthDate(birthDate) {
  if (!birthDate) return 25;

  try {
    const birth = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    if (age < 0 || age > 50) return 25;
    return age;
  } catch {
    return 25;
  }
}

// =============================================================================
// ENRICH PLAYER DATA
// =============================================================================

/**
 * Enrich a player object with composite attribute scores.
 * Used for roster display and free agent display.
 * @param {object} player - Player data object
 * @param {object|null} stats - Season stats for this player or null
 * @returns {object} Enriched player object
 */
export function enrichPlayerData(player, stats = null) {
  const attributes = player.attributes ?? {};

  const shooting = calculateShootingScore(attributes);
  const playmaking = calculatePlaymakingScore(attributes);
  const defense = calculateDefenseScore(attributes);
  const athleticism = calculateAthleticismScore(attributes);
  const rebounding = calculateReboundingScore(attributes);
  const basketballIQ = attributes?.mental?.basketballIQ ?? null;

  return {
    // Spread original player so no fields (motivations, personality, morale, etc.) are lost
    ...player,
    // Normalized/computed fields override originals
    firstName: player.firstName ?? player.first_name,
    lastName: player.lastName ?? player.last_name,
    secondaryPosition: player.secondaryPosition ?? player.secondary_position ?? null,
    jerseyNumber: player.jerseyNumber ?? player.jersey_number ?? null,
    overallRating: player.overallRating ?? player.overall_rating,
    potentialRating: player.potentialRating ?? player.potential_rating,
    age: player.age ?? calculateAgeFromBirthDate(player.birthDate ?? player.birth_date ?? null),
    height: player.heightFormatted ?? player.height_formatted ?? formatHeight(player.heightInches ?? player.height_inches ?? null),
    weight: player.weightLbs ?? player.weight_lbs ?? null,
    contractSalary: parseFloat(player.contractSalary ?? player.contract_salary ?? 0),
    contractYearsRemaining: parseInt(player.contractYearsRemaining ?? player.contract_years_remaining ?? 0),
    attributes,
    badges: player.badges ?? [],
    shooting,
    playmaking,
    defense,
    athleticism,
    rebounding,
    basketballIQ,
    stats: stats ? {
      ppg: Math.round((stats.ppg ?? 0) * 10) / 10,
      rpg: Math.round((stats.rpg ?? 0) * 10) / 10,
      apg: Math.round((stats.apg ?? 0) * 10) / 10,
      fgPct: Math.round(stats.fg_pct ?? stats.fgPct ?? 0),
      gamesPlayed: stats.games_played ?? stats.gamesPlayed ?? 0,
    } : null,
  };
}

// =============================================================================
// FINANCE SUMMARY
// =============================================================================

/**
 * Get the team's financial summary.
 * @param {object} params
 * @param {Array} params.roster - Array of player objects with contractSalary
 * @param {number} [params.salaryCap] - Team's salary cap
 * @param {number} [params.currentSeasonYear]
 * @returns {object}
 */
export function getFinanceSummary({ roster, salaryCap = DEFAULT_SALARY_CAP, currentSeasonYear = new Date().getFullYear(), capNumbers = null }) {
  const totalPayroll = roster.reduce((sum, p) => sum + parseFloat(p.contractSalary ?? p.contract_salary ?? 0), 0);

  return {
    salary_cap: salaryCap,
    total_payroll: totalPayroll,
    cap_space: salaryCap - totalPayroll,
    roster_count: roster.length,
    current_season: currentSeasonYear,
    // Threshold ladder (campaign-scoped via capNumbersFor; null when the
    // caller doesn't supply a set — UI hides the ladder rows in that case).
    luxury_tax: capNumbers?.luxuryTax ?? null,
    first_apron: capNumbers?.firstApron ?? null,
    second_apron: capNumbers?.secondApron ?? null,
  };
}

// =============================================================================
// ROSTER CONTRACTS (with stats)
// =============================================================================

/**
 * Get roster with contracts and season stats.
 * @param {object} params
 * @param {Array} params.roster - Array of player objects
 * @param {object} params.seasonStats - Map of playerId => stats
 * @returns {Array}
 */
export function getRosterContracts({ roster, seasonStats = {} }) {
  return roster.map(player => {
    const stats = seasonStats[player.id] ?? null;
    return enrichPlayerData(player, stats);
  });
}

// =============================================================================
// FREE AGENTS
// =============================================================================

/**
 * Get free agents with enriched data from league players.
 * @param {Array} leaguePlayers - All league players
 * @returns {Array}
 */
export function getFreeAgents(leaguePlayers) {
  return leaguePlayers
    .filter(player => {
      if (player.isRetired || player.is_retired) return false;
      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
      return !teamAbbr || teamAbbr === 'FA';
    })
    .map(player => {
      const enriched = enrichPlayerData(player);
      // Free agents have no contract
      enriched.contractSalary = 0;
      enriched.contractYearsRemaining = 0;
      return enriched;
    });
}

// =============================================================================
// SEASON STATS
// =============================================================================

/**
 * Calculate per-game stats from season totals.
 * @param {object} playerStats - Raw season stats with totals
 * @returns {object|null}
 */
export function calculatePerGameStats(playerStats) {
  const gamesPlayed = playerStats?.gamesPlayed ?? 0;
  if (gamesPlayed <= 0) return null;

  return {
    games_played: gamesPlayed,
    ppg: (playerStats.points ?? 0) / gamesPlayed,
    rpg: (playerStats.rebounds ?? 0) / gamesPlayed,
    apg: (playerStats.assists ?? 0) / gamesPlayed,
    fg_pct: (playerStats.fga ?? 0) > 0
      ? ((playerStats.fgm ?? 0) / playerStats.fga) * 100
      : 0,
  };
}

/**
 * Build season stats lookup from season data.
 * @param {object} seasonData - Season data object with playerStats
 * @returns {object} Map of playerId => per-game stats
 */
export function buildSeasonStatsLookup(seasonData) {
  const stats = {};
  const playerStats = seasonData?.playerStats ?? {};

  for (const [playerId, rawStats] of Object.entries(playerStats)) {
    const perGame = calculatePerGameStats(rawStats);
    if (perGame) {
      stats[playerId] = perGame;
    }
  }

  return stats;
}

// =============================================================================
// VALIDATE SIGNING
// =============================================================================

/**
 * Validate a new signing against salary cap.
 * @param {object} params
 * @param {number} params.salary - The salary to sign at
 * @param {string} params.capMode - 'easy', 'normal', or 'hard'
 * @param {number} params.currentPayroll
 * @param {number} params.salaryCap
 * @returns {{ valid: boolean, reason?: string, current_payroll?: number, signing_salary?: number, salary_cap?: number }}
 */
export function validateSigning({ salary, capMode = 'normal', currentPayroll, salaryCap = DEFAULT_SALARY_CAP }) {
  // Easy mode - no restrictions
  if (capMode === 'easy') {
    return { valid: true };
  }

  // Hard cap mode
  if (capMode === 'hard') {
    if (currentPayroll + salary > salaryCap) {
      return {
        valid: false,
        reason: 'Signing would exceed salary cap',
        current_payroll: currentPayroll,
        signing_salary: salary,
        salary_cap: salaryCap,
      };
    }
  }

  // Normal mode - soft cap (allow signings even over cap, like NBA bird rights)
  return {
    valid: true,
    current_payroll: currentPayroll,
    signing_salary: salary,
    salary_cap: salaryCap,
  };
}

// =============================================================================
// SIGN FREE AGENT
// =============================================================================

/**
 * Sign a free agent to the user's team.
 * Returns the result and updated data, but does NOT mutate input.
 * @param {object} params
 * @param {string} params.playerId
 * @param {Array} params.leaguePlayers - All league players
 * @param {Array} params.currentRoster - Current roster
 * @param {string} params.capMode
 * @param {number} params.salaryCap
 * @returns {{ success: boolean, player?: object, updatedLeaguePlayers?: Array, error?: string }}
 */
export function signFreeAgent({ playerId, leaguePlayers, currentRoster, salary = null, years = null, salaryCap = DEFAULT_SALARY_CAP }) {
  // Validate roster size
  if (currentRoster.length >= MAX_ROSTER_SIZE) {
    return { success: false, error: 'Roster is full (15 players maximum)' };
  }

  // Find the free agent
  let freeAgent = null;
  let freeAgentIndex = -1;

  for (let i = 0; i < leaguePlayers.length; i++) {
    const player = leaguePlayers[i];
    if ((player.id ?? '') == playerId) {
      // Accept the player if ANY free-agent signal is true. Older release
      // paths in the engine only update some of the duplicated camelCase /
      // snake_case fields, which can leave a player record where
      // `isFreeAgent === 1` but `team_abbreviation` still points at their
      // previous club (or vice versa). Honoring any of the four signals
      // keeps the signing flow resilient to that drift.
      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
      const isFA = player.isFreeAgent === 1 || player.is_free_agent === 1;
      const hasNoTeam = !player.teamId && !player.team_id;
      if (isFA || hasNoTeam || !teamAbbr || teamAbbr === 'FA') {
        freeAgent = player;
        freeAgentIndex = i;
        break;
      }
    }
  }

  if (!freeAgent) {
    return { success: false, error: 'Player not found or not a free agent' };
  }

  // Resolve the contract terms: honor the offered salary/years, defaulting to
  // the player's market value when none is supplied.
  const minSalary = veteranMinSalary(freeAgent);
  const offerSalary = Math.max(
    minSalary,
    Math.round(salary ?? playerMarketValue(freeAgent) ?? DEFAULT_FREE_AGENT_SALARY)
  );
  const offerYears = Math.max(1, Math.min(5, Math.round(years ?? DEFAULT_FREE_AGENT_YEARS)));

  // Cap rule: a minimum-salary contract is always allowed (the NBA minimum
  // exception — even over the cap). Anything above the minimum requires real
  // cap space, so an over-the-cap team can only add minimum-salary players.
  const currentPayroll = currentRoster.reduce(
    (sum, p) => sum + parseFloat(p.contractSalary ?? p.contract_salary ?? 0), 0
  );
  const isMinimumDeal = offerSalary <= minSalary;
  if (!isMinimumDeal && currentPayroll + offerSalary > salaryCap) {
    return {
      success: false,
      error: 'Over the cap — you can only sign minimum-salary players.',
    };
  }

  // Per-year escalation (5%/yr), mirroring the other contract-building paths.
  const salaries = [];
  for (let i = 0; i < offerYears; i++) {
    salaries.push(Math.round((offerSalary * (1 + 0.05 * i)) / 10000) * 10000);
  }
  const contractDetails = {
    totalYears: offerYears,
    salaries,
    options: {},
    noTradeClause: false,
    minimumDeal: isMinimumDeal,
    signedAsFreeAgent: true,
  };

  // Build signed player data
  const signedPlayer = {
    ...freeAgent,
    contractYearsRemaining: offerYears,
    contract_years_remaining: offerYears,
    contractSalary: offerSalary,
    contract_salary: offerSalary,
    contractDetails,
    contract_details: contractDetails,
  };

  // Remove from league players list
  const updatedLeaguePlayers = [...leaguePlayers];
  updatedLeaguePlayers.splice(freeAgentIndex, 1);

  const playerName = `${freeAgent.firstName ?? freeAgent.first_name ?? ''} ${freeAgent.lastName ?? freeAgent.last_name ?? ''}`.trim();

  return {
    success: true,
    player: signedPlayer,
    updatedLeaguePlayers,
    transaction: {
      type: 'signing',
      playerName,
      playerId: freeAgent.id,
      years: offerYears,
      salary: offerSalary,
      totalValue: offerSalary * offerYears,
    },
    message: `Signed ${playerName}`,
  };
}

// =============================================================================
// RE-SIGN PLAYER
// =============================================================================

/**
 * Re-sign a player to a new contract (same salary rate for Phase 1).
 * @param {object} params
 * @param {object} params.player - Player object
 * @param {number} params.years - Number of years
 * @param {boolean} [params.resignDeadlinePassed] - When true, refuses to mutate the
 *   contract and returns a failure result. The store layer should already gate
 *   this, but we double-check at the engine layer as defense in depth.
 * @returns {{ success: boolean, player: object|null, transaction: object|null, message: string }}
 */
export function resignPlayer({ player, years, salary: salaryOverride, resignDeadlinePassed = false }) {
  const playerName = `${player.firstName ?? player.first_name ?? ''} ${player.lastName ?? player.last_name ?? ''}`.trim();

  if (resignDeadlinePassed) {
    return {
      success: false,
      player: null,
      transaction: null,
      message: 'Re-sign deadline has passed for this season',
    };
  }

  const salary = salaryOverride != null
    ? parseFloat(salaryOverride)
    : parseFloat(player.contractSalary ?? player.contract_salary ?? 0);

  // Mid-season extension semantics: the new N-year deal starts NEXT season.
  // processSeasonEnd() decrements contractYearsRemaining at season's end for
  // every player, so without a guard a player re-signed mid-season for N years
  // would carry only N-1 into the new season — and a 1-year re-sign would
  // expire to 0 and be flipped to a free agent during enterOffseason.
  //
  // The authoritative persister (stores/finance.js resignPlayer) writes the
  // guard fields onto the DB record: the legacy `resignedThisSeason` boolean
  // AND a `resignedSeasonYear` stamp that processSeasonEnd compares (not
  // consumes) so the skip is idempotent and survives sync round-trips. The
  // boolean below keeps this engine helper's returned player self-consistent
  // for any in-memory caller.
  const updatedPlayer = {
    ...player,
    contractYearsRemaining: years,
    contract_years_remaining: years,
    contractSalary: salary,
    contract_salary: salary,
    resignedThisSeason: true,
    resigned_this_season: true,
  };

  return {
    success: true,
    player: updatedPlayer,
    transaction: {
      type: 'extension',
      playerName,
      playerId: player.id,
      years,
      salary,
      totalValue: salary * years,
    },
    message: `Re-signed ${playerName} to a ${years}-year deal`,
  };
}

// =============================================================================
// DROP PLAYER
// =============================================================================

/**
 * Drop a player from the roster (release to free agency).
 * @param {object} params
 * @param {object} params.player - Player object to release
 * @param {Array} params.leaguePlayers - Current league players
 * @returns {{ success: boolean, updatedLeaguePlayers: Array, transaction: object, message: string }}
 */
export function dropPlayer({ player, leaguePlayers }) {
  const playerName = `${player.firstName ?? player.first_name ?? ''} ${player.lastName ?? player.last_name ?? ''}`.trim();
  const salary = parseFloat(player.contractSalary ?? player.contract_salary ?? 0);
  const yearsRemaining = player.contractYearsRemaining ?? player.contract_years_remaining ?? 0;

  // Create free agent entry
  const freeAgentData = {
    id: `fa_${player.id}_${Date.now()}`,
    firstName: player.firstName ?? player.first_name,
    lastName: player.lastName ?? player.last_name,
    position: player.position,
    secondaryPosition: player.secondaryPosition ?? player.secondary_position ?? null,
    jerseyNumber: player.jerseyNumber ?? player.jersey_number ?? null,
    heightInches: player.heightInches ?? player.height_inches ?? null,
    weightLbs: player.weightLbs ?? player.weight_lbs ?? null,
    birthDate: player.birthDate ?? player.birth_date ?? null,
    country: player.country ?? 'USA',
    overallRating: player.overallRating ?? player.overall_rating,
    potentialRating: player.potentialRating ?? player.potential_rating,
    attributes: player.attributes ?? {},
    tendencies: player.tendencies ?? {},
    badges: player.badges ?? [],
    teamAbbreviation: 'FA',
  };

  const updatedLeaguePlayers = [...leaguePlayers, freeAgentData];

  return {
    success: true,
    updatedLeaguePlayers,
    transaction: {
      type: 'release',
      playerName,
      playerId: player.id,
      salary,
      yearsRemaining,
    },
    message: `Released ${playerName}`,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  DEFAULT_SALARY_CAP,
  DEFAULT_FREE_AGENT_SALARY,
  DEFAULT_FREE_AGENT_YEARS,
  MAX_ROSTER_SIZE,
};
