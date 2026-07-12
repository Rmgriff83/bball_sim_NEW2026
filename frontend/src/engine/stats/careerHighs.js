// =============================================================================
// careerHighs.js
// =============================================================================
// Single-game "highs" tracking: a player's best single-game points, rebounds,
// assists, steals, and blocks — at three scopes:
//   • careerHighs  — best ever this campaign (live, never reset)
//   • seasonHighs  — best this season (live, reset each season, archived)
//   • all-time     — campaign record by ANYONE (recomputed from careerHighs)
//
// A high entry is { value, opp, year } (the all-time record also carries the
// holder's { playerId, playerName }). Pure and import-free so it's directly
// node-testable and safe to import into the simulation worker.
// =============================================================================

// Canonical stat keys we track highs for.
export const HIGH_STATS = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

// Map a per-game performance entry (trackPerformance shape: pts/reb/ast/stl/blk)
// to the canonical stat keys.
function _gameValue(gameLine, stat) {
  if (!gameLine) return 0;
  switch (stat) {
    case 'points': return _int(gameLine.pts ?? gameLine.points);
    case 'rebounds': return _int(gameLine.reb ?? gameLine.rebounds);
    case 'assists': return _int(gameLine.ast ?? gameLine.assists);
    case 'steals': return _int(gameLine.stl ?? gameLine.steals);
    case 'blocks': return _int(gameLine.blk ?? gameLine.blocks);
    default: return 0;
  }
}

function _int(v) {
  const n = parseInt(v ?? 0, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Derive the SEASON year from a game date (YYYY-MM-DD). NBA seasons start in
 * October and run into June, labeled by the starting year — so Jan–Sep games
 * belong to the prior start-year (e.g. a game on 2026-04-10 is the 2025 season).
 */
export function seasonYearFromDate(date) {
  if (!date) return null;
  const s = String(date);
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(y)) return null;
  if (!Number.isFinite(m)) return y;
  return m >= 10 ? y : y - 1;
}

/**
 * Fold a single game's line into a highs object. Returns a NEW object; for each
 * tracked stat, if this game beats the stored value, it replaces the entry with
 * `{ value, opp, year }`. A value of 0 never sets a high (no record for a goose-egg).
 *
 * @param {object|null} highs   - existing highs ({ points: {value,opp,year}, ... })
 * @param {object} gameLine     - per-game stat line (pts/reb/ast/stl/blk)
 * @param {{ opp?: string, year?: number|string }} ctx
 * @returns {object} updated highs
 */
export function updateHighs(highs, gameLine, ctx = {}) {
  const next = { ...(highs || {}) };
  const opp = ctx.opp ?? null;
  const year = ctx.year ?? null;
  for (const stat of HIGH_STATS) {
    const value = _gameValue(gameLine, stat);
    if (value <= 0) continue;
    const prev = next[stat];
    if (!prev || value > (prev.value ?? 0)) {
      next[stat] = { value, opp, year };
    }
  }
  return next;
}

/**
 * League-wide single-game record board: the best single game by ANY player in
 * each stat, derived from every player's highs under `key` ('careerHighs' for
 * all-time campaign records, 'seasonHighs' for this-season records). Returns
 * { points: { value, opp, year, playerId, playerName, teamAbbr }, ... } for each
 * stat anyone has a record in.
 *
 * @param {Array} players
 * @param {'careerHighs'|'seasonHighs'} [key]
 * @returns {object}
 */
export function recomputeHighsLeaders(players = [], key = 'careerHighs') {
  const out = {};
  for (const player of players || []) {
    const highs = player?.[key];
    if (!highs) continue;
    const playerId = player.id ?? player.player_id ?? null;
    const playerName = player.name
      || `${player.firstName ?? player.first_name ?? ''} ${player.lastName ?? player.last_name ?? ''}`.trim()
      || null;
    const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null;
    for (const stat of HIGH_STATS) {
      const entry = highs[stat];
      if (!entry || !(entry.value > 0)) continue;
      if (!out[stat] || entry.value > out[stat].value) {
        out[stat] = {
          value: entry.value,
          opp: entry.opp ?? null,
          year: entry.year ?? null,
          playerId,
          playerName,
          teamAbbr,
        };
      }
    }
  }
  return out;
}

/**
 * Campaign all-time highs (best single game ever by anyone). Thin wrapper over
 * recomputeHighsLeaders for existing callers (enterOffseason persistence).
 *
 * @param {Array} players
 * @returns {object}
 */
export function recomputeAllTimeHighs(players = []) {
  return recomputeHighsLeaders(players, 'careerHighs');
}

/**
 * Merge any number of record boards (recomputeHighsLeaders output shape) into
 * one: per stat, the entry with the higher value wins, metadata and all.
 *
 * This is what makes the all-time board durable across retiree pruning —
 * pruned players' records live on in the stored board and are unioned with
 * the live recompute, so a record can only ever be beaten, never lost.
 *
 * @param {...(object|null|undefined)} boards
 * @returns {object}
 */
export function mergeHighsBoards(...boards) {
  const out = {};
  for (const board of boards) {
    if (!board || typeof board !== 'object') continue;
    for (const stat of HIGH_STATS) {
      const entry = board[stat];
      if (!entry || !(entry.value > 0)) continue;
      if (!out[stat] || entry.value > out[stat].value) {
        out[stat] = { ...entry };
      }
    }
  }
  return out;
}
