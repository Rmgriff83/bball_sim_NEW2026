import { SeasonManager } from './SeasonManager'

// ---------------------------------------------------------------------------
// AwardService
// ---------------------------------------------------------------------------
// Handles end-of-season award selection: MVP, Rookie of the Year, All-NBA,
// All-Rookie, All-Defense. Pure functions — no file I/O or database access.
// ---------------------------------------------------------------------------

const MVP_MIN_GAMES_PCT = 0.75
const ROTY_MIN_GAMES_PCT = 0.50
const DEFENSE_MIN_GAMES_PCT = 0.60

export class AwardService {

  // -----------------------------------------------------------------------
  // Main Entry Point
  // -----------------------------------------------------------------------

  /**
   * Process all end-of-season awards.
   *
   * @param {Object} params
   * @param {Object} params.seasonData - Current season data
   * @param {number} params.year - Season year
   * @param {Array} params.allPlayers - All player objects
   * @param {Array} params.teams - All team objects
   * @param {number|string} params.userTeamId - The user's team ID
   * @returns {Object} { mvp, rookieOfTheYear, allNba, allRookie, allDefense, newsEvents }
   */
  static processSeasonAwards({ seasonData, year, allPlayers, teams, userTeamId }) {
    const allStats = SeasonManager.getAllPlayerStats(seasonData)
    const standings = SeasonManager.getStandings(seasonData)

    const teamWinPcts = AwardService._buildTeamWinPcts(standings)
    const playerLookup = AwardService._buildPlayerLookup(allPlayers, teams)

    // Find max games played
    let maxGames = 0
    for (const stats of Object.values(allStats)) {
      const gp = stats.gamesPlayed ?? 0
      if (gp > maxGames) maxGames = gp
    }

    // MVP
    const mvp = AwardService._selectMVP(allStats, playerLookup, teamWinPcts, maxGames)

    // Rookie of the Year
    const rookieOfTheYear = AwardService._selectROTY(allStats, playerLookup, teamWinPcts, maxGames, year)

    // All-NBA (3 teams, position-based)
    const allNba = AwardService._selectAllNBA(allStats, playerLookup, teamWinPcts, maxGames)

    // All-Rookie (2 teams, no position requirement)
    const allRookie = AwardService._selectAllRookie(allStats, playerLookup, teamWinPcts, maxGames, year)

    // All-Defense (2 teams, position-based)
    const allDefense = AwardService._selectAllDefense(allStats, playerLookup, teamWinPcts, maxGames)

    // Determine the end-of-season date for news events
    const schedule = seasonData?.schedule || []
    const lastGame = schedule.filter(g => g.played).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    const date = lastGame?.date || `${year + 1}-04-15`

    const newsEvents = AwardService._generateNewsEvents(
      { mvp, rookieOfTheYear, allNba, allRookie, allDefense },
      playerLookup, userTeamId, date
    )

    return { mvp, rookieOfTheYear, allNba, allRookie, allDefense, newsEvents }
  }

  // -----------------------------------------------------------------------
  // Team Win Percentages
  // -----------------------------------------------------------------------

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

