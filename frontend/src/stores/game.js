import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useEngineStore } from '@/stores/engine'
import { useToastStore } from '@/stores/toast'
import { useCampaignStore } from '@/stores/campaign'
import { useSyncStore } from '@/stores/sync'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonManager } from '@/engine/season/SeasonManager'
import { processGameRewards } from '@/engine/rewards/RewardService'
import { NewsService } from '@/engine/season/NewsService'

export const useGameStore = defineStore('game', () => {
  // State
  const games = ref([])
  const currentGame = ref(null)
  const simulationResult = ref(null)
  const loading = ref(false)
  const simulating = ref(false)
  const error = ref(null)

  // Live simulation state (quarter-by-quarter)
  const isLiveSimulation = ref(false)
  const currentSimQuarter = ref(0)
  const quarterAnimationData = ref([])

  // Simulate to next game state
  const simulatePreview = ref(null)
  const loadingPreview = ref(false)

  // Cache tracking
  const _loadedCampaignId = ref(null)

  // Background simulation state (kept for view compatibility, now driven by bulk sim)
  const backgroundSimulating = ref(false)
  const simulationProgress = ref(null)

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get campaign data needed for season repository lookups.
   * Returns { campaignId, year, userTeamId }.
   */
  async function _getCampaignContext(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
    const year = campaign.currentSeasonYear ?? 2025
    const userTeamId = campaign.teamId
    return { campaign, year, userTeamId }
  }

  /**
   * Apply evolution results to player records and save to IndexedDB.
   * Evolution returns { home: { players: {id: playerObj, ...} }, away: { ... } }.
   * The player objects are already fully updated with new attributes, morale,
   * fatigue, recent_performances, etc. — we just save them.
   */
  async function _applyEvolutionToPlayers(evolution, game) {
    if (!evolution) return
    const updatedPlayers = []
    for (const teamKey of ['home', 'away']) {
      const evolvedPlayers = evolution[teamKey]?.players
      if (!evolvedPlayers || typeof evolvedPlayers !== 'object') continue
      for (const [playerId, evolvedPlayer] of Object.entries(evolvedPlayers)) {
        if (evolvedPlayer && evolvedPlayer.campaignId) {
          updatedPlayers.push(evolvedPlayer)
        }
      }
    }
    if (updatedPlayers.length > 0) {
      await PlayerRepository.saveBulk(updatedPlayers)
    }
  }

  /**
   * Normalize a schedule entry from IndexedDB (camelCase) to the snake_case
   * shape that Vue views expect, including derived fields like is_user_game.
   */
  function _normalizeGame(game, userTeamId, teams = null) {
    const isUserGame =
      game.homeTeamId === userTeamId || game.awayTeamId === userTeamId

    const normalized = {
      id: game.id,
      home_team_id: game.homeTeamId,
      away_team_id: game.awayTeamId,
      home_team_abbreviation: game.homeTeamAbbreviation,
      away_team_abbreviation: game.awayTeamAbbreviation,
      game_date: game.gameDate,
      is_playoff: game.isPlayoff ?? false,
      is_complete: game.isComplete ?? false,
      is_in_progress: game.isInProgress ?? false,
      home_score: game.homeScore ?? null,
      away_score: game.awayScore ?? null,
      box_score: game.boxScore ?? null,
      quarter_scores: game.quarterScores ?? null,
      is_user_game: isUserGame,
      current_quarter: game.currentQuarter ?? null,
    }

    // Attach full team objects when available
    if (teams) {
      const homeTeam = teams.find(t => t.id === game.homeTeamId)
      const awayTeam = teams.find(t => t.id === game.awayTeamId)
      if (homeTeam) normalized.home_team = homeTeam
      if (awayTeam) normalized.away_team = awayTeam
    }

    return normalized
  }

  /**
   * Normalize a schedule entry into a detailed game object (for currentGame).
   * Includes full team objects, play-by-play, animation data, etc.
   */
  function _normalizeDetailedGame(game, userTeamId, teams) {
    const base = _normalizeGame(game, userTeamId, teams)

    // Copy through any extra fields that may exist on detailed game results
    if (game.play_by_play) base.play_by_play = game.play_by_play
    if (game.animation_data) base.animation_data = game.animation_data
    if (game.evolution) base.evolution = game.evolution
    if (game.rewards) base.rewards = game.rewards
    if (game.upgrade_points_awarded) base.upgrade_points_awarded = game.upgrade_points_awarded

    return base
  }

  /**
   * Update player season stats from a box score.
   */
  function _updatePlayerStatsFromBoxScore(seasonData, boxScore, homeTeamId, awayTeamId) {
    if (!boxScore) return

    const sides = { home: homeTeamId, away: awayTeamId }
    for (const [side, teamId] of Object.entries(sides)) {
      for (const playerStats of (boxScore[side] ?? [])) {
        const playerId = playerStats.player_id ?? playerStats.playerId ?? null
        const playerName = playerStats.name ?? 'Unknown'
        if (!playerId) continue
        SeasonManager.updatePlayerStats(seasonData, playerId, playerName, teamId, playerStats)
      }
    }
  }

  /**
   * Save in-progress game state to IndexedDB so it survives page navigation.
   * Stores the serialized worker gameState on the schedule entry.
   */
  async function _saveInProgressState(campaignId, year, gameId, gameState, scores, quarter) {
    const seasonData = await SeasonRepository.get(campaignId, year)
    if (!seasonData) return
    const game = seasonData.schedule.find(g => g.id === gameId)
    if (!game) return

    game.isInProgress = true
    game.isComplete = false
    game.savedGameState = gameState
    game.homeScore = scores.home
    game.awayScore = scores.away
    game.currentQuarter = quarter

    await SeasonRepository.save({ campaignId, year, ...seasonData })
  }

  /**
   * Advance the campaign date to the day after the given game date.
   */
  async function _advanceDateIfNeeded(campaignId, gameDate) {
    if (!gameDate) return
    const campaign = await CampaignRepository.get(campaignId)
    if (!campaign) return

    // Only advance if game date >= current date
    if (gameDate >= (campaign.currentDate || '')) {
      const [y, m, d] = gameDate.split('-').map(Number)
      const nextDay = new Date(y, m - 1, d)
      nextDay.setDate(nextDay.getDate() + 1)
      const newDate = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`
      campaign.currentDate = newDate
      await CampaignRepository.save(campaign)

      // Update campaign store if loaded
      const campaignStore = useCampaignStore()
      if (campaignStore.currentCampaign?.id === campaignId) {
        campaignStore.updateCurrentDate(newDate)
      }
    }
  }

  /**
   * Prepare game data for simulation: load teams and players.
   */
  async function _loadGameSimData(campaignId, game) {
    const [homeTeam, awayTeam, homePlayers, awayPlayers] = await Promise.all([
      TeamRepository.get(campaignId, game.homeTeamId),
      TeamRepository.get(campaignId, game.awayTeamId),
      PlayerRepository.getByTeam(campaignId, game.homeTeamId),
      PlayerRepository.getByTeam(campaignId, game.awayTeamId),
    ])

    if (!homeTeam) throw new Error(`Home team ${game.homeTeamId} not found`)
    if (!awayTeam) throw new Error(`Away team ${game.awayTeamId} not found`)

    return { homeTeam, awayTeam, homePlayers, awayPlayers }
  }

  /**
   * Persist a single game result into seasonData, update standings, player stats.
   * Mutates seasonData in place and saves to IndexedDB.
   */
  async function _persistGameResult(campaignId, year, seasonData, gameId, result, isUserGame) {
    // Build persist data
    const persistData = {
      isComplete: true,
      homeScore: result.home_score,
      awayScore: result.away_score,
      boxScore: result.box_score,
      quarterScores: result.quarter_scores,
    }

    // Persist evolution summary (without the heavy players map) for user games
    if (isUserGame && result.evolution) {
      const slimEvolution = {}
      for (const teamKey of ['home', 'away']) {
        const teamEvo = result.evolution[teamKey]
        if (!teamEvo) continue
        // Copy everything except the players map
        const { players, ...summary } = teamEvo
        slimEvolution[teamKey] = summary
      }
      persistData.evolution = slimEvolution
    }

    // Update schedule entry
    SeasonManager.updateGame(seasonData, gameId, persistData, isUserGame)

    // Update standings
    const game = seasonData.schedule.find(g => g.id === gameId)
    if (game) {
      SeasonManager.updateStandingsAfterGame(
        seasonData,
        game.homeTeamId,
        game.awayTeamId,
        result.home_score,
        result.away_score
      )
    }

    // Update player stats
    _updatePlayerStatsFromBoxScore(seasonData, result.box_score, game?.homeTeamId, game?.awayTeamId)

    // Generate and persist news
    _generateNews(seasonData, game, result)

    // Save to IndexedDB
    await SeasonRepository.save({
      campaignId,
      year,
      ...seasonData,
    })

    // Mark for cloud sync
    useSyncStore().markDirty()
  }

  /**
   * Generate game news and evolution news, appending to seasonData.news.
   */
  function _generateNews(seasonData, game, result) {
    if (!game) return
    if (!seasonData.news) seasonData.news = []

    const homeTeam = { id: game.homeTeamId, name: result.home_team || game.homeTeamAbbreviation }
    const awayTeam = { id: game.awayTeamId, name: result.away_team || game.awayTeamAbbreviation }
    const gameDate = game.gameDate
    const newEvents = []

    // --- Game-level news ---

    const margin = Math.abs(result.home_score - result.away_score)
    const winnerIsHome = result.home_score > result.away_score

    // Blowout (margin >= 25)
    if (margin >= 25) {
      const winnerTeam = winnerIsHome ? homeTeam : awayTeam
      const loserTeam = winnerIsHome ? awayTeam : homeTeam
      const winnerScore = winnerIsHome ? result.home_score : result.away_score
      const loserScore = winnerIsHome ? result.away_score : result.home_score
      newEvents.push(NewsService.createBlowoutNews({ winnerTeam, loserTeam, winnerScore, loserScore, gameDate }))
    }

    // OT thriller
    if (result.quarter_scores?.home?.length > 4) {
      const overtimePeriods = result.quarter_scores.home.length - 4
      newEvents.push(NewsService.createOvertimeThrillerNews({
        homeTeam, awayTeam,
        homeScore: result.home_score,
        awayScore: result.away_score,
        overtimePeriods,
        gameDate,
      }))
    }

    // Big individual performance (30+ points)
    if (result.box_score) {
      for (const side of ['home', 'away']) {
        const sideTeam = side === 'home' ? homeTeam : awayTeam
        const opponent = side === 'home' ? awayTeam : homeTeam
        const teamWon = (side === 'home') === winnerIsHome
        for (const ps of (result.box_score[side] ?? [])) {
          const pts = ps.points ?? ps.pts ?? 0
          if (pts >= 30) {
            const player = {
              id: ps.player_id ?? ps.playerId,
              firstName: (ps.name ?? '').split(' ')[0],
              lastName: (ps.name ?? '').split(' ').slice(1).join(' '),
            }
            newEvents.push(NewsService.createBigPerformanceNews({
              player,
              team: sideTeam,
              opponent,
              stats: { points: pts, rebounds: ps.rebounds ?? 0, assists: ps.assists ?? 0 },
              teamWon,
              gameDate,
            }))
          }
        }
      }
    }

    // --- Evolution news ---
    if (result.evolution) {
      for (const teamKey of ['home', 'away']) {
        const evoNews = result.evolution[teamKey]?.news
        if (Array.isArray(evoNews)) {
          newEvents.push(...evoNews)
        }
      }
    }

    // Normalize and append
    for (const evt of newEvents) {
      if (!evt) continue
      seasonData.news.push({
        id: `news_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        event_type: evt.eventType ?? evt.event_type ?? 'general',
        headline: evt.headline ?? '',
        body: evt.body ?? '',
        date: evt.gameDate ?? evt.game_date ?? evt.date ?? game.gameDate,
        player_id: evt.playerId ?? evt.player_id ?? null,
        team_id: evt.teamId ?? evt.team_id ?? null,
      })
    }

    // Keep only the most recent 50 news items
    if (seasonData.news.length > 50) {
      seasonData.news = seasonData.news.slice(-50)
    }
  }

  // Getters
  const upcomingGames = computed(() =>
    games.value.filter(g => !g.is_complete).slice(0, 10)
  )

  const completedGames = computed(() =>
    games.value.filter(g => g.is_complete)
  )

  const userGames = computed(() =>
    games.value.filter(g => g.is_user_game)
  )

  const nextUserGame = computed(() =>
    userGames.value.find(g => !g.is_complete)
  )

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function fetchGames(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _loadedCampaignId.value === campaignId && games.value.length > 0) {
      return games.value
    }

    loading.value = true
    error.value = null
    try {
      const { year, userTeamId } = await _getCampaignContext(campaignId)
      const [schedule, teams] = await Promise.all([
        SeasonRepository.getSchedule(campaignId, year),
        TeamRepository.getAllForCampaign(campaignId),
      ])

      if (!schedule) {
        games.value = []
      } else {
        games.value = schedule.map(g => _normalizeGame(g, userTeamId, teams))
      }

      _loadedCampaignId.value = campaignId
      return games.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch games'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchGame(campaignId, gameId) {
    loading.value = true
    error.value = null
    try {
      const { year, userTeamId } = await _getCampaignContext(campaignId)
      const schedule = await SeasonRepository.getSchedule(campaignId, year)
      const game = schedule?.find(g => g.id === gameId)

      if (!game) throw new Error(`Game ${gameId} not found`)

      // Load full team objects for detailed view
      const teams = await TeamRepository.getAllForCampaign(campaignId)
      currentGame.value = _normalizeDetailedGame(game, userTeamId, teams)
      return currentGame.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch game'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function simulateGame(campaignId, gameId, mode = 'animated', year = null) {
    simulating.value = true
    error.value = null
    try {
      const { year: seasonYear, userTeamId, campaign } = await _getCampaignContext(campaignId)
      const effectiveYear = year || seasonYear

      // Load season data
      const seasonData = await SeasonRepository.get(campaignId, effectiveYear)
      if (!seasonData) throw new Error(`Season ${effectiveYear} not found`)

      const game = seasonData.schedule.find(g => g.id === gameId)
      if (!game) throw new Error(`Game ${gameId} not found in schedule`)

      const isUserGame = game.homeTeamId === userTeamId || game.awayTeamId === userTeamId

      // Load teams and players
      const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, game)

      // Run simulation via worker
      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()

      const generateAnimationData = isUserGame && mode === 'animated'
      const result = await worker.simulateGame(homeTeam, awayTeam, homePlayers, awayPlayers, {
        generateAnimationData,
        isLiveGame: false,
        userTeamId,
      })

      // Process post-game evolution
      const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
        userTeamId,
        difficulty: campaign.difficulty || 'pro',
        gameDate: game.gameDate,
      })
      result.evolution = evolution

      // Process rewards for user games
      let rewards = null
      if (isUserGame && result.animation_data) {
        const isHome = game.homeTeamId === userTeamId
        const didWin = isHome
          ? result.home_score > result.away_score
          : result.away_score > result.home_score
        rewards = processGameRewards({
          animationData: result.animation_data,
          isHome,
          didWin,
        })
        result.rewards = rewards
      }

      // Persist to IndexedDB
      await _persistGameResult(campaignId, effectiveYear, seasonData, gameId, result, isUserGame)

      // Save evolution changes to player records
      await _applyEvolutionToPlayers(evolution, game)

      // Store result
      simulationResult.value = result

      // Update game in list
      const index = games.value.findIndex(g => g.id === gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_complete: true,
          home_score: result.home_score,
          away_score: result.away_score,
        }
      }

      // Load teams for detailed currentGame
      const teams = await TeamRepository.getAllForCampaign(campaignId)
      currentGame.value = {
        ..._normalizeDetailedGame(game, userTeamId, teams),
        is_complete: true,
        home_score: result.home_score,
        away_score: result.away_score,
        box_score: result.box_score,
        quarter_scores: result.quarter_scores,
        play_by_play: result.play_by_play,
        animation_data: result.animation_data,
        evolution: result.evolution,
        rewards: result.rewards,
        upgrade_points_awarded: rewards?.tokens_awarded || null,
      }

      // Advance campaign date
      await _advanceDateIfNeeded(campaignId, game.gameDate)

      return result
    } catch (err) {
      error.value = err.message || 'Failed to simulate game'
      throw err
    } finally {
      simulating.value = false
    }
  }

  async function simulateDay(campaignId) {
    simulating.value = true
    error.value = null
    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)
      const currentDate = campaign.currentDate || '2025-10-21'

      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData) throw new Error(`Season ${year} not found`)

      // Find all games for today
      const todayGames = seasonData.schedule.filter(
        g => g.gameDate === currentDate && !g.isComplete
      )

      if (todayGames.length === 0) {
        return { message: 'No games to simulate today' }
      }

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()

      // Separate user game from AI games
      const userGame = todayGames.find(
        g => g.homeTeamId === userTeamId || g.awayTeamId === userTeamId
      )
      const aiGames = todayGames.filter(
        g => g.homeTeamId !== userTeamId && g.awayTeamId !== userTeamId
      )

      let userGameResult = null

      // Simulate user's game if present
      if (userGame) {
        const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, userGame)

        const result = await worker.simulateGame(homeTeam, awayTeam, homePlayers, awayPlayers, {
          generateAnimationData: false,
          userTeamId,
        })

        // Post-game evolution
        const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
          userTeamId,
          difficulty: campaign.difficulty || 'pro',
          gameDate: userGame.gameDate,
        })
        result.evolution = evolution

        await _persistGameResult(campaignId, year, seasonData, userGame.id, result, true)
        await _applyEvolutionToPlayers(evolution, userGame)

        userGameResult = {
          game_id: userGame.id,
          home_score: result.home_score,
          away_score: result.away_score,
          box_score: result.box_score,
        }

        // Update in games list
        const index = games.value.findIndex(g => g.id === userGame.id)
        if (index !== -1) {
          games.value[index] = {
            ...games.value[index],
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }
      }

      // Simulate AI games in bulk
      if (aiGames.length > 0) {
        await _simulateAiGamesBulk(campaignId, year, seasonData, aiGames, worker)
      }

      // Advance date
      await _advanceDateIfNeeded(campaignId, currentDate)

      return { userGameResult }
    } catch (err) {
      error.value = err.message || 'Failed to simulate day'
      throw err
    } finally {
      simulating.value = false
    }
  }

  function clearSimulationResult() {
    simulationResult.value = null
  }

  function clearCurrentGame() {
    currentGame.value = null
  }

  /**
   * Start a live quarter-by-quarter game simulation (Q1).
   * @param {Object} settings - Optional { home_lineup, away_lineup, offensive_style, defensive_style }
   */
  async function startLiveGame(campaignId, gameId, settings = null) {
    simulating.value = true
    isLiveSimulation.value = true
    currentSimQuarter.value = 0
    quarterAnimationData.value = []
    error.value = null

    try {
      const { year, userTeamId } = await _getCampaignContext(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData) throw new Error(`Season ${year} not found`)

      const game = seasonData.schedule.find(g => g.id === gameId)
      if (!game) throw new Error(`Game ${gameId} not found`)

      // Load teams and players
      const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, game)
      const teams = await TeamRepository.getAllForCampaign(campaignId)

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()

      // Start Q1 simulation
      const quarterResult = await worker.simulateQuarter({
        homeTeam,
        awayTeam,
        homePlayers,
        awayPlayers,
        options: {
          generateAnimationData: true,
          isLiveGame: true,
          userTeamId,
          ...(settings || {}),
        },
      })

      currentSimQuarter.value = 1

      // Store Q1 animation data
      quarterAnimationData.value.push({
        quarter: 1,
        possessions: quarterResult.animation_data.possessions,
        quarterEndIndex: quarterResult.animation_data.quarter_end_index,
      })

      // Persist in-progress state to IndexedDB so it survives navigation
      if (quarterResult.gameState) {
        await _saveInProgressState(campaignId, year, gameId, quarterResult.gameState, quarterResult.scores, 1)
      }

      // Update current game state
      currentGame.value = {
        ..._normalizeDetailedGame(game, userTeamId, teams),
        is_in_progress: true,
        home_score: quarterResult.scores.home,
        away_score: quarterResult.scores.away,
        box_score: quarterResult.box_score,
        quarter_scores: quarterResult.scores.quarterScores,
      }

      // Also update in games list so homepage shows in-progress state
      const index = games.value.findIndex(g => g.id === gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_in_progress: true,
          home_score: quarterResult.scores.home,
          away_score: quarterResult.scores.away,
          current_quarter: 1,
        }
      }

      // Simulate AI games for this day in background (non-blocking)
      _simulateAiGamesForDay(campaignId, year, game.gameDate, userTeamId)

      return quarterResult
    } catch (err) {
      error.value = err.message || 'Failed to start game'
      isLiveSimulation.value = false
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Continue a live game simulation (Q2+).
   * @param {Object} adjustments - Optional { home_lineup, offensive_style, defensive_style }
   */
  async function continueGame(campaignId, gameId, adjustments = null) {
    simulating.value = true
    error.value = null

    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()

      // Build params for the worker
      const params = { adjustments: adjustments || {} }

      // If the worker lost its state (user navigated away), restore from IndexedDB
      if (!isLiveSimulation.value) {
        const seasonData = await SeasonRepository.get(campaignId, year)
        const scheduleEntry = seasonData?.schedule?.find(g => g.id === gameId)
        const savedState = scheduleEntry?.savedGameState || null

        if (savedState) {
          params.resumeState = savedState
          // Load teams/players so the worker can fully restore context
          const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, scheduleEntry)
          params.homeTeam = homeTeam
          params.awayTeam = awayTeam
          params.homePlayers = homePlayers
          params.awayPlayers = awayPlayers
          params.options = {
            generateAnimationData: true,
            isLiveGame: true,
            userTeamId,
          }
          // Restore live simulation state in the store
          isLiveSimulation.value = true
        }
      }

      const quarterResult = await worker.simulateQuarter(params)

      currentSimQuarter.value = quarterResult.quarter

      // Append this quarter's animation data
      quarterAnimationData.value.push({
        quarter: quarterResult.quarter,
        possessions: quarterResult.animation_data.possessions,
        quarterEndIndex: quarterResult.animation_data.quarter_end_index,
      })

      if (quarterResult.isGameComplete) {
        // Game finished
        isLiveSimulation.value = false
        const result = quarterResult.result

        // Merge all quarter animation data for replay
        const allPossessions = quarterAnimationData.value.flatMap(q => q.possessions)
        const quarterEndIndices = quarterAnimationData.value.map(q => q.quarterEndIndex)

        // Process post-game evolution
        const seasonData = await SeasonRepository.get(campaignId, year)
        const game = seasonData.schedule.find(g => g.id === gameId)

        const [homePlayers, awayPlayers] = await Promise.all([
          PlayerRepository.getByTeam(campaignId, game.homeTeamId),
          PlayerRepository.getByTeam(campaignId, game.awayTeamId),
        ])

        const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
          userTeamId,
          difficulty: campaign.difficulty || 'pro',
          gameDate: game.gameDate,
        })
        result.evolution = evolution

        // Process rewards
        const isHome = game.homeTeamId === userTeamId
        const didWin = isHome
          ? result.home_score > result.away_score
          : result.away_score > result.home_score
        const rewards = processGameRewards({
          animationData: { possessions: allPossessions },
          isHome,
          didWin,
        })
        result.rewards = rewards

        // Persist game result and clear saved in-progress state
        await _persistGameResult(campaignId, year, seasonData, gameId, result, true)
        // Clean up the savedGameState from the schedule entry (already handled by _persistGameResult setting isComplete)
        const completedEntry = seasonData.schedule.find(g => g.id === gameId)
        if (completedEntry) {
          delete completedEntry.savedGameState
          completedEntry.isInProgress = false
          await SeasonRepository.save({ campaignId, year, ...seasonData })
        }

        // Save evolution changes to player records
        await _applyEvolutionToPlayers(evolution, game)

        const teams = await TeamRepository.getAllForCampaign(campaignId)

        currentGame.value = {
          ..._normalizeDetailedGame(game, userTeamId, teams),
          is_complete: true,
          is_in_progress: false,
          home_score: result.home_score,
          away_score: result.away_score,
          box_score: result.box_score,
          quarter_scores: result.quarter_scores,
          evolution: result.evolution,
          rewards: result.rewards,
          upgrade_points_awarded: rewards?.tokens_awarded || null,
          animation_data: {
            possessions: allPossessions,
            quarter_end_indices: quarterEndIndices,
            total_possessions: allPossessions.length,
          },
        }

        // Update game in list
        const listIndex = games.value.findIndex(g => g.id === gameId)
        if (listIndex !== -1) {
          games.value[listIndex] = {
            ...games.value[listIndex],
            is_complete: true,
            is_in_progress: false,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }

        // Advance campaign date
        await _advanceDateIfNeeded(campaignId, game.gameDate)

        return {
          ...quarterResult,
          // Keep backward-compatible fields
          year,
          standings: seasonData.standings,
          playerStats: seasonData.playerStats,
        }
      } else {
        // Game continues — mid-quarter update
        currentGame.value = {
          ...currentGame.value,
          home_score: quarterResult.scores.home,
          away_score: quarterResult.scores.away,
          box_score: quarterResult.box_score,
          quarter_scores: quarterResult.scores.quarterScores,
        }

        // Persist updated game state to IndexedDB so it survives navigation
        if (quarterResult.gameState) {
          await _saveInProgressState(campaignId, year, gameId, quarterResult.gameState, quarterResult.scores, quarterResult.quarter)
        }

        // Keep games list in sync with scores/quarter
        const idx = games.value.findIndex(g => g.id === gameId)
        if (idx !== -1) {
          games.value[idx] = {
            ...games.value[idx],
            is_in_progress: true,
            home_score: quarterResult.scores.home,
            away_score: quarterResult.scores.away,
            current_quarter: quarterResult.quarter,
          }
        }
      }

      return quarterResult
    } catch (err) {
      error.value = err.message || 'Failed to continue game'
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Sim an in-progress game to completion (skip remaining quarters).
   */
  async function simToEnd(campaignId, gameId) {
    simulating.value = true
    error.value = null

    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()

      // Load saved game state in case worker lost it (page navigation)
      const seasonCheck = await SeasonRepository.get(campaignId, year)
      const scheduleEntry = seasonCheck?.schedule?.find(g => g.id === gameId)
      const savedState = scheduleEntry?.savedGameState || null

      const finalResult = await worker.simToEnd(null, savedState)
      const result = finalResult.result || finalResult

      isLiveSimulation.value = false

      // Process post-game evolution
      const seasonData = await SeasonRepository.get(campaignId, year)
      const game = seasonData.schedule.find(g => g.id === gameId)

      const [homePlayers, awayPlayers] = await Promise.all([
        PlayerRepository.getByTeam(campaignId, game.homeTeamId),
        PlayerRepository.getByTeam(campaignId, game.awayTeamId),
      ])

      const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
        userTeamId,
        difficulty: campaign.difficulty || 'pro',
        gameDate: game.gameDate,
      })
      result.evolution = evolution

      // Process rewards
      const isHome = game.homeTeamId === userTeamId
      const didWin = isHome
        ? result.home_score > result.away_score
        : result.away_score > result.home_score
      const rewards = processGameRewards({
        animationData: result.animation_data || { possessions: [] },
        isHome,
        didWin,
      })
      result.rewards = rewards

      // Persist and clean up saved in-progress state
      await _persistGameResult(campaignId, year, seasonData, gameId, result, true)
      const completedEntry = seasonData.schedule.find(g => g.id === gameId)
      if (completedEntry) {
        delete completedEntry.savedGameState
        completedEntry.isInProgress = false
        await SeasonRepository.save({ campaignId, year, ...seasonData })
      }

      // Save evolution changes to player records
      await _applyEvolutionToPlayers(evolution, game)

      const teams = await TeamRepository.getAllForCampaign(campaignId)

      currentGame.value = {
        ..._normalizeDetailedGame(game, userTeamId, teams),
        is_complete: true,
        is_in_progress: false,
        home_score: result.home_score,
        away_score: result.away_score,
        box_score: result.box_score,
        quarter_scores: result.quarter_scores,
        evolution: result.evolution,
        rewards: result.rewards,
        upgrade_points_awarded: rewards?.tokens_awarded || null,
      }

      // Update game in list
      const listIndex = games.value.findIndex(g => g.id === gameId)
      if (listIndex !== -1) {
        games.value[listIndex] = {
          ...games.value[listIndex],
          is_complete: true,
          is_in_progress: false,
          home_score: result.home_score,
          away_score: result.away_score,
        }
      }

      // Advance campaign date
      await _advanceDateIfNeeded(campaignId, game.gameDate)

      return {
        result,
        rewards,
        upgrade_points_awarded: rewards?.tokens_awarded || null,
      }
    } catch (err) {
      error.value = err.message || 'Failed to sim to end'
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Clear live simulation state.
   */
  function clearLiveSimulation() {
    isLiveSimulation.value = false
    currentSimQuarter.value = 0
    quarterAnimationData.value = []
  }

  /**
   * Fetch preview data for simulating to the next user game.
   * Computed locally from schedule data.
   */
  async function fetchSimulateToNextGamePreview(campaignId) {
    loadingPreview.value = true
    error.value = null
    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)
      const currentDate = campaign.currentDate || '2025-10-21'
      const seasonData = await SeasonRepository.get(campaignId, year)

      if (!seasonData) {
        simulatePreview.value = null
        return null
      }

      const preview = SeasonManager.getSimulateToNextGamePreview(seasonData, userTeamId, currentDate)

      // Enrich preview with team objects so the modal can display team info
      if (preview?.nextUserGame) {
        const teams = await TeamRepository.getAllForCampaign(campaignId)
        const teamsById = {}
        for (const t of (teams || [])) teamsById[t.id] = t

        const game = preview.nextUserGame
        game.isHome = game.homeTeamId === userTeamId

        const enrichTeam = (t, fallbackAbbr) => {
          if (!t) return { abbreviation: fallbackAbbr, name: fallbackAbbr, color: '#666' }
          return { ...t, color: t.primary_color || t.color || '#666' }
        }
        game.homeTeam = enrichTeam(teamsById[game.homeTeamId], game.homeTeamAbbreviation)
        game.awayTeam = enrichTeam(teamsById[game.awayTeamId], game.awayTeamAbbreviation)
      }

      simulatePreview.value = preview
      return preview
    } catch (err) {
      error.value = err.message || 'Failed to fetch preview'
      throw err
    } finally {
      loadingPreview.value = false
    }
  }

  /**
   * Simulate all games up to and including the next user game.
   * @param {boolean} excludeUserGame - If true, only simulate games BEFORE user's game (for live play)
   */
  async function simulateToNextGame(campaignId, excludeUserGame = false) {
    simulating.value = true
    error.value = null
    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)
      const currentDate = campaign.currentDate || '2025-10-21'

      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData) throw new Error(`Season ${year} not found`)

      const preview = SeasonManager.getSimulateToNextGamePreview(seasonData, userTeamId, currentDate)
      if (!preview) {
        simulating.value = false
        return { message: 'No games to simulate' }
      }

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()
      const toastStore = useToastStore()

      // Collect all AI games to simulate
      const aiGames = []
      for (const [, dateGames] of Object.entries(preview.gamesByDate)) {
        for (const game of dateGames) {
          aiGames.push(game)
        }
      }

      // Also include the user's game if not excluded
      let userGameResult = null
      const nextUserGame = preview.nextUserGame

      if (!excludeUserGame && nextUserGame) {
        const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, nextUserGame)

        const result = await worker.simulateGame(homeTeam, awayTeam, homePlayers, awayPlayers, {
          generateAnimationData: false,
          userTeamId,
        })

        // Post-game evolution for user game
        const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
          userTeamId,
          difficulty: campaign.difficulty || 'pro',
          gameDate: nextUserGame.gameDate,
        })
        result.evolution = evolution

        const isHome = nextUserGame.homeTeamId === userTeamId
        const didWin = isHome
          ? result.home_score > result.away_score
          : result.away_score > result.home_score
        const rewards = processGameRewards({
          animationData: result.animation_data || { possessions: [] },
          isHome,
          didWin,
        })
        result.rewards = rewards

        await _persistGameResult(campaignId, year, seasonData, nextUserGame.id, result, true)
        await _applyEvolutionToPlayers(evolution, nextUserGame)

        userGameResult = {
          game_id: nextUserGame.id,
          home_team: homeTeam,
          away_team: awayTeam,
          home_score: result.home_score,
          away_score: result.away_score,
          box_score: result.box_score,
          evolution: result.evolution,
          rewards: result.rewards,
          is_user_home: isHome,
        }

        // Update in games list
        const index = games.value.findIndex(g => g.id === nextUserGame.id)
        if (index !== -1) {
          games.value[index] = {
            ...games.value[index],
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }

        // Update currentGame if it matches
        if (currentGame.value?.id === nextUserGame.id) {
          const teams = await TeamRepository.getAllForCampaign(campaignId)
          currentGame.value = {
            ...currentGame.value,
            ..._normalizeDetailedGame(nextUserGame, userTeamId, teams),
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
            box_score: result.box_score,
            evolution: result.evolution,
            rewards: result.rewards,
          }
        }
      }

      // Advance date to after the user's next game date
      // Must happen BEFORE backgroundSimulating goes false, otherwise the
      // CampaignHomeView watcher re-fetches campaign with the old date.
      const latestDate = nextUserGame?.gameDate || currentDate
      await _advanceDateIfNeeded(campaignId, latestDate)

      // Simulate AI games in bulk with progress
      if (aiGames.length > 0) {
        backgroundSimulating.value = true
        simulationProgress.value = { completed: 0, total: aiGames.length }
        const progressToastId = toastStore.showProgress('League games', 0, aiGames.length)

        try {
          await _simulateAiGamesBulk(campaignId, year, seasonData, aiGames, worker, (progress) => {
            simulationProgress.value = progress
            toastStore.updateProgress(progressToastId, progress.completed, progress.total)
          })
        } finally {
          toastStore.removeMinimalToast(progressToastId)
          backgroundSimulating.value = false
          simulationProgress.value = null
        }
      }

      simulating.value = false
      return { userGameResult }
    } catch (err) {
      error.value = err.message || 'Failed to simulate to next game'
      simulating.value = false
      backgroundSimulating.value = false
      simulationProgress.value = null
      throw err
    }
  }

  /**
   * Simulate all remaining regular season games after the user has finished their schedule.
   */
  async function simulateRemainingSeason(campaignId) {
    simulating.value = true
    error.value = null
    try {
      const { year, userTeamId, campaign } = await _getCampaignContext(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData) throw new Error(`Season ${year} not found`)

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()
      const toastStore = useToastStore()

      // Find all remaining unplayed games
      const remainingGames = seasonData.schedule.filter(g => !g.isComplete && !g.isPlayoff)

      if (remainingGames.length === 0) {
        simulating.value = false
        return { message: 'No remaining games to simulate' }
      }

      backgroundSimulating.value = true
      simulationProgress.value = { completed: 0, total: remainingGames.length }
      const progressToastId = toastStore.showProgress('Simulating season', 0, remainingGames.length)

      try {
        // Separate user games from AI games
        const userGames = remainingGames.filter(
          g => g.homeTeamId === userTeamId || g.awayTeamId === userTeamId
        )
        const aiGames = remainingGames.filter(
          g => g.homeTeamId !== userTeamId && g.awayTeamId !== userTeamId
        )

        let completedCount = 0

        // Simulate user games one by one (for evolution tracking)
        for (const game of userGames) {
          const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, game)
          const result = await worker.simulateGame(homeTeam, awayTeam, homePlayers, awayPlayers, {
            generateAnimationData: false,
            userTeamId,
          })
          const evolution = await worker.processPostGame(homePlayers, awayPlayers, result, {
            userTeamId,
            difficulty: campaign.difficulty || 'pro',
            gameDate: game.gameDate,
          })
          result.evolution = evolution
          await _persistGameResult(campaignId, year, seasonData, game.id, result, true)
          await _applyEvolutionToPlayers(evolution, game)

          completedCount++
          toastStore.updateProgress(progressToastId, completedCount, remainingGames.length)
          simulationProgress.value = { completed: completedCount, total: remainingGames.length }
        }

        // Simulate AI games in bulk
        if (aiGames.length > 0) {
          await _simulateAiGamesBulk(campaignId, year, seasonData, aiGames, worker, (progress) => {
            const total = remainingGames.length
            const completed = completedCount + progress.completed
            simulationProgress.value = { completed, total }
            toastStore.updateProgress(progressToastId, completed, total)
          })
        }

        // Advance date past the last game (before backgroundSimulating goes false)
        const lastGame = remainingGames[remainingGames.length - 1]
        if (lastGame) {
          await _advanceDateIfNeeded(campaignId, lastGame.gameDate)
        }
      } finally {
        toastStore.removeMinimalToast(progressToastId)
        backgroundSimulating.value = false
        simulationProgress.value = null
      }

      simulating.value = false
      return { completed: remainingGames.length }
    } catch (err) {
      error.value = err.message || 'Failed to simulate remaining season'
      simulating.value = false
      backgroundSimulating.value = false
      simulationProgress.value = null
      throw err
    }
  }

  /**
   * Clear the simulate preview state.
   */
  function clearSimulatePreview() {
    simulatePreview.value = null
  }

  function invalidate() {
    _loadedCampaignId.value = null
  }

  // ---------------------------------------------------------------------------
  // Internal: AI game bulk simulation
  // ---------------------------------------------------------------------------

  /**
   * Simulate a set of AI games in bulk, persist results, and report progress.
   */
  async function _simulateAiGamesBulk(campaignId, year, seasonData, aiGames, worker, onProgress = null) {
    // Get campaign difficulty for evolution processing
    const { campaign } = await _getCampaignContext(campaignId)

    // Prepare bulk game data
    const bulkGames = []
    for (const game of aiGames) {
      const { homeTeam, awayTeam, homePlayers, awayPlayers } = await _loadGameSimData(campaignId, game)
      bulkGames.push({
        gameId: game.id,
        homeTeam,
        awayTeam,
        homePlayers,
        awayPlayers,
        gameDate: game.gameDate,
        options: {
          generateAnimationData: false,
          isLiveGame: false,
        },
      })
    }

    // Run bulk simulation with evolution processing
    const bulkResult = await worker.simulateBulk(bulkGames, onProgress, {
      processEvolution: true,
      difficulty: campaign.difficulty || 'pro',
    })

    // Merge results into season data
    const results = (bulkResult.results || []).map(r => {
      const game = aiGames.find(g => g.id === r.gameId)
      return {
        gameId: r.gameId,
        homeTeamId: game?.homeTeamId,
        awayTeamId: game?.awayTeamId,
        homeScore: r.result.home_score,
        awayScore: r.result.away_score,
        boxScore: r.result.box_score,
        quarterScores: r.result.quarter_scores,
        isUserGame: false,
      }
    })

    SeasonManager.bulkMergeResults(seasonData, results)

    // Generate news for notable AI games
    for (const r of (bulkResult.results || [])) {
      const game = aiGames.find(g => g.id === r.gameId)
      if (game) {
        _generateNews(seasonData, game, r.result)
      }
    }

    // Save season data
    await SeasonRepository.save({
      campaignId,
      year,
      ...seasonData,
    })

    // Save evolved AI players to IndexedDB (recent_performances, fatigue, etc.)
    if (bulkResult.evolvedPlayers?.length > 0) {
      await PlayerRepository.saveBulk(bulkResult.evolvedPlayers)
    }

    // Mark for cloud sync
    useSyncStore().markDirty()

    // Update games list
    for (const result of results) {
      const index = games.value.findIndex(g => g.id === result.gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_complete: true,
          home_score: result.homeScore,
          away_score: result.awayScore,
        }
      }
    }
  }

  /**
   * Simulate AI games for a specific day in the background (fire-and-forget).
   * Used during live games to simulate same-day AI matchups.
   */
  async function _simulateAiGamesForDay(campaignId, year, gameDate, userTeamId) {
    try {
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData) return

      const aiGames = seasonData.schedule.filter(
        g => g.gameDate === gameDate && !g.isComplete &&
             g.homeTeamId !== userTeamId && g.awayTeamId !== userTeamId
      )

      if (aiGames.length === 0) return

      const engineStore = useEngineStore()
      const worker = engineStore.getWorker()
      const toastStore = useToastStore()

      backgroundSimulating.value = true
      simulationProgress.value = { completed: 0, total: aiGames.length }
      const progressToastId = toastStore.showProgress('League games', 0, aiGames.length)

      try {
        await _simulateAiGamesBulk(campaignId, year, seasonData, aiGames, worker, (progress) => {
          simulationProgress.value = progress
          toastStore.updateProgress(progressToastId, progress.completed, progress.total)
        })
      } finally {
        toastStore.removeMinimalToast(progressToastId)
        backgroundSimulating.value = false
        simulationProgress.value = null
      }
    } catch (err) {
      console.error('Failed to simulate AI games for day:', err)
      backgroundSimulating.value = false
      simulationProgress.value = null
    }
  }

  return {
    // State
    games,
    currentGame,
    simulationResult,
    loading,
    simulating,
    error,
    isLiveSimulation,
    currentSimQuarter,
    quarterAnimationData,
    simulatePreview,
    loadingPreview,
    // Background simulation state (kept for view compatibility)
    backgroundSimulating,
    simulationProgress,
    // Getters
    upcomingGames,
    completedGames,
    userGames,
    nextUserGame,
    // Actions
    fetchGames,
    fetchGame,
    simulateGame,
    simulateDay,
    startLiveGame,
    continueGame,
    simToEnd,
    clearSimulationResult,
    clearCurrentGame,
    clearLiveSimulation,
    fetchSimulateToNextGamePreview,
    simulateToNextGame,
    simulateRemainingSeason,
    clearSimulatePreview,
    invalidate,
  }
})
