// =============================================================================
// AIContractService.js
// =============================================================================
// AI team roster management: cuts, extensions, signings, backfill.
// Cap-aware with draft capital assessment and team direction integration.
// =============================================================================

import { analyzeTeamDirection, buildContext } from './AITradeService';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// =============================================================================
// CONSTANTS
// =============================================================================

const SALARY_CAP = 136_000_000;
const LUXURY_TAX_LINE = 165_000_000;
const MIN_ROSTER_SIZE = 10;
const TARGET_ROSTER_SIZE = 14;
const MAX_ROSTER_SIZE = 15;
const MINIMUM_SEASON_ROSTER = 14;

// =============================================================================
// SALARY LOOKUP
// =============================================================================

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

function getPositionCount(roster, position) {
  let count = 0;
  for (const player of roster) {
    if ((player.position ?? 'SF') === position) count++;
  }
  return count;
}

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
// CAP & PAYROLL HELPERS
// =============================================================================

function calculateTeamPayroll(roster) {
  return roster.reduce((sum, p) => sum + (p.contractSalary ?? p.contract_salary ?? 0), 0);
}

function getCapSituation(roster) {
  const payroll = calculateTeamPayroll(roster);
  const capSpace = SALARY_CAP - payroll;
  return {
    payroll,
    capSpace,
    isOverCap: payroll > SALARY_CAP,
    isInTax: payroll > LUXURY_TAX_LINE,
    capRoom: Math.max(0, capSpace),
  };
}

// =============================================================================
// DRAFT CAPITAL ASSESSMENT
// =============================================================================

function assessDraftCapital(team, gameYear) {
  const picks = team.draftPicks || [];
  const ownedPicks = picks.filter(p => p.currentOwnerId === team.id);

  let firstRoundNext2Years = 0;
  let otherFirstRound = 0;
  let secondRound = 0;

  for (const pick of ownedPicks) {
    const yearOffset = (pick.year ?? 0) - (gameYear ?? 1);
    if (pick.round === 1) {
      if (yearOffset >= 0 && yearOffset <= 1) {
        firstRoundNext2Years++;
      } else {
        otherFirstRound++;
      }
    } else {
      secondRound++;
    }
  }

  const draftRichness = Math.min(1,
    firstRoundNext2Years * 0.3 + otherFirstRound * 0.15 + secondRound * 0.05
  );

  return {
    totalPicks: ownedPicks.length,
    firstRoundPicks: firstRoundNext2Years + otherFirstRound,
    draftRichness,
  };
}

// =============================================================================
// PLAYER CONTRACT VALUE EVALUATION
// =============================================================================

function evaluatePlayerContract(player, direction, stats, rosterContext) {
  const rating = getPlayerRating(player);
  const age = getPlayerAge(player);
  const salary = player.contractSalary ?? player.contract_salary ?? 0;
  const yearsRemaining = player.contractYearsRemaining ?? player.contract_years_remaining ?? 0;
  const expectedSalary = calculateExpectedSalary(rating);

  // Base value score (0-100)
  let valueScore = rating * 0.6;

  // Age adjustment
  if (age > 30) valueScore -= (age - 30) * 5;
  if (age < 25) valueScore += (25 - age) * 5;

  // Stats bonus
  if (stats && (stats.gamesPlayed ?? 0) >= 5) {
    const ppg = (stats.points ?? 0) / stats.gamesPlayed;
    if (ppg > 8) valueScore += 10;
    else if (ppg > 4) valueScore += 5;
  }

  // Contract value comparison
  const salaryRatio = expectedSalary > 0 ? salary / expectedSalary : 1;
  if (salaryRatio <= 1.0) valueScore += 10;
  else if (salaryRatio <= 1.3) { /* fair — no adjustment */ }
  else if (salaryRatio <= 1.5) valueScore -= 10;
  else valueScore -= 20;

  // Direction fit
  if (direction === 'rebuilding') {
    if (age <= 25) valueScore += 10;
    if (age >= 30 && rating < 80) valueScore -= 10;
  } else if (direction === 'contending' || direction === 'title_contender' || direction === 'win_now') {
    if (rating >= 78) valueScore += 10;
  }

  valueScore = Math.max(0, Math.min(100, valueScore));

  // Cut decision
  const { rosterSize, isInTax, topPlayerIds } = rosterContext;
  const isTop3 = topPlayerIds.slice(0, 3).includes(player.id);
  const isTop5 = topPlayerIds.slice(0, 5).includes(player.id);
  const wouldDropBelowMin = rosterSize - 1 < MIN_ROSTER_SIZE;

  let shouldCut = false;
  let cutReason = null;

  if (isTop3 || wouldDropBelowMin) {
    // Never cut top 3 or if roster would be too small
  } else if (valueScore < 35 && salary > 5_000_000 && yearsRemaining >= 2) {
    shouldCut = true;
    cutReason = 'low_value_overpaid';
  } else if (direction === 'rebuilding' && age >= 31 && salary > 10_000_000 && yearsRemaining >= 2) {
    shouldCut = true;
    cutReason = 'rebuilding_veteran_cut';
  } else if (isInTax && valueScore < 45 && !isTop5) {
    shouldCut = true;
    cutReason = 'luxury_tax_relief';
  }

  return { valueScore, shouldCut, cutReason };
}

