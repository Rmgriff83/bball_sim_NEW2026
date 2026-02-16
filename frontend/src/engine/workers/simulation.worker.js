/**
 * simulation.worker.js
 *
 * Web Worker entry point for running game simulations off the main thread.
 * Handles message types: INIT, SIMULATE_GAME, SIMULATE_QUARTER, SIMULATE_BULK, PROCESS_WEEKLY.
 *
 * All engine modules are imported here so heavy computation happens in the worker.
 * The main thread sends player/team data + config; the worker returns results.
 */

import GameSimulator from '../simulation/GameSimulator'
import {
  processPostGame,
  processWeeklyEvolution,
  processRestDayRecovery,
  processMultiDayRestRecovery,
  processSeasonEnd,
  recalculateOverall,
} from '../evolution/PlayerEvolution'
import { SeasonManager } from '../season/SeasonManager'
import { selectPlay } from '../simulation/PlayService'
import { BADGES } from '../data/badges'
import { SYNERGIES } from '../data/synergies'

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let simulator = null
let initialized = false
let liveGameState = null  // Stored game state for quarter-by-quarter flow

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async function (e) {
  const { type, id, payload } = e.data

  try {
    let result
    switch (type) {
      case 'INIT':
        result = handleInit(payload)
        break
      case 'SIMULATE_GAME':
        result = handleSimulateGame(payload)
        break
      case 'SIMULATE_QUARTER':
        result = handleSimulateQuarter(payload)
        break
      case 'SIM_TO_END':
        result = handleSimToEnd(payload)
        break
      case 'SIMULATE_BULK':
        result = await handleSimulateBulk(id, payload)
        break
      case 'PROCESS_POST_GAME':
        result = handleProcessPostGame(payload)
        break
      case 'PROCESS_WEEKLY':
        result = handleProcessWeekly(payload)
        break
      case 'PROCESS_REST_DAY':
        result = handleProcessRestDay(payload)
        break
      case 'PROCESS_SEASON_END':
        result = handleProcessSeasonEnd(payload)
        break
      case 'RECALCULATE_OVERALL':
        result = handleRecalculateOverall(payload)
        break
      default:
        throw new Error(`Unknown message type: ${type}`)
    }
    self.postMessage({ type: 'RESULT', id, result })
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      id,
      error: { message: error.message, stack: error.stack },
    })
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleInit(payload) {
  const { badgeDefinitions, badgeSynergies } = payload || {}
  simulator = new GameSimulator({
    badgeDefinitions: badgeDefinitions || BADGES,
    badgeSynergies: badgeSynergies || SYNERGIES,
  })
  initialized = true
  return { success: true }
}

function ensureInitialized() {
  if (!initialized || !simulator) {
    // Auto-init with defaults if not explicitly initialized
    handleInit({})
  }
}

/**
 * Full game simulation (all 4 quarters at once).
 * payload: { homeTeam, awayTeam, homePlayers, awayPlayers, options }
 */
function handleSimulateGame(payload) {
  ensureInitialized()
  const { homeTeam, awayTeam, homePlayers, awayPlayers, options } = payload

  // Attach players to team objects (simulator reads team.players)
  homeTeam.players = homePlayers || []
  awayTeam.players = awayPlayers || []

  const result = simulator.simulateGame(homeTeam, awayTeam, options || {})
  return result
}

/**
 * Start or continue a live game one quarter at a time.
 * payload: { homeTeam, awayTeam, homePlayers, awayPlayers, options, adjustments }
 *
 * First call: starts the game and simulates Q1.
 * Subsequent calls: applies adjustments and simulates the next quarter.
 */
function handleSimulateQuarter(payload) {
  ensureInitialized()
  const { homeTeam, awayTeam, homePlayers, awayPlayers, options, adjustments, resumeState } = payload

  // Restore game state from saved data if worker lost it (e.g. page navigation)
  if (!liveGameState && resumeState) {
    liveGameState = resumeState
  }

  if (!liveGameState) {
    // Start new game - simulate Q1
    // Attach players to team objects (simulator reads team.players)
    homeTeam.players = homePlayers || []
    awayTeam.players = awayPlayers || []

    const result = simulator.startGame(homeTeam, awayTeam, options || {})

    // Store game state for continuation
    liveGameState = result.gameState

    // Flatten: game.js expects quarterResult fields at top level
    // Return gameState so main thread can persist it
    return {
      ...result.quarterResult,
      gameState: result.gameState,
    }
  } else {
    // Continue existing game - apply adjustments and simulate next quarter
    const result = simulator.continueGame(liveGameState, adjustments || null)

    if (result.isComplete) {
      // Game finished - clear stored state
      liveGameState = null
      return {
        ...result.quarterResult,
        isGameComplete: true,
        result: result.finalResult,
      }
    } else {
      // Store updated state for next quarter
      liveGameState = result.gameState
      return {
        ...result.quarterResult,
        isGameComplete: false,
        gameState: result.gameState,
      }
    }
  }
}

/**
 * Sim an in-progress game to completion (skip remaining quarters).
 */
function handleSimToEnd(payload) {
  ensureInitialized()
  const { resumeState } = payload || {}

  // Restore game state from saved data if worker lost it
  if (!liveGameState && resumeState) {
    liveGameState = resumeState
  }

  if (!liveGameState) {
    throw new Error('No game in progress to sim to end')
  }

  const result = simulator.simToEnd(liveGameState)
  liveGameState = null  // Game is done

  return {
    ...result.quarterResult,
    isGameComplete: true,
    result: result.finalResult,
  }
}

