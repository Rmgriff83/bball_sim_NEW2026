import { SeasonManager } from './SeasonManager'

// ---------------------------------------------------------------------------
// AllStarService
// ---------------------------------------------------------------------------
// Handles All-Star and Rising Stars team selection based on player statistics,
// team performance, and eligibility rules. All data is passed in and returned
// as plain objects — no file I/O or database access.
// ---------------------------------------------------------------------------

// All-Star date now flows from SeasonDeadlines (currently Feb 5 alongside the
// trade deadline). Callers gate on the season-day crossing themselves, so this
// service no longer hard-codes a trigger date.
const ALL_STAR_MIN_GAMES_PCT = 0.60
// Rising Stars is an invitational showcase for young players — the prior
// 0.40 gate filtered out bench rookies who DNP-CD early-season, leaving
// some conferences with too few eligible candidates to fill 5 starters +
// 5 reserves. 0.25 keeps a sanity floor (rookies still need to have played
// ~12 games by the break) while letting rotation guys qualify.
const RISING_STARS_MIN_GAMES_PCT = 0.25

export class AllStarService {

  // -----------------------------------------------------------------------
  // Main Entry Point
  // -----------------------------------------------------------------------

  /**
   * Process All-Star and Rising Stars selections if date conditions are met.
   *
   * @param {Object} params
   * @param {Object} params.seasonData - Current season data
   * @param {number} params.year - Season year
   * @param {string} params.currentDate - Current campaign date (YYYY-MM-DD)
   * @param {Array} params.allPlayers - Unified array of all players with:
   *   { id, firstName/first_name, lastName/last_name, position, secondaryPosition/secondary_position,
   *     draftYear/draft_year, teamId/team_id, teamAbbreviation, overallRating/overall_rating,
   *     allStarSelections/all_star_selections }
   * @param {Array} params.teams - All team objects [{ id, abbreviation, conference, primary_color, ... }]
   * @param {number|string} params.userTeamId - The user's team ID
   * @param {boolean} [params.alreadySelected=false] - Whether All-Star was already processed this season
   * @returns {Object|null} { allStars, risingStars, newsEvents } or null if not triggered
   */
  static processAllStarSelections({
    seasonData,
    year,
    currentDate,
    allPlayers,
    teams,
    userTeamId,
    alreadySelected = false,
  }) {
    // Already processed this season
    if (alreadySelected) return null

    // Gather data
    const allStats = SeasonManager.getAllPlayerStats(seasonData)
    const standings = SeasonManager.getStandings(seasonData)

    // Build team win percentages from standings
    const teamWinPcts = AllStarService._buildTeamWinPcts(standings)

    // Build unified player lookup
    const playerLookup = AllStarService._buildPlayerLookup(allPlayers, teams)

    // Select All-Stars
    const allStars = AllStarService._selectTeam(allStats, playerLookup, teamWinPcts, false, year)

    // Select Rising Stars
    const risingStars = AllStarService._selectTeam(allStats, playerLookup, teamWinPcts, true, year)

    // Generate news events
    const newsEvents = AllStarService._generateNewsEvents(allStars, risingStars, playerLookup, userTeamId, currentDate)

    // Collect selected player IDs for award tracking
    const allStarIds = AllStarService._collectSelectedPlayerIds(allStars)
    const risingStarIds = AllStarService._collectSelectedPlayerIds(risingStars)
    const allSelectedIds = [...new Set([...allStarIds, ...risingStarIds])]

    // Store rosters on season data
    const rosters = { allStars, risingStars }
    seasonData.allStarRosters = rosters
    seasonData.metadata.updatedAt = new Date().toISOString()

    return {
      allStars,
      risingStars,
      rosters,
      newsEvents,
      selectedPlayerIds: allSelectedIds,
      allStarPlayerIds: allStarIds,
      risingStarPlayerIds: risingStarIds,
    }
  }

  // -----------------------------------------------------------------------
  // Team Win Percentages
  // -----------------------------------------------------------------------

  /**
   * Build team win percentages from standings data.
   * @private
   */
  static _buildTeamWinPcts(standings) {
    const winPcts = {}
    for (const conf of ['east', 'west']) {
      for (const standing of (standings[conf] ?? [])) {
        const teamId = standing.teamId ?? null
        if (!teamId) continue
        const wins = standing.wins ?? 0
        const losses = standing.losses ?? 0
        const total = wins + losses
        winPcts[teamId] = total > 0 ? wins / total : 0
      }
    }
    return winPcts
  }

