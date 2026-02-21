/**
 * GameSimulator.js
 *
 * Main game simulation orchestrator, translated from
 * backend/app/Services/GameSimulationService.php.
 *
 * All game logic and math preserved exactly from the PHP source.
 * Laravel-specific code (models, DB, DI, logging, events, queues) removed.
 *
 * Usage:
 *   const sim = new GameSimulator({ badgeDefinitions, badgeSynergies });
 *   const result = sim.simulateGame(homeTeam, awayTeam, options);
 */

import PlayExecutionEngine from './PlayExecutionEngine'
import { selectPlay } from './PlayService'
import { coachingEngine } from './CoachingEngine'
import { evaluateSubstitutions, applyVariance, getDefaultTargetMinutes } from './SubstitutionEngine'
import * as Config from '../config/GameConfig'
import { BADGES } from '../data/badges'
import { SYNERGIES } from '../data/synergies'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUARTERS = Config.QUARTERS // 4
const QUARTER_LENGTH_MINUTES = Config.QUARTER_LENGTH_MINUTES // 10
const SHOT_CLOCK_SECONDS = Config.SHOT_CLOCK_SECONDS // 24
const OVERTIME_LENGTH_MINUTES = Config.OVERTIME_LENGTH_MINUTES || 5

// ---------------------------------------------------------------------------
// Helper: build a badge definition lookup keyed by badge id
// ---------------------------------------------------------------------------

function buildBadgeDefinitionMap(badges) {
  const map = {}
  for (const badge of badges) {
    map[badge.id] = badge
  }
  return map
}

// ---------------------------------------------------------------------------
// GameSimulator class
// ---------------------------------------------------------------------------

class GameSimulator {
  /**
   * @param {Object} opts
   * @param {Array}  [opts.badgeDefinitions]  - Override badge definitions (default: built-in BADGES)
   * @param {Array}  [opts.badgeSynergies]    - Override badge synergies (default: built-in SYNERGIES)
   */
  constructor(opts = {}) {
    // Badge data
    this.badgeDefinitions = buildBadgeDefinitionMap(opts.badgeDefinitions || BADGES)
    this.badgeSynergies = opts.badgeSynergies || SYNERGIES

    // Play execution engine instance
    this.playEngine = new PlayExecutionEngine()

    // ---- Substitution state ----
    this.homeTargetMinutes = {}
    this.awayTargetMinutes = {}
    this.homeSubStrategy = 'staggered'
    this.awaySubStrategy = 'staggered'
    this.homeStarterIds = []
    this.awayStarterIds = []
    this.isLiveGame = false
    this.userTeamId = null

    // ---- Game state ----
    this.generateAnimationData = true
    this.homeBoxScore = {}
    this.awayBoxScore = {}
    this.playByPlay = []
    this.animationData = []
    this.homeScore = 0
    this.awayScore = 0
    this.currentQuarter = 1
    this.timeRemaining = 12.0
    this.quarterScores = { home: [], away: [] }
    this.possessionCount = 0
    this.quarterEndPossessions = []

    // ---- Team data ----
    this.homeTeam = null
    this.awayTeam = null
    this.homePlayers = []
    this.awayPlayers = []
    this.homeLineup = []
    this.awayLineup = []
    this.homeOffensiveScheme = 'balanced'
    this.awayOffensiveScheme = 'balanced'
    this.homeDefensiveScheme = 'man'
    this.awayDefensiveScheme = 'man'

    // ---- Clutch play tracking ----
    this.lastClutchPlay = null

    // ---- Synergy tracking ----
    this.homeSynergiesActivated = 0
    this.awaySynergiesActivated = 0

    // ---- Chemistry modifiers ----
    this.homeChemistryModifier = 0.0
    this.awayChemistryModifier = 0.0
  }

  // =========================================================================
  // PUBLIC: simulateGame  (full sim - no quarter breaks)
  // =========================================================================

  /**
   * Simulate a complete game.
   *
   * @param {Object} homeTeam  - { id, name, abbreviation, coaching_scheme, lineup_settings, players (roster array) }
   * @param {Object} awayTeam  - same shape as homeTeam
   * @param {Object} options
   * @param {string|null}  options.userTeamId            - The user's team id (for lineup / sub logic)
   * @param {Array|null}   options.userLineup            - Array of 5 player IDs for user's starting lineup
   * @param {boolean}      options.generateAnimationData - true for live mode, false for full sim (default true)
   * @param {boolean}      options.isLiveGame            - true if quarter-by-quarter (default false)
   * @returns {Object} Complete game result
   */
  simulateGame(homeTeam, awayTeam, options = {}) {
    this.initializeGameFromData(homeTeam, awayTeam, options)

    // Full sim: AI handles all substitutions
    this.isLiveGame = false

    let homeScoreAtQuarterStart = 0
    let awayScoreAtQuarterStart = 0

    // Simulate each quarter
    for (let quarter = 1; quarter <= QUARTERS; quarter++) {
      this.currentQuarter = quarter
      this.simulateQuarter()

      this.quarterEndPossessions.push(this.possessionCount)
      this.quarterScores.home.push(this.homeScore - homeScoreAtQuarterStart)
      this.quarterScores.away.push(this.awayScore - awayScoreAtQuarterStart)
      homeScoreAtQuarterStart = this.homeScore
      awayScoreAtQuarterStart = this.awayScore
    }

    // Overtime
    while (this.homeScore === this.awayScore) {
      this.currentQuarter++
      this.timeRemaining = OVERTIME_LENGTH_MINUTES
      this.simulateQuarter()

      this.quarterEndPossessions.push(this.possessionCount)
      this.quarterScores.home.push(this.homeScore - homeScoreAtQuarterStart)
      this.quarterScores.away.push(this.awayScore - awayScoreAtQuarterStart)
      homeScoreAtQuarterStart = this.homeScore
      awayScoreAtQuarterStart = this.awayScore
    }

    return this.finalizeGame()
  }

  // =========================================================================
  // PUBLIC: startGame  (quarter-by-quarter, returns Q1 + state)
  // =========================================================================

  /**
   * Start a new game and simulate the first quarter only.
   * Returns Q1 results and serialised state for continuation.
   *
   * @param {Object} homeTeam
   * @param {Object} awayTeam
   * @param {Object} options - same as simulateGame, plus coachingAdjustments
   * @returns {{ quarterResult: Object, gameState: Object }}
   */
  startGame(homeTeam, awayTeam, options = {}) {
    this.initializeGameFromData(homeTeam, awayTeam, options)
    this.isLiveGame = true

    if (options.coachingAdjustments) {
      this.applyAdjustments(options.coachingAdjustments)
    }

    if (!this.homeLineup.length || !this.awayLineup.length) {
      throw new Error(
        `Cannot simulate game: missing player lineup. ` +
        `Home lineup count: ${this.homeLineup.length}, ` +
        `Away lineup count: ${this.awayLineup.length}. ` +
        `Home players: ${this.homePlayers.length}, ` +
        `Away players: ${this.awayPlayers.length}.`
      )
    }

    const homeScoreAtQuarterStart = 0
    const awayScoreAtQuarterStart = 0

    this.currentQuarter = 1
    this.timeRemaining = QUARTER_LENGTH_MINUTES
    this.simulateQuarterOnly()

    this.quarterScores.home.push(this.homeScore - homeScoreAtQuarterStart)
    this.quarterScores.away.push(this.awayScore - awayScoreAtQuarterStart)
    this.quarterEndPossessions.push(this.possessionCount)

    return {
      quarterResult: this.buildQuarterResult(1),
      gameState: this.serializeState(),
    }
  }

  // =========================================================================
  // PUBLIC: continueGame  (next quarter from serialised state)
  // =========================================================================