/**
 * Simulate multiple games in bulk with progress reporting.
 * payload: {
 *   games: [{ gameId, homeTeam, awayTeam, homePlayers, awayPlayers, options, gameDate }],
 *   processEvolution: boolean,
 *   difficulty: string
 * }
 *
 * When processEvolution is true, runs post-game evolution for each game and
 * accumulates evolved player state across games. Returns evolvedPlayers map.
 */
async function handleSimulateBulk(messageId, payload) {
  ensureInitialized()
  const { games, processEvolution, difficulty } = payload
  const results = []
  const total = games.length

  // Track evolved player state across games (accumulates recent_performances, fatigue, etc.)
  const playerCache = processEvolution ? {} : null

  for (let i = 0; i < total; i++) {
    const game = games[i]

    // Create fresh simulator for each game to reset state
    const gameSim = new GameSimulator({
      badgeDefinitions: BADGES,
      badgeSynergies: SYNERGIES,
    })

    // Get rosters — use evolved versions if available
    const homePlayers = game.homePlayers || []
    const awayPlayers = game.awayPlayers || []
    const homeRoster = playerCache
      ? homePlayers.map(p => playerCache[p.id] || p)
      : homePlayers
    const awayRoster = playerCache
      ? awayPlayers.map(p => playerCache[p.id] || p)
      : awayPlayers

    // Attach players to team objects (simulator reads team.players)
    game.homeTeam.players = homeRoster
    game.awayTeam.players = awayRoster

    const result = gameSim.simulateGame(
      game.homeTeam,
      game.awayTeam,
      game.options || {}
    )

    // Process evolution inline if requested
    if (processEvolution) {
      const gameData = {
        homeTeamAbbreviation: result.home_team_abbreviation || game.homeTeam.abbreviation || '',
        awayTeamAbbreviation: result.away_team_abbreviation || game.awayTeam.abbreviation || '',
      }
      const evolution = processPostGame(
        gameData,
        result.home_score, result.away_score,
        result.box_score,
        homeRoster, awayRoster,
        difficulty || 'pro',
        false,
        game.gameDate || null
      )
      // Accumulate evolved player state
      for (const teamKey of ['home', 'away']) {
        const evolvedPlayers = evolution?.[teamKey]?.players
        if (evolvedPlayers) {
          for (const [id, p] of Object.entries(evolvedPlayers)) {
            playerCache[id] = p
          }
        }
      }
    }

    results.push({
      gameId: game.gameId,
      result,
    })

    // Send progress update every game
    self.postMessage({
      type: 'BULK_PROGRESS',
      id: messageId,
      progress: { completed: i + 1, total, gameId: game.gameId },
    })

    // Yield to allow progress messages to be sent
    if (i % 5 === 4) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  return {
    results,
    total,
    evolvedPlayers: playerCache ? Object.values(playerCache) : null,
  }
}

/**
 * Process post-game evolution for players.
 * payload: { homePlayers, awayPlayers, gameResult, options }
 *
 * Maps the flat payload into processPostGame's positional arguments:
 *   (gameData, homeScore, awayScore, boxScores, homeRoster, awayRoster, difficulty, isPlayoff, gameDate)
 */
function handleProcessPostGame(payload) {
  const { homePlayers, awayPlayers, gameResult, options } = payload

  const gameData = {
    homeTeamAbbreviation: gameResult.home_team_abbreviation || options?.homeTeamAbbreviation || '',
    awayTeamAbbreviation: gameResult.away_team_abbreviation || options?.awayTeamAbbreviation || '',
  }

  const homeScore = gameResult.home_score ?? gameResult.homeScore ?? 0
  const awayScore = gameResult.away_score ?? gameResult.awayScore ?? 0
  const boxScores = gameResult.box_score ?? gameResult.boxScore ?? { home: [], away: [] }
  const difficulty = options?.difficulty || 'pro'
  const isPlayoff = options?.isPlayoff || false
  const gameDate = options?.gameDate || gameResult.game_date || null

  return processPostGame(
    gameData,
    homeScore,
    awayScore,
    boxScores,
    homePlayers || [],
    awayPlayers || [],
    difficulty,
    isPlayoff,
    gameDate
  )
}

/**
 * Process weekly evolution for all players.
 * payload: { players, gameResults, difficulty, week, options }
 */
function handleProcessWeekly(payload) {
  const { players, gameResults, difficulty, week, options } = payload
  return processWeeklyEvolution(players, gameResults || {}, difficulty || 'pro', week || 0, options || {})
}

/**
 * Process rest day recovery for players.
 * payload: { players, teamsWithGames }
 */
function handleProcessRestDay(payload) {
  const { players, teamsWithGames } = payload
  return processRestDayRecovery(players, teamsWithGames || [])
}

/**
 * Process season end evolution for all players.
 * payload: { players, seasonStats, difficulty }
 */
function handleProcessSeasonEnd(payload) {
  const { players, seasonStats, difficulty } = payload
  return processSeasonEnd(players, seasonStats || {}, difficulty || 'pro')
}

/**
 * Recalculate a single player's overall rating.
 * payload: { player }
 */
function handleRecalculateOverall(payload) {
  const { player } = payload
  return { overall: recalculateOverall(player) }
}