  // -----------------------------------------------------------------------
  // Player Lookup
  // -----------------------------------------------------------------------

  /**
   * Build a unified player lookup from all players.
   * @private
   * @param {Array} allPlayers
   * @param {Array} teams
   * @returns {Object} Keyed by playerId string
   */
  static _buildPlayerLookup(allPlayers, teams) {
    const lookup = {}

    // Build team lookup by id and abbreviation
    const teamsById = {}
    const teamsByAbbr = {}
    for (const t of teams) {
      teamsById[t.id] = t
      teamsByAbbr[t.abbreviation] = t
    }

    for (const player of allPlayers) {
      const playerId = String(player.id ?? '')
      if (!playerId) continue

      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null
      const teamId = player.teamId ?? player.team_id ?? null

      // Skip free agents
      if (teamAbbr === 'FA') continue

      // Find team
      let team = null
      if (teamId) team = teamsById[teamId]
      if (!team && teamAbbr) team = teamsByAbbr[teamAbbr]
      if (!team) continue

      const firstName = player.firstName ?? player.first_name ?? ''
      const lastName = player.lastName ?? player.last_name ?? ''

      lookup[playerId] = {
        playerId,
        playerName: `${firstName} ${lastName}`.trim(),
        position: player.position ?? 'SG',
        secondaryPosition: player.secondaryPosition ?? player.secondary_position ?? null,
        draftYear: player.draftYear ?? player.draft_year ?? null,
        teamId: team.id,
        teamAbbr: team.abbreviation,
        teamColor: team.primary_color ?? team.primaryColor ?? '#6B7280',
        conference: team.conference ?? 'east',
        overallRating: player.overallRating ?? player.overall_rating ?? 70,
        // Preserve headshot pointers so the All-Star modal's PlayerAvatar
        // can resolve the actual portrait instead of falling back to the
        // default User icon. Both forms supported because the underlying
        // resolver reads either.
        headshot: player.headshot ?? null,
        hasCustomHeadshot: player.hasCustomHeadshot ?? player.has_custom_headshot ?? false,
      }
    }

    return lookup
  }

  // -----------------------------------------------------------------------
  // Team Selection
  // -----------------------------------------------------------------------

  /**
   * Select All-Star or Rising Stars teams for both conferences.
   * @private
   */
  static _selectTeam(allStats, playerLookup, teamWinPcts, risingStarsOnly, seasonYear) {
    // Find max games played to compute threshold
    let maxGames = 0
    for (const stats of Object.values(allStats)) {
      const gp = stats.gamesPlayed ?? 0
      if (gp > maxGames) maxGames = gp
    }

    const minGamesPct = risingStarsOnly ? RISING_STARS_MIN_GAMES_PCT : ALL_STAR_MIN_GAMES_PCT
    const minGames = Math.ceil(maxGames * minGamesPct)

    // Score eligible players
    const scoredPlayers = {}
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0

      // Must exist in player lookup
      const playerInfo = playerLookup[pid]
      if (!playerInfo) continue

      if (risingStarsOnly) {
        // Rising Stars: keep the rookie/sophomore tenure gate, but DON'T hard-cut
        // on the min-games floor — in a freshly generated season 1 most tagged
        // rookies are low-minute bench players that would fail it, leaving the
        // roster under-filled. Instead include anyone who has played, and mark
        // whether they cleared the floor so _selectConference can prefer the
        // higher-minute rookies first and only backfill the bench with the rest.
        if (gp < 1) continue
        const draftYear = playerInfo.draftYear
        if (draftYear == null || draftYear < seasonYear - 1) continue
      } else {
        // Regular All-Stars: strict min-games filter (large pool, no backfill needed).
        if (gp < minGames) continue
      }

      const teamWinPct = teamWinPcts[playerInfo.teamId] ?? 0
      const score = AllStarService._scorePlayer(stats, teamWinPct)

      scoredPlayers[pid] = {
        playerId: pid,
        playerName: playerInfo.playerName,
        teamId: playerInfo.teamId,
        teamAbbr: playerInfo.teamAbbr,
        teamColor: playerInfo.teamColor,
        position: playerInfo.position,
        secondaryPosition: playerInfo.secondaryPosition,
        conference: playerInfo.conference,
        // Rising Stars: did this player clear the min-games floor? Starters/bench
        // prefer those who did, then backfill with lower-minute rookies.
        eligibleStrict: risingStarsOnly ? gp >= minGames : true,
        // Forward the headshot pointers from the lookup so the All-Star pause
        // modal's PlayerAvatar resolves the real portrait instead of the default
        // icon. (Preserved in _buildPlayerLookup but previously dropped here.)
        headshot: playerInfo.headshot ?? null,
        hasCustomHeadshot: playerInfo.hasCustomHeadshot ?? false,
        stats: {
          gp,
          ppg: Math.round(((stats.points ?? 0) / gp) * 10) / 10,
          rpg: Math.round(((stats.rebounds ?? 0) / gp) * 10) / 10,
          apg: Math.round(((stats.assists ?? 0) / gp) * 10) / 10,
          spg: Math.round(((stats.steals ?? 0) / gp) * 10) / 10,
          bpg: Math.round(((stats.blocks ?? 0) / gp) * 10) / 10,
          fgPct: (stats.fieldGoalsAttempted ?? 0) > 0
            ? Math.round(((stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted * 100) * 10) / 10
            : 0,
          threePct: (stats.threePointersAttempted ?? 0) > 0
            ? Math.round(((stats.threePointersMade ?? 0) / stats.threePointersAttempted * 100) * 10) / 10
            : 0,
        },
        score: Math.round(score * 10) / 10,
      }
    }

    // Split by conference
    const eastPlayers = {}
    const westPlayers = {}
    for (const [id, p] of Object.entries(scoredPlayers)) {
      if (p.conference === 'east') {
        eastPlayers[id] = p
      } else {
        westPlayers[id] = p
      }
    }

    return {
      east: AllStarService._selectConference(eastPlayers, risingStarsOnly),
      west: AllStarService._selectConference(westPlayers, risingStarsOnly),
    }
  }