// =============================================================================
// PROCESS TEAM CUTS
// =============================================================================

export function processTeamCuts({
  roster,
  direction,
  leaguePlayers,
  teamAbbreviation,
  getPlayerStatsFn = () => null,
  draftCapital = { draftRichness: 0.5 },
}) {
  const cuts = [];
  let updatedPlayers = [...leaguePlayers];
  const capSituation = getCapSituation(roster);

  // Sort roster by rating descending to identify top players
  const sortedByRating = [...roster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));
  const topPlayerIds = sortedByRating.map(p => p.id);

  const rosterContext = {
    rosterSize: roster.length,
    isInTax: capSituation.isInTax,
    topPlayerIds,
  };

  // Determine max cuts based on direction and draft capital
  let maxCuts;
  if (direction === 'rebuilding' && draftCapital.draftRichness > 0.5) {
    maxCuts = 3;
  } else if (direction === 'rebuilding' || capSituation.isInTax) {
    maxCuts = 2;
  } else if (direction === 'contending' || direction === 'title_contender' || direction === 'win_now') {
    maxCuts = 1;
  } else {
    maxCuts = 1; // ascending or default
  }

  // Evaluate all players and sort by value (worst first)
  const evaluations = roster.map(player => {
    const stats = getPlayerStatsFn(player.id);
    const eval_ = evaluatePlayerContract(player, direction, stats, rosterContext);
    return { player, ...eval_ };
  });
  evaluations.sort((a, b) => a.valueScore - b.valueScore);

  let cutCount = 0;
  for (const { player, shouldCut, cutReason } of evaluations) {
    if (cutCount >= maxCuts) break;
    if (rosterContext.rosterSize - cutCount <= MIN_ROSTER_SIZE) break;
    if (!shouldCut) continue;

    // Release the player
    for (let i = 0; i < updatedPlayers.length; i++) {
      if ((updatedPlayers[i].id ?? '') == player.id) {
        updatedPlayers[i] = {
          ...updatedPlayers[i],
          isFreeAgent: 1,
          teamId: null,
          teamAbbreviation: 'FA',
          team_abbreviation: 'FA',
        };
        break;
      }
    }

    cuts.push({
      team: teamAbbreviation,
      player: getPlayerName(player),
      playerId: player.id,
      salary: player.contractSalary ?? player.contract_salary ?? 0,
      reason: cutReason,
    });

    cutCount++;
  }

  return { cuts, updatedPlayers };
}

// =============================================================================
// EVALUATE RE-SIGNING (cap-aware)
// =============================================================================

export function evaluateResigning(player, direction, stats, rosterCount = 12, capSituation = null, draftCapital = null) {
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
  const needsPlayers = rosterCount < MINIMUM_SEASON_ROSTER;

  // Cap-aware factors
  if (capSituation) {
    // In luxury tax: don't re-sign expensive role players
    if (capSituation.isInTax && salary > 8_000_000 && rating < 75) {
      return false;
    }
  }

  // Draft-rich rebuilding teams are pickier
  if (draftCapital && direction === 'rebuilding' && draftCapital.draftRichness > 0.6) {
    if (age > 27 && rating < 82) {
      return false;
    }
  }

  // Decision logic
  if (isMassivelyOverpaid && !needsPlayers) {
    return false;
  }

  if (!matchesDirection && rating < 78) {
    return false;
  }

  return isPerformingWell || needsPlayers;
}

