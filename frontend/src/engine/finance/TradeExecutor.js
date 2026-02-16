// =============================================================================
// TradeExecutor.js
// =============================================================================
// Trade validation and execution logic.
// Translated from PHP: backend/app/Services/TradeService.php
// =============================================================================

// =============================================================================
// HELPERS
// =============================================================================

function getPlayerName(player) {
  const first = player.firstName ?? player.first_name ?? '';
  const last = player.lastName ?? player.last_name ?? '';
  return `${first} ${last}`.trim();
}

// =============================================================================
// SALARY CAP VALIDATION
// =============================================================================

/**
 * Validate trade meets salary cap rules.
 * @param {object} params
 * @param {Array} params.userGiving - Assets user is giving [{ type, playerId, ... }]
 * @param {Array} params.userReceiving - Assets user is receiving
 * @param {string} params.capMode - 'easy', 'normal', or 'hard'
 * @param {function} params.getPlayerFn - (playerId) => player object or null
 * @param {number} [params.currentPayroll] - User team's current payroll
 * @param {number} [params.salaryCap] - Team salary cap
 * @returns {{ valid: boolean, reason?: string, incoming_salary?: number, outgoing_salary?: number, max_incoming?: number }}
 */
export function validateSalaryCap({
  userGiving,
  userReceiving,
  capMode = 'normal',
  getPlayerFn,
  currentPayroll = 0,
  salaryCap = 136_000_000,
}) {
  if (capMode === 'easy') {
    return { valid: true };
  }

  const outgoingSalary = calculateTotalSalary(userGiving, getPlayerFn);
  const incomingSalary = calculateTotalSalary(userReceiving, getPlayerFn);

  if (capMode === 'normal') {
    // 125% + $100K rule
    if (outgoingSalary > 0) {
      const maxIncoming = (outgoingSalary * 1.25) + 100_000;
      if (incomingSalary > maxIncoming) {
        return {
          valid: false,
          reason: `Incoming salary ($${incomingSalary.toLocaleString()}) exceeds 125% of outgoing ($${maxIncoming.toLocaleString()})`,
          incoming_salary: incomingSalary,
          outgoing_salary: outgoingSalary,
          max_incoming: maxIncoming,
        };
      }
    }
  }

  if (capMode === 'hard') {
    const netChange = incomingSalary - outgoingSalary;
    if (currentPayroll + netChange > salaryCap) {
      return {
        valid: false,
        reason: `Trade would put team over salary cap ($${salaryCap.toLocaleString()})`,
        current_payroll: currentPayroll,
        net_change: netChange,
        salary_cap: salaryCap,
      };
    }
  }

  return {
    valid: true,
    incoming_salary: incomingSalary,
    outgoing_salary: outgoingSalary,
  };
}

/**
 * Calculate total salary of player assets.
 * @param {Array} assets
 * @param {function} getPlayerFn
 * @returns {number}
 */
function calculateTotalSalary(assets, getPlayerFn) {
  let total = 0;

  for (const asset of assets) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      if (player) {
        total += parseFloat(player.contractSalary ?? player.contract_salary ?? 0);
      }
    }
  }

  return total;
}

// =============================================================================
// BUILD TRADE DETAILS
// =============================================================================

/**
 * Build trade details array from proposal.
 * @param {object} params
 * @param {object} params.userTeam - { id, name, city }
 * @param {object} params.aiTeam - { id, name, city }
 * @param {Array} params.userGives - Assets user gives
 * @param {Array} params.userReceives - Assets user receives
 * @param {function} params.getPlayerFn - (playerId) => player object
 * @param {function} [params.getPickDisplayFn] - (pickId) => display string
 * @returns {object}
 */