  /**
   * Continue a game from saved state, simulate the next quarter.
   *
   * @param {Object} gameState - previously serialised state
   * @param {Object|null} adjustments - optional lineup/coaching adjustments
   * @returns {{ quarterResult, gameState, isComplete, finalResult }}
   */
  continueGame(gameState, adjustments = null) {
    this.deserializeState(gameState)
    this.applyAdjustments(adjustments)

    const nextQuarter = (gameState.completedQuarters || []).length + 1
    const homeScoreAtQuarterStart = this.homeScore
    const awayScoreAtQuarterStart = this.awayScore

    this.currentQuarter = nextQuarter
    this.timeRemaining = nextQuarter <= 4 ? QUARTER_LENGTH_MINUTES : OVERTIME_LENGTH_MINUTES

    this.simulateQuarterOnly()

    this.quarterScores.home.push(this.homeScore - homeScoreAtQuarterStart)
    this.quarterScores.away.push(this.awayScore - awayScoreAtQuarterStart)
    this.quarterEndPossessions.push(this.possessionCount)

    const isComplete = this.isGameComplete()

    return {
      quarterResult: this.buildQuarterResult(nextQuarter),
      gameState: isComplete ? null : this.serializeState(),
      isComplete,
      finalResult: isComplete ? this.buildFinalResult() : null,
    }
  }

  // =========================================================================
  // PUBLIC: simToEnd  (finish an in-progress game)
  // =========================================================================

  /**
   * Simulate the remainder of an in-progress game to completion.
   *
   * @param {Object} gameState
   * @returns {{ quarterResult, gameState, isComplete, finalResult }}
   */
  simToEnd(gameState) {
    let state = gameState
    let result
    while (true) {
      result = this.continueGame(state)
      if (result.isComplete) return result
      state = result.gameState
    }
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  /**
   * Initialize game state from team data objects.
   *
   * @param {Object} homeTeam - { id, name, abbreviation, coaching_scheme, lineup_settings, players }
   * @param {Object} awayTeam
   * @param {Object} options
   */
  initializeGameFromData(homeTeam, awayTeam, options = {}) {
    this.homeTeam = homeTeam
    this.awayTeam = awayTeam
    this.lastClutchPlay = null
    this.generateAnimationData = options.generateAnimationData !== false
    this.userTeamId = options.userTeamId || null

    // Accept userLineup directly, or home_lineup/away_lineup from game settings
    let userLineup = options.userLineup || null
    if (!userLineup && this.userTeamId) {
      if (homeTeam.id === this.userTeamId && options.home_lineup) {
        userLineup = options.home_lineup
      } else if (awayTeam.id === this.userTeamId && options.away_lineup) {
        userLineup = options.away_lineup
      }
    }

    // Load & normalize rosters
    let homeRoster = (homeTeam.players || []).map(p => this.normalizePlayerForSimulation(p))
    let awayRoster = (awayTeam.players || []).map(p => this.normalizePlayerForSimulation(p))

    // Sort by overall rating descending
    homeRoster.sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
    awayRoster.sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))

    this.homePlayers = homeRoster
    this.awayPlayers = awayRoster

    // Determine if user's team is home or away
    const isUserHomeTeam = this.userTeamId && homeTeam.id === this.userTeamId
    const isUserAwayTeam = this.userTeamId && awayTeam.id === this.userTeamId

    // Build lineups
    if (isUserHomeTeam && userLineup && userLineup.length >= 5) {
      this.homeLineup = this.buildLineupFromIds(userLineup, this.homePlayers)
    } else if (!isUserHomeTeam && homeTeam.lineup_settings && homeTeam.lineup_settings.starters && homeTeam.lineup_settings.starters.length >= 5) {
      this.homeLineup = this.buildLineupFromIds(homeTeam.lineup_settings.starters, this.homePlayers)
    } else {
      this.homeLineup = this.selectLineup(this.homePlayers)
    }

    if (isUserAwayTeam && userLineup && userLineup.length >= 5) {
      this.awayLineup = this.buildLineupFromIds(userLineup, this.awayPlayers)
    } else if (!isUserAwayTeam && awayTeam.lineup_settings && awayTeam.lineup_settings.starters && awayTeam.lineup_settings.starters.length >= 5) {
      this.awayLineup = this.buildLineupFromIds(awayTeam.lineup_settings.starters, this.awayPlayers)
    } else {
      this.awayLineup = this.selectLineup(this.awayPlayers)
    }

    // Reset and initialize box scores
    this.homeBoxScore = {}
    this.awayBoxScore = {}
    for (const player of this.homePlayers) {
      this.homeBoxScore[player.id] = this.emptyStatLine(player)
    }
    for (const player of this.awayPlayers) {
      this.awayBoxScore[player.id] = this.emptyStatLine(player)
    }

    this.homeScore = 0
    this.awayScore = 0
    this.playByPlay = []
    this.animationData = []
    this.quarterScores = { home: [], away: [] }
    this.possessionCount = 0
    this.quarterEndPossessions = []
    this.homeSynergiesActivated = 0
    this.awaySynergiesActivated = 0

    // Coaching schemes
    const homeScheme = homeTeam.coaching_scheme || {}
    const awayScheme = awayTeam.coaching_scheme || {}
    this.homeOffensiveScheme = homeScheme.offensive || 'balanced'
    this.homeDefensiveScheme = homeScheme.defensive || 'man'
    this.awayOffensiveScheme = awayScheme.offensive || 'balanced'
    this.awayDefensiveScheme = awayScheme.defensive || 'man'

    // Record starter IDs
    this.homeStarterIds = this.homeLineup.map(p => p.id)
    this.awayStarterIds = this.awayLineup.map(p => p.id)

    // Load target minutes
    this.homeTargetMinutes = this.loadTargetMinutes(
      homeTeam, isUserHomeTeam, options, this.homePlayers, this.homeStarterIds
    )
    this.awayTargetMinutes = this.loadTargetMinutes(
      awayTeam, isUserAwayTeam, options, this.awayPlayers, this.awayStarterIds
    )

    // Substitution strategies
    this.homeSubStrategy = homeScheme.substitution || 'staggered'
    this.awaySubStrategy = awayScheme.substitution || 'staggered'

    // Apply variance so minutes differ game-to-game
    // Skip variance for user team when they've explicitly set target minutes
    if (!(isUserHomeTeam && options.targetMinutes)) {
      this.homeTargetMinutes = applyVariance(this.homeTargetMinutes)
    }
    if (!(isUserAwayTeam && options.targetMinutes)) {
      this.awayTargetMinutes = applyVariance(this.awayTargetMinutes)
    }

