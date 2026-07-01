// =============================================================================
// campaignRecords.js
// =============================================================================
// Pure builders for the League page "All Time" tab — history of champions and
// MVPs across a campaign, derived from each archived season's seasonData
// (`SeasonRepository.getAllForCampaign`). Past seasons are retained in
// IndexedDB, so these work retroactively for existing campaigns.
//
// Pure and import-free — node-testable.
// =============================================================================

function _year(season) {
  const y = Number(season?.year);
  return Number.isFinite(y) ? y : null;
}

/**
 * Per-season champions, newest first. Skips seasons with no recorded champion
 * (regular-season-in-progress, or AI seasons that never finished a bracket).
 *
 * @param {Array} seasons - SeasonRepository.getAllForCampaign result
 * @returns {Array<{ year, abbreviation, name, primaryColor, finalsMvpName, finalsMvpTeam }>}
 */
export function buildChampionsHistory(seasons = []) {
  const rows = [];
  for (const season of seasons || []) {
    const champ = season?.playoffBracket?.champion;
    if (!champ || !(champ.abbreviation || champ.name)) continue;
    // Finals MVP lives in two shapes: the normalized seasonAwards.finalsMVP
    // ({ playerName, teamAbbreviation }) and the raw bracket.finalsMVP — the
    // series MVP — which uses { name, teamId }. Read both.
    const fmvp = season?.seasonAwards?.finalsMVP ?? season?.playoffBracket?.finalsMVP ?? null;
    rows.push({
      year: _year(season),
      abbreviation: champ.abbreviation ?? null,
      name: champ.name ?? champ.abbreviation ?? 'Champion',
      primaryColor: champ.primaryColor ?? champ.primary_color ?? null,
      finalsMvpName: fmvp?.playerName ?? fmvp?.name ?? null,
      finalsMvpTeam: fmvp?.teamAbbreviation ?? fmvp?.teamAbbr ?? null,
    });
  }
  return rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/**
 * Per-season MVPs, newest first. Skips seasons with no recorded MVP.
 *
 * @param {Array} seasons
 * @returns {Array<{ year, playerName, teamAbbr, teamColor, stats }>}
 */
export function buildMvpHistory(seasons = []) {
  const rows = [];
  for (const season of seasons || []) {
    const mvp = season?.seasonAwards?.mvp;
    if (!mvp || !mvp.playerName) continue;
    rows.push({
      year: _year(season),
      playerName: mvp.playerName,
      teamAbbr: mvp.teamAbbr ?? mvp.teamAbbreviation ?? null,
      teamColor: mvp.teamColor ?? null,
      stats: mvp.stats ?? null,
    });
  }
  return rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/**
 * Per-season Rookies of the Year, newest first. Skips seasons with no recorded
 * winner. Same row shape as buildMvpHistory.
 *
 * @param {Array} seasons
 * @returns {Array<{ year, playerName, teamAbbr, teamColor, stats }>}
 */
export function buildRotyHistory(seasons = []) {
  const rows = [];
  for (const season of seasons || []) {
    const roty = season?.seasonAwards?.rookieOfTheYear;
    if (!roty || !roty.playerName) continue;
    rows.push({
      year: _year(season),
      playerName: roty.playerName,
      teamAbbr: roty.teamAbbr ?? roty.teamAbbreviation ?? null,
      teamColor: roty.teamColor ?? null,
      stats: roty.stats ?? null,
    });
  }
  return rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/**
 * Per-season Defensive Players of the Year, newest first. Skips seasons with no
 * recorded winner (incl. seasons archived before DPOY existed). Same row shape
 * as buildMvpHistory.
 *
 * @param {Array} seasons
 * @returns {Array<{ year, playerName, teamAbbr, teamColor, stats }>}
 */
export function buildDpoyHistory(seasons = []) {
  const rows = [];
  for (const season of seasons || []) {
    const dpoy = season?.seasonAwards?.dpoy;
    if (!dpoy || !dpoy.playerName) continue;
    rows.push({
      year: _year(season),
      playerName: dpoy.playerName,
      teamAbbr: dpoy.teamAbbr ?? dpoy.teamAbbreviation ?? null,
      teamColor: dpoy.teamColor ?? null,
      stats: dpoy.stats ?? null,
    });
  }
  return rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}