export function buildTradeDetails({
  userTeam,
  aiTeam,
  userGives,
  userReceives,
  getPlayerFn,
  getPickDisplayFn = (pickId) => `Pick #${pickId}`,
}) {
  const assets = [];

  // User giving assets (going to AI team)
  for (const asset of userGives) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      assets.push({
        type: 'player',
        playerId: asset.playerId,
        playerName: player ? getPlayerName(player) : 'Unknown',
        from: userTeam.id,
        to: aiTeam.id,
        salary: player ? parseFloat(player.contractSalary ?? player.contract_salary ?? 0) : 0,
      });
    } else if (asset.type === 'pick') {
      assets.push({
        type: 'pick',
        pickId: asset.pickId,
        pickDisplay: getPickDisplayFn(asset.pickId),
        from: userTeam.id,
        to: aiTeam.id,
      });
    }
  }

  // User receiving assets (coming from AI team)
  for (const asset of userReceives) {
    if (asset.type === 'player') {
      const player = getPlayerFn(asset.playerId);
      assets.push({
        type: 'player',
        playerId: asset.playerId,
        playerName: player ? getPlayerName(player) : 'Unknown',
        from: aiTeam.id,
        to: userTeam.id,
        salary: player ? parseFloat(player.contractSalary ?? player.contract_salary ?? 0) : 0,
      });
    } else if (asset.type === 'pick') {
      assets.push({
        type: 'pick',
        pickId: asset.pickId,
        pickDisplay: getPickDisplayFn(asset.pickId),
        from: aiTeam.id,
        to: userTeam.id,
      });
    }
  }

  return {
    teams: [userTeam.id, aiTeam.id],
    team_names: {
      [userTeam.id]: userTeam.name,
      [aiTeam.id]: aiTeam.name,
    },
    assets,
  };
}

// =============================================================================
// EXECUTE TRADE
// =============================================================================

/**
 * Execute an accepted trade.
 * Moves players between teams and transfers pick ownership.
 * Returns the mutated data structures.
 *
 * @param {object} params
 * @param {object} params.tradeDetails - From buildTradeDetails()
 * @param {Array} params.leaguePlayers - All league players (will be mutated)
 * @param {Array} params.userRoster - User's roster (will return updated copy)
 * @param {Array} params.draftPicks - All draft picks (will be mutated)
 * @param {object} params.userTeam - { id, abbreviation }
 * @param {string} params.currentDate - ISO date string
 * @param {number} params.currentSeasonId
 * @returns {{ trade: object, updatedLeaguePlayers: Array, updatedUserRoster: Array, updatedDraftPicks: Array }}
 */
export function executeTrade({
  tradeDetails,
  leaguePlayers,
  userRoster,
  draftPicks = [],
  userTeam,
  currentDate,
  currentSeasonId = null,
}) {
  const trade = {
    trade_date: currentDate,
    season_id: currentSeasonId,
    details: tradeDetails,
  };

  let updatedLeaguePlayers = [...leaguePlayers];
  let updatedUserRoster = [...userRoster];
  let updatedDraftPicks = [...draftPicks];

  for (const asset of tradeDetails.assets) {
    if (asset.type === 'player') {
      const result = movePlayer({
        playerId: asset.playerId,
        fromTeamId: asset.from,
        toTeamId: asset.to,
        leaguePlayers: updatedLeaguePlayers,
        userRoster: updatedUserRoster,
        userTeamId: userTeam.id,
      });
      updatedLeaguePlayers = result.leaguePlayers;
      updatedUserRoster = result.userRoster;
    } else if (asset.type === 'pick') {
      updatedDraftPicks = transferPick({
        pickId: asset.pickId,
        newOwnerId: asset.to,
        draftPicks: updatedDraftPicks,
      });
    }
  }

  return {
    trade,
    updatedLeaguePlayers,
    updatedUserRoster,
    updatedDraftPicks,
  };
}

/**
 * Move a player between teams.
 * Handles user-team-to-AI, AI-to-user, and AI-to-AI scenarios.
 * @param {object} params
 * @param {string} params.playerId
 * @param {*} params.fromTeamId
 * @param {*} params.toTeamId
 * @param {Array} params.leaguePlayers
 * @param {Array} params.userRoster
 * @param {*} params.userTeamId
 * @returns {{ leaguePlayers: Array, userRoster: Array }}
 */
