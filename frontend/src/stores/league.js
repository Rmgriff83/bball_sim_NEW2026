import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { scoreMVPCandidate, MVP_MIN_GAMES_PCT } from '@/engine/season/AwardService'

export const useLeagueStore = defineStore('league', () => {
  // State
  const standings = ref({ east: [], west: [] })
  const playerLeaders = ref([])
  const rookieLeaders = ref([])
  const mvpRace = ref([])
  const schedule = ref([])
  const loading = ref(false)
  const loadingLeaders = ref(false)
  const loadingRookies = ref(false)
  const loadingMvpRace = ref(false)
  const error = ref(null)

  // Cache tracking
  const _standingsCampaignId = ref(null)
  const _leadersCampaignId = ref(null)
  const _mvpRaceCampaignId = ref(null)

  // Getters
  const eastStandings = computed(() => standings.value.east || [])
  const westStandings = computed(() => standings.value.west || [])

  const topEightEast = computed(() => eastStandings.value.slice(0, 8))
  const topEightWest = computed(() => westStandings.value.slice(0, 8))

  const playoffTeams = computed(() => [
    ...topEightEast.value,
    ...topEightWest.value,
  ])

  const leagueLeaders = computed(() => {
    // Combine standings and sort by win percentage
    const all = [...eastStandings.value, ...westStandings.value]
    return all.sort((a, b) => {
      const totalA = a.wins + a.losses
      const totalB = b.wins + b.losses
      const pctA = totalA > 0 ? a.wins / totalA : 0
      const pctB = totalB > 0 ? b.wins / totalB : 0
      if (pctA !== pctB) return pctB - pctA
      const diffA = (a.pointsFor || 0) - (a.pointsAgainst || 0)
      const diffB = (b.pointsFor || 0) - (b.pointsAgainst || 0)
      return diffB - diffA
    })
  })

  // Actions
  async function fetchStandings(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _standingsCampaignId.value === campaignId && (standings.value.east?.length > 0 || standings.value.west?.length > 0)) {
      return standings.value
    }

    loading.value = true
    error.value = null
    try {
      // Get the campaign to determine the current season year
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? new Date().getFullYear()

      // Read standings and teams in parallel
      const [standingsData, teams] = await Promise.all([
        SeasonRepository.getStandings(campaignId, seasonYear),
        TeamRepository.getAllForCampaign(campaignId),
      ])

      if (standingsData) {
        // Build team lookup by ID
        const teamsById = {}
        for (const t of (teams || [])) {
          teamsById[t.id] = t
        }

        // Enrich each standing entry with its full team object
        const enrichConference = (entries) =>
          (entries || []).map(s => ({ ...s, team: teamsById[s.teamId] || null }))

        standings.value = {
          east: enrichConference(standingsData.east),
          west: enrichConference(standingsData.west),
        }
      } else {
        standings.value = { east: [], west: [] }
      }

      _standingsCampaignId.value = campaignId
      return standings.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch standings'
      throw err
    } finally {
      loading.value = false
    }
  }

  function updateStandings(newStandings) {
    standings.value = newStandings
  }

  function getTeamRank(teamId, conference) {
    const conferenceStandings = conference === 'east' ? eastStandings.value : westStandings.value
    const index = conferenceStandings.findIndex(s => s.teamId === teamId)
    return index >= 0 ? index + 1 : null
  }

  function getWinPercentage(wins, losses) {
    const total = wins + losses
    if (total === 0) return '.000'
    const pct = wins / total
    return pct.toFixed(3).substring(1) // Remove leading 0
  }

  function getGamesBehind(wins, losses, leaderWins, leaderLosses) {
    const gb = ((leaderWins - wins) + (losses - leaderLosses)) / 2
    if (gb === 0) return '-'
    return gb.toFixed(1)
  }

  function clearStandings() {
    standings.value = { east: [], west: [] }
    _standingsCampaignId.value = null
  }

  async function fetchPlayerLeaders(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _leadersCampaignId.value === campaignId && playerLeaders.value.length > 0) {
      return playerLeaders.value
    }

    loadingLeaders.value = true
    error.value = null
    try {
      // Get the campaign to determine the current season year
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? new Date().getFullYear()

      // Read player stats and teams from IndexedDB
      const [playerStats, teams] = await Promise.all([
        SeasonRepository.getPlayerStats(campaignId, seasonYear),
        TeamRepository.getAllForCampaign(campaignId),
      ])

      if (!playerStats || typeof playerStats !== 'object') {
        playerLeaders.value = []
        _leadersCampaignId.value = campaignId
        return playerLeaders.value
      }

      // Build team lookup by ID for enrichment
      const teamsById = {}
      for (const t of (teams || [])) {
        teamsById[t.id] = t
      }

      // Compute leaders from raw player stats
      // Convert playerStats map to array with per-game averages
      const leaders = []
      for (const [playerId, stats] of Object.entries(playerStats)) {
        const gamesPlayed = stats.gamesPlayed ?? stats.games_played ?? 0
        if (gamesPlayed <= 0) continue

        const ppg = (stats.points ?? 0) / gamesPlayed
        // rebounds is already total (offensive + defensive), don't double-count
        const rpg = (stats.rebounds ?? 0) / gamesPlayed
        const apg = (stats.assists ?? 0) / gamesPlayed
        const spg = (stats.steals ?? 0) / gamesPlayed
        const bpg = (stats.blocks ?? 0) / gamesPlayed
        const topg = (stats.turnovers ?? 0) / gamesPlayed
        const fga = stats.fga ?? stats.fieldGoalsAttempted ?? 0
        const fgPct = fga > 0
          ? ((stats.fgm ?? stats.fieldGoalsMade ?? 0) / fga) * 100
          : 0
        const tpa = stats.tpa ?? stats.fg3a ?? stats.threePointersAttempted ?? 0
        const threePct = tpa > 0
          ? ((stats.tpm ?? stats.fg3m ?? stats.threePointersMade ?? 0) / tpa) * 100
          : 0
        const fta = stats.fta ?? stats.freeThrowsAttempted ?? 0
        const ftPct = fta > 0
          ? ((stats.ftm ?? stats.freeThrowsMade ?? 0) / fta) * 100
          : 0

        // Enrich with team data
        const team = teamsById[stats.teamId] || null
        const teamAbbreviation = team?.abbreviation ?? stats.teamAbbreviation ?? stats.team_abbreviation ?? ''

        leaders.push({
          playerId,
          name: stats.playerName ?? stats.player_name ?? 'Unknown',
          teamId: stats.teamId ?? null,
          teamAbbreviation,
          teamColor: team?.primary_color ?? '#6B7280',
          position: stats.position ?? '',
          gamesPlayed,
          ppg: Math.round(ppg * 10) / 10,
          rpg: Math.round(rpg * 10) / 10,
          apg: Math.round(apg * 10) / 10,
          spg: Math.round(spg * 10) / 10,
          bpg: Math.round(bpg * 10) / 10,
          topg: Math.round(topg * 10) / 10,
          fgPct: Math.round(fgPct * 10) / 10,
          threePct: Math.round(threePct * 10) / 10,
          ftPct: Math.round(ftPct * 10) / 10,
        })
      }

      // Sort by ppg descending as default
      leaders.sort((a, b) => b.ppg - a.ppg)

      playerLeaders.value = leaders
      _leadersCampaignId.value = campaignId
      return playerLeaders.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch league leaders'
      throw err
    } finally {
      loadingLeaders.value = false
    }
  }

  async function fetchMVPRace(campaignId, { force = false } = {}) {
    // Return cached if already loaded for this campaign.
    if (!force && _mvpRaceCampaignId.value === campaignId && mvpRace.value.length > 0) {
      return mvpRace.value
    }

    loadingMvpRace.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? new Date().getFullYear()

      const [playerStats, teams, seasonData] = await Promise.all([
        SeasonRepository.getPlayerStats(campaignId, seasonYear),
        TeamRepository.getAllForCampaign(campaignId),
        SeasonRepository.get(campaignId, seasonYear),
      ])

      if (!playerStats || typeof playerStats !== 'object') {
        mvpRace.value = []
        _mvpRaceCampaignId.value = campaignId
        return mvpRace.value
      }

      // Build team lookup and team-id → win% map from standings.
      // Combine east + west into one lookup since the MVP race is
      // league-wide (no conference filter).
      const teamsById = {}
      for (const t of (teams || [])) teamsById[t.id] = t
      const teamWinPctById = {}
      const allStandings = [
        ...(seasonData?.standings?.east || []),
        ...(seasonData?.standings?.west || []),
      ]
      for (const s of allStandings) {
        const tid = s.teamId ?? s.team_id
        const w = s.wins ?? 0
        const l = s.losses ?? 0
        const games = w + l
        teamWinPctById[tid] = games > 0 ? w / games : 0
      }

      // Compute max games played → min-games eligibility floor.
      // Mirrors AwardService._selectMVP exactly so the live leader
      // matches the end-of-season MVP winner.
      let maxGames = 0
      for (const stats of Object.values(playerStats)) {
        const gp = stats.gamesPlayed ?? stats.games_played ?? 0
        if (gp > maxGames) maxGames = gp
      }
      const minGames = Math.ceil(maxGames * MVP_MIN_GAMES_PCT)

      const candidates = []
      for (const [playerId, stats] of Object.entries(playerStats)) {
        const gamesPlayed = stats.gamesPlayed ?? stats.games_played ?? 0
        if (gamesPlayed < minGames) continue

        // Normalize key names AwardService._scoreMVP expects.
        // (it reads stats.fieldGoalsMade / fieldGoalsAttempted; the
        // playerStats records use fgm/fga in some paths.)
        const normalized = {
          gamesPlayed,
          points: stats.points ?? 0,
          rebounds: stats.rebounds ?? 0,
          assists: stats.assists ?? 0,
          steals: stats.steals ?? 0,
          blocks: stats.blocks ?? 0,
          turnovers: stats.turnovers ?? 0,
          fieldGoalsMade: stats.fgm ?? stats.fieldGoalsMade ?? 0,
          fieldGoalsAttempted: stats.fga ?? stats.fieldGoalsAttempted ?? 0,
        }

        const teamId = stats.teamId ?? null
        const teamWinPct = teamWinPctById[teamId] ?? 0
        const mvpScore = scoreMVPCandidate(normalized, teamWinPct)

        const team = teamsById[teamId] || null
        const wins = allStandings.find(s => (s.teamId ?? s.team_id) === teamId)?.wins ?? 0
        const losses = allStandings.find(s => (s.teamId ?? s.team_id) === teamId)?.losses ?? 0
        const ppg = gamesPlayed > 0 ? (stats.points ?? 0) / gamesPlayed : 0
        const rpg = gamesPlayed > 0 ? (stats.rebounds ?? 0) / gamesPlayed : 0
        const apg = gamesPlayed > 0 ? (stats.assists ?? 0) / gamesPlayed : 0
        const fga = stats.fga ?? stats.fieldGoalsAttempted ?? 0
        const fgPct = fga > 0
          ? ((stats.fgm ?? stats.fieldGoalsMade ?? 0) / fga) * 100
          : 0

        candidates.push({
          playerId,
          name: stats.playerName ?? stats.player_name ?? 'Unknown',
          teamId,
          teamAbbreviation: team?.abbreviation ?? stats.teamAbbreviation ?? stats.team_abbreviation ?? '',
          teamColor: team?.primary_color ?? '#6B7280',
          position: stats.position ?? '',
          gamesPlayed,
          mvpScore: Math.round(mvpScore * 10) / 10,
          ppg: Math.round(ppg * 10) / 10,
          rpg: Math.round(rpg * 10) / 10,
          apg: Math.round(apg * 10) / 10,
          fgPct: Math.round(fgPct * 10) / 10,
          teamWins: wins,
          teamLosses: losses,
        })
      }

      candidates.sort((a, b) => b.mvpScore - a.mvpScore)

      // Top 15 — covers all serious candidates, keeps the list scannable.
      mvpRace.value = candidates.slice(0, 15)
      _mvpRaceCampaignId.value = campaignId
      return mvpRace.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch MVP race'
      throw err
    } finally {
      loadingMvpRace.value = false
    }
  }

  function clearMvpRace() {
    mvpRace.value = []
    _mvpRaceCampaignId.value = null
  }

  function clearPlayerLeaders() {
    playerLeaders.value = []
    _leadersCampaignId.value = null
  }

  async function fetchRookieLeaders(campaignId) {
    loadingRookies.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? new Date().getFullYear()

      const [playerStats, teams, players] = await Promise.all([
        SeasonRepository.getPlayerStats(campaignId, seasonYear),
        TeamRepository.getAllForCampaign(campaignId),
        PlayerRepository.getAllForCampaign(campaignId),
      ])

      if (!playerStats || typeof playerStats !== 'object') {
        rookieLeaders.value = []
        return rookieLeaders.value
      }

      const teamsById = {}
      for (const t of (teams || [])) teamsById[t.id] = t

      const playersById = {}
      for (const p of (players || [])) playersById[String(p.id)] = p

      const rookies = []
      for (const [playerId, stats] of Object.entries(playerStats)) {
        const gp = stats.gamesPlayed ?? stats.games_played ?? 0
        if (gp <= 0) continue

        const playerInfo = playersById[String(playerId)]
        const draftYear = playerInfo?.draftYear ?? playerInfo?.draft_year ?? null
        if (draftYear == null || draftYear !== seasonYear) continue

        const ppg = (stats.points ?? 0) / gp
        const rpg = (stats.rebounds ?? 0) / gp
        const apg = (stats.assists ?? 0) / gp
        const spg = (stats.steals ?? 0) / gp
        const bpg = (stats.blocks ?? 0) / gp
        const tovpg = (stats.turnovers ?? 0) / gp
        const fga = stats.fga ?? stats.fieldGoalsAttempted ?? 0
        const fgPct = fga > 0
          ? ((stats.fgm ?? stats.fieldGoalsMade ?? 0) / fga) * 100
          : 0

        // ROTY-style score (mirrors AwardService._scoreROTY without team win pct,
        // since this ranking is about individual production, not awards races)
        const score = (ppg * 3) + (rpg * 2) + (apg * 2.5) + (spg * 2) + (bpg * 1.5) - (tovpg * 0.5)

        const team = teamsById[stats.teamId] || null
        const teamAbbreviation = team?.abbreviation ?? stats.teamAbbreviation ?? stats.team_abbreviation ?? ''

        const fallbackName = playerInfo
          ? `${playerInfo.firstName ?? ''} ${playerInfo.lastName ?? ''}`.trim()
          : ''

        rookies.push({
          playerId,
          name: stats.playerName ?? stats.player_name ?? (fallbackName || 'Unknown'),
          teamId: stats.teamId ?? null,
          teamAbbreviation,
          teamColor: team?.primary_color ?? '#6B7280',
          position: stats.position ?? playerInfo?.position ?? '',
          gamesPlayed: gp,
          ppg: Math.round(ppg * 10) / 10,
          rpg: Math.round(rpg * 10) / 10,
          apg: Math.round(apg * 10) / 10,
          spg: Math.round(spg * 10) / 10,
          bpg: Math.round(bpg * 10) / 10,
          fgPct: Math.round(fgPct * 10) / 10,
          score: Math.round(score * 10) / 10,
        })
      }

      rookies.sort((a, b) => b.score - a.score)
      rookieLeaders.value = rookies.slice(0, 10)
      return rookieLeaders.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch rookie rankings'
      throw err
    } finally {
      loadingRookies.value = false
    }
  }

  function clearRookieLeaders() {
    rookieLeaders.value = []
  }

  function invalidate() {
    _standingsCampaignId.value = null
    _leadersCampaignId.value = null
    _mvpRaceCampaignId.value = null
  }

  return {
    // State
    standings,
    playerLeaders,
    rookieLeaders,
    mvpRace,
    schedule,
    loading,
    loadingLeaders,
    loadingRookies,
    loadingMvpRace,
    error,
    // Getters
    eastStandings,
    westStandings,
    topEightEast,
    topEightWest,
    playoffTeams,
    leagueLeaders,
    // Actions
    fetchStandings,
    fetchPlayerLeaders,
    fetchRookieLeaders,
    fetchMVPRace,
    updateStandings,
    getTeamRank,
    getWinPercentage,
    getGamesBehind,
    clearStandings,
    clearPlayerLeaders,
    clearRookieLeaders,
    clearMvpRace,
    invalidate,
  }
})