  static _buildPlayerLookup(allPlayers, teams) {
    const lookup = {}
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

      if (teamAbbr === 'FA') continue

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
        attributes: player.attributes ?? null,
      }
    }

    return lookup
  }

  // -----------------------------------------------------------------------
  // Position Classification
  // -----------------------------------------------------------------------

  static _classifyPosition(pos) {
    if (pos === 'PG' || pos === 'SG') return 'guard'
    if (pos === 'SF' || pos === 'PF') return 'forward'
    if (pos === 'C') return 'center'
    return 'forward'
  }

  // -----------------------------------------------------------------------
  // Scoring Functions
  // -----------------------------------------------------------------------

  static _scoreMVP(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp
    const fgPct = (stats.fieldGoalsAttempted ?? 0) > 0
      ? (stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted
      : 0

    return (ppg * 3.5) + (rpg * 2) + (apg * 3) + (spg * 2) + (bpg * 1.5)
           - (tovpg * 1.5) + (fgPct * 5) + (teamWinPct * 15)
  }

  static _scoreROTY(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp

    return (ppg * 3) + (rpg * 2) + (apg * 2.5) + (spg * 2) + (bpg * 1.5)
           - (tovpg * 0.5) + (teamWinPct * 5)
  }

  static _scoreDefense(stats, teamWinPct, attributes) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const drpg = (stats.defensiveRebounds ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const pfpg = (stats.personalFouls ?? 0) / gp

    // Defensive attribute average
    let defAttrAvg = 70
    if (attributes?.defense) {
      const d = attributes.defense
      const vals = [d.perimeterDefense ?? d.perimeter_defense ?? 70,
                    d.interiorDefense ?? d.interior_defense ?? 70,
                    d.defensiveIQ ?? d.defensive_iq ?? 70]
      defAttrAvg = vals.reduce((a, b) => a + b, 0) / vals.length
    }

    return (spg * 5) + (bpg * 5) + (drpg * 1.5) + (rpg * 0.5)
           - (pfpg * 0.5) + (defAttrAvg / 10) + (teamWinPct * 5)
  }

  // -----------------------------------------------------------------------
  // Build Per-Game Stats Object
  // -----------------------------------------------------------------------

  static _buildPerGameStats(stats) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    return {
      gp,
      ppg: Math.round(((stats.points ?? 0) / gp) * 10) / 10,
      rpg: Math.round(((stats.rebounds ?? 0) / gp) * 10) / 10,
      apg: Math.round(((stats.assists ?? 0) / gp) * 10) / 10,
      spg: Math.round(((stats.steals ?? 0) / gp) * 10) / 10,
      bpg: Math.round(((stats.blocks ?? 0) / gp) * 10) / 10,
      fgPct: (stats.fieldGoalsAttempted ?? 0) > 0
        ? Math.round(((stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted * 100) * 10) / 10
        : 0,
    }
  }

  // -----------------------------------------------------------------------
  // MVP Selection
  // -----------------------------------------------------------------------

  static _selectMVP(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * MVP_MIN_GAMES_PCT)
    let bestPlayer = null
    let bestScore = -Infinity

    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreMVP(stats, teamWinPct)

      if (score > bestScore) {
        bestScore = score
        bestPlayer = {
          playerId: pid,
          playerName: info.playerName,
          teamAbbr: info.teamAbbr,
          teamColor: info.teamColor,
          position: info.position,
          score: Math.round(score * 10) / 10,
          stats: AwardService._buildPerGameStats(stats),
        }
      }
    }

    return bestPlayer
  }

  // -----------------------------------------------------------------------
  // Rookie of the Year Selection
  // -----------------------------------------------------------------------

  static _selectROTY(allStats, playerLookup, teamWinPcts, maxGames, year) {
    const minGames = Math.ceil(maxGames * ROTY_MIN_GAMES_PCT)
    let bestPlayer = null
    let bestScore = -Infinity

    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      // Rookies only
      if (info.draftYear == null || info.draftYear !== year) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreROTY(stats, teamWinPct)

      if (score > bestScore) {
        bestScore = score
        bestPlayer = {
          playerId: pid,
          playerName: info.playerName,
          teamAbbr: info.teamAbbr,
          teamColor: info.teamColor,
          position: info.position,
          score: Math.round(score * 10) / 10,
          stats: AwardService._buildPerGameStats(stats),
        }
      }
    }

    return bestPlayer
  }

  // -----------------------------------------------------------------------
  // All-NBA Selection (3 teams, 2G/2F/1C each)
  // -----------------------------------------------------------------------

  static _selectAllNBA(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * MVP_MIN_GAMES_PCT)

    // Score all eligible players
    const scored = []
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreMVP(stats, teamWinPct)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        posClass: AwardService._classifyPosition(info.position),
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
      })
    }

    scored.sort((a, b) => b.score - a.score)

    const used = new Set()
    const result = { first: [], second: [], third: [] }

    for (const tier of ['first', 'second', 'third']) {
      result[tier] = AwardService._fillPositionSlots(scored, used)
    }

    return result
  }

  // -----------------------------------------------------------------------
  // All-Rookie Selection (2 teams, 5 each, no position requirement)
  // -----------------------------------------------------------------------

  static _selectAllRookie(allStats, playerLookup, teamWinPcts, maxGames, year) {
    const minGames = Math.ceil(maxGames * ROTY_MIN_GAMES_PCT)

    const scored = []
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue
      if (info.draftYear == null || info.draftYear !== year) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreROTY(stats, teamWinPct)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
      })
    }

    if (scored.length === 0) return null

    scored.sort((a, b) => b.score - a.score)

    return {
      first: scored.slice(0, 5),
      second: scored.slice(5, 10),
    }
  }

  // -----------------------------------------------------------------------
  // All-Defense Selection (2 teams, 2G/2F/1C each)
  // -----------------------------------------------------------------------

  static _selectAllDefense(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * DEFENSE_MIN_GAMES_PCT)

    const scored = []
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreDefense(stats, teamWinPct, info.attributes)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        posClass: AwardService._classifyPosition(info.position),
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
      })
    }

    scored.sort((a, b) => b.score - a.score)

    const used = new Set()
    return {
      first: AwardService._fillPositionSlots(scored, used),
      second: AwardService._fillPositionSlots(scored, used),
    }
  }

  // -----------------------------------------------------------------------
  // Position-Slot Filler (2G, 2F, 1C)
  // -----------------------------------------------------------------------

  static _fillPositionSlots(sortedPlayers, usedIds) {
    const slots = { guard: 2, forward: 2, center: 1 }
    const selected = []

    for (const player of sortedPlayers) {
      if (usedIds.has(player.playerId)) continue
      const cls = player.posClass
      if (slots[cls] > 0) {
        selected.push(player)
        usedIds.add(player.playerId)
        slots[cls]--
      }
      if (selected.length === 5) break
    }

    return selected
  }

  // -----------------------------------------------------------------------
  // Apply Awards to Player Objects
  // -----------------------------------------------------------------------

  static applyAwardsToPlayers(allPlayers, awardResults) {
    const playerMap = Object.fromEntries(allPlayers.map(p => [String(p.id), p]))

    // MVP
    if (awardResults.mvp) {
      const p = playerMap[awardResults.mvp.playerId]
      if (p) {
        p.mvpAwards = (p.mvpAwards ?? p.mvp_awards ?? 0) + 1
        p.mvp_awards = p.mvpAwards
      }
    }

    // Rookie of the Year
    if (awardResults.rookieOfTheYear) {
      const p = playerMap[awardResults.rookieOfTheYear.playerId]
      if (p) {
        p.rookieOfTheYear = (p.rookieOfTheYear ?? p.rookie_of_the_year ?? 0) + 1
        p.rookie_of_the_year = p.rookieOfTheYear
      }
    }

    // All-NBA
    if (awardResults.allNba) {
      for (const tier of ['first', 'second', 'third']) {
        for (const entry of (awardResults.allNba[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allNbaSelections = (p.allNbaSelections ?? p.all_nba_selections ?? 0) + 1
            p.all_nba_selections = p.allNbaSelections
            if (tier === 'first') {
              p.allNbaFirstTeam = (p.allNbaFirstTeam ?? p.all_nba_first_team ?? 0) + 1
              p.all_nba_first_team = p.allNbaFirstTeam
            }
          }
        }
      }
    }

    // All-Rookie
    if (awardResults.allRookie) {
      for (const tier of ['first', 'second']) {
        for (const entry of (awardResults.allRookie[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allRookieTeam = (p.allRookieTeam ?? p.all_rookie_team ?? 0) + 1
            p.all_rookie_team = p.allRookieTeam
          }
        }
      }
    }

    // All-Defense
    if (awardResults.allDefense) {
      for (const tier of ['first', 'second']) {
        for (const entry of (awardResults.allDefense[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allDefensiveTeam = (p.allDefensiveTeam ?? p.all_defensive_team ?? 0) + 1
            p.all_defensive_team = p.allDefensiveTeam
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // News Generation
  // -----------------------------------------------------------------------

  static _generateNewsEvents(awards, playerLookup, userTeamId, date) {
    const events = []

    // MVP announcement
    if (awards.mvp) {
      events.push({
        eventType: 'award',
        headline: `${awards.mvp.playerName} wins League MVP`,
        body: `${awards.mvp.playerName} (${awards.mvp.teamAbbr}) has been named the League MVP, averaging ${awards.mvp.stats.ppg} PPG, ${awards.mvp.stats.rpg} RPG, and ${awards.mvp.stats.apg} APG.`,
        gameDate: date,
      })
    }

    // ROTY announcement
    if (awards.rookieOfTheYear) {
      events.push({
        eventType: 'award',
        headline: `${awards.rookieOfTheYear.playerName} named Rookie of the Year`,
        body: `${awards.rookieOfTheYear.playerName} (${awards.rookieOfTheYear.teamAbbr}) has been named Rookie of the Year, averaging ${awards.rookieOfTheYear.stats.ppg} PPG, ${awards.rookieOfTheYear.stats.rpg} RPG, and ${awards.rookieOfTheYear.stats.apg} APG.`,
        gameDate: date,
      })
    }

    // All-NBA 1st Team
    if (awards.allNba?.first?.length > 0) {
      const names = awards.allNba.first.map(p => p.playerName).join(', ')
      events.push({
        eventType: 'award',
        headline: 'All-NBA teams announced',
        body: `All-NBA First Team: ${names}.`,
        gameDate: date,
      })
    }

    // User team player individual news
    const userTeamIdStr = String(userTeamId)
    const notified = new Set()

    // Check if MVP is on user team
    if (awards.mvp) {
      const info = playerLookup[awards.mvp.playerId]
      if (info && String(info.teamId) === userTeamIdStr) {
        notified.add(awards.mvp.playerId)
        events.push({
          eventType: 'award',
          headline: `${awards.mvp.playerName} wins League MVP!`,
          body: `Your player ${awards.mvp.playerName} has been named the League MVP.`,
          playerId: awards.mvp.playerId,
          teamId: userTeamId,
          gameDate: date,
        })
      }
    }

    // Check if ROTY is on user team
    if (awards.rookieOfTheYear) {
      const info = playerLookup[awards.rookieOfTheYear.playerId]
      if (info && String(info.teamId) === userTeamIdStr) {
        notified.add(awards.rookieOfTheYear.playerId)
        events.push({
          eventType: 'award',
          headline: `${awards.rookieOfTheYear.playerName} wins Rookie of the Year!`,
          body: `Your player ${awards.rookieOfTheYear.playerName} has been named Rookie of the Year.`,
          playerId: awards.rookieOfTheYear.playerId,
          teamId: userTeamId,
          gameDate: date,
        })
      }
    }

    // Check All-NBA, All-Defense, All-Rookie for user team players
    const teamAwards = [
      { key: 'allNba', label: 'All-NBA' },
      { key: 'allDefense', label: 'All-Defense' },
      { key: 'allRookie', label: 'All-Rookie' },
    ]

    for (const { key, label } of teamAwards) {
      const award = awards[key]
      if (!award) continue
      for (const tier of ['first', 'second', 'third']) {
        for (const entry of (award[tier] || [])) {
          if (notified.has(entry.playerId)) continue
          const info = playerLookup[entry.playerId]
          if (info && String(info.teamId) === userTeamIdStr) {
            notified.add(entry.playerId)
            events.push({
              eventType: 'award',
              headline: `${entry.playerName} named to ${label} Team`,
              body: `Your player ${entry.playerName} has been selected to the ${label} ${tier.charAt(0).toUpperCase() + tier.slice(1)} Team.`,
              playerId: entry.playerId,
              teamId: userTeamId,
              gameDate: date,
            })
          }
        }
      }
    }

    return events
  }
}

export default AwardService
