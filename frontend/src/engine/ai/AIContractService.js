// =============================================================================
// AIContractService.js
// =============================================================================
// AI team roster management: cuts, extensions, signings, backfill.
// Cap-aware with draft capital assessment and team direction integration.
// =============================================================================

import { analyzeTeamDirection, buildContext } from './AITradeService';
import { calculateRetentionScore, getMarketSize } from './MotivationService';
import { playerMarketValue } from './ResignValuationService';
import { FREE_AGENCY_DURATION_DAYS } from '../season/SeasonDeadlines';
import { SALARY_CAP, LUXURY_TAX, veteranMinSalary } from '../data/salaryScale';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// =============================================================================
// CONSTANTS
// =============================================================================

// Economy thresholds come from data/salaryScale.js (real 2025-26 NBA). Aliased
// here to the names this module already uses.
const LUXURY_TAX_LINE = LUXURY_TAX;
const MIN_ROSTER_SIZE = 10;
const TARGET_ROSTER_SIZE = 14;
const MAX_ROSTER_SIZE = 15;
const MINIMUM_SEASON_ROSTER = 14;

// Bird-rights hard ceiling. Real NBA Bird rights have no per-deal cap (just
// the league max), but teams can't recklessly stack maxes forever — we cap
// total team payroll at ~20% above the luxury-tax line so AI Bird re-signs
// don't produce $300M payrolls.
const BIRD_RIGHTS_PAYROLL_CEILING = Math.floor(LUXURY_TAX_LINE * 1.2);

// Re-exported for back-compat; delegates to the canonical vet-min helper.
export function getVeteranMinSalary(player) {
  return veteranMinSalary(player);
}

/**
 * "Bird rights" check — true when the player was on this team's roster last
 * season (set by the offseason flow at `player.previousTeamId`). Real NBA
 * Bird rights require 3 consecutive seasons; we use the simpler 1-year
 * previous-team match since the engine doesn't track multi-year tenure.
 */
function isTeamIncumbent(player, teamId) {
  const prev = player.previousTeamId ?? player.previous_team_id ?? null;
  return prev != null && String(prev) === String(teamId);
}

// =============================================================================
// SALARY LOOKUP
// =============================================================================

// Expected/market salary now comes from the shared production-aware valuation
// (engine/ai/ResignValuationService.playerMarketValue), so AI free-agency and
// re-sign offers stay consistent with what a player would ask the user team for.

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