// =============================================================================
// EVALUATE FREE AGENT SIGNING (cap-aware)
// =============================================================================

export function evaluateFreeAgentSigning(player, direction, teamRoster, capSituation = null) {
  const rating = getPlayerRating(player);
  const age = getPlayerAge(player);
  const position = player.position ?? 'SF';

  const hasNeed = hasPositionNeed(teamRoster, position);
  const meetsRatingThreshold = rating >= 65;
  const posCount = getPositionCount(teamRoster, position);
  const needsPlayers = teamRoster.length < MINIMUM_SEASON_ROSTER;

  // Don't sign if team already has 3+ at this position (unless roster is short)
  if (posCount >= 3 && !needsPlayers) return false;

  // Any team below 14 should sign serviceable players regardless of direction
  if (needsPlayers && rating >= 60) return true;

  // Cap-aware: if in luxury tax, only sign minimum-salary caliber players
  if (capSituation && capSituation.isInTax) {
    return rating >= 70 && hasNeed;
  }

  // Rebuilding teams want young players with upside
  if (direction === 'rebuilding') {
    if (age <= 24 && rating >= 62) return hasNeed;
    return age <= 26 && rating >= 68 && hasNeed;
  }

  // Contending teams want proven players (sign vets even if over cap)
  if (direction === 'contending' || direction === 'title_contender' || direction === 'win_now') {
    if (rating >= 72 && hasNeed) return true;
    if (rating >= 70 && teamRoster.length < TARGET_ROSTER_SIZE) return true;
    return false;
  }

  // Middling/ascending teams fill gaps
  return meetsRatingThreshold && hasNeed;
}

// =============================================================================
// CALCULATE CONTRACT OFFER (cap-aware)
// =============================================================================