function movePlayer({ playerId, fromTeamId, toTeamId, leaguePlayers, userRoster, userTeamId }) {
  let updatedLeaguePlayers = [...leaguePlayers];
  let updatedUserRoster = [...userRoster];

  if (userTeamId == toTeamId) {
    // Moving TO user's team (JSON -> DB/roster)
    // Find the player in league players
    let playerIndex = -1;
    let playerData = null;
    for (let i = 0; i < updatedLeaguePlayers.length; i++) {
      if ((updatedLeaguePlayers[i].id ?? '') == playerId) {
        playerData = updatedLeaguePlayers[i];
        playerIndex = i;
        break;
      }
    }

    if (playerData && playerIndex >= 0) {
      // Add to user roster
      updatedUserRoster.push({ ...playerData });
      // Remove from league players
      updatedLeaguePlayers.splice(playerIndex, 1);
    }

  } else if (userTeamId == fromTeamId) {
    // Moving FROM user's team (DB/roster -> JSON)
    let playerIndex = -1;
    let playerData = null;
    for (let i = 0; i < updatedUserRoster.length; i++) {
      if ((updatedUserRoster[i].id ?? '') == playerId) {
        playerData = updatedUserRoster[i];
        playerIndex = i;
        break;
      }
    }

    if (playerData && playerIndex >= 0) {
      // Find the destination team abbreviation from trade details context
      // We get the toTeamId but need the abbreviation for JSON storage
      // The caller should set teamAbbreviation on the player or we look it up
      const updatedPlayer = { ...playerData };
      // Remove from user roster
      updatedUserRoster.splice(playerIndex, 1);
      // Add to league players
      updatedLeaguePlayers.push(updatedPlayer);
    }

  } else {
    // AI to AI trade - update teamAbbreviation in JSON
    // The caller should handle setting the new abbreviation
    // We just keep the data as-is since both are in leaguePlayers
  }

  return { leaguePlayers: updatedLeaguePlayers, userRoster: updatedUserRoster };
}

/**
 * Transfer draft pick ownership.
 * @param {object} params
 * @param {number|string} params.pickId
 * @param {*} params.newOwnerId
 * @param {Array} params.draftPicks
 * @returns {Array} Updated draft picks
 */
function transferPick({ pickId, newOwnerId, draftPicks }) {
  return draftPicks.map(pick => {
    if ((pick.id ?? '') == pickId) {
      return {
        ...pick,
        current_owner_id: newOwnerId,
        is_traded: true,
      };
    }
    return pick;
  });
}

// =============================================================================
// RECALCULATE PAYROLLS
// =============================================================================

/**
 * Recalculate team payrolls after a trade.
 * @param {object} params
 * @param {Array} params.teamIds - IDs of teams involved
 * @param {Array} params.userRoster - User's current roster
 * @param {Array} params.leaguePlayers - All league players
 * @param {*} params.userTeamId
 * @param {Array} params.teams - All team objects
 * @returns {object} Map of teamId => total payroll
 */
export function recalculatePayrolls({ teamIds, userRoster, leaguePlayers, userTeamId, teams }) {
  const payrolls = {};

  for (const teamId of teamIds) {
    if (teamId == userTeamId) {
      payrolls[teamId] = userRoster.reduce(
        (sum, p) => sum + parseFloat(p.contractSalary ?? p.contract_salary ?? 0), 0
      );
    } else {
      const team = teams.find(t => t.id === teamId);
      if (team) {
        const roster = leaguePlayers.filter(p =>
          (p.teamAbbreviation ?? p.team_abbreviation ?? '') === team.abbreviation
        );
        payrolls[teamId] = roster.reduce(
          (sum, p) => sum + parseFloat(p.contractSalary ?? p.contract_salary ?? 0), 0
        );
      }
    }
  }

  return payrolls;
}

// =============================================================================
// TRADE HISTORY
// =============================================================================

/**
 * Format a trade record for display.
 * @param {object} trade - Raw trade record
 * @returns {object}
 */
export function formatTradeForDisplay(trade) {
  return {
    id: trade.id,
    trade_date: trade.trade_date,
    teams: trade.details?.teams ?? [],
    team_names: trade.details?.team_names ?? {},
    assets: trade.details?.assets ?? [],
  };
}