    // Calculate team chemistry modifiers from roster morale
    const homeAvgMorale = this.averageMorale(this.homePlayers)
    const awayAvgMorale = this.averageMorale(this.awayPlayers)
    this.homeChemistryModifier = this.calculateChemistryModifier(homeAvgMorale)
    this.awayChemistryModifier = this.calculateChemistryModifier(awayAvgMorale)
  }

  // =========================================================================
  // TARGET MINUTES
  // =========================================================================

  /**
   * Load target minutes for a team from the appropriate source.
   */
  loadTargetMinutes(team, isUserTeam, options, players, starterIds) {
    let targetMinutes = {}

    if (isUserTeam && options.targetMinutes) {
      targetMinutes = options.targetMinutes
    } else if (team.lineup_settings && team.lineup_settings.target_minutes) {
      targetMinutes = team.lineup_settings.target_minutes
    }

    // Fallback to defaults if empty
    if (!targetMinutes || Object.keys(targetMinutes).length === 0) {
      targetMinutes = getDefaultTargetMinutes(players, starterIds)
    }

    return targetMinutes
  }

  // =========================================================================
  // LINEUP SELECTION
  // =========================================================================

  /**
   * Select starting lineup by position.
   */
  selectLineup(players) {
    const lineup = {}
    const usedPlayerIds = []
    const positions = ['PG', 'SG', 'SF', 'PF', 'C']

    // Filter to healthy players first, fall back to all if not enough healthy
    const healthy = players.filter(p => !this._isInjured(p))
    const pool = healthy.length >= 5 ? healthy : players

    for (const pos of positions) {
      for (const player of pool) {
        const playerId = player.id || null
        if (
          !lineup[pos] &&
          !usedPlayerIds.includes(playerId) &&
          (player.position === pos || player.secondary_position === pos)
        ) {
          lineup[pos] = player
          usedPlayerIds.push(playerId)
          break
        }
      }
    }

    // Fill remaining positions with best available
    for (const pos of positions) {
      if (!lineup[pos]) {
        for (const player of pool) {
          const playerId = player.id || null
          if (!usedPlayerIds.includes(playerId)) {
            lineup[pos] = player
            usedPlayerIds.push(playerId)
            break
          }
        }
      }
    }

    return Object.values(lineup)
  }

  /**
   * Build a lineup from an array of player IDs.
   * Falls back to selectLineup() if the lineup can't be fully built.
   */
  buildLineupFromIds(playerIds, allPlayers) {
    const positions = ['PG', 'SG', 'SF', 'PF', 'C']
    const playerMap = {}
    for (const player of allPlayers) {
      playerMap[player.id] = player
    }

    const lineup = []
    const usedIds = new Set()

    for (let index = 0; index < playerIds.length; index++) {
      const id = playerIds[index]
      if (!playerMap[id]) {
        // Player not found - fall back to auto-selection
        return this.selectLineup(allPlayers)
      }

      const player = playerMap[id]
      const requiredPosition = positions[index] || null

      if (requiredPosition) {
        const primaryPos = player.position || null
        const secondaryPos = player.secondary_position || null

        if (primaryPos !== requiredPosition && secondaryPos !== requiredPosition) {
          console.warn(`Lineup validation failed: ${player.first_name} cannot play ${requiredPosition}`)
          return this.selectLineup(allPlayers)
        }
      }

      // If starter is injured, find a healthy replacement who can play the position
      if (this._isInjured(player)) {
        const replacement = this._findHealthyReplacement(allPlayers, usedIds, playerIds, requiredPosition)
        if (replacement) {
          lineup.push(replacement)
          usedIds.add(replacement.id)
          continue
        }
        // No healthy replacement available — use injured player as last resort
      }

      lineup.push(player)
      usedIds.add(player.id)
    }

    if (lineup.length < 5) {
      return this.selectLineup(allPlayers)
    }

    return lineup
  }

  _isInjured(player) {
    return player.is_injured ?? player.isInjured ?? false
  }

  _findHealthyReplacement(allPlayers, usedIds, starterIds, requiredPosition) {
    // Build set of starter IDs to exclude
    const starterSet = new Set(starterIds)

    // Look for bench players who can play the position, sorted by rating (allPlayers is pre-sorted)
    for (const player of allPlayers) {
      if (usedIds.has(player.id) || starterSet.has(player.id)) continue
      if (this._isInjured(player)) continue

      if (!requiredPosition) return player

      const primary = player.position || null
      const secondary = player.secondary_position || null
      if (primary === requiredPosition || secondary === requiredPosition) {
        return player
      }
    }

    // No position match found — return best available healthy bench player
    for (const player of allPlayers) {
      if (usedIds.has(player.id) || starterSet.has(player.id)) continue
      if (this._isInjured(player)) continue
      return player
    }

    return null
  }

  /**
   * Rebuild lineup array from player IDs.
   */
  rebuildLineupFromIds(playerIds, players) {
    const playerMap = {}
    for (const player of players) {
      playerMap[player.id] = player
    }

    const lineup = []
    for (const id of playerIds) {
      if (playerMap[id]) {
        lineup.push(playerMap[id])
      }
    }
    return lineup
  }

  // =========================================================================
  // QUARTER SIMULATION
  // =========================================================================

  /**
   * Simulate a single quarter.
   */
  simulateQuarter() {
    this.timeRemaining = this.currentQuarter <= 4 ? QUARTER_LENGTH_MINUTES : OVERTIME_LENGTH_MINUTES
    let possessionTeam = Math.random() < 0.5 ? 'home' : 'away'
    let minutesSinceLastRotation = 0

    while (this.timeRemaining > 0) {
      // Realistic possession time: 10-24 seconds = 0.17 to 0.4 minutes
      let possessionTime = (Math.floor(Math.random() * 15) + 10) / 60

      if (possessionTime > this.timeRemaining) {
        possessionTime = this.timeRemaining
      }

      const gotOreb = this.simulatePossession(possessionTeam, possessionTime)
      this.timeRemaining -= possessionTime
      minutesSinceLastRotation += possessionTime

      // Switch possession (unless offensive rebound)
      if (!gotOreb) {
        possessionTeam = possessionTeam === 'home' ? 'away' : 'home'
      }

      // Rotate players every ~2 minutes of game time
      if (minutesSinceLastRotation >= 2) {
        this.rotatePlayers()
        minutesSinceLastRotation = 0
      }
    }
  }

  /**
   * Simulate a single quarter without resetting timeRemaining.
   * timeRemaining and currentQuarter must be set before calling.
   */
  simulateQuarterOnly() {
    let possessionTeam = Math.random() < 0.5 ? 'home' : 'away'
    let minutesSinceLastRotation = 0

    while (this.timeRemaining > 0) {
      let possessionTime = (Math.floor(Math.random() * 15) + 10) / 60

      if (possessionTime > this.timeRemaining) {
        possessionTime = this.timeRemaining
      }

      const gotOreb = this.simulatePossession(possessionTeam, possessionTime)
      this.timeRemaining -= possessionTime
      minutesSinceLastRotation += possessionTime

      if (!gotOreb) {
        possessionTeam = possessionTeam === 'home' ? 'away' : 'home'
      }

      if (minutesSinceLastRotation >= 2) {
        this.rotatePlayers()
        minutesSinceLastRotation = 0
      }
    }
  }

  // =========================================================================
  // POSSESSION SIMULATION
  // =========================================================================

  /**
   * Simulate a single possession using play-based system.
   * Returns true if offensive rebound occurred (team keeps possession).
   */
  simulatePossession(team, duration) {
    const isHome = team === 'home'
    const offense = isHome ? this.homeLineup : this.awayLineup
    const defense = isHome ? this.awayLineup : this.homeLineup
    const offensiveScheme = isHome ? this.homeOffensiveScheme : this.awayOffensiveScheme
    const defensiveScheme = isHome ? this.awayDefensiveScheme : this.homeDefensiveScheme

    // Update minutes for active players
    for (const player of offense) {
      const playerId = player.id || null
      if (playerId) {
        if (isHome && this.homeBoxScore[playerId]) {
          this.homeBoxScore[playerId].minutes += duration
        } else if (!isHome && this.awayBoxScore[playerId]) {
          this.awayBoxScore[playerId].minutes += duration
        }
      }
    }
    for (const defPlayer of defense) {
      const defPlayerId = defPlayer.id || null
      if (defPlayerId) {
        if (isHome && this.awayBoxScore[defPlayerId]) {
          this.awayBoxScore[defPlayerId].minutes += duration
        } else if (!isHome && this.homeBoxScore[defPlayerId]) {
          this.homeBoxScore[defPlayerId].minutes += duration
        }
      }
    }

    this.possessionCount++

    // Determine if this is a transition opportunity
    const transitionFreq = coachingEngine.getTransitionFrequency(offensiveScheme)
    const isTransition = transitionFreq > Math.random()

    // Select a play based on team, scheme, and game situation
    const context = {
      isTransition,
      shotClock: SHOT_CLOCK_SECONDS,
      scoreDifferential: isHome
        ? this.homeScore - this.awayScore
        : this.awayScore - this.homeScore,
      quarter: this.currentQuarter,
      timeRemaining: this.timeRemaining,
      defensiveScheme,
    }

    const play = selectPlay(offense, defense, offensiveScheme, context)

    // Calculate defensive modifiers based on scheme and play
    const defensiveModifiers = coachingEngine.calculateDefensiveModifiers(defensiveScheme, play)

    // Execute the play with defensive context
    const playResult = this.playEngine.executePlay(play, offense, defense, defensiveScheme, defensiveModifiers)

    // Calculate synergies for this possession
    let activatedSynergies = []
    if (playResult.shotAttempt) {
      const shooterId = playResult.shotAttempt.shooter || null
      let shooter = null
      for (const player of offense) {
        if ((player.id || null) === shooterId) {
          shooter = player
          break
        }
      }
      if (shooter) {
        const shotType = (() => {
          switch (playResult.shotAttempt.shotType || 'paint') {
            case 'threePoint': return 'three_pointer'
            case 'midRange': return 'mid_range'
            default: return 'paint'
          }
        })()
        const synergyResult = this.calculateSynergyBoostWithActivations(shooter, offense, shotType)
        activatedSynergies = synergyResult.activatedSynergies

        // Track synergies by team for rewards
        if (activatedSynergies.length > 0) {
          if (isHome) {
            this.homeSynergiesActivated += activatedSynergies.length
          } else {
            this.awaySynergiesActivated += activatedSynergies.length
          }
        }
      }
    }
    playResult.activatedSynergies = activatedSynergies

    // Process play result and update stats
    const gotOffensiveRebound = this.processPlayResult(playResult, offense, defense, isHome)

    // Record play-by-play and animation data (skip for AI-only games)
    if (this.generateAnimationData) {
      this.recordPlayByPlay(playResult, team)

      if (playResult.keyframes && playResult.keyframes.length > 0) {
        this.animationData.push({
          possession_id: this.possessionCount,
          team,
          quarter: this.currentQuarter,
          time: this.timeRemaining,
          play_id: playResult.playId,
          play_name: playResult.playName,
          duration: playResult.duration,
          keyframes: playResult.keyframes,
          home_score: this.homeScore,
          away_score: this.awayScore,
          box_score: {
            home: Object.values(this.homeBoxScore).map(s => this.formatBoxScoreStats(s)),
            away: Object.values(this.awayBoxScore).map(s => this.formatBoxScoreStats(s)),
          },
          activated_badges: playResult.activatedBadges || [],
          activated_synergies: playResult.activatedSynergies || [],
        })
      }
    }

    return gotOffensiveRebound
  }

  // =========================================================================
  // PLAY RESULT PROCESSING
  // =========================================================================

  /**
   * Process play result and update box scores.
   * Returns true if an offensive rebound occurred (offense keeps possession).
   */
  processPlayResult(playResult, offense, defense, isHome) {
    const outcome = playResult.outcome
    const points = playResult.points || 0
    const shotAttempt = playResult.shotAttempt || null
    const freeThrows = playResult.freeThrows || null

    // Store scores before update for clutch play tracking
    const prevHomeScore = this.homeScore
    const prevAwayScore = this.awayScore

    // Update score
    if (isHome) {
      this.homeScore += points
    } else {
      this.awayScore += points
    }

    // Track clutch plays in final 2 minutes (for game-winner news)
    if (points > 0 && this.timeRemaining < 2.0 && this.currentQuarter >= 4) {
      const wasTied = prevHomeScore === prevAwayScore
      const nowTied = this.homeScore === this.awayScore
      const leadChanged = (prevHomeScore > prevAwayScore) !== (this.homeScore > this.awayScore)
      const margin = Math.abs(this.homeScore - this.awayScore)

      if ((wasTied || leadChanged || !nowTied) && margin <= 3) {
        let shooter = null
        let shotType = 'shot'
        if (shotAttempt) {
          const shooterId = shotAttempt.shooter || null
          if (shooterId) {
            for (const player of offense) {
              if ((player.id || null) === shooterId) {
                shooter = player
                break
              }
            }
          }
          switch (shotAttempt.shotType || 'midRange') {
            case 'threePoint': shotType = 'three-pointer'; break
            case 'layup':
            case 'dunk': shotType = 'layup'; break
            default: shotType = 'jumper'; break
          }
        }

        if (shooter) {
          this.lastClutchPlay = {
            player: shooter,
            shotType,
            isHomeTeam: isHome,
            points,
          }
        }
      }
    }

    // Process shot attempt
    if (shotAttempt) {
      const shooterId = shotAttempt.shooter
      let boxScore = isHome ? this.homeBoxScore : this.awayBoxScore

      if (boxScore[shooterId]) {
        boxScore[shooterId].fieldGoalsAttempted++
        boxScore[shooterId].points += shotAttempt.points || 0

        if (shotAttempt.made) {
          boxScore[shooterId].fieldGoalsMade++
        }

        if (shotAttempt.shotType === 'threePoint') {
          boxScore[shooterId].threePointersAttempted++
          if (shotAttempt.made) {
            boxScore[shooterId].threePointersMade++
          }
        }

        // Assign assist -- chemistry boosts ball movement
        const chemMod = isHome ? this.homeChemistryModifier : this.awayChemistryModifier
        const assistPct = 65 * (1 + chemMod)
        if (shotAttempt.made && Math.floor(Math.random() * 100) + 1 <= assistPct) {
          for (const player of offense) {
            const playerId = player.id || null
            if (playerId && playerId !== shooterId && boxScore[playerId]) {
              boxScore[playerId].assists++
              break
            }
          }
        }

        // Save back
        if (isHome) {
          this.homeBoxScore = boxScore
        } else {
          this.awayBoxScore = boxScore
        }
      }
    }

    // Process free throws
    if (freeThrows) {
      const shooterId = shotAttempt ? shotAttempt.shooter : null
      let boxScore = isHome ? this.homeBoxScore : this.awayBoxScore

      if (shooterId && boxScore[shooterId]) {
        boxScore[shooterId].freeThrowsAttempted += freeThrows.attempted
        boxScore[shooterId].freeThrowsMade += freeThrows.made
        boxScore[shooterId].points += freeThrows.made

        if (isHome) {
          this.homeScore += freeThrows.made
          this.homeBoxScore = boxScore
        } else {
          this.awayScore += freeThrows.made
          this.awayBoxScore = boxScore
        }
      }
    }

    // Handle turnover
    if (outcome === 'turnover') {
      const ballHandlerRoles = ['ballHandler', 'point', 'passer']
      let turnoverPlayerId = null

      const roleAssignments = playResult.roleAssignments || {}
      for (const role of Object.keys(roleAssignments)) {
        if (ballHandlerRoles.includes(role)) {
          turnoverPlayerId = roleAssignments[role]
          break
        }
      }

      let boxScore = isHome ? this.homeBoxScore : this.awayBoxScore
      if (turnoverPlayerId && boxScore[turnoverPlayerId]) {
        boxScore[turnoverPlayerId].turnovers++
        if (isHome) {
          this.homeBoxScore = boxScore
        } else {
          this.awayBoxScore = boxScore
        }
      }

      // Chance of steal -- opposing chemistry boosts steal rate
      const defChem = isHome ? this.awayChemistryModifier : this.homeChemistryModifier
      if (Math.floor(Math.random() * 100) + 1 <= (60 * (1 + defChem)) && defense.length > 0) {
        const stealer = defense[Math.floor(Math.random() * defense.length)]
        const stealerId = stealer.id || null
        if (stealerId) {
          if (isHome && this.awayBoxScore[stealerId]) {
            this.awayBoxScore[stealerId].steals++
          } else if (!isHome && this.homeBoxScore[stealerId]) {
            this.homeBoxScore[stealerId].steals++
          }
        }
      }
    }

    // Handle rebound on miss
    let gotOffensiveRebound = false
    if (outcome === 'missed' || outcome === 'offensive_rebound') {
      gotOffensiveRebound = this.handleRebound(offense, defense, isHome)
    }

    // Handle block
    if (shotAttempt && shotAttempt.blocked) {
      const blocker = this.selectBlocker(defense)
      const blockerId = blocker.id || null
      if (blockerId) {
        if (isHome && this.awayBoxScore[blockerId]) {
          this.awayBoxScore[blockerId].blocks++
        } else if (!isHome && this.homeBoxScore[blockerId]) {
          this.homeBoxScore[blockerId].blocks++
        }
      }
    }

    return gotOffensiveRebound
  }

  // =========================================================================
  // REBOUNDS
  // =========================================================================

  /**
   * Handle rebound after a missed shot.
   * Returns true if offensive rebound (offense keeps possession).
   */
  handleRebound(offense, defense, isHome) {
    let offBoxScore = isHome ? this.homeBoxScore : this.awayBoxScore
    let defBoxScore = isHome ? this.awayBoxScore : this.homeBoxScore

    // Position multipliers for rebounding opportunity
    const posMult = { C: 1.8, PF: 1.5, SF: 1.1, SG: 0.8, PG: 0.6 }

    // Calculate team offensive rebounding strength
    let offRebTotal = 0
    for (const player of offense) {
      const orebAttr = (player.attributes && player.attributes.defense && player.attributes.defense.offensiveRebound) || 40
      const mult = posMult[player.position] || 1.0
      offRebTotal += orebAttr * mult
    }

    // Calculate team defensive rebounding strength
    let defRebTotal = 0
    for (const player of defense) {
      const drebAttr = (player.attributes && player.attributes.defense && player.attributes.defense.defensiveRebound) || 50
      const mult = posMult[player.position] || 1.0
      defRebTotal += drebAttr * mult
    }

    // Defense has inherent positioning advantage (box out)
    const defAdvantage = 2.5
    let totalWeighted = offRebTotal + defRebTotal * defAdvantage
    if (totalWeighted <= 0) totalWeighted = 1

    let offRebChance = offRebTotal / totalWeighted
    offRebChance = Math.max(0.15, Math.min(0.40, offRebChance))

    const isOffensiveRebound = Math.floor(Math.random() * 1000) + 1 <= Math.floor(offRebChance * 1000)

    // Select the specific rebounder
    const rebounders = isOffensiveRebound ? offense : defense
    let boxScore = isOffensiveRebound ? offBoxScore : defBoxScore

    const weights = {}
    for (let index = 0; index < rebounders.length; index++) {
      const player = rebounders[index]
      let rebAttr
      if (isOffensiveRebound) {
        rebAttr = (player.attributes && player.attributes.defense && player.attributes.defense.offensiveRebound) || 40
      } else {
        rebAttr = (player.attributes && player.attributes.defense && player.attributes.defense.defensiveRebound) || 50
      }
      const mult = posMult[player.position] || 1.0
      weights[index] = rebAttr * mult
    }

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
    let rebounder = null

    if (total <= 0) {
      rebounder = rebounders[0] || null
      if (rebounder) {
        const rebounderId = rebounder.id || null
        if (rebounderId && boxScore[rebounderId]) {
          boxScore[rebounderId].rebounds++
          if (isOffensiveRebound) {
            boxScore[rebounderId].offensiveRebounds++
          } else {
            boxScore[rebounderId].defensiveRebounds++
          }
        }
      }
    } else {
      const rand = Math.floor(Math.random() * Math.floor(total)) + 1
      let running = 0

      for (const [index, weight] of Object.entries(weights)) {
        running += weight
        if (rand <= running) {
          rebounder = rebounders[index]
          const rebounderId = rebounder.id || null
          if (rebounderId && boxScore[rebounderId]) {
            boxScore[rebounderId].rebounds++
            if (isOffensiveRebound) {
              boxScore[rebounderId].offensiveRebounds++
            } else {
              boxScore[rebounderId].defensiveRebounds++
            }
          }
          break
        }
      }
    }

    // Save box score back
    if (isOffensiveRebound) {
      if (isHome) this.homeBoxScore = boxScore
      else this.awayBoxScore = boxScore
    } else {
      if (isHome) this.awayBoxScore = boxScore
      else this.homeBoxScore = boxScore
    }

    // Record offensive rebound in play-by-play
    if (isOffensiveRebound && this.generateAnimationData) {
      const rebName = rebounder
        ? (rebounder.first_name || '') + ' ' + (rebounder.last_name || '')
        : 'Unknown'
      const teamLabel = isHome ? 'home' : 'away'
      const mins = Math.floor(this.timeRemaining)
      const secs = Math.floor((this.timeRemaining - mins) * 60)
      this.playByPlay.push({
        possession: this.possessionCount,
        quarter: this.currentQuarter,
        time: `${mins}:${String(secs).padStart(2, '0')}`,
        team: teamLabel,
        play_name: 'Offensive Rebound',
        play_id: null,
        outcome: 'offensive_rebound',
        points: 0,
        description: `${rebName} grabs the offensive rebound`,
        home_score: this.homeScore,
        away_score: this.awayScore,
      })
    }

    return isOffensiveRebound
  }

  // =========================================================================
  // BLOCK SELECTION
  // =========================================================================

  /**
   * Select a player likely to get a block.
   */
  selectBlocker(defense) {
    if (!defense || defense.length === 0) {
      return {
        id: 'unknown_blocker',
        first_name: 'Unknown',
        last_name: 'Defender',
        position: 'C',
        attributes: {},
      }
    }

    const weights = {}
    for (let index = 0; index < defense.length; index++) {
      const blockRating = (defense[index].attributes && defense[index].attributes.defense && defense[index].attributes.defense.block) || 50
      weights[index] = blockRating
    }

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
    if (total <= 0) return defense[0]

    const rand = Math.floor(Math.random() * Math.floor(total)) + 1
    let running = 0

    for (const [index, weight] of Object.entries(weights)) {
      running += weight
      if (rand <= running) {
        return defense[index]
      }
    }

    return defense[0]
  }

  // =========================================================================
  // BALL HANDLER / DEFENDER SELECTION (legacy helpers, used by old executePlay)
  // =========================================================================

  /**
   * Select the primary ball handler for this possession.
   */
  selectBallHandler(lineup) {
    if (!lineup || lineup.length === 0) {
      return {
        id: 'unknown_ball_handler',
        first_name: 'Unknown',
        last_name: 'Player',
        position: 'PG',
        overall_rating: 70,
        attributes: {},
      }
    }

    const weights = {}
    for (let index = 0; index < lineup.length; index++) {
      let weight = lineup[index].overall_rating || 70
      if (['PG', 'SG'].includes(lineup[index].position || 'SG')) {
        weight *= 1.5
      }
      weights[index] = weight
    }

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
    if (total <= 0) return lineup[0]

    const rand = Math.floor(Math.random() * Math.floor(total)) + 1
    let running = 0

    for (const [index, weight] of Object.entries(weights)) {
      running += weight
      if (rand <= running) {
        return lineup[index]
      }
    }

    return lineup[0]
  }

  /**
   * Get the defender matching up against the ball handler.
   */
  getMatchingDefender(ballHandler, defense) {
    if (!defense || defense.length === 0) {
      return {
        id: 'unknown_defender',
        first_name: 'Unknown',
        last_name: 'Defender',
        position: ballHandler.position || 'SF',
        overall_rating: 70,
        attributes: {},
      }
    }

    const handlerPosition = ballHandler.position || 'SF'
    for (const defender of defense) {
      if ((defender.position || '') === handlerPosition) {
        return defender
      }
    }
    return defense[0]
  }

  // =========================================================================
  // PLAY TYPE / SHOT LOGIC (legacy helpers)
  // =========================================================================

  /**
   * Determine what type of play will be run.
   */
  determinePlayType(player) {
    const tendencies = player.tendencies || {}
    const shotSelection = tendencies.shotSelection || { threePoint: 0.33, midRange: 0.33, paint: 0.34 }

    let rand = (Math.floor(Math.random() * 100) + 1) / 100

    // Small chance of turnover
    if (rand < 0.12) return 'turnover'

    rand = (Math.floor(Math.random() * 100) + 1) / 100

    if (rand < shotSelection.threePoint) {
      return 'three_pointer'
    } else if (rand < shotSelection.threePoint + shotSelection.midRange) {
      return 'mid_range'
    } else {
      return 'paint'
    }
  }

  /**
   * Get base shooting percentage for play type.
   * Boosted ~15% from original NBA averages for better game flow.
   */
  getBasePercentage(playType, shootingAttr) {
    switch (playType) {
      case 'three_pointer':
        return 0.32 + ((shootingAttr.threePoint || 70) / 100) * 0.18
      case 'mid_range':
        return 0.40 + ((shootingAttr.midRange || 70) / 100) * 0.18
      case 'paint':
        return 0.58 + ((shootingAttr.layup || 70) / 100) * 0.20
      default:
        return 0.46
    }
  }

  /**
   * Calculate how contested the shot is.
   */
  calculateContestLevel(shooter, defender, playType) {
    const defenseAttr = (defender.attributes && defender.attributes.defense) || {}
    const shooterPhysical = (shooter.attributes && shooter.attributes.physical) || {}

    let defenseRating
    switch (playType) {
      case 'three_pointer':
      case 'mid_range':
        defenseRating = defenseAttr.perimeterD || 70
        break
      case 'paint':
        defenseRating = defenseAttr.interiorD || 70
        break
      default:
        defenseRating = 70
    }

    const separation = ((shooterPhysical.speed || 70) + (shooterPhysical.acceleration || 70)) / 200

    const contest = (defenseRating / 100) * (1 - separation * 0.3)

    return Math.max(0, Math.min(1, contest))
  }

  // =========================================================================
  // BADGE / SYNERGY CALCULATIONS
  // =========================================================================

  /**
   * Calculate badge boost and return activated badges/synergies for animation.
   */
  calculateBadgeBoostWithActivations(shooter, playType, teammates) {
    const badges = shooter.badges || []
    let boost = 0
    const activatedBadges = []
    let activatedSynergies = []

    for (const badge of badges) {
      const badgeId = badge.id
      const level = badge.level

      if (!this.badgeDefinitions[badgeId]) continue

      const effects = (this.badgeDefinitions[badgeId].effects && this.badgeDefinitions[badgeId].effects[level]) || {}
      let badgeBoost = 0

      if (playType === 'three_pointer') {
        badgeBoost += effects.catchShootBoost || 0
        badgeBoost += effects.cornerThreeBoost || 0
        badgeBoost += effects.deepRangeBoost || 0
        badgeBoost += effects.contestReduction || 0
      } else if (playType === 'mid_range') {
        badgeBoost += effects.movingShotBoost || 0
        badgeBoost += effects.contestReduction || 0
      } else if (playType === 'paint') {
        badgeBoost += effects.contestedLayupBoost || 0
        badgeBoost += effects.contactFinishBoost || 0
        badgeBoost += effects.floaterBoost || 0
        badgeBoost += effects.giantSlayerBoost || 0
      }

      if (badgeBoost > 0) {
        boost += badgeBoost
        const badgeDef = this.badgeDefinitions[badgeId]
        activatedBadges.push({
          id: badgeId,
          name: badgeDef.name || badgeId,
          level,
          playerId: shooter.id,
          playerName: (shooter.firstName || shooter.first_name || '') + ' ' + (shooter.lastName || shooter.last_name || ''),
        })
      }
    }

    // Check for badge synergies with teammates
    const synergyResult = this.calculateSynergyBoostWithActivations(shooter, teammates, playType)
    boost += synergyResult.boost
    activatedSynergies = synergyResult.activatedSynergies

    return {
      boost,
      activatedBadges,
      activatedSynergies,
    }
  }

  /**
   * Calculate synergy boost and return activated synergies for animation.
   */
  calculateSynergyBoostWithActivations(shooter, teammates, playType) {
    let boost = 0
    const activatedSynergies = []
    const shooterBadgeIds = (shooter.badges || []).map(b => b.id)

    for (const synergy of this.badgeSynergies) {
      // Check if shooter has one of the synergy badges
      if (!shooterBadgeIds.includes(synergy.badge1_id) && !shooterBadgeIds.includes(synergy.badge2_id)) {
        continue
      }

      const shooterBadge = shooterBadgeIds.includes(synergy.badge1_id)
        ? synergy.badge1_id
        : synergy.badge2_id
      const requiredBadge = shooterBadgeIds.includes(synergy.badge1_id)
        ? synergy.badge2_id
        : synergy.badge1_id

      // Check if any teammate has the other badge
      for (const teammate of teammates) {
        if (teammate.id === shooter.id) continue

        const teammateBadgeIds = (teammate.badges || []).map(b => b.id)
        if (teammateBadgeIds.includes(requiredBadge)) {
          const effect = synergy.effect || {}
          const boostValues = effect.boost || {}

          let synergyBoost = 0
          synergyBoost += boostValues.shotPercentage || 0
          synergyBoost += boostValues.rollerFinishing || 0
          boost += synergyBoost

          activatedSynergies.push({
            synergy_name: synergy.synergy_name || 'synergy',
            badge1: shooterBadge,
            badge2: requiredBadge,
            effect: synergy.effect_type || synergy.synergy_name || 'synergy',
            player1: {
              id: shooter.id,
              name: (shooter.firstName || shooter.first_name || '') + ' ' + (shooter.lastName || shooter.last_name || ''),
            },
            player2: {
              id: teammate.id,
              name: (teammate.firstName || teammate.first_name || '') + ' ' + (teammate.lastName || teammate.last_name || ''),
            },
          })
          break
        }
      }
    }

    return { boost, activatedSynergies }
  }

  // =========================================================================
  // FATIGUE & CHEMISTRY
  // =========================================================================

  /**
   * Calculate fatigue modifier.
   */
  calculateFatigueModifier(player) {
    const stamina = (player.attributes && player.attributes.physical && player.attributes.physical.stamina) || 70
    const fatigue = player.fatigue || 0

    const fatigueImpact = (fatigue / 100) * (1 - stamina / 200)

    return 1 - fatigueImpact * 0.25
  }

  /**
   * Calculate chemistry modifier from average team morale.
   * Baseline morale = 80. Below 80 = penalty, above 80 = bonus.
   * Range: -3% at morale 0 to +3% at morale 100.
   */
  calculateChemistryModifier(avgMorale) {
    return Math.max(-0.03, Math.min(0.03, (avgMorale - 80) / 80 * 0.03))
  }

  /**
   * Calculate the average morale across a roster.
   */
  averageMorale(players) {
    if (!players || players.length === 0) return 80
    let sum = 0
    for (const p of players) {
      sum += (p.personality && p.personality.morale != null) ? p.personality.morale : 80
    }
    return sum / players.length
  }

  // =========================================================================
  // PLAYER ROTATION
  // =========================================================================

  /**
   * Rotate players using the substitution engine.
   */
  rotatePlayers() {
    // Home team
    const isUserHomeLive = this.isLiveGame && this.homeTeam && this.homeTeam.id === this.userTeamId
    const homeResult = evaluateSubstitutions(
      this.homeLineup,
      this.homePlayers,
      this.homeBoxScore,
      this.homeTargetMinutes,
      this.homeSubStrategy,
      this.currentQuarter,
      this.timeRemaining,
      this.homeScore - this.awayScore,
      isUserHomeLive
    )
    if (homeResult) {
      this.homeLineup = this.rebuildLineupFromIds(homeResult, this.homePlayers)
    }

    // Away team
    const isUserAwayLive = this.isLiveGame && this.awayTeam && this.awayTeam.id === this.userTeamId
    const awayResult = evaluateSubstitutions(
      this.awayLineup,
      this.awayPlayers,
      this.awayBoxScore,
      this.awayTargetMinutes,
      this.awaySubStrategy,
      this.currentQuarter,
      this.timeRemaining,
      this.awayScore - this.homeScore,
      isUserAwayLive
    )
    if (awayResult) {
      this.awayLineup = this.rebuildLineupFromIds(awayResult, this.awayPlayers)
    }
  }

  // =========================================================================
  // PLAY-BY-PLAY RECORDING
  // =========================================================================

  /**
   * Record play-by-play entry.
   */
  recordPlayByPlay(playResult, team) {
    const keyframes = playResult.keyframes || []
    const lastKeyframe = keyframes.length > 0 ? keyframes[keyframes.length - 1] : {}

    const mins = Math.floor(this.timeRemaining)
    const secs = Math.floor((this.timeRemaining - mins) * 60)

    this.playByPlay.push({
      possession: this.possessionCount,
      quarter: this.currentQuarter,
      time: `${mins}:${String(secs).padStart(2, '0')}`,
      team,
      play_name: playResult.playName || 'Play',
      play_id: playResult.playId || null,
      outcome: playResult.outcome,
      points: playResult.points || 0,
      description: lastKeyframe.description || '',
      home_score: this.homeScore,
      away_score: this.awayScore,
    })
  }

  // =========================================================================
  // PLAYER DATA NORMALIZATION
  // =========================================================================

  /**
   * Normalize player data from either snake_case or camelCase format.
   * Simulation expects snake_case keys.
   */
  normalizePlayerForSimulation(player) {
    // If already in snake_case format, return as-is (with fallback id)
    if (player.first_name !== undefined) {
      if (!player.id) {
        player.id = (
          (player.first_name || 'unknown') + '-' +
          (player.last_name || 'player') + '-' +
          Math.random().toString(36).slice(2, 10)
        ).toLowerCase()
      }
      return player
    }

    // Convert from camelCase to snake_case
    const firstName = player.firstName || ''
    const lastName = player.lastName || ''
    let playerId = player.id || null

    if (!playerId) {
      playerId = (
        (firstName || 'unknown') + '-' +
        (lastName || 'player') + '-' +
        Math.random().toString(36).slice(2, 10)
      ).toLowerCase()
    }

    return {
      id: playerId,
      first_name: firstName,
      last_name: lastName,
      position: player.position || 'SG',
      secondary_position: player.secondaryPosition || null,
      jersey_number: player.jerseyNumber || 0,
      height_inches: player.heightInches || 78,
      weight_lbs: player.weightLbs || 200,
      overall_rating: player.overallRating || 70,
      potential_rating: player.potentialRating || 70,
      attributes: player.attributes || {},
      badges: player.badges || [],
      tendencies: player.tendencies || {},
      fatigue: player.fatigue || 0,
      is_injured: player.isInjured || false,
      personality: player.personality || {},
    }
  }

  // =========================================================================
  // STAT LINES & BOX SCORE FORMATTING
  // =========================================================================

  /**
   * Create empty stat line for a player.
   */
  emptyStatLine(player) {
    return {
      playerId: player.id,
      name: (player.first_name || '') + ' ' + (player.last_name || ''),
      position: player.position,
      secondary_position: player.secondary_position || null,
      overall_rating: player.overall_rating || null,
      fatigue: player.fatigue || 0,
      is_injured: player.is_injured || false,
      minutes: 0,
      points: 0,
      rebounds: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      plusMinus: 0,
    }
  }

  /**
   * Format box score stats with snake_case keys for frontend.
   */
  formatBoxScoreStats(stats) {
    return {
      player_id: stats.playerId,
      name: stats.name,
      position: stats.position,
      secondary_position: stats.secondary_position || null,
      overall_rating: stats.overall_rating || stats.overallRating || null,
      fatigue: stats.fatigue || 0,
      is_injured: stats.is_injured || stats.isInjured || false,
      minutes: Math.round(stats.minutes),
      points: stats.points,
      rebounds: stats.rebounds != null
        ? stats.rebounds
        : (stats.offensiveRebounds || 0) + (stats.defensiveRebounds || 0),
      offensive_rebounds: stats.offensiveRebounds,
      defensive_rebounds: stats.defensiveRebounds,
      assists: stats.assists,
      steals: stats.steals,
      blocks: stats.blocks,
      turnovers: stats.turnovers,
      fouls: stats.fouls,
      fgm: stats.fieldGoalsMade,
      fga: stats.fieldGoalsAttempted,
      fg3m: stats.threePointersMade,
      fg3a: stats.threePointersAttempted,
      ftm: stats.freeThrowsMade,
      fta: stats.freeThrowsAttempted,
      plus_minus: stats.plusMinus,
    }
  }

  // =========================================================================
  // GAME FINALIZATION
  // =========================================================================

  /**
   * Finalize game and return complete results.
   */
  finalizeGame() {
    const homeBoxScoreFormatted = Object.values(this.homeBoxScore).map(s => this.formatBoxScoreStats(s))
    const awayBoxScoreFormatted = Object.values(this.awayBoxScore).map(s => this.formatBoxScoreStats(s))

    return {
      home_team: this.homeTeam ? this.homeTeam.name : 'Home',
      away_team: this.awayTeam ? this.awayTeam.name : 'Away',
      home_team_id: this.homeTeam ? this.homeTeam.id : null,
      away_team_id: this.awayTeam ? this.awayTeam.id : null,
      home_team_abbreviation: this.homeTeam?.abbreviation || '',
      away_team_abbreviation: this.awayTeam?.abbreviation || '',
      home_score: this.homeScore,
      away_score: this.awayScore,
      winner: this.homeScore > this.awayScore ? 'home' : 'away',
      box_score: {
        home: homeBoxScoreFormatted,
        away: awayBoxScoreFormatted,
      },
      quarter_scores: this.quarterScores,
      play_by_play: this.generateAnimationData ? this.playByPlay : [],
      animation_data: this.generateAnimationData
        ? {
            possessions: this.animationData,
            total_possessions: this.possessionCount,
            quarter_end_indices: this.quarterEndPossessions,
          }
        : {},
      synergies_activated: {
        home: this.homeSynergiesActivated,
        away: this.awaySynergiesActivated,
      },
      clutch_play: this.lastClutchPlay,
      overtime_periods: this.currentQuarter > 4 ? this.currentQuarter - 4 : 0,
    }
  }

  // =========================================================================
  // QUARTER-BY-QUARTER RESULT BUILDERS
  // =========================================================================

  /**
   * Build result for a single quarter.
   */
  buildQuarterResult(quarter) {
    const homeBoxScoreFormatted = Object.values(this.homeBoxScore).map(s => this.formatBoxScoreStats(s))
    const awayBoxScoreFormatted = Object.values(this.awayBoxScore).map(s => this.formatBoxScoreStats(s))

    return {
      quarter,
      scores: {
        home: this.homeScore,
        away: this.awayScore,
        quarterScores: this.quarterScores,
      },
      animation_data: {
        possessions: this.animationData,
        quarter_start_possession: quarter > 1
          ? (this.quarterEndPossessions[quarter - 2] || 0) + 1
          : 1,
        quarter_end_index: this.possessionCount,
      },
      box_score: {
        home: homeBoxScoreFormatted,
        away: awayBoxScoreFormatted,
      },
      play_by_play: this.playByPlay,
    }
  }

  /**
   * Build final game result (for when quarter-by-quarter game completes).
   */
  buildFinalResult() {
    const homeBoxScoreFormatted = Object.values(this.homeBoxScore).map(s => this.formatBoxScoreStats(s))
    const awayBoxScoreFormatted = Object.values(this.awayBoxScore).map(s => this.formatBoxScoreStats(s))

    return {
      home_team: this.homeTeam ? this.homeTeam.name : 'Home',
      away_team: this.awayTeam ? this.awayTeam.name : 'Away',
      home_team_id: this.homeTeam ? this.homeTeam.id : null,
      away_team_id: this.awayTeam ? this.awayTeam.id : null,
      home_team_abbreviation: this.homeTeam?.abbreviation || '',
      away_team_abbreviation: this.awayTeam?.abbreviation || '',
      home_score: this.homeScore,
      away_score: this.awayScore,
      winner: this.homeScore > this.awayScore ? 'home' : 'away',
      box_score: {
        home: homeBoxScoreFormatted,
        away: awayBoxScoreFormatted,
      },
      quarter_scores: this.quarterScores,
      synergies_activated: {
        home: this.homeSynergiesActivated,
        away: this.awaySynergiesActivated,
      },
    }
  }

  // =========================================================================
  // STATE SERIALIZATION (for quarter-by-quarter mode)
  // =========================================================================

  /**
   * Check if game is complete (Q4+ and scores not tied).
   */
  isGameComplete() {
    return this.currentQuarter >= 4 && this.homeScore !== this.awayScore
  }

  /**
   * Serialize current game state for storage between quarters.
   */
  serializeState() {
    return {
      version: 4,
      status: 'in_progress',
      currentQuarter: this.currentQuarter,
      completedQuarters: Array.from({ length: this.currentQuarter }, (_, i) => i + 1),
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      quarterScores: this.quarterScores,
      homeBoxScore: this.homeBoxScore,
      awayBoxScore: this.awayBoxScore,
      homeLineup: this.homeLineup.map(p => p.id),
      awayLineup: this.awayLineup.map(p => p.id),
      homePlayers: this.homePlayers.map(p => this.compactPlayerData(p)),
      awayPlayers: this.awayPlayers.map(p => this.compactPlayerData(p)),
      homeOffensiveScheme: this.homeOffensiveScheme,
      homeDefensiveScheme: this.homeDefensiveScheme,
      awayOffensiveScheme: this.awayOffensiveScheme,
      awayDefensiveScheme: this.awayDefensiveScheme,
      possessionCount: this.possessionCount,
      quarterEndPossessions: this.quarterEndPossessions,
      homeTeamId: this.homeTeam ? this.homeTeam.id : null,
      awayTeamId: this.awayTeam ? this.awayTeam.id : null,
      homeTeamName: this.homeTeam ? this.homeTeam.name : null,
      awayTeamName: this.awayTeam ? this.awayTeam.name : null,
      homeSynergiesActivated: this.homeSynergiesActivated,
      awaySynergiesActivated: this.awaySynergiesActivated,
      // Substitution state
      homeTargetMinutes: this.homeTargetMinutes,
      awayTargetMinutes: this.awayTargetMinutes,
      homeSubStrategy: this.homeSubStrategy,
      awaySubStrategy: this.awaySubStrategy,
      homeStarterIds: this.homeStarterIds,
      awayStarterIds: this.awayStarterIds,
      isLiveGame: this.isLiveGame,
      userTeamId: this.userTeamId,
      lastUpdatedAt: new Date().toISOString(),
    }
  }

  /**
   * Compact player data for serialisation.
   */
  compactPlayerData(player) {
    return {
      id: player.id,
      first_name: player.first_name,
      last_name: player.last_name,
      position: player.position,
      secondary_position: player.secondary_position || null,
      overall_rating: player.overall_rating,
      attributes: player.attributes || {},
      badges: player.badges || [],
      tendencies: player.tendencies || {},
      fatigue: player.fatigue || 0,
    }
  }

  /**
   * Restore game state from serialised data.
   */
  deserializeState(state) {
    this.homeScore = state.homeScore
    this.awayScore = state.awayScore
    this.quarterScores = state.quarterScores
    this.homeBoxScore = state.homeBoxScore
    this.awayBoxScore = state.awayBoxScore
    this.homePlayers = state.homePlayers
    this.awayPlayers = state.awayPlayers

    // Handle both old format (single scheme) and new format (offensive/defensive)
    if (state.homeOffensiveScheme !== undefined) {
      this.homeOffensiveScheme = state.homeOffensiveScheme
      this.homeDefensiveScheme = state.homeDefensiveScheme
      this.awayOffensiveScheme = state.awayOffensiveScheme
      this.awayDefensiveScheme = state.awayDefensiveScheme
    } else {
      // Old format migration
      this.homeOffensiveScheme = state.homeCoachingScheme || 'balanced'
      this.homeDefensiveScheme = 'man'
      this.awayOffensiveScheme = state.awayCoachingScheme || 'balanced'
      this.awayDefensiveScheme = 'man'
    }

    this.possessionCount = state.possessionCount
    this.quarterEndPossessions = state.quarterEndPossessions
    this.currentQuarter = state.currentQuarter

    // Rebuild lineups from IDs
    this.homeLineup = this.rebuildLineupFromIds(state.homeLineup, this.homePlayers)
    this.awayLineup = this.rebuildLineupFromIds(state.awayLineup, this.awayPlayers)

    // Restore team references (lightweight)
    this.homeTeam = { id: state.homeTeamId, name: state.homeTeamName || null }
    this.awayTeam = { id: state.awayTeamId, name: state.awayTeamName || null }

    // Restore synergy counters
    this.homeSynergiesActivated = state.homeSynergiesActivated || 0
    this.awaySynergiesActivated = state.awaySynergiesActivated || 0

    // Restore substitution state
    this.homeTargetMinutes = state.homeTargetMinutes || {}
    this.awayTargetMinutes = state.awayTargetMinutes || {}
    this.homeSubStrategy = state.homeSubStrategy || 'staggered'
    this.awaySubStrategy = state.awaySubStrategy || 'staggered'
    this.homeStarterIds = state.homeStarterIds || []
    this.awayStarterIds = state.awayStarterIds || []
    this.isLiveGame = state.isLiveGame || false
    this.userTeamId = state.userTeamId || null

    // Reset per-quarter data
    this.animationData = []
    this.playByPlay = []
  }

  // =========================================================================
  // ADJUSTMENTS (for quarter-by-quarter user input)
  // =========================================================================

  /**
   * Apply user adjustments (lineup, coaching styles) before simulating a quarter.
   */
  applyAdjustments(adjustments) {
    if (!adjustments) return

    // Accept both camelCase and snake_case field names
    const homeLineup = adjustments.homeLineup || adjustments.home_lineup || null
    const awayLineup = adjustments.awayLineup || adjustments.away_lineup || null
    const offStyle = adjustments.offensiveStyle || adjustments.offensive_style || null
    const defStyle = adjustments.defensiveStyle || adjustments.defensive_style || null

    // Update home lineup if provided
    if (homeLineup && homeLineup.length > 0) {
      this.homeLineup = this.rebuildLineupFromIds(homeLineup, this.homePlayers)
    }

    // Update away lineup if provided
    if (awayLineup && awayLineup.length > 0) {
      this.awayLineup = this.rebuildLineupFromIds(awayLineup, this.awayPlayers)
    }

    // Determine which team the user is
    const isUserHome = homeLineup && homeLineup.length > 0
    const isUserAway = awayLineup && awayLineup.length > 0

    if (offStyle) {
      if (isUserHome) {
        this.homeOffensiveScheme = offStyle
      } else if (isUserAway) {
        this.awayOffensiveScheme = offStyle
      } else {
        this.homeOffensiveScheme = offStyle
      }
    }

    if (defStyle) {
      if (isUserHome) {
        this.homeDefensiveScheme = defStyle
      } else if (isUserAway) {
        this.awayDefensiveScheme = defStyle
      } else {
        this.homeDefensiveScheme = defStyle
      }
    }
  }
}

export default GameSimulator