export function calculateContractOffer(player, direction, capSituation = null) {
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

  // Cap-aware salary adjustments
  if (capSituation) {
    if (capSituation.isInTax) {
      baseSalary *= 0.80; // Tax teams offer discount
    } else if (capSituation.isOverCap) {
      baseSalary *= 0.90; // Over-cap teams offer slight discount
    } else if (!capSituation.isOverCap && (direction === 'contending' || direction === 'title_contender' || direction === 'win_now')) {
      baseSalary *= 1.10; // Contending teams with cap room pay premium
    }
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
// PROCESS TEAM EXTENSIONS (cap-aware)
// =============================================================================

export function processTeamExtensions({
  roster,
  direction,
  leaguePlayers,
  teamAbbreviation,
  getPlayerStatsFn = () => null,
  capSituation = null,
  draftCapital = null,
}) {
  const extensions = [];
  const updatedPlayers = [...leaguePlayers];

  const expiringPlayers = roster.filter(player => {
    const years = player.contractYearsRemaining ?? player.contract_years_remaining ?? 0;
    return years === 0;
  });

  for (const player of expiringPlayers) {
    const playerStats = getPlayerStatsFn(player.id);
    const rosterCount = roster.length;
    const shouldResign = evaluateResigning(player, direction, playerStats, rosterCount, capSituation, draftCapital);

    if (shouldResign) {
      const contract = calculateContractOffer(player, direction, capSituation);

      // Update player in league players array
      for (let i = 0; i < updatedPlayers.length; i++) {
        if ((updatedPlayers[i].id ?? '') == player.id) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            contractYearsRemaining: contract.years,
            contract_years_remaining: contract.years,
            contractSalary: contract.salary,
            contract_salary: contract.salary,
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
// PROCESS TEAM SIGNINGS (cap-aware, target 13)
// =============================================================================

export function processTeamSignings({
  direction,
  leaguePlayers,
  teamAbbreviation,
  teamId = null,
  currentRosterCount,
  capSituation = null,
}) {
  const signings = [];
  let updatedPlayers = [...leaguePlayers];
  const maxSignings = Math.min(4, TARGET_ROSTER_SIZE - currentRosterCount);

  if (maxSignings <= 0) return { signings, updatedPlayers };

  // Get free agents
  let freeAgents = updatedPlayers.filter(player => {
    if (player.isFreeAgent === 1 || player.is_free_agent === 1) return true;
    const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
    return !teamAbbr || teamAbbr === 'FA';
  });

  // Sort by overall rating descending
  freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  let signedCount = 0;

  for (const player of freeAgents) {
    if (signedCount >= maxSignings) break;

    const teamRoster = getTeamRoster(updatedPlayers, teamAbbreviation);
    const shouldSign = evaluateFreeAgentSigning(player, direction, teamRoster, capSituation);

    if (shouldSign) {
      const contract = calculateContractOffer(player, direction, capSituation);

      // Cap check: skip if signing would push team over luxury tax (unless contending)
      if (capSituation) {
        const projectedPayroll = calculateTeamPayroll(teamRoster) + contract.salary;
        const isContending = direction === 'contending' || direction === 'title_contender' || direction === 'win_now';
        if (projectedPayroll > LUXURY_TAX_LINE && !isContending) {
          continue;
        }
      }

      // Update player in league players array
      for (let i = 0; i < updatedPlayers.length; i++) {
        if ((updatedPlayers[i].id ?? '') == player.id) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            teamId,
            teamAbbreviation,
            team_abbreviation: teamAbbreviation,
            contractYearsRemaining: contract.years,
            contract_years_remaining: contract.years,
            contractSalary: contract.salary,
            contract_salary: contract.salary,
            isFreeAgent: 0,
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
// ROSTER BACKFILL
// =============================================================================

function backfillRoster({
  leaguePlayers,
  teamAbbreviation,
  teamId,
}) {
  const signings = [];
  let updatedPlayers = [...leaguePlayers];

  const teamRoster = getTeamRoster(updatedPlayers, teamAbbreviation);
  const slotsNeeded = MINIMUM_SEASON_ROSTER - teamRoster.length;

  if (slotsNeeded <= 0) return { signings, updatedPlayers };

  // Get free agents, sorted by rating
  let freeAgents = updatedPlayers.filter(player => {
    if (player.isDraftProspect) return false;
    if (player.isFreeAgent === 1 || player.is_free_agent === 1) return true;
    const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
    return !teamAbbr || teamAbbr === 'FA';
  });
  freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Less selective — just need warm bodies
  const minRating = 50;
  let filled = 0;

  for (const player of freeAgents) {
    if (filled >= slotsNeeded) break;
    if (getPlayerRating(player) < minRating) break;

    // Minimum-salary 1-year contract
    const salary = 2_000_000;
    const years = 1;

    for (let i = 0; i < updatedPlayers.length; i++) {
      if ((updatedPlayers[i].id ?? '') == player.id) {
        updatedPlayers[i] = {
          ...updatedPlayers[i],
          teamId,
          teamAbbreviation,
          team_abbreviation: teamAbbreviation,
          contractYearsRemaining: years,
          contract_years_remaining: years,
          contractSalary: salary,
          contract_salary: salary,
          isFreeAgent: 0,
        };
        break;
      }
    }

    signings.push({
      team: teamAbbreviation,
      player: getPlayerName(player),
      playerId: player.id,
      years,
      salary,
      totalValue: salary,
      isBackfill: true,
    });

    filled++;
  }

  return { signings, updatedPlayers };
}

// =============================================================================
// MAIN: RUN AI ROSTER MANAGEMENT
// =============================================================================

export function runAIRosterManagement({
  aiTeams,
  leaguePlayers,
  standings,
  allTeams,
  seasonPhase = 'offseason',
  getPlayerStatsFn = () => null,
  gameYear = 1,
}) {
  const results = {
    cuts: [],
    extensions: [],
    signings: [],
  };

  let currentPlayers = [...leaguePlayers];
  const context = buildContext({ standings, teams: allTeams, seasonPhase });

  for (const team of aiTeams) {
    const teamRoster = getTeamRoster(currentPlayers, team.abbreviation);
    const direction = analyzeTeamDirection(team, teamRoster, context);
    const draftCapital = assessDraftCapital(team, gameYear);
    const capSituation = getCapSituation(teamRoster);

    // Step 1: Evaluate & cut overpaid/underperforming players
    const cutResults = processTeamCuts({
      roster: teamRoster,
      direction,
      leaguePlayers: currentPlayers,
      teamAbbreviation: team.abbreviation,
      getPlayerStatsFn,
      draftCapital,
    });
    results.cuts.push(...cutResults.cuts);
    currentPlayers = cutResults.updatedPlayers;

    // Refresh roster and cap after cuts
    const rosterAfterCuts = getTeamRoster(currentPlayers, team.abbreviation);
    const capAfterCuts = getCapSituation(rosterAfterCuts);

    // Step 2: Re-sign expiring players (cap-aware)
    const extensionResults = processTeamExtensions({
      roster: rosterAfterCuts,
      direction,
      leaguePlayers: currentPlayers,
      teamAbbreviation: team.abbreviation,
      getPlayerStatsFn,
      capSituation: capAfterCuts,
      draftCapital,
    });
    results.extensions.push(...extensionResults.extensions);
    currentPlayers = extensionResults.updatedPlayers;

    // Step 3: Sign free agents (cap-aware, target 13)
    const rosterAfterExtensions = getTeamRoster(currentPlayers, team.abbreviation);
    const capAfterExtensions = getCapSituation(rosterAfterExtensions);

    if (rosterAfterExtensions.length < TARGET_ROSTER_SIZE) {
      const signingResults = processTeamSignings({
        direction,
        leaguePlayers: currentPlayers,
        teamAbbreviation: team.abbreviation,
        teamId: team.id,
        currentRosterCount: rosterAfterExtensions.length,
        capSituation: capAfterExtensions,
      });
      results.signings.push(...signingResults.signings);
      currentPlayers = signingResults.updatedPlayers;
    }

    // Step 4: Backfill if roster below 14 players (retirement + cuts + releases)
    const rosterAfterSignings = getTeamRoster(currentPlayers, team.abbreviation);
    if (rosterAfterSignings.length < MINIMUM_SEASON_ROSTER) {
      const backfillResults = backfillRoster({
        leaguePlayers: currentPlayers,
        teamAbbreviation: team.abbreviation,
        teamId: team.id,
      });
      results.signings.push(...backfillResults.signings);
      currentPlayers = backfillResults.updatedPlayers;
    }
  }

  return {
    cuts: results.cuts,
    extensions: results.extensions,
    signings: results.signings,
    updatedPlayers: currentPlayers,
  };
}

// =============================================================================
// ENSURE MINIMUM ROSTERS (post-release safety net)
// =============================================================================

/**
 * After expired contracts are released, backfill every AI team to at least
 * MINIMUM_SEASON_ROSTER (14) players so no team enters the season short-handed.
 *
 * @param {Array} aiTeams - AI team objects
 * @param {Array} leaguePlayers - all players (already mutated by prior steps)
 * @returns {{ signings: Array, updatedPlayers: Array }}
 */
export function ensureMinimumRosters({ aiTeams, leaguePlayers }) {
  const signings = [];
  let currentPlayers = [...leaguePlayers];

  for (const team of aiTeams) {
    const teamRoster = getTeamRoster(currentPlayers, team.abbreviation);
    const slotsNeeded = MINIMUM_SEASON_ROSTER - teamRoster.length;

    if (slotsNeeded <= 0) continue;

    // Get free agents, sorted by rating descending
    let freeAgents = currentPlayers.filter(player => {
      if (player.isDraftProspect) return false;
      if (player.isFreeAgent === 1 || player.is_free_agent === 1) return true;
      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
      return !teamAbbr || teamAbbr === 'FA';
    });
    freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

    let filled = 0;
    for (const player of freeAgents) {
      if (filled >= slotsNeeded) break;

      // Accept anyone rated 50+ to ensure roster fills
      if (getPlayerRating(player) < 50) break;

      const salary = 2_000_000;
      const years = 1;

      for (let i = 0; i < currentPlayers.length; i++) {
        if ((currentPlayers[i].id ?? '') == player.id) {
          currentPlayers[i] = {
            ...currentPlayers[i],
            teamId: team.id,
            teamAbbreviation: team.abbreviation,
            team_abbreviation: team.abbreviation,
            contractYearsRemaining: years,
            contract_years_remaining: years,
            contractSalary: salary,
            contract_salary: salary,
            isFreeAgent: 0,
          };
          break;
        }
      }

      signings.push({
        team: team.abbreviation,
        player: getPlayerName(player),
        playerId: player.id,
        years,
        salary,
        totalValue: salary,
        isBackfill: true,
      });

      filled++;
    }
  }

  return { signings, updatedPlayers: currentPlayers };
}

// Backward compatibility alias
export const runAIContractDecisions = runAIRosterManagement;
