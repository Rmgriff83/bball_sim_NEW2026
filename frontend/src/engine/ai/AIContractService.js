// =============================================================================
// AIContractService.js
// =============================================================================
// AI team contract decision logic (extensions, signings, releases).
// Translated from PHP: backend/app/Services/AIContractService.php
// =============================================================================

import { analyzeTeamDirection, buildContext } from './AITradeService';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// =============================================================================
// SALARY LOOKUP
// =============================================================================

/**
 * Calculate expected salary based on player rating.
 * @param {number} rating
 * @returns {number}
 */
function calculateExpectedSalary(rating) {
  if (rating >= 90) return 40_000_000;
  if (rating >= 85) return 30_000_000;
  if (rating >= 80) return 20_000_000;
  if (rating >= 75) return 10_000_000;
  if (rating >= 70) return 5_000_000;
  if (rating >= 65) return 3_000_000;
  return 2_000_000;
}

// =============================================================================
// HELPERS
// =============================================================================

function getPlayerRating(player) {
  return player.overallRating ?? player.overall_rating ?? 70;
}

function getPlayerAge(player) {
  if (player.age != null) return player.age;
  const birthDate = player.birthDate ?? player.birth_date ?? null;
  if (birthDate) {
    const birth = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    return Math.abs(age);
  }
  return 25;
}

function getPlayerName(player) {
  const first = player.firstName ?? player.first_name ?? '';
  const last = player.lastName ?? player.last_name ?? '';
  return `${first} ${last}`.trim();
}

function getTeamRoster(leaguePlayers, teamAbbr) {
  return leaguePlayers.filter(p => {
    return (p.teamAbbreviation ?? p.team_abbreviation ?? '') === teamAbbr;
  });
}

/**
 * Check if team has position need (fewer than 2 at a position).
 * @param {Array} roster
 * @param {string} position
 * @returns {boolean}
 */
function hasPositionNeed(roster, position) {
  const positionCounts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };

  for (const player of roster) {
    const pos = player.position ?? 'SF';
    if (positionCounts[pos] !== undefined) {
      positionCounts[pos]++;
    }
  }

  return (positionCounts[position] ?? 0) < 2;
}

/**
 * Check if player matches team direction.
 * @param {number} age
 * @param {number} rating
 * @param {string} direction
 * @returns {boolean}
 */
function playerMatchesDirection(age, rating, direction) {
  switch (direction) {
    case 'rebuilding':
      return age <= 28 || rating >= 80;
    case 'contending':
      return rating >= 72;
    default:
      return true;
  }
}

// =============================================================================
// EVALUATE RE-SIGNING
// =============================================================================

/**
 * Evaluate whether AI should re-sign a player.
 * @param {object} player
 * @param {string} direction
 * @param {object|null} stats - Season stats
 * @param {number} rosterCount - Current roster size
 * @returns {boolean}
 */
export function evaluateResigning(player, direction, stats, rosterCount = 12) {
  const rating = getPlayerRating(player);
  const age = getPlayerAge(player);
  const salary = player.contractSalary ?? player.contract_salary ?? 0;

  const expectedSalary = calculateExpectedSalary(rating);

  // Factor 1: Is player performing well?
  let isPerformingWell = rating >= 70;
  if (stats && (stats.gamesPlayed ?? 0) >= 5) {
    const ppg = (stats.points ?? 0) / stats.gamesPlayed;
    isPerformingWell = isPerformingWell && (ppg >= 5 || rating >= 75);
  }

  // Factor 2: Is player massively overpaid?
  const isMassivelyOverpaid = salary > (expectedSalary * 1.5);

  // Factor 3: Does player match team direction?
  const matchesDirection = playerMatchesDirection(age, rating, direction);

  // Factor 4: Minimum roster needs
  const needsPlayers = rosterCount < 12;

  // Decision logic
  if (isMassivelyOverpaid && !needsPlayers) {
    return false; // Let overpaid players walk unless desperate
  }

  if (!matchesDirection && rating < 78) {
    return false; // Don't resign mismatched role players
  }

  return isPerformingWell || needsPlayers;
}

