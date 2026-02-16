/**
 * SimulationWorkerManager.js
 *
 * Main-thread promise-based API for communicating with the simulation Web Worker.
 * Provides: initialize(), simulateGame(), simulateQuarter(), simToEnd(),
 *           simulateBulk(games, onProgress), processPostGame(), processWeekly(),
 *           terminate().
 */

let messageIdCounter = 0

function nextId() {
  return ++messageIdCounter
}

export class SimulationWorkerManager {
  constructor() {
    this.worker = null
    this.pending = new Map() // id -> { resolve, reject }
    this.bulkProgressCallbacks = new Map() // id -> onProgress callback
    this.initialized = false
  }

  /**
   * Spawn the worker and initialize it with reference data.
   */
  async initialize(options = {}) {
    if (this.worker) {
      this.terminate()
    }

    this.worker = new Worker(
      new URL('./simulation.worker.js', import.meta.url),
      { type: 'module' }
    )

    this.worker.onmessage = (e) => this._handleMessage(e)
    this.worker.onerror = (e) => this._handleError(e)

    await this._send('INIT', {
      badgeDefinitions: options.badgeDefinitions || null,
      badgeSynergies: options.badgeSynergies || null,
    })

    this.initialized = true
  }

  /**
   * Simulate a full game (all quarters).
   * @param {Object} homeTeam - Home team data
   * @param {Object} awayTeam - Away team data
   * @param {Array} homePlayers - Home roster
   * @param {Array} awayPlayers - Away roster
   * @param {Object} options - { generateAnimationData, isLiveGame, userTeamId, ... }
   * @returns {Object} Full game result with box scores, play-by-play, animation data
   */
  async simulateGame(homeTeam, awayTeam, homePlayers, awayPlayers, options = {}) {
    return this._send('SIMULATE_GAME', {
      homeTeam,
      awayTeam,
      homePlayers,
      awayPlayers,
      options,
    })
  }

  /**
   * Start or continue a live game one quarter at a time.
   * First call starts the game (Q1). Subsequent calls continue with adjustments.
   * @param {Object} params - { homeTeam, awayTeam, homePlayers, awayPlayers, options, adjustments }
   * @returns {Object} Quarter result with scores, box score, animation data
   */
  async simulateQuarter(params) {
    return this._send('SIMULATE_QUARTER', params)
  }

  /**
   * Sim an in-progress game to completion (skip remaining quarters).
   * @param {Object} adjustments - Optional lineup/style adjustments
   * @returns {Object} Final game result
   */
  async simToEnd(adjustments = null, resumeState = null) {
    return this._send('SIM_TO_END', { adjustments, resumeState })
  }

  /**
   * Simulate multiple games in bulk with progress reporting.
   * @param {Array} games - Array of { gameId, homeTeam, awayTeam, homePlayers, awayPlayers, options, gameDate }
   * @param {Function} onProgress - Called with { completed, total, gameId } after each game
   * @param {Object} bulkOptions - { processEvolution, difficulty }
   * @returns {Object} { results: [{ gameId, result }], total, evolvedPlayers }
   */
  async simulateBulk(games, onProgress = null, bulkOptions = {}) {
    const id = nextId()

    if (onProgress) {
      this.bulkProgressCallbacks.set(id, onProgress)
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({
        type: 'SIMULATE_BULK',
        id,
        payload: {
          games,
          processEvolution: bulkOptions.processEvolution || false,
          difficulty: bulkOptions.difficulty || 'pro',
        },
      })
    }).finally(() => {
      this.bulkProgressCallbacks.delete(id)
    })
  }

  /**
   * Process post-game evolution for players after a game.
   * @param {Array} homePlayers
   * @param {Array} awayPlayers
   * @param {Object} gameResult
   * @param {Object} options
   * @returns {Object} Evolution results
   */
  async processPostGame(homePlayers, awayPlayers, gameResult, options = {}) {
    return this._send('PROCESS_POST_GAME', {
      homePlayers,
      awayPlayers,
      gameResult,
      options,
    })
  }

  /**
   * Process weekly evolution for all players.
   * @param {Array} players - All players
   * @param {Object} gameResults - Keyed by player ID
   * @param {string} difficulty
   * @param {number} week
   * @param {Object} options
   * @returns {Object} Evolution results
   */
  async processWeekly(players, gameResults = {}, difficulty = 'pro', week = 0, options = {}) {
    return this._send('PROCESS_WEEKLY', {
      players,
      gameResults,
      difficulty,
      week,
      options,
    })
  }

  /**
   * Process rest day recovery for players.
   * @param {Array} players
   * @param {Array} teamsWithGames - Team abbreviations that played today
   * @returns {Object} Updated players
   */
  async processRestDay(players, teamsWithGames = []) {
    return this._send('PROCESS_REST_DAY', { players, teamsWithGames })
  }

  /**
   * Process season-end evolution for all players.
   * @param {Array} players
   * @param {Object} seasonStats
   * @param {string} difficulty
   * @returns {Object} Season-end evolution results
   */
  async processSeasonEnd(players, seasonStats = {}, difficulty = 'pro') {
    return this._send('PROCESS_SEASON_END', { players, seasonStats, difficulty })
  }

  /**
   * Recalculate a single player's overall rating.
   * @param {Object} player
   * @returns {Object} { overall }
   */
  async recalculateOverall(player) {
    return this._send('RECALCULATE_OVERALL', { player })
  }

  /**
   * Terminate the worker and clean up.
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.initialized = false
    // Reject all pending promises
    for (const [id, { reject }] of this.pending) {
      reject(new Error('Worker terminated'))
    }
    this.pending.clear()
    this.bulkProgressCallbacks.clear()
  }

  /**
   * Check if the worker is ready.
   */
  get isReady() {
    return this.initialized && this.worker !== null
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _send(type, payload) {
    const id = nextId()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ type, id, payload })
    })
  }

  _handleMessage(e) {
    const { type, id, result, error, progress } = e.data

    switch (type) {
      case 'RESULT': {
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          pending.resolve(result)
        }
        break
      }
      case 'ERROR': {
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          pending.reject(new Error(error?.message || 'Worker error'))
        }
        break
      }
      case 'BULK_PROGRESS': {
        const callback = this.bulkProgressCallbacks.get(id)
        if (callback) {
          callback(e.data.progress)
        }
        break
      }
    }
  }

  _handleError(e) {
    console.error('[SimulationWorker] Unhandled error:', e)
    // Reject all pending promises on unhandled worker error
    for (const [id, { reject }] of this.pending) {
      reject(new Error(`Worker error: ${e.message}`))
    }
    this.pending.clear()
  }
}

// Export singleton instance
export const workerManager = new SimulationWorkerManager()
export default workerManager