  /**
   * Score a player for All-Star consideration.
   * @private
   */
  static _scorePlayer(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp

    const statScore = (ppg * 3) + (rpg * 2) + (apg * 2.5) + (spg * 2) + (bpg * 1.5) - (tovpg * 1)
    const teamBonus = teamWinPct * 10

    return statScore + teamBonus
  }

  /**
   * Select starters and reserves for one conference.
   * @private
   */
  static _selectConference(conferencePlayers, risingStarsOnly = false) {
    const positions = ['PG', 'SG', 'SF', 'PF', 'C']
    const byScore = (a, b) => b.score - a.score

    // Selection priority: players who cleared the min-games floor ("strong")
    // first, then lower-minute backfill ("weak") — only Rising Stars have a weak
    // set (regular All-Stars are all strong). This keeps the roster full without
    // promoting a fringe rookie over one who actually played.
    const entries = Object.values(conferencePlayers)
    const strong = entries.filter((p) => p.eligibleStrict !== false).sort(byScore)
    const weak = entries.filter((p) => p.eligibleStrict === false).sort(byScore)
    const ordered = [...strong, ...weak]

    const used = new Set()
    const starters = {}

    // 1) One position-matched starter per slot (strong before weak).
    for (const pos of positions) {
      const pick = ordered.find(
        (p) => !used.has(p.playerId) && (p.position === pos || p.secondaryPosition === pos)
      )
      if (pick) {
        pick.starterPosition = pos
        starters[pos] = pick
        used.add(pick.playerId)
      }
    }

    // 2) Fill any still-empty starter slot with the best remaining player,
    //    regardless of natural position, keyed under the POSITION key (NOT a
    //    FLEX key) so AllStarModal — which reads starters[pos] for the five
    //    fixed positions — actually renders it.
    for (const pos of positions) {
      if (starters[pos]) continue
      const pick = ordered.find((p) => !used.has(p.playerId))
      if (!pick) break
      pick.starterPosition = pos
      starters[pos] = pick
      used.add(pick.playerId)
    }

    // 3) Reserves: remaining by score up to the target bench size.
    const reservesTarget = risingStarsOnly ? 5 : 7
    const reserves = ordered.filter((p) => !used.has(p.playerId)).slice(0, reservesTarget)

    return {
      starters,
      reserves,
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Count how many of the user team's players made the All-Star team
   * (starters + reserves, both conferences). All-Star team ONLY — Rising
   * Stars and end-of-season All-League/awards are intentionally excluded.
   *
   * @param {Object} allStars - seasonData.allStarRosters.allStars ({ east, west })
   * @param {number|string} userTeamId
   * @returns {number}
   */
  static countUserAllStars(allStars, userTeamId) {
    if (!allStars || userTeamId == null) return 0
    let n = 0
    for (const conf of ['east', 'west']) {
      const roster = allStars[conf]
      for (const p of Object.values(roster?.starters ?? {})) {
        if (String(p.teamId) === String(userTeamId)) n++
      }
      for (const p of (roster?.reserves ?? [])) {
        if (String(p.teamId) === String(userTeamId)) n++
      }
    }
    return n
  }

  /**
   * Tally the user team's in-season All-Star selections toward the GM
   * contract's "Produce All-Stars" sub-task (gmContract.progress.allStarAppearances).
   *
   * Counts All-Star team selections only (see countUserAllStars) — NOT Rising
   * Stars and NOT any end-of-season All-League awards. Idempotent per season, so
   * it can be called both at selection time (mid-season, for immediate UI
   * feedback) and as an end-of-season safety net without double-counting.
   *
   * The per-season idempotency guard is CO-LOCATED with the counter on
   * `gmContract.progress.allStarCountedSeasons` (an array of season years) so
   * the guard and the counter are always written/persisted together in the same
   * campaign record. (The old design kept the guard on `seasonData` and the
   * counter on the campaign — two separate IndexedDB records that could desync,
   * e.g. a stale cloud-sync snapshot reverting the counter while the guard stuck
   * `true`, permanently dropping a season's All-Stars.) Because the guard now
   * reverts together with the counter, this is also self-healing: a reverted
   * season simply gets re-tallied on the next advance/offseason. The legacy
   * `seasonData.allStarGmTallied` flag is still honored for the transition season
   * and kept in sync for any other reader.
   *
   * Mutates `gmContract.progress` (and `seasonData.allStarGmTallied`) in place;
   * callers are responsible for persisting the campaign (and season) records.
   *
   * @param {Object} params
   * @param {Object} params.seasonData
   * @param {Object} [params.gmContract] - campaign.settings.gmContract
   * @param {number|string} params.userTeamId
   * @param {number|string} [params.year] - the season year (authoritative per-season key)
   * @returns {number} how many user All-Stars were added this call (0 if already tallied or no active contract)
   */
  static tallyUserAllStarsForGm({ seasonData, gmContract, userTeamId, year }) {
    if (!seasonData) return 0
    if (!gmContract || gmContract.status !== 'active') return 0
    const allStars = seasonData.allStarRosters?.allStars
    if (!allStars) return 0

    if (!gmContract.progress) {
      gmContract.progress = {
        allStarAppearances: 0, badgesAdded: 0, starPlayerIdsAtSign: [], allStarCountedSeasons: [],
      }
    }
    const prog = gmContract.progress
    if (!Array.isArray(prog.allStarCountedSeasons)) prog.allStarCountedSeasons = []

    const y = Number(year ?? seasonData.year ?? seasonData.seasonYear)

    // Defensive: if we can't resolve a season year, fall back to the legacy
    // per-seasonData guard so re-runs still can't double-count.
    if (!Number.isFinite(y)) {
      if (seasonData.allStarGmTallied) return 0
      seasonData.allStarGmTallied = true
      const count = AllStarService.countUserAllStars(allStars, userTeamId)
      if (count > 0) prog.allStarAppearances = (prog.allStarAppearances ?? 0) + count
      return count
    }

    // Authoritative, co-located per-season guard.
    if (prog.allStarCountedSeasons.includes(y)) return 0

    // Legacy transition: a season already tallied under the old seasonData guard
    // is already reflected in allStarAppearances. Record it so it isn't re-added,
    // but don't double-count.
    if (seasonData.allStarGmTallied) {
      prog.allStarCountedSeasons.push(y)
      return 0
    }

    const count = AllStarService.countUserAllStars(allStars, userTeamId)
    prog.allStarAppearances = (prog.allStarAppearances ?? 0) + count
    prog.allStarCountedSeasons.push(y)
    seasonData.allStarGmTallied = true // keep the legacy flag in sync (harmless)
    return count
  }

  /**
   * Record per-player All-Star awards for EVERY selected player (user + AI),
   * at selection time. Bumps the career counter and appends to the player's
   * award history so the player detail modals reflect the selection
   * immediately rather than only at end-of-season.
   *
   * Writes, for each selected player:
   *   - allStarSelections / all_star_selections (career count)
   *   - awards.all_star          → year pushed (kept for the existing Awards card)
   *   - awards.all_star_history  → { year, teamAbbr } pushed (the new section)
   *
   * Idempotent per season via `seasonData.allStarAwardsRecorded`, so it can be
   * called both at selection time (mid-season) and as an end-of-season safety
   * net without double-counting. Mutates `seasonData` and the matched player
   * objects in place; the caller is responsible for persisting both.
   *
   * @param {Object} params
   * @param {Object} params.seasonData
   * @param {Array}  params.allPlayers - all campaign players ({ id, awards, ... })
   * @param {number} params.year       - season year for these selections
   * @returns {Array} the player objects that were mutated (for the caller to persist)
   */
  static recordAllStarSelectionsForPlayers({ seasonData, allPlayers, year }) {
    if (!seasonData || seasonData.allStarAwardsRecorded) return []
    const allStars = seasonData.allStarRosters?.allStars
    if (!allStars) return []

    seasonData.allStarAwardsRecorded = true

    // Map each selected player id -> their All-Star team abbreviation.
    const teamAbbrById = {}
    for (const conf of ['east', 'west']) {
      const roster = allStars[conf]
      for (const p of Object.values(roster?.starters ?? {})) {
        teamAbbrById[String(p.playerId)] = p.teamAbbr ?? null
      }
      for (const p of (roster?.reserves ?? [])) {
        teamAbbrById[String(p.playerId)] = p.teamAbbr ?? null
      }
    }

    const playerMap = Object.fromEntries((allPlayers ?? []).map((p) => [String(p.id), p]))
    const updated = []
    for (const pid of Object.keys(teamAbbrById)) {
      const p = playerMap[pid]
      if (!p) continue
      p.allStarSelections = (p.allStarSelections ?? 0) + 1
      p.all_star_selections = p.allStarSelections
      if (!p.awards) p.awards = {}
      if (!Array.isArray(p.awards.all_star)) p.awards.all_star = []
      p.awards.all_star.push(year)
      if (!Array.isArray(p.awards.all_star_history)) p.awards.all_star_history = []
      p.awards.all_star_history.push({ year, teamAbbr: teamAbbrById[pid] ?? null })
      updated.push(p)
    }
    return updated
  }

  /**
   * Collect all player IDs from a selection result.
   * @private
   */
  static _collectSelectedPlayerIds(selection) {
    const ids = []
    for (const conf of ['east', 'west']) {
      for (const player of Object.values(selection[conf]?.starters ?? {})) {
        ids.push(String(player.playerId))
      }
      for (const player of (selection[conf]?.reserves ?? [])) {
        ids.push(String(player.playerId))
      }
    }
    return ids
  }

  // -----------------------------------------------------------------------
  // News Generation
  // -----------------------------------------------------------------------

  /**
   * Generate news event objects for All-Star announcements.
   * Returns an array of plain news event objects (not persisted).
   * @private
   * @returns {Array} Array of { eventType, headline, body, playerId?, teamId?, gameDate }
   */
  static _generateNewsEvents(allStars, risingStars, playerLookup, userTeamId, currentDate) {
    const events = []

    // Build body with starter names
    const bodyParts = []
    const confNames = { east: 'Eastern', west: 'Western' }

    for (const [conf, confName] of Object.entries(confNames)) {
      const starters = allStars[conf]?.starters ?? {}
      const names = Object.values(starters).map(p => p.playerName)
      if (names.length > 0) {
        bodyParts.push(`${confName} Conference starters: ${names.join(', ')}`)
      }
    }

    const body = bodyParts.join('. ') + '.'

    // Main announcement
    events.push({
      eventType: 'award',
      headline: 'All-Star & Rising Stars teams announced',
      body,
      gameDate: currentDate,
    })

    // Individual news for user team players selected
    const allStarIds = AllStarService._collectSelectedPlayerIds(allStars)
    const risingStarIds = AllStarService._collectSelectedPlayerIds(risingStars)
    const allSelectedIds = [...new Set([...allStarIds, ...risingStarIds])]

    for (const playerId of allSelectedIds) {
      const playerInfo = playerLookup[playerId]
      if (!playerInfo || playerInfo.teamId != userTeamId) continue

      const inAllStar = allStarIds.includes(playerId)
      const inRising = risingStarIds.includes(playerId)

      let label
      if (inAllStar && inRising) {
        label = 'All-Star & Rising Stars'
      } else if (inAllStar) {
        label = 'All-Star'
      } else {
        label = 'Rising Stars'
      }

      events.push({
        eventType: 'award',
        headline: `${playerInfo.playerName} selected to ${label} team`,
        body: `Your player ${playerInfo.playerName} has been named to the ${label} team this season.`,
        playerId,
        teamId: userTeamId,
        gameDate: currentDate,
      })
    }

    return events
  }
}

export default AllStarService