// =============================================================================
// EVALUATE FREE AGENT SIGNING
// =============================================================================

/**
 * Evaluate whether AI should sign a free agent.
 * @param {object} player
 * @param {string} direction
 * @param {Array} teamRoster - Current roster (from allPlayers filtered)
 * @returns {boolean}
 */
export function evaluateFreeAgentSigning(player, direction, teamRoster) {
  const rating = getPlayerRating(player);
  const age = getPlayerAge(player);
  const position = player.position ?? 'SF';

  const hasNeed = hasPositionNeed(teamRoster, position);
  const meetsRatingThreshold = rating >= 65;

  // Rebuilding teams want young players with upside
  if (direction === 'rebuilding') {
    return age <= 26 && rating >= 68 && (hasNeed || teamRoster.length < 10);
  }

  // Contending teams want proven players
  if (direction === 'contending') {
    return rating >= 72 && hasNeed;
  }

  // Middling teams fill gaps
  return meetsRatingThreshold && hasNeed;
}

// =============================================================================
// CALCULATE CONTRACT OFFER
// =============================================================================

/**
 * Calculate contract offer for a player.
 * @param {object} player
 * @param {string} direction
 * @returns {{ years: number, salary: number }}
 */
export function calculateContractOffer(player, direction) {
  const rating = getPlayerRating(player);
  const age = getPlayerAge(player);

  // Base salary from rating
  let baseSalary = calculateExpectedSalary(rating);

  // Adjust for age
  if (age <= 25) {
    baseSalary *= 1.1; // Youth premium
  } else if (age >= 32) {
    baseSalary *= 0.85; // Age discount
  }

  // Determine years based on age and direction
  let years;
  if (age >= 34) {
    years = 1;
  } else if (age >= 30) {
    years = direction === 'rebuilding' ? 1 : 2;
  } else if (age >= 27) {
    years = direction === 'rebuilding' ? 2 : 3;
  } else {
    years = direction === 'contending' ? 3 : 4;
  }

  // Cap years at 4 for AI teams
  years = Math.min(years, 4);

  return {
    years,
    salary: Math.floor(baseSalary),
  };
}

// =============================================================================
// PROCESS TEAM EXTENSIONS
// =============================================================================

/**
 * Process contract extensions for a single AI team.
 * @param {object} params
 * @param {Array} params.roster - Team's current roster
 * @param {string} params.direction - Team direction
 * @param {Array} params.leaguePlayers - Full league players array (will be mutated)
 * @param {string} params.teamAbbreviation
 * @param {function} [params.getPlayerStatsFn] - (playerId) => stats or null
 * @returns {{ extensions: Array, updatedPlayers: Array }}
 */
export function processTeamExtensions({
  roster,
  direction,
  leaguePlayers,
  teamAbbreviation,
  getPlayerStatsFn = () => null,
}) {
  const extensions = [];
  const updatedPlayers = [...leaguePlayers];

  const expiringPlayers = roster.filter(player => {
    const years = player.contractYearsRemaining ?? player.contract_years_remaining ?? 0;
    return years === 1;
  });

  for (const player of expiringPlayers) {
    const playerStats = getPlayerStatsFn(player.id);
    const rosterCount = roster.length;
    const shouldResign = evaluateResigning(player, direction, playerStats, rosterCount);

    if (shouldResign) {
      const contract = calculateContractOffer(player, direction);

      // Update player in league players array
      for (let i = 0; i < updatedPlayers.length; i++) {
        if ((updatedPlayers[i].id ?? '') == player.id) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            contractYearsRemaining: contract.years,
            contractSalary: contract.salary,
          };
          break;
        }
      }

      extensions.push({
        team: teamAbbreviation,
        player: getPlayerName(player),
        playerId: player.id,
        years: contract.years,
        salary: contract.salary,
        totalValue: contract.salary * contract.years,
      });
    }
  }

  return { extensions, updatedPlayers };
}