function getCapSituation(roster, capNumbers = null) {
  const salaryCap = capNumbers?.salaryCap ?? SALARY_CAP;
  const luxuryTax = capNumbers?.luxuryTax ?? LUXURY_TAX_LINE;
  const payroll = calculateTeamPayroll(roster);
  const capSpace = salaryCap - payroll;
  return {
    payroll,
    capSpace,
    isOverCap: payroll > salaryCap,
    isInTax: payroll > luxuryTax,
    capRoom: Math.max(0, capSpace),
    // Carried so downstream gates key off the campaign's numbers, not the
    // legacy constants (pre-2026 saves resolve to the same values).
    salaryCap,
    luxuryTax,
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
  const expectedSalary = playerMarketValue(player, stats);

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
  capNumbers = null,
}) {
  const cuts = [];
  let updatedPlayers = [...leaguePlayers];
  const capSituation = getCapSituation(roster, capNumbers);

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

  const expectedSalary = playerMarketValue(player, stats);

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

  // Motivation-aware retention check
  if (player.motivations) {
    const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? '';
    const retentionContext = {
      contractSalary: salary,
      expectedSalary,
      teamMarketSize: getMarketSize(teamAbbr),
    };
    const retention = calculateRetentionScore(player, retentionContext);
    // Player very unlikely to accept — don't bother unless desperate
    if (retention < 30 && !needsPlayers) return false;
    // Unhappy player — only re-sign if offering premium (handled in calculateContractOffer)
    if (retention < 50 && isMassivelyOverpaid) return false;
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

  // Elite talent (80+ OVR) overrides strict positional need — real FA
  // markets have "best player available" energy on top names, so teams will
  // happily double up at a position to grab a star. Without this clause,
  // top FAs at over-supplied positions were going unsigned because every
  // team's hasPositionNeed() came back false.
  if (rating >= 80) {
    // Tax teams still pass on top FAs (the offer math will reject anyway).
    if (capSituation && capSituation.isInTax) return false;
    // Rebuilding teams only chase elite talent if they're still young.
    if (direction === 'rebuilding') return age <= 28;
    // Everyone else is in.
    return true;
  }

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

export function calculateContractOffer(player, direction, capSituation = null, stats = null) {
  const age = getPlayerAge(player);

  // Base salary = the player's open-market value (smooth rating curve + this
  // season's production + age, floored at the vet min). Age is already baked in,
  // so don't re-apply it here.
  let baseSalary = playerMarketValue(player, stats);

  // Motivation-aware salary adjustment
  if (player.motivations?.money) {
    const moneyWeight = player.motivations.money.weight;
    if (moneyWeight > 0.8) {
      baseSalary *= 1.10; // Pay premium to retain money-motivated players
    } else if (moneyWeight < 0.3) {
      baseSalary *= 0.90; // Player doesn't care as much about money
    }
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
      const contract = calculateContractOffer(player, direction, capSituation, playerStats);

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

  // Get free agents (retirees excluded)
  let freeAgents = updatedPlayers.filter(player => {
    if (player.isRetired || player.is_retired) return false;
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
    const incumbent = isTeamIncumbent(player, teamId);
    const shouldSign = incumbent || evaluateFreeAgentSigning(player, direction, teamRoster, capSituation);

    if (shouldSign) {
      const contract = calculateContractOffer(player, direction, capSituation, getPlayerStatsFn(player.id));

      // Cap check: skip if signing would push team over luxury tax (unless
      // contending OR re-signing an incumbent via Bird rights OR open slot
      // can be filled at vet min).
      if (capSituation) {
        const projectedPayroll = calculateTeamPayroll(teamRoster) + contract.salary;
        const isContending = direction === 'contending' || direction === 'title_contender' || direction === 'win_now';
        const taxLine = capSituation.luxuryTax ?? LUXURY_TAX_LINE;
        if (projectedPayroll > taxLine && !isContending) {
          if (incumbent) {
            // Bird rights — let it ride up to the payroll ceiling.
            if (projectedPayroll > Math.floor(taxLine * 1.2)) continue;
          } else if (teamRoster.length < TARGET_ROSTER_SIZE) {
            // Vet-min over-cap signing to fill a needed slot.
            contract.salary = getVeteranMinSalary(player);
            contract.years = 1;
          } else {
            continue;
          }
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

  // Get free agents, sorted by rating (retirees excluded)
  let freeAgents = updatedPlayers.filter(player => {
    if (player.isDraftProspect) return false;
    if (player.isRetired || player.is_retired) return false;
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
  skipExtensions = false,
  skipSignings = false,
  skipBackfill = false,
  capNumbers = null,
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
    const capSituation = getCapSituation(teamRoster, capNumbers);

    // Step 1: Evaluate & cut overpaid/underperforming players
    const cutResults = processTeamCuts({
      roster: teamRoster,
      direction,
      leaguePlayers: currentPlayers,
      teamAbbreviation: team.abbreviation,
      getPlayerStatsFn,
      draftCapital,
      capNumbers,
    });
    results.cuts.push(...cutResults.cuts);
    currentPlayers = cutResults.updatedPlayers;

    // Refresh roster and cap after cuts
    const rosterAfterCuts = getTeamRoster(currentPlayers, team.abbreviation);
    const capAfterCuts = getCapSituation(rosterAfterCuts, capNumbers);

    // Step 2: Re-sign expiring players (cap-aware) — skipped when the offseason
    // FA window will handle these signings instead.
    if (!skipExtensions) {
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
    }

    // Step 3: Sign free agents (cap-aware, target 13) — skipped during offseason
    // entry so the FA window has a real pool to bid on.
    const rosterAfterExtensions = getTeamRoster(currentPlayers, team.abbreviation);
    const capAfterExtensions = getCapSituation(rosterAfterExtensions, capNumbers);

    if (!skipSignings && rosterAfterExtensions.length < TARGET_ROSTER_SIZE) {
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
    if (!skipBackfill && rosterAfterSignings.length < MINIMUM_SEASON_ROSTER) {
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
export function ensureMinimumRosters({ aiTeams, leaguePlayers, minRating = 50 }) {
  const signings = [];
  let currentPlayers = [...leaguePlayers];

  for (const team of aiTeams) {
    const teamRoster = getTeamRoster(currentPlayers, team.abbreviation);
    const slotsNeeded = MINIMUM_SEASON_ROSTER - teamRoster.length;

    if (slotsNeeded <= 0) continue;

    // Get free agents, sorted by rating descending (retirees excluded)
    let freeAgents = currentPlayers.filter(player => {
      if (player.isDraftProspect) return false;
      if (player.isRetired || player.is_retired) return false;
      if (player.isFreeAgent === 1 || player.is_free_agent === 1) return true;
      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
      return !teamAbbr || teamAbbr === 'FA';
    });
    freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

    let filled = 0;
    for (const player of freeAgents) {
      if (filled >= slotsNeeded) break;

      // Quality floor — AI uses 50 by default. Callers can pass minRating: 0
      // for emergency fills (e.g. UserTeamFinalizer's "let AI finish setup")
      // where filling the roster trumps player quality.
      if (getPlayerRating(player) < minRating) break;

      const salary = 2_000_000;
      const years = 1;

      for (let i = 0; i < currentPlayers.length; i++) {
        if ((currentPlayers[i].id ?? '') == player.id) {
          currentPlayers[i] = {
            ...currentPlayers[i],
            teamId: team.id,
            team_id: team.id,
            teamAbbreviation: team.abbreviation,
            team_abbreviation: team.abbreviation,
            contractYearsRemaining: years,
            contract_years_remaining: years,
            contractSalary: salary,
            contract_salary: salary,
            isFreeAgent: 0,
            is_free_agent: 0,
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

// =============================================================================
// FREE AGENCY: AI OFFER GENERATION
// =============================================================================
//
// Daily pass that lets every AI team add pending offers to the FA pool. The
// pool lives at `campaign.settings.freeAgencyOffers` keyed by playerId; each
// entry is an array of Offer objects: { teamId, teamAbbr, salary, years,
// dayOffered, isUserOffer }. We mutate the offers map in-place and return a
// summary of new offers placed today.

const MAX_OFFERS_PER_TEAM_PER_WINDOW = 6;
const MAX_OFFERS_PER_TEAM_PER_DAY = 1;

// Per-FREE-AGENT spread caps. These are what keep the market even: without
// them every team piles its day-1 offer onto the same handful of stars while
// mid-tier FAs go untouched all week.
//  • WINDOW cap: a single FA draws at most this many distinct suitors over the
//    whole window. Once a star is "full," teams cascade down to the next-best
//    available FA — spreading offers into the mid tier.
//  • NEW-per-day cap: a FA gains at most this many *new* suitors on any one
//    day, so a star's offers trickle in across the week instead of flooding in
//    on day 1. (Salary bumps to existing offers are exempt — see dedup below.)
const MAX_OFFERS_PER_PLAYER_PER_WINDOW = 4;
const MAX_NEW_OFFERS_PER_PLAYER_PER_DAY = 1;

/**
 * Linear pace gate. A team can place at most `ceil(day * MAX / DURATION)`
 * offers cumulatively by day N — so by day 1 they're capped at 1 of their 6
 * window allowance, day 7 at ~3, and the full budget only unlocks toward
 * the end of the window. Stops every AI team from blowing their entire
 * offer budget on day 1 and leaving the rest of the window dead air.
 */
function maxOffersByDay(day) {
  const ratio = day / FREE_AGENCY_DURATION_DAYS;
  return Math.max(1, Math.min(
    MAX_OFFERS_PER_TEAM_PER_WINDOW,
    Math.ceil(ratio * MAX_OFFERS_PER_TEAM_PER_WINDOW)
  ));
}

function hashSeed(...parts) {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0) / 4294967296;
}

function teamPendingOffersTotal(offersMap, teamId) {
  let count = 0;
  for (const offers of Object.values(offersMap || {})) {
    for (const offer of offers) {
      if (offer.teamId === teamId && !offer.isUserOffer) count++;
    }
  }
  return count;
}

function teamPendingSalaryCommitment(offersMap, teamId) {
  let total = 0;
  for (const offers of Object.values(offersMap || {})) {
    for (const offer of offers) {
      if (offer.teamId === teamId && !offer.isUserOffer) total += offer.salary || 0;
    }
  }
  return total;
}

function existingTeamOfferForPlayer(offersMap, playerId, teamId) {
  return (offersMap[playerId] || []).find(o => o.teamId === teamId && !o.isUserOffer) || null;
}

/**
 * Generate one day of AI free-agency offers, mutating `offersMap` in place.
 *
 * @param {object} args
 * @param {Array} args.aiTeams - non-user team objects
 * @param {Array} args.leaguePlayers - all players (FAs already released)
 * @param {Array} args.standings
 * @param {Array} args.allTeams
 * @param {object} args.offersMap - campaign.settings.freeAgencyOffers (mutated)
 * @param {number} args.day - current FA day (1-indexed)
 * @param {string} args.campaignId - for deterministic seeding
 * @param {number} args.gameYear
 * @returns {Array} summary of offers placed today
 */
export function generateAIFreeAgencyOffers({
  aiTeams,
  leaguePlayers,
  standings,
  allTeams,
  offersMap,
  day,
  campaignId,
  gameYear = 1,
  getPlayerStatsFn = () => null,
  capNumbers = null,
}) {
  const placed = [];
  if (!offersMap) return placed;

  const context = buildContext({ standings, teams: allTeams, seasonPhase: 'offseason' });

  // Get free agents (non-prospects, non-retirees)
  const freeAgents = leaguePlayers.filter(p => {
    if (p.isDraftProspect) return false;
    if (p.isRetired || p.is_retired) return false;
    if (p.isFreeAgent === 1 || p.is_free_agent === 1) return true;
    const teamAbbr = p.teamAbbreviation ?? p.team_abbreviation ?? null;
    return !teamAbbr || teamAbbr === 'FA';
  });

  // Sort by rating descending so top FAs see action first each day
  freeAgents.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  for (const team of aiTeams) {
    const teamRoster = getTeamRoster(leaguePlayers, team.abbreviation);
    if (teamRoster.length >= MAX_ROSTER_SIZE) continue;

    const direction = analyzeTeamDirection(team, teamRoster, context);
    const draftCapital = assessDraftCapital(team, gameYear);
    const baseCap = getCapSituation(teamRoster, capNumbers);

    const pendingForTeam = teamPendingOffersTotal(offersMap, team.id);
    if (pendingForTeam >= MAX_OFFERS_PER_TEAM_PER_WINDOW) continue;

    // Cumulative pace gate: by day N, this team can only have a fraction of
    // its 6-offer budget on the board. Without this, ~all AI bids land in
    // the first 2-3 days because top-FA interest thresholds are so low early.
    const dayCap = maxOffersByDay(day);
    if (pendingForTeam >= dayCap) continue;
    const remainingTodayCap = dayCap - pendingForTeam;

    let offersToday = 0;
    let pendingCommitment = teamPendingSalaryCommitment(offersMap, team.id);

    for (const player of freeAgents) {
      if (offersToday >= MAX_OFFERS_PER_TEAM_PER_DAY) break;
      if (offersToday >= remainingTodayCap) break;
      if (pendingForTeam + offersToday >= MAX_OFFERS_PER_TEAM_PER_WINDOW) break;

      const incumbent = isTeamIncumbent(player, team.id);
      const playerOffers = (offersMap[player.id] || []).filter(o => !o.isUserOffer);
      const teamAlreadyOffered = playerOffers.some(o => o.teamId === team.id);

      // Spread caps for fresh suitors. A team re-signing its own Bird-rights guy
      // bypasses these, and an existing suitor (handled by the dedup branch
      // below) isn't a "new" offer. The `continue` lets the team cascade to the
      // next FA, which is what pushes offers down into the mid tier.
      if (!incumbent && !teamAlreadyOffered) {
        if (playerOffers.length >= MAX_OFFERS_PER_PLAYER_PER_WINDOW) continue;
        const newOffersToday = playerOffers.filter(o => o.dayOffered === day).length;
        if (newOffersToday >= MAX_NEW_OFFERS_PER_PLAYER_PER_DAY) continue;
      }

      // Deterministic per-team-per-day-per-player chance the team is "interested today"
      const interestRoll = hashSeed(campaignId, team.id, player.id, day);
      // Pacing curve: top FAs still draw the earliest interest (otherwise bench
      // guys would get all the early bids), but the per-player caps above keep
      // them from being flooded — so these thresholds are flattened across tiers
      // (finer bands) to give mid- and lower-tier FAs a real early market too.
      const rating = getPlayerRating(player);
      const earlyWindow = day <= 4;
      const midWindow = day >= 5 && day <= 8;
      let interestThreshold;
      if (rating >= 80) {
        interestThreshold = earlyWindow ? 0.50 : midWindow ? 0.42 : 0.38;
      } else if (rating >= 73) {
        interestThreshold = earlyWindow ? 0.58 : midWindow ? 0.48 : 0.42;
      } else if (rating >= 66) {
        interestThreshold = earlyWindow ? 0.66 : midWindow ? 0.55 : 0.48;
      } else {
        interestThreshold = earlyWindow ? 0.74 : midWindow ? 0.62 : 0.52;
      }
      if (interestRoll < interestThreshold) continue;

      // Roster fit (positional need, direction, etc.). Bird-rights incumbents
      // bypass the normal evaluation gate — teams ALWAYS want to keep their
      // own guys around if possible.
      const adjustedCap = { ...baseCap, capSpace: baseCap.capSpace - pendingCommitment };
      const wantsPlayer = incumbent || evaluateFreeAgentSigning(player, direction, teamRoster, adjustedCap);
      if (!wantsPlayer) continue;

      const offer = calculateContractOffer(player, direction, adjustedCap, getPlayerStatsFn(player.id));

      // Cap-aware budgeting:
      //  • Contenders can dip into tax (with a $20M per-deal sanity cap).
      //  • Bird-rights incumbents → keep the full-market offer regardless of
      //    cap (capped by BIRD_RIGHTS_PAYROLL_CEILING so payrolls don't
      //    spiral past ~120% of the tax line).
      //  • Over-cap teams with open roster slots → vet-min flier instead of
      //    skipping. This is the real-NBA "minimum exception": teams over
      //    the cap can still sign players to vet-min deals to fill holes.
      //  • Elite-talent flier (existing): fitted offer in remaining cap room.
      const isContending = direction === 'contending' || direction === 'title_contender' || direction === 'win_now';
      const projectedCommitment = pendingCommitment + offer.salary;
      const overCap = projectedCommitment > Math.max(0, adjustedCap.capRoom);
      const needsBodies = teamRoster.length < TARGET_ROSTER_SIZE;
      if (!isContending && overCap) {
        if (incumbent) {
          // Bird rights: bypass cap. Just enforce the payroll ceiling so
          // even Bird-blessed teams can't bloat past ~$200M.
          const currentPayroll = calculateTeamPayroll(teamRoster) + pendingCommitment;
          const birdCeiling = Math.floor((baseCap.luxuryTax ?? LUXURY_TAX_LINE) * 1.2);
          if (currentPayroll + offer.salary > birdCeiling) continue;
        } else {
          const expected = playerMarketValue(player);
          const remainingRoom = Math.max(0, Math.max(0, adjustedCap.capRoom) - pendingCommitment);
          if (rating >= 80 && remainingRoom >= expected * 0.25) {
            // Elite-talent flier — fit into remaining room.
            offer.salary = Math.floor(remainingRoom * 0.9);
            offer.years = Math.min(offer.years, 2);
          } else if (needsBodies) {
            // Vet-min over-cap signing — only when the team actually needs
            // bodies. Caps the deal at 1 year so it doesn't lock cap space
            // beyond the immediate need.
            offer.salary = getVeteranMinSalary(player);
            offer.years = 1;
          } else {
            continue;
          }
        }
      }
      if (isContending) {
        // Contenders can dip into tax but cap each pending offer at $20M
        // unless re-signing their own incumbent (Bird rights override).
        if (!incumbent && offer.salary > 20_000_000 && pendingCommitment > 0) continue;
      }

      // Dedup: if team already has an offer to this player, only re-offer mid-window with a salary bump
      const existing = existingTeamOfferForPlayer(offersMap, player.id, team.id);
      if (existing) {
        const competing = (offersMap[player.id] || []).filter(o => o.teamId !== team.id);
        if (day < 7 || competing.length === 0) continue;
        const bumped = Math.floor(existing.salary * 1.10);
        if (bumped <= existing.salary) continue;
        existing.salary = bumped;
        existing.dayOffered = day;
        placed.push({ teamId: team.id, teamAbbr: team.abbreviation, playerId: player.id, salary: bumped, years: existing.years, kind: 'bumped' });
        offersToday++;
        continue;
      }

      const draftRichBonus = draftCapital.draftRichness > 0.6 && direction === 'rebuilding' ? 0.95 : 1.0;
      const finalSalary = Math.floor(offer.salary * draftRichBonus);

      const newOffer = {
        teamId: team.id,
        teamAbbr: team.abbreviation,
        salary: finalSalary,
        years: offer.years,
        dayOffered: day,
        isUserOffer: false,
      };

      if (!offersMap[player.id]) offersMap[player.id] = [];
      offersMap[player.id].push(newOffer);
      pendingCommitment += finalSalary;
      offersToday++;

      placed.push({
        teamId: team.id,
        teamAbbr: team.abbreviation,
        playerId: player.id,
        salary: finalSalary,
        years: offer.years,
        kind: 'new',
      });
    }
  }

  return placed;
}