// =============================================================================
// PROCESS TEAM SIGNINGS
// =============================================================================

/**
 * Process free agent signings for a single AI team.
 * @param {object} params
 * @param {string} params.direction
 * @param {Array} params.leaguePlayers - Full league players (will be mutated)
 * @param {string} params.teamAbbreviation
 * @param {number} params.currentRosterCount
 * @returns {{ signings: Array, updatedPlayers: Array }}
 */
export function processTeamSignings({
  direction,
  leaguePlayers,
  teamAbbreviation,
  currentRosterCount,
}) {
  const signings = [];
  let updatedPlayers = [...leaguePlayers];
  const maxSignings = Math.min(3, 12 - currentRosterCount);

  // Get free agents
  let freeAgents = updatedPlayers.filter(player => {
    const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
    return !teamAbbr || teamAbbr === 'FA';
  });

  // Sort by overall rating descending
  freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  let signedCount = 0;

  for (const player of freeAgents) {
    if (signedCount >= maxSignings) break;

    const teamRoster = getTeamRoster(updatedPlayers, teamAbbreviation);
    const shouldSign = evaluateFreeAgentSigning(player, direction, teamRoster);

    if (shouldSign) {
      const contract = calculateContractOffer(player, direction);

      // Update player in league players array
      for (let i = 0; i < updatedPlayers.length; i++) {
        if ((updatedPlayers[i].id ?? '') == player.id) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            teamAbbreviation,
            contractYearsRemaining: contract.years,
            contractSalary: contract.salary,
          };
          break;
        }
      }

      signings.push({
        team: teamAbbreviation,
        player: getPlayerName(player),
        playerId: player.id,
        years: contract.years,
        salary: contract.salary,
        totalValue: contract.salary * contract.years,
      });

      signedCount++;
    }
  }

  return { signings, updatedPlayers };
}

// =============================================================================
// MAIN: RUN AI CONTRACT DECISIONS
// =============================================================================

/**
 * Process all AI teams' contract decisions for a campaign.
 * Called during offseason processing.
 *
 * @param {object} params
 * @param {Array} params.aiTeams - AI team objects (with abbreviation, id, etc.)
 * @param {Array} params.leaguePlayers - All league players
 * @param {object} params.standings - { east: [...], west: [...] }
 * @param {Array} params.allTeams - All teams for context
 * @param {string} params.seasonPhase
 * @param {function} [params.getPlayerStatsFn]
 * @returns {{ extensions: Array, signings: Array, updatedPlayers: Array }}
 */
export function runAIContractDecisions({
  aiTeams,
  leaguePlayers,
  standings,
  allTeams,
  seasonPhase = 'offseason',
  getPlayerStatsFn = () => null,
}) {
  const results = {
    extensions: [],
    signings: [],
  };

  let currentPlayers = [...leaguePlayers];
  const context = buildContext({ standings, teams: allTeams, seasonPhase });

  for (const team of aiTeams) {
    const teamRoster = getTeamRoster(currentPlayers, team.abbreviation);
    const direction = analyzeTeamDirection(team, teamRoster, context);

    // Process re-signings first
    const extensionResults = processTeamExtensions({
      roster: teamRoster,
      direction,
      leaguePlayers: currentPlayers,
      teamAbbreviation: team.abbreviation,
      getPlayerStatsFn,
    });
    results.extensions.push(...extensionResults.extensions);
    currentPlayers = extensionResults.updatedPlayers;

    // Process free agent signings if roster has room
    const updatedRoster = getTeamRoster(currentPlayers, team.abbreviation);
    if (updatedRoster.length < 12) {
      const signingResults = processTeamSignings({
        direction,
        leaguePlayers: currentPlayers,
        teamAbbreviation: team.abbreviation,
        currentRosterCount: updatedRoster.length,
      });
      results.signings.push(...signingResults.signings);
      currentPlayers = signingResults.updatedPlayers;
    }
  }

  return {
    extensions: results.extensions,
    signings: results.signings,
    updatedPlayers: currentPlayers,
  };
}
