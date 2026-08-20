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
import { T } from './commentaryTemplate'
import { selectPlay } from './PlayService'
import { coachingEngine } from './CoachingEngine'
import { evaluateSubstitutions, applyVariance, getDefaultTargetMinutes, computeAITargetMinutes, aiStarterCapFor } from './SubstitutionEngine'
import * as Config from '../config/GameConfig'
import { BADGES } from '../data/badges'
import { SYNERGIES, CONDITION_TO_PHASE } from '../data/synergies'

// Play-by-play feed templates for shot results, keyed made/missed ×
// shotType. Templates only ({shooter} interpolated via T) — the `*_TPLS`
// naming is load-bearing: wl-i18n.config.js regex-extracts these blocks.
const SHOT_RESULT_TPLS = {
  made: {
    threePoint: '{shooter} makes the three-pointer!',
    midRange: '{shooter} makes the mid-range jumper!',
    paint: '{shooter} makes the shot at the rim!',
  },
  missed: {
    threePoint: '{shooter} misses the three-pointer',
    midRange: '{shooter} misses the mid-range jumper',
    paint: '{shooter} misses the shot at the rim',
  },
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUARTERS = Config.QUARTERS // 4
const QUARTER_LENGTH_MINUTES = Config.QUARTER_LENGTH_MINUTES // 12
const SHOT_CLOCK_SECONDS = Config.SHOT_CLOCK_SECONDS // 24
const OVERTIME_LENGTH_MINUTES = Config.OVERTIME_LENGTH_MINUTES || 5
const TOTAL_GAME_MINUTES = Config.TOTAL_GAME_MINUTES // 48
const ROTATION_BUDGET = TOTAL_GAME_MINUTES * 5 // 5 players on court → 240 player-minutes per game

// Engine-controlled per-player MPG cap. Used by loadTargetMinutes (the
// restMode post-processing path) and the post-variance _clampTargets
// step in initializeGameFromData. The value matches SubstitutionEngine's
// AI_MAX_MPG so the two layers agree on the ceiling. Skipped on playoffs
// and user-live games.
const AI_MAX_MPG_POST_VARIANCE = 38

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
// Helper: scale a team's targetMinutes so they fill exactly 5 × game-minutes
// of court time. Stale campaigns from the 40-min era persisted minutes that
// sum to ~200; this rescales them to 240 so the sub engine's percentage
// math comes out right. New campaigns already sum to 240 — no-op.
// ---------------------------------------------------------------------------

function normalizeTargetMinutesToBudget(targetMinutes) {
  const ids = Object.keys(targetMinutes)
  if (ids.length === 0) return targetMinutes

  const total = ids.reduce((s, id) => s + (targetMinutes[id] || 0), 0)
  if (total <= 0) return targetMinutes
  // Within 1 minute of budget → no scaling. Rounding residual that close
  // doesn't materially shift rotations.
  if (Math.abs(total - ROTATION_BUDGET) <= 1) return targetMinutes

  const factor = ROTATION_BUDGET / total
  const scaled = {}
  for (const id of ids) {
    scaled[id] = Math.max(0, Math.min(TOTAL_GAME_MINUTES, Math.round((targetMinutes[id] || 0) * factor)))
  }
  // Fix rounding residual on the highest-minutes player.
  const rounded = ids.reduce((s, id) => s + scaled[id], 0)
  if (rounded !== ROTATION_BUDGET) {
    const topId = ids.reduce((a, b) => (scaled[a] >= scaled[b] ? a : b))
    scaled[topId] = Math.max(0, Math.min(TOTAL_GAME_MINUTES, scaled[topId] + (ROTATION_BUDGET - rounded)))
  }
  return scaled
}

/**
 * Clamp every target in a {playerId: minutes} map to `maxPerPlayer`,
 * then renormalize back to the 240-player-minute budget WHILE preserving
 * the per-player cap. Iterates clamp+renormalize because a naive single
 * renormalize would push capped values back above maxPerPlayer (a 38-min
 * starter scaled by factor 1.33 becomes 50.5, which the budget
 * normalizer would clamp at 48, not at 38). The iteration distributes
 * freed minutes among non-capped players and stops once everyone is
 * either at maxPerPlayer or no further redistribution is possible.
 */
function _clampTargets(targetMinutes, maxPerPlayer) {
  if (!targetMinutes) return targetMinutes
  const ids = Object.keys(targetMinutes)
  if (ids.length === 0) return targetMinutes

  let working = {}
  for (const id of ids) {
    working[id] = Math.max(0, Math.min(maxPerPlayer, targetMinutes[id] || 0))
  }

  // Up to 5 iterations is plenty in practice — usually converges in 1-2.
  for (let iter = 0; iter < 5; iter++) {
    const total = ids.reduce((s, id) => s + working[id], 0)
    if (total <= 0 || Math.abs(total - ROTATION_BUDGET) <= 1) break
    // Identify players who still have headroom (below the per-player
    // cap). Freed minutes go to them; players already at the cap are
    // frozen at maxPerPlayer.
    const headroomIds = ids.filter(id => working[id] < maxPerPlayer && working[id] > 0)
    if (headroomIds.length === 0) break
    const headroomTotal = headroomIds.reduce((s, id) => s + working[id], 0)
    const otherTotal = total - headroomTotal
    const targetForHeadroom = ROTATION_BUDGET - otherTotal
    if (targetForHeadroom <= headroomTotal) break  // already exceeded budget elsewhere
    const factor = targetForHeadroom / headroomTotal
    const next = { ...working }
    for (const id of headroomIds) {
      next[id] = Math.min(maxPerPlayer, Math.round(working[id] * factor))
    }
    working = next
  }

  return working
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
    // Back-reference so the engine can read fatigue, momentum, and cold-streak
    // state from the simulator during per-action probability calculation.
    this.playEngine.gameSimulator = this

    // ---- Substitution state ----
    this.homeTargetMinutes = {}
    this.awayTargetMinutes = {}
    this.homeSubStrategy = 'staggered'
    this.awaySubStrategy = 'staggered'
    this.homeStarterIds = []
    this.awayStarterIds = []
    this.isLiveGame = false
    this.userTeamId = null
    // User defensive matchup overrides ({ opponentOffId: userDefId }); applied
    // when the user's team is on defense. Survives quarter breaks (serialized).
    this.userDefensiveMatchups = null

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

    // ---- Home court advantage ----
    // Computed once at tip-off from the home team's average morale.
    // Applied to the home team's made-shot probability on every possession.
    this.homeCourtAdvantage = 0.0

    // ---- Momentum mechanic ----
    // Per-team momentum value, baseline 50, hard-capped to [20, 80]. Drifts
    // toward 50 each possession (regression-to-mean cooldown floor) and gets
    // a one-time dampener after a 3-in-a-row run via momentumCooldown.
    this.momentum = { home: 50, away: 50 }
    this.momentumCooldown = { home: 0, away: 0 }
    // Rolling makes/misses windows (last 5 shots per team) used to detect
    // hot runs and to drive recentMakeStreak(team).
    this.recentShots = { home: [], away: [] }
    // Per-shooter rolling shot window (last 5 attempts) for personal cold-streak
    // detection. shooterId -> array of booleans (true = made).
    this.recentAttemptsByShooter = {}
    // Set of shooter IDs that have already burned their one-shot cold-streak
    // bonus this game. Reset when the shooter gets a make so they can claim it
    // again on a future cold spell.
    this.coldStreakBonusUsed = new Set()

    // ---- Pacing / segmented simulation (live games) ----
    // 'quarter' (legacy, default) | 'play' (stop after every possession) |
    // 'deadBall' (stop only at dead-ball stoppages). Serialized so a resumed
    // game keeps the mode it started with.
    this.pacingMode = 'quarter'
    // Mid-quarter loop state. `pendingPossessionTeam` non-null means we're
    // mid-quarter (it's also the serialization signal for `midQuarter`).
    this.pendingPossessionTeam = null
    this.minutesSinceLastRotation = 0
    this.scoreAtQuarterStart = { home: 0, away: 0 }
    // Result of the most recent possession — read by the segment loop for
    // dead-ball classification. Set every possession in simulatePossession.
    this.lastPlayResult = null

    // ---- Foul model ----
    // Team fouls reset each quarter; a defense at >= 5 is "in the penalty"
    // (non-shooting fouls award 2 FTs).
    this.teamFouls = { home: 0, away: 0 }
    // User-team players who fouled out since the last break — surfaced via
    // breakInfo so the UI can prompt for a replacement (the engine already
    // auto-subbed a fallback so the game can never wedge).
    this.pendingFoulOutIds = []

    // ---- User timeouts ----
    this.userTimeoutsRemaining = 4

    // ---- Pending free throws ----
    // Set when a play ends at a whistle that awards FTs; each attempt then
    // runs as its OWN segment via _simulateFreeThrowAttempt so paced modes
    // break before/between attempts (and subs made at those breaks apply).
    // { team, shooterId, attempts, taken, made, playId, playName }
    this.pendingFreeThrows = null

    // ---- Transition trigger ----
    // How the NEXT possession begins, stamped by how the previous one ended.
    // Transition offense only exists when the ball is gained LIVE with the
    // defense not set (steal > recovered block > defensive rebound; some
    // teams push off makes) — dead balls (violations, fouls, OOB, timeouts,
    // period starts) always let the defense set, so no fast break.
    // One of: 'steal' | 'block' | 'live_rebound' | 'made_basket' |
    // 'oreb' | 'dead_ball'.
    this.nextPossessionStart = 'dead_ball'
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
    this.pacingMode = options.pacing_mode ?? options.pacingMode ?? 'quarter'

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

    this.currentQuarter = 1
    this.timeRemaining = QUARTER_LENGTH_MINUTES

    // stop_after_play: the live client fetches one possession per call in
    // EVERY pacing mode (it auto-continues through boundaries where the mode
    // wouldn't pause) so timeouts/edits land at the end of the current play.
    const stopAfterPlay = !!(options.stop_after_play ?? options.stopAfterPlay)

    if (this.pacingMode !== 'quarter' || stopAfterPlay) {
      this._beginQuarterSegmentState()
      const segStartScores = { home: this.homeScore, away: this.awayScore }
      const breakInfo = this._runSegment(stopAfterPlay ? 'play' : this.pacingMode)
      return {
        quarterResult: this._buildSegmentResult(1, breakInfo, segStartScores),
        gameState: this.serializeState(),
      }
    }

    const homeScoreAtQuarterStart = 0
    const awayScoreAtQuarterStart = 0

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
  continueGame(gameState, adjustments = null, opts = {}) {
    this.deserializeState(gameState)
    this.applyAdjustments(adjustments)
    if (adjustments && (adjustments.call_timeout || adjustments.callTimeout)) {
      this._applyTimeout()
    }

    // Segmented path: required whenever we're resuming mid-quarter (the legacy
    // path would re-simulate the partial quarter from 12:00 on top of the
    // already-banked score), and used for play/deadBall pacing. simToEnd
    // passes forceQuarterPacing so segments run straight to quarter ends.
    let stopMode = opts.forceQuarterPacing ? 'quarter' : this.pacingMode
    // Per-call override: the live client fetches ONE possession per call in
    // every pacing mode so armed timeouts and live coaching edits land at the
    // end of the CURRENT play (it auto-continues through boundaries where the
    // pacing wouldn't pause). Persisted pacingMode is untouched — resume UI
    // still shows the user's pick. simToEnd's forceQuarterPacing wins.
    if (!opts.forceQuarterPacing && adjustments && (adjustments.stop_after_play || adjustments.stopAfterPlay)) {
      stopMode = 'play'
    }
    if (this.pendingPossessionTeam != null || stopMode !== 'quarter') {
      return this._continueSegmented(gameState, stopMode)
    }

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
      result = this.continueGame(state, null, { forceQuarterPacing: true })
      if (result.isComplete) return result
      state = result.gameState
    }
  }

  // =========================================================================
  // SEGMENTED SIMULATION (play / deadBall pacing)
  // =========================================================================

  /**
   * Reset the mid-quarter loop state at the top of a fresh quarter.
   */
  _beginQuarterSegmentState() {
    this.applyBetweenQuarterMomentum()
    this.teamFouls = { home: 0, away: 0 }
    // Period opens with a jump/inbound against a set defense — no transition.
    this.nextPossessionStart = 'dead_ball'
    this.pendingPossessionTeam = Math.random() < 0.5 ? 'home' : 'away'
    this.minutesSinceLastRotation = 0
    this.scoreAtQuarterStart = { home: this.homeScore, away: this.awayScore }
  }

  /**
   * Continue a segmented (play/deadBall) game: resume mid-quarter loop state
   * if present, otherwise start the next quarter, then simulate up to the
   * next stop point for `stopMode`.
   */
  _continueSegmented(gameState, stopMode) {
    let quarter
    if (this.pendingPossessionTeam != null) {
      // Mid-quarter resume — clock/possession/rotation state restored by
      // deserializeState; no quarter advance, no between-quarter momentum.
      quarter = this.currentQuarter
    } else {
      quarter = (gameState.completedQuarters || []).length + 1
      this.currentQuarter = quarter
      this.timeRemaining = quarter <= 4 ? QUARTER_LENGTH_MINUTES : OVERTIME_LENGTH_MINUTES
      this._beginQuarterSegmentState()
    }

    const segStartScores = { home: this.homeScore, away: this.awayScore }
    const breakInfo = this._runSegment(stopMode)

    const isComplete = breakInfo.quarterComplete && this.isGameComplete()
    if (isComplete) breakInfo.reason = 'gameEnd'

    return {
      quarterResult: this._buildSegmentResult(quarter, breakInfo, segStartScores),
      gameState: isComplete ? null : this.serializeState(),
      isComplete,
      finalResult: isComplete ? this.buildFinalResult() : null,
    }
  }

  /**
   * Run possessions until the next stop point for `stopMode`:
   *   'play'     → after every possession
   *   'deadBall' → after possessions ending in a dead ball
   *   'quarter'  → only at quarter end (used by simToEnd on segmented saves)
   * Returns the breakInfo describing why we stopped. Quarter-end bookkeeping
   * (quarterScores push etc.) happens here when the clock hits zero.
   */
  _runSegment(stopMode) {
    // Fresh segment: foul-outs surfaced at the previous break were either
    // handled by the user's lineup adjustment or the engine's auto-sub.
    this.pendingFoulOutIds = []

    let stopClassification = null
    let reason = null

    // Pending free throws keep the segment alive past the clock (FTs are
    // shot with the clock stopped, even after it hits zero).
    while (this.timeRemaining > 0 || this.pendingFreeThrows) {
      // Free throws owed from a whistle: each attempt is its own segment
      // step so paced modes break BEFORE the first shot and between shots.
      // After the FINAL attempt there is NO break — the ball is live again
      // (rebound/inbound) and deadBall mode flows straight into the next
      // possession. 'play' mode still pauses (it pauses after everything).
      if (this.pendingFreeThrows) {
        const keptFt = this._simulateFreeThrowAttempt()
        if (!keptFt) {
          this.pendingPossessionTeam = this.pendingPossessionTeam === 'home' ? 'away' : 'home'
        }
        const stillPending = !!this.pendingFreeThrows
        if (stopMode === 'play' || (stopMode === 'deadBall' && stillPending)) {
          stopClassification = stillPending
            ? this._classifyPossessionEnd(this.lastPlayResult || {})
            : { deadBall: false, deadBallType: null }
          reason = stillPending ? 'deadBall' : 'possession'
          break
        }
        continue
      }

      const team = this.pendingPossessionTeam
      const scheme = team === 'home' ? this.homeOffensiveScheme : this.awayOffensiveScheme
      let possessionTime = this._rollPossessionMinutes(scheme)
      if (possessionTime > this.timeRemaining) {
        possessionTime = this.timeRemaining
      }

      const keptBall = this.simulatePossession(team, possessionTime)
      this.timeRemaining -= possessionTime
      this.minutesSinceLastRotation += possessionTime

      if (!keptBall) {
        this.pendingPossessionTeam = team === 'home' ? 'away' : 'home'
      }

      if (this.minutesSinceLastRotation >= 2) {
        this.rotatePlayers()
        this.minutesSinceLastRotation = 0
      }

      if (this.timeRemaining <= 0 && !this.pendingFreeThrows) break

      const cls = this._classifyPossessionEnd(this.lastPlayResult || {})
      if (stopMode === 'play') {
        stopClassification = cls
        reason = cls.deadBall ? 'deadBall' : 'possession'
        break
      }
      if (stopMode === 'deadBall' && cls.deadBall) {
        stopClassification = cls
        reason = 'deadBall'
        break
      }
    }

    const quarterComplete = this.timeRemaining <= 0 && !this.pendingFreeThrows
    if (quarterComplete) {
      this.quarterScores.home.push(this.homeScore - this.scoreAtQuarterStart.home)
      this.quarterScores.away.push(this.awayScore - this.scoreAtQuarterStart.away)
      this.quarterEndPossessions.push(this.possessionCount)
      this.pendingPossessionTeam = null
      reason = 'quarterEnd'
    }

    return this._buildBreakInfo(reason, quarterComplete, stopClassification)
  }

  /**
   * Classify how the last possession ended for the dead-ball model.
   * Dead: any foul (shooting/reach-in/and-1), deflection out of bounds,
   * free throws, and non-steal turnovers (violations / ball out of bounds).
   * Live: steals, made baskets without a foul, rebounds either way.
   */
  _classifyPossessionEnd(playResult) {
    // Free throws still owed (whistle just happened, or mid-trip between
    // attempts): dead ball with its own type so the UI can say what's next.
    if (this.pendingFreeThrows) {
      return { deadBall: true, deadBallType: 'free_throw_pending' }
    }
    const foul = playResult.foul || null
    if (foul) {
      // Offensive fouls (charges) are their own type — they read as a
      // turnover against the offense, not a defensive foul (no bonus
      // implications, possession flips).
      const type = foul.type === 'offensive'
        ? 'offensive_foul'
        : foul.type === 'and_one'
          ? 'and_one'
          : foul.type === 'shooting' ? 'shooting_foul' : 'non_shooting_foul'
      return { deadBall: true, deadBallType: type }
    }
    if (playResult.deflection) {
      return { deadBall: true, deadBallType: 'deflection_oob' }
    }
    if (playResult.outcome === 'free_throws') {
      return { deadBall: true, deadBallType: 'shooting_foul' }
    }
    if (playResult.outcome === 'turnover' && playResult.turnoverKind !== 'stolen') {
      // violationKind names the concrete call (travel, bad_pass_oob, ...)
      // rolled by PlayExecutionEngine.getViolationDescription.
      return {
        deadBall: true,
        deadBallType: 'violation',
        violationKind: playResult.turnoverViolation ?? null,
      }
    }
    return { deadBall: false, deadBallType: null }
  }

  /**
   * Break metadata returned with each segment. `bonus.home` means the HOME
   * offense is in the bonus (i.e. the away defense has >= 5 team fouls).
   */
  _buildBreakInfo(reason, quarterComplete, cls) {
    const deadBall = quarterComplete ? true : !!(cls && cls.deadBall)

    // Free-throw trips: only the break BEFORE THE FINAL attempt is the
    // "main" break — the real substitution/timeout window (subs must be in
    // before the last FT, after which the ball is live). Earlier FT breaks
    // (the whistle, between non-final attempts) are pause beats only.
    // Exception: a user-team foul-out always opens subs so the replacement
    // prompt is never stranded on a subs-disabled break.
    const pendingFt = this.pendingFreeThrows
    const isMinorFtBreak = !!pendingFt && (pendingFt.taken + 1) < pendingFt.attempts
    const hasFoulOut = (this.pendingFoulOutIds || []).length > 0
    const allowStoppageActions = deadBall && (!isMinorFtBreak || hasFoulOut)

    return {
      reason: reason || 'possession',
      deadBall,
      deadBallType: quarterComplete ? 'quarter_end' : (cls ? cls.deadBallType : null),
      // Concrete violation call (travel, bad_pass_oob, ...) when
      // deadBallType is 'violation' — names the stoppage in the UI.
      violationKind: cls?.violationKind ?? null,
      allowTimeout: allowStoppageActions && !quarterComplete && this.userTimeoutsRemaining > 0,
      allowSubs: allowStoppageActions,
      quarterComplete,
      timeoutsRemaining: this.userTimeoutsRemaining,
      teamFouls: { ...this.teamFouls },
      bonus: { home: this.teamFouls.away >= 5, away: this.teamFouls.home >= 5 },
      // Free throws owed at this break (break bar shows "FT n of m next").
      // shooterId: the fouled player MUST keep shooting — the subs UI locks
      // their slot and applyAdjustments rejects lineups that bench them.
      freeThrows: this.pendingFreeThrows
        ? {
            next: this.pendingFreeThrows.taken + 1,
            total: this.pendingFreeThrows.attempts,
            shooterId: this.pendingFreeThrows.shooterId ?? null,
          }
        : null,
      foulOutPlayerIds: [...(this.pendingFoulOutIds || [])],
      currentLineups: {
        home: this.homeLineup.map(p => p.id),
        away: this.awayLineup.map(p => p.id),
      },
    }
  }

  /**
   * Segment result: same shape as buildQuarterResult plus breakInfo and the
   * scores at the start of this segment (mid-quarter resume display).
   */
  _buildSegmentResult(quarter, breakInfo, segStartScores) {
    const base = this.buildQuarterResult(quarter)
    return {
      ...base,
      starting_scores: segStartScores
        ? { ...segStartScores }
        : { ...this.scoreAtQuarterStart },
      breakInfo,
    }
  }

  /**
   * User timeout: burn one, reset momentum to even (kills either team's run —
   * calling one while YOU have the run wastes it) and give BOTH teams' on-court
   * fives a real breather (energy back, fatigue recovery) — a timeout stops play
   * for everyone on the floor, so the opponent's starters rest too.
   */
  _applyTimeout() {
    if (this.userTimeoutsRemaining <= 0) return false
    if (!this.userTeamId) return false
    this.userTimeoutsRemaining--

    // Timeout = dead ball; the defense sets before the inbound, so the next
    // possession can never open in transition.
    this.nextPossessionStart = 'dead_ball'

    const userIsHome = this.homeTeam && this.homeTeam.id === this.userTeamId
    this.momentum.home = 50
    this.momentum.away = 50
    this.momentumCooldown = { home: 0, away: 0 }

    // Both on-court fives rest during the stoppage — not just the team that
    // called the timeout.
    for (const p of [...this.homeLineup, ...this.awayLineup]) {
      p.fatigue = Math.max(0, (p.fatigue ?? 0) - 10)
      p.energy = Math.min(100, (p.energy ?? 100) + 20)
    }

    if (this.generateAnimationData) {
      const mins = Math.floor(this.timeRemaining)
      const secs = Math.floor((this.timeRemaining - mins) * 60)
      const teamObj = userIsHome ? this.homeTeam : this.awayTeam
      const desc = T('{team} calls a timeout ({remaining} remaining)', {
        team: teamObj?.name || 'Coach',
        remaining: this.userTimeoutsRemaining,
      })
      this.playByPlay.push({
        possession: this.possessionCount,
        quarter: this.currentQuarter,
        time: `${mins}:${String(secs).padStart(2, '0')}`,
        team: userIsHome ? 'home' : 'away',
        play_name: 'Timeout',
        play_id: null,
        outcome: 'timeout',
        points: 0,
        description: desc.text,
        descTpl: desc.tpl,
        descParams: desc.params,
        home_score: this.homeScore,
        away_score: this.awayScore,
      })
    }
    return true
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
    // Playoff context — feeds into AI fatigue management. When true, the
    // AI's per-game minute haircut + 38-MPG cap + ≥85 in-game force-sit
    // are all skipped so AI teams can play stars heavy minutes when it
    // matters. Sourced from the schedule's game record (game.isPlayoff).
    this.isPlayoff = !!options.isPlayoff

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

    // Initialize in-game energy (NOT persisted — resets every game).
    // Energy drives the per-stint sub triggers in evaluateSubstitutions so
    // stars naturally play in 6-8 minute bursts with breathers rather than
    // 48 unbroken minutes. Every player starts at full reserves (100) —
    // cross-game fatigue is reflected in the depletion RATE (fatigued
    // stars drain faster, see evaluateSubstitutions' drainRate formula:
    // multiplied by `1 + max(0, fatigue-50)/100`), not in starting energy.
    // A fatigue-75 star still tips off at 100 energy, but runs out of
    // gas in ~6 min instead of ~9.
    for (const p of [...this.homePlayers, ...this.awayPlayers]) {
      p.energy = 100
      p.lastEnergyTickGameMinutes = 0
      // Snapshot season fatigue so the play-by-play per-action accrual
      // (PlayExecutionEngine.accumulateFatigue) stays EPHEMERAL — it drives the
      // live display, shot penalty, and sub triggers during the game, but is
      // restored in finalizeGame() so it never leaks into the persisted season
      // meter. Post-game evolution then applies only the tuned minute-bracket
      // delta. Without this the bulk AI path (sim + evolution on the same
      // objects) double-counted the huge accrual and pinned AI at 100.
      p._fatigueAtGameStart = p.fatigue ?? 0
    }

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

    // Per-play-set analytics accumulators (offense that ran each play).
    this.homePlayAnalytics = {}
    this.awayPlayAnalytics = {}

    this.homeScore = 0
    this.awayScore = 0
    this.playByPlay = []
    this.animationData = []
    this.quarterScores = { home: [], away: [] }
    this.possessionCount = 0
    this.quarterEndPossessions = []
    this.homeSynergiesActivated = 0
    this.awaySynergiesActivated = 0

    // Per-game runtime state — the live worker reuses ONE simulator instance
    // across games, so anything only initialized in the constructor leaks
    // from the previous game (e.g. timeouts spent last game left the next
    // game starting at 0). Fresh game = full reset; resumes never come
    // through here (deserializeState restores their saved values).
    this.userTimeoutsRemaining = 4
    this.momentum = { home: 50, away: 50 }
    this.momentumCooldown = { home: 0, away: 0 }
    this.teamFouls = { home: 0, away: 0 }
    this.pendingFoulOutIds = []
    this.pendingFreeThrows = null
    this.nextPossessionStart = 'dead_ball'
    this.pendingPossessionTeam = null

    // Coaching schemes
    const homeScheme = homeTeam.coaching_scheme || {}
    const awayScheme = awayTeam.coaching_scheme || {}
    this.homeOffensiveScheme = homeScheme.offensive || 'balanced'
    this.homeDefensiveScheme = homeScheme.defensive || 'man'
    this.awayOffensiveScheme = awayScheme.offensive || 'balanced'
    this.awayDefensiveScheme = awayScheme.defensive || 'man'

    // Honor a per-game style passed in options for the USER team, so the very
    // first quarter reflects the in-game dropdown even if the team's persisted
    // coaching_scheme auto-save was skipped. Q2+ already get this via
    // applyAdjustments/continueGame; this closes the Q1 gap.
    const optOffStyle = options.offensiveStyle || options.offensive_style || null
    const optDefStyle = options.defensiveStyle || options.defensive_style || null
    if (optOffStyle) {
      if (isUserHomeTeam) this.homeOffensiveScheme = optOffStyle
      else if (isUserAwayTeam) this.awayOffensiveScheme = optOffStyle
    }
    if (optDefStyle) {
      if (isUserHomeTeam) this.homeDefensiveScheme = optDefStyle
      else if (isUserAwayTeam) this.awayDefensiveScheme = optDefStyle
    }

    // User-defined defensive matchup overrides ({ opponentOffId: userDefId }),
    // applied when the user's team is on defense. Passed per-game via options
    // (and updated at quarter breaks via applyAdjustments); serialized so it
    // survives the worker round-trip + navigation resume.
    this.userDefensiveMatchups =
      options.defensiveMatchups ?? options.defensive_matchups ?? this.userDefensiveMatchups ?? null

    // Coach references — used by CoachingEngine to scale scheme modifiers by
    // offensiveIQ / defensiveIQ, and by PlayExecutionEngine for clutch-time
    // gameManagement bias. Null-safe everywhere downstream.
    this.homeCoach = homeTeam.coach || null
    this.awayCoach = awayTeam.coach || null

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

    // Apply variance for game-to-game variation. Skipped for AI teams
    // (whose targets come straight from computeAITargetMinutes already
    // capped at the strategy ceiling — variance would just compound
    // leak risk for marginal added realism) AND for the user team when
    // they've explicitly set target minutes via CPU Adjust.
    if (!isUserHomeTeam && !options.isPlayoff) {
      // AI home team: skip variance entirely. Game-to-game variation
      // for AI now comes from fatigue accumulation + restMode
      // transitions, which is more realistic than ±15% RNG.
    } else if (!(isUserHomeTeam && options.targetMinutes)) {
      this.homeTargetMinutes = applyVariance(this.homeTargetMinutes)
    }
    if (!isUserAwayTeam && !options.isPlayoff) {
      // AI away team: same as above.
    } else if (!(isUserAwayTeam && options.targetMinutes)) {
      this.awayTargetMinutes = applyVariance(this.awayTargetMinutes)
    }

    // Post-process clamp ONLY applies to user-team fast-sim, where the
    // user's stored targets could exceed the league cap. AI teams are
    // already capped per-strategy inside computeAITargetMinutes and
    // skip variance, so no further clamp needed. User-live games keep
    // full freedom — the user is picking subs manually.
    const isUserLive = options.isLiveGame === true
    if (!options.isPlayoff && !isUserLive) {
      if (isUserHomeTeam) {
        this.homeTargetMinutes = _clampTargets(this.homeTargetMinutes, AI_MAX_MPG_POST_VARIANCE)
      }
      if (isUserAwayTeam) {
        this.awayTargetMinutes = _clampTargets(this.awayTargetMinutes, AI_MAX_MPG_POST_VARIANCE)
      }
    }

    // Calculate team chemistry modifiers from roster morale
    const homeAvgMorale = this.averageMorale(this.homePlayers)
    const awayAvgMorale = this.averageMorale(this.awayPlayers)
    this.homeChemistryModifier = this.calculateChemistryModifier(homeAvgMorale)
    this.awayChemistryModifier = this.calculateChemistryModifier(awayAvgMorale)
    this.homeCourtAdvantage = this.calculateHomeCourtAdvantage(homeAvgMorale)
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
    } else if (!isUserTeam) {
      // AI team: recompute targets every game so fatigue accumulation
      // from prior games rolls into reduced per-game minutes for tired
      // starters. The previous behavior reused the persisted
      // team.lineup_settings.target_minutes from season init unchanged,
      // which is why AI stars drifted to 40+ MPG and red-zone fatigue
      // — they got the same big targets every night regardless of how
      // worn down they were. computeAITargetMinutes also clamps to 38
      // MPG and zeroes out players at ≥85 fatigue. All caps skip when
      // isPlayoff is true.
      const strategy = team.coaching_scheme?.substitution || 'staggered'
      targetMinutes = computeAITargetMinutes(players, starterIds, strategy, {
        isPlayoff: !!options.isPlayoff,
      })
    } else if (team.lineup_settings && team.lineup_settings.target_minutes) {
      targetMinutes = team.lineup_settings.target_minutes
    }

    // Fallback to defaults if empty. Pass the team's strategy so the fallback
    // still respects the starter MPG cap (otherwise it hands out ~39-MPG
    // uncapped starters — the old over-minutes behavior leaking through).
    if (!targetMinutes || Object.keys(targetMinutes).length === 0) {
      const fbStrategy = team?.coaching_scheme?.substitution || 'staggered'
      targetMinutes = getDefaultTargetMinutes(players, starterIds, fbStrategy)
    }

    // restMode post-processing for the user's team during fast-sim.
    // The user's stored target allocation (CPU Adjust output) doesn't
    // know about the new restMode flag — without this step, a tired
    // user star with restMode=true would still get their stored 36-min
    // target during fast-sim, defeating the hysteresis entirely.
    // Skipped on user-live games (manual control) and in playoffs (let
    // stars play). The AI-team branch above already handles restMode
    // via computeAITargetMinutes, so this only matters for user team.
    const isUserLive = isUserTeam && options.isLiveGame === true
    const skipRestModeHaircut = isUserLive || !!options.isPlayoff
    if (isUserTeam && !skipRestModeHaircut) {
      let modified = false
      const adjusted = { ...targetMinutes }
      for (const p of players) {
        if (!p?.id) continue
        if (p.restMode === true && (adjusted[p.id] ?? 0) > 0) {
          adjusted[p.id] = 0
          modified = true
        }
      }
      if (modified) {
        // Renormalize to 240 so freed minutes from sat-out stars
        // redistribute proportionally to fresh teammates. Uses the
        // user team's strategy-specific cap (not the legacy AI_MAX_
        // MPG_POST_VARIANCE constant) so a user on load_management
        // honors a 30-MPG ceiling while a user on tight_rotation
        // honors 38. When the total still falls short of 240 after
        // capped scaling, the Tier-4 cross-position fallback in
        // evaluateSubstitutions fills the in-game gap.
        const userStrategy = team.coaching_scheme?.substitution || 'staggered'
        const USER_STARTER_CAP = aiStarterCapFor(userStrategy)
        const total = Object.values(adjusted).reduce((s, m) => s + m, 0)
        if (total > 0 && total !== 240) {
          const factor = 240 / total
          for (const id of Object.keys(adjusted)) {
            adjusted[id] = Math.max(0, Math.min(USER_STARTER_CAP, Math.round(adjusted[id] * factor)))
          }
          const rounded = Object.values(adjusted).reduce((s, m) => s + m, 0)
          if (rounded !== 240) {
            const topId = Object.keys(adjusted).reduce((a, b) =>
              adjusted[a] >= adjusted[b] ? a : b
            )
            adjusted[topId] = Math.max(0, Math.min(USER_STARTER_CAP, adjusted[topId] + (240 - rounded)))
          }
        }
        targetMinutes = adjusted
      }
    }

    // Back-compat for campaigns created under the old 40-minute game length:
    // their persisted target_minutes sum to ~200, but a 48-minute game has
    // 240 player-minutes of court time to fill. Scale the team up so the
    // sub engine's percentage math (mins / TOTAL_GAME_MINUTES) hits 5.0
    // total across the roster. New campaigns already total 240 → no-op.
    //
    // Skipped for AI teams because computeAITargetMinutes deliberately
    // caps every value at the strategy ceiling and accepts a sum less
    // than 240 in shorthanded games (multiple restMode players). The
    // back-compat normalize step would push the highest-minutes player
    // back up to 48 by ignoring the per-player cap — the very leak
    // this rewrite is closing.
    if (isUserTeam) {
      targetMinutes = normalizeTargetMinutesToBudget(targetMinutes)
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
   * Roll a possession duration (in minutes) for the team currently on offense.
   * Possession length scales by the team's offensive scheme tempo modifier:
   *   - Base mean = 11.9 seconds → ~121 possessions per team in a 48-min game
   *     when both teams run a tempo-neutral scheme (balanced, motion-ish).
   *     Bumped iteratively: 14.4 (100 poss) → 13.1 (110 poss) → 11.9 (121 poss).
   *   - effectiveMean = baseMean / schemeTempo (run_and_gun 1.3 → 9.2s,
   *     post_centric 0.85 → 14.0s, etc.)
   *   - Uniform random within effectiveMean ± 5s, clamped to a realistic
   *     [4s, 24s] range (24 = shot clock).
   *
   * The alternating-possession loop means both teams' schemes contribute to
   * the actual game pace — a fast team paired with a slow team lands the
   * game roughly between their two paces.
   */
  _rollPossessionMinutes(offensiveScheme) {
    const BASE_MEAN_SECONDS = 11.9
    const VARIANCE_SECONDS = 5
    const MIN_SECONDS = 4
    const MAX_SECONDS = 24

    const tempoMod = coachingEngine.getTempoModifier(offensiveScheme) || 1.0
    const effectiveMean = BASE_MEAN_SECONDS / tempoMod
    const lo = Math.max(MIN_SECONDS, effectiveMean - VARIANCE_SECONDS)
    const hi = Math.min(MAX_SECONDS, effectiveMean + VARIANCE_SECONDS)
    const possessionSeconds = lo + Math.random() * (hi - lo)
    return possessionSeconds / 60
  }

  /**
   * Simulate a single quarter.
   */
  simulateQuarter() {
    this.timeRemaining = this.currentQuarter <= 4 ? QUARTER_LENGTH_MINUTES : OVERTIME_LENGTH_MINUTES
    this.applyBetweenQuarterMomentum()
    this.teamFouls = { home: 0, away: 0 }
    // Period opens with a jump/inbound against a set defense — no transition.
    this.nextPossessionStart = 'dead_ball'
    let possessionTeam = Math.random() < 0.5 ? 'home' : 'away'
    let minutesSinceLastRotation = 0

    while (this.timeRemaining > 0) {
      const scheme = possessionTeam === 'home' ? this.homeOffensiveScheme : this.awayOffensiveScheme
      let possessionTime = this._rollPossessionMinutes(scheme)

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

      // Whistle left free throws pending — shoot them now (clock stopped;
      // this also covers FTs awarded on a foul as the clock expired).
      while (this.pendingFreeThrows) {
        const kept = this._simulateFreeThrowAttempt()
        if (!kept) {
          possessionTeam = possessionTeam === 'home' ? 'away' : 'home'
        }
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
    this.applyBetweenQuarterMomentum()
    this.teamFouls = { home: 0, away: 0 }
    // Period opens with a jump/inbound against a set defense — no transition.
    this.nextPossessionStart = 'dead_ball'
    let possessionTeam = Math.random() < 0.5 ? 'home' : 'away'
    let minutesSinceLastRotation = 0

    while (this.timeRemaining > 0) {
      const scheme = possessionTeam === 'home' ? this.homeOffensiveScheme : this.awayOffensiveScheme
      let possessionTime = this._rollPossessionMinutes(scheme)

      if (possessionTime > this.timeRemaining) {
        possessionTime = this.timeRemaining
      }

      const gotOreb = this.simulatePossession(possessionTeam, possessionTime)
      this.timeRemaining -= possessionTime
      minutesSinceLastRotation += possessionTime

      if (!gotOreb) {
        possessionTeam = possessionTeam === 'home' ? 'away' : 'home'
      }

      // Whistle left free throws pending — shoot them now (clock stopped).
      while (this.pendingFreeThrows) {
        const kept = this._simulateFreeThrowAttempt()
        if (!kept) {
          possessionTeam = possessionTeam === 'home' ? 'away' : 'home'
        }
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
    const offensiveCoach = isHome ? this.homeCoach : this.awayCoach
    const defensiveCoach = isHome ? this.awayCoach : this.homeCoach

    // User-defined defensive matchup overrides — only when the DEFENDING team is
    // the user's. Sourced from `userDefensiveMatchups` (set per-game via options
    // and at quarter breaks via applyAdjustments; serialized for resume).
    // Honored by the engine's matchup hierarchy (user pick wins when both players
    // are on court).
    const defendingTeam = isHome ? this.awayTeam : this.homeTeam
    const defensiveMatchups =
      defendingTeam && this.userTeamId && defendingTeam.id === this.userTeamId
        ? (this.userDefensiveMatchups ?? null)
        : null

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

    // Bench players recover fatigue in-game, symmetric to the on-court per-action
    // accrual — so a rested player's fatigue ticks DOWN on the live screen and he
    // returns fresher. Ephemeral (restored in finalizeGame like the accrual), so
    // it only affects the live display + in-game shot/sub decisions, not the
    // persisted season meter.
    this._recoverBenchFatigue(duration)

    this.possessionCount++

    // Transition-phase synergies (e.g. Fast Break Igniter, Block-to-Break)
    // boost the offense's transition frequency before the per-possession roll.
    const transitionSynergyActs = this.findSynergyActivations(offense, 'transition')
    let fastBreakSynergyBonus = 0
    for (const act of transitionSynergyActs) {
      fastBreakSynergyBonus += act.boost?.fastBreakChance || 0
    }
    // Transition opportunity — gated by how THIS possession begins
    // (nextPossessionStart, stamped by the previous possession's ending).
    // Real transition only exists off a LIVE change of possession with the
    // defense unset: steals & recovered blocks convert most, defensive
    // rebounds off misses moderately, made baskets occasionally (up-tempo
    // quick-inbound push). Dead balls (violations, fouls, OOB, timeouts,
    // period starts) and offensive-rebound resets never produce a break —
    // the defense is set. Multipliers scale the scheme's aggression
    // (TRANSITION_FREQUENCIES) so overall transition volume stays near the
    // tuned rate while the timing becomes realistic.
    const TRANSITION_TRIGGER_MULT = {
      steal: 3.5,
      block: 3.5,
      live_rebound: 1.4,
      made_basket: 0.5,
      oreb: 0,
      dead_ball: 0,
    }
    const triggerMult = TRANSITION_TRIGGER_MULT[this.nextPossessionStart] ?? 0
    const transitionFreq = coachingEngine.getTransitionFrequency(offensiveScheme)
    const transitionChance = Math.min(0.85, (transitionFreq + fastBreakSynergyBonus) * triggerMult)
    const isTransition = Math.random() < transitionChance

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

    // Calculate scheme modifiers, scaled by each coach's IQ + any badge boosts.
    const defensiveModifiers = coachingEngine.calculateDefensiveModifiers(defensiveScheme, play, defensiveCoach)
    const offensiveModifiers = coachingEngine.calculateOffensiveModifiers(offensiveScheme, offensiveCoach)

    // Team chemistry (avg roster morale) feeds the shot probability in the
    // same ±0.03 range that the existing chemistry/steal coupling used —
    // happy teams shoot a hair better, unhappy teams shoot a hair worse.
    offensiveModifiers.chemistryShotBonus = isHome
      ? this.homeChemistryModifier
      : this.awayChemistryModifier
    // Home court advantage: only the home team gets it. Computed once at
    // tip-off from home avg morale (see calculateHomeCourtAdvantage).
    offensiveModifiers.homeCourtBonus = isHome ? this.homeCourtAdvantage : 0

    // Detect clutch time BEFORE the play resolves so PlayExecutionEngine can
    // apply the offensive coach's gameManagement bias to the shot probability.
    const clutchTime = this.timeRemaining < 2.0 && this.currentQuarter >= 4
    // Pre-compute synergy candidates so PlayExecutionEngine can apply them
    // during shot resolution and rebound battles. Defense candidates fire on
    // the DEFENSIVE lineup — finally letting the legacy defense-side
    // synergies (Defensive Anchor, Lockdown Defense) trigger.
    const shotSynergyMap = new Map()
    for (const candidate of offense) {
      if (!candidate || candidate.id == null) continue
      const acts = this.findSynergyActivations(offense, 'shot', candidate)
      if (acts.length > 0) shotSynergyMap.set(String(candidate.id), acts)
    }
    const defenseSynergyCandidates = this.findSynergyActivations(defense, 'defense')
    const reboundSynergyCandidates = this.findSynergyActivations(offense, 'rebound')

    const playOptions = {
      offensiveModifiers,
      offensiveCoach,
      clutchTime,
      // Game-state context for defense/matchup-aware read steering in PEE
      // (which option the offense reads into — not shot-quality math).
      shotClock: context.shotClock,
      scoreDifferential: context.scoreDifferential,
      // User-set defensive matchup overrides (null unless the defending team is
      // the user's and they've configured matchups — UI ships later).
      defensiveMatchups,
      // Used by PlayExecutionEngine to read this.momentum[offensiveTeamSide]
      // when applying the per-shot momentum spillover.
      offensiveTeamSide: team,
      // Synergy data — PEE applies condition gating using full shot context
      // (shotType, dribblesSincePass, play.category) that GameSimulator
      // doesn't have at this point.
      synergyShotMap: shotSynergyMap,
      synergyDefenseCandidates: defenseSynergyCandidates,
      synergyReboundCandidates: reboundSynergyCandidates,
      gameSimulator: this,
      // Foul model context — defense in the penalty shoots FTs on reach-ins.
      foulContext: {
        defenseInPenalty: (this.teamFouls[isHome ? 'away' : 'home'] ?? 0) >= 5,
      },
    }

    // Execute the play with defensive context
    const playResult = this.playEngine.executePlay(play, offense, defense, defensiveScheme, defensiveModifiers, playOptions)

    // Assemble the list of synergies that actually fired this possession
    // (animation + season-end counter). Three sources:
    //   1. Shot-phase synergies that PEE applied during shot resolution.
    //      These are stamped onto `playResult.firedShotSynergies` by PEE.
    //   2. Defense-phase synergies that PEE applied (`firedDefenseSynergies`).
    //   3. Rebound-phase synergies that PEE applied (`firedReboundSynergies`).
    //   4. Transition-phase synergies that fired pre-play.
    const activatedSynergies = []
    if (playResult.firedShotSynergies) activatedSynergies.push(...playResult.firedShotSynergies)
    if (playResult.firedDefenseSynergies) activatedSynergies.push(...playResult.firedDefenseSynergies)
    if (playResult.firedReboundSynergies) activatedSynergies.push(...playResult.firedReboundSynergies)
    // Transition synergies fire on the offensive team that just got the
    // transition opportunity, so include them only when isTransition was rolled
    // in this possession.
    if (isTransition) activatedSynergies.push(...transitionSynergyActs)

    if (activatedSynergies.length > 0) {
      if (isHome) {
        this.homeSynergiesActivated += activatedSynergies.length
      } else {
        this.awaySynergiesActivated += activatedSynergies.length
      }
    }
    playResult.activatedSynergies = activatedSynergies

    // Process play result and update stats
    const gotOffensiveRebound = this.processPlayResult(playResult, offense, defense, isHome)

    // Whistle that awards free throws: queue the attempts — they run as
    // separate segments/possessions after this play's dead-ball break.
    if (playResult.pendingFreeThrows && playResult.pendingFreeThrows.attempts > 0) {
      this.pendingFreeThrows = {
        team,
        shooterId: playResult.pendingFreeThrows.shooterId,
        attempts: playResult.pendingFreeThrows.attempts,
        taken: 0,
        made: 0,
        playId: playResult.playId ?? null,
        playName: playResult.playName ?? null,
      }
    }

    // Expose the possession result to the segment loop (dead-ball
    // classification) and fold in retained-possession dead balls
    // (deflected out of bounds, non-penalty fouls on the floor).
    this.lastPlayResult = playResult
    const keptPossession = gotOffensiveRebound || playResult.offenseRetains === true

    // Stamp how the NEXT possession begins (feeds the transition roll).
    // Order matters: any dead ball (foul, violation, deflection OOB,
    // FTs owed) kills transition regardless of the raw outcome — pending
    // FT trips re-stamp when the final attempt resolves the ball live.
    if (this._classifyPossessionEnd(playResult).deadBall) {
      this.nextPossessionStart = 'dead_ball'
    } else if (keptPossession) {
      this.nextPossessionStart = 'oreb'
    } else if (playResult.turnoverKind === 'stolen') {
      this.nextPossessionStart = 'steal'
    } else if (playResult.shotAttempt?.blocked) {
      this.nextPossessionStart = 'block'
    } else if (playResult.outcome === 'made') {
      this.nextPossessionStart = 'made_basket'
    } else if (playResult.outcome === 'missed' || playResult.outcome === 'offensive_rebound') {
      this.nextPossessionStart = 'live_rebound'
    } else {
      this.nextPossessionStart = 'dead_ball'
    }

    // Update momentum based on the outcome of this possession.
    this.updateMomentum(playResult, team)

    // Record play-by-play and animation data (skip for AI-only games)
    this._pushPossessionAnimation(playResult, team)

    return keptPossession
  }

  /**
   * Record the play-by-play entry + animation possession for a resolved
   * play result. Shared by regular possessions and standalone free-throw
   * attempts. No-op for AI-only games (generateAnimationData false).
   */
  _pushPossessionAnimation(playResult, team) {
    if (!this.generateAnimationData) return

    this.recordPlayByPlay(playResult, team)
    // The feed entry recordPlayByPlay just pushed carries the definitive
    // result line ("X makes the three-pointer!") — stamp it on the
    // animation possession so presentation (the stoppage bubble) can show
    // the play's outcome. Additive fields — readers guard with `?? ''`.
    const lastEntry = this.playByPlay.length > 0
      ? this.playByPlay[this.playByPlay.length - 1]
      : null
    const resultText = lastEntry?.description || ''

    if (playResult.keyframes && playResult.keyframes.length > 0) {
      // Synergies fire on the shot, which resolves at the end of the play —
      // stamp them so the canvas can stagger them with the rest of the
      // animation (mirrors the badge `time` field set in PlayExecutionEngine).
      const synergyTime = Math.max(0, (playResult.duration ?? 0) - 0.05)
      const stampedSynergies = (playResult.activatedSynergies || []).map(s => ({
        ...s,
        time: typeof s.time === 'number' ? s.time : synergyTime,
      }))

      // Live player condition, refreshed per possession. The stat line's
      // own `fatigue` copy is snapshotted at game start, but fatigue accrues
      // play-by-play on the live player objects (PlayExecutionEngine) — so
      // re-read it here, along with in-game `energy` (100 → 0 reserve that
      // resets every game). Additive fields — readers guard with `??`.
      const liveById = new Map()
      for (const p of [...this.homePlayers, ...this.awayPlayers]) {
        liveById.set(String(p.id), p)
      }
      const withLiveCondition = (s) => {
        const formatted = this.formatBoxScoreStats(s)
        const live = liveById.get(String(formatted.player_id))
        formatted.energy = live?.energy ?? 100
        formatted.fatigue = live?.fatigue ?? formatted.fatigue
        return formatted
      }

      this.animationData.push({
        possession_id: this.possessionCount,
        team,
        quarter: this.currentQuarter,
        time: this.timeRemaining,
        play_id: playResult.playId,
        play_name: playResult.playName,
        // Per-attempt FT possessions (executeFreeThrowAttempt) are the only
        // playResults carrying `freeThrows`. The flag lets presentation
        // treat them differently (e.g. no court-noise ambient bed at the
        // line). play_id can't be used — it keeps the fouled play's id.
        is_free_throw: !!playResult.freeThrows,
        result_text: resultText,
        result_tpl: lastEntry?.descTpl ?? null,
        result_params: lastEntry?.descParams ?? null,
        duration: playResult.duration,
        keyframes: playResult.keyframes,
        home_score: this.homeScore,
        away_score: this.awayScore,
        box_score: {
          home: Object.values(this.homeBoxScore).map(withLiveCondition),
          away: Object.values(this.awayBoxScore).map(withLiveCondition),
        },
        activated_badges: playResult.activatedBadges || [],
        activated_synergies: stampedSynergies,
        momentum: { home: this.momentum.home, away: this.momentum.away },
      })
    }
  }

  /**
   * Shoot ONE pending free throw as its own segment/possession. Returns
   * true while the offense retains (more attempts coming), false after the
   * final attempt (possession flips). Clock stays stopped — no game time
   * is consumed, matching real dead-ball free throws.
   */
  _simulateFreeThrowAttempt() {
    const pending = this.pendingFreeThrows
    if (!pending) return false

    const isHome = pending.team === 'home'
    const offense = isHome ? this.homeLineup : this.awayLineup
    const defense = isHome ? this.awayLineup : this.homeLineup
    const players = isHome ? this.homePlayers : this.awayPlayers

    // Shooter must keep shooting even if a break-time sub removed them from
    // the current lineup (real rule: the fouled player shoots).
    const shooter =
      offense.find(p => String(p.id) === String(pending.shooterId)) ||
      players.find(p => String(p.id) === String(pending.shooterId)) ||
      offense[0]

    pending.taken++
    const playResult = this.playEngine.executeFreeThrowAttempt(shooter, offense, {
      attemptNo: pending.taken,
      totalAttempts: pending.attempts,
      playId: pending.playId,
      playName: pending.playName,
    })
    playResult.activatedSynergies = []

    this.possessionCount++
    if (playResult.freeThrows?.made) pending.made += playResult.freeThrows.made

    const kept = this.processPlayResult(playResult, offense, defense, isHome)
    this.updateMomentum(playResult, pending.team)
    this._pushPossessionAnimation(playResult, pending.team)
    this.lastPlayResult = playResult

    const done = pending.taken >= pending.attempts
    if (done) this.pendingFreeThrows = null

    // Transition trigger for the possession that follows the trip. Between
    // attempts the ball stays dead. After the FINAL attempt: made FT → live
    // inbound (push-off-make territory); missed FT → live rebound scramble
    // (defensive board can run, offensive board is a reset).
    if (!done) {
      this.nextPossessionStart = 'dead_ball'
    } else if (playResult.freeThrows?.made) {
      this.nextPossessionStart = 'made_basket'
    } else {
      this.nextPossessionStart = kept ? 'oreb' : 'live_rebound'
    }

    return !done || kept || playResult.offenseRetains === true
  }

  // =========================================================================
  // PLAY RESULT PROCESSING
  // =========================================================================

  /**
   * Process play result and update box scores.
   * Returns true if an offensive rebound occurred (offense keeps possession).
   */
  /**
   * Accumulate per-play-set analytics for the offense that just ran `playResult`.
   * Keyed by play id; tracks possessions, 2PT/3PT makes+attempts, FT makes+
   * attempts, turnovers, and points. Percentages/PPP are derived at display time.
   */
  _accumulatePlayAnalytics(playResult, isHome) {
    const playId = playResult.playId
    if (!playId) return
    const pa = isHome ? this.homePlayAnalytics : this.awayPlayAnalytics
    let e = pa[playId]
    if (!e) {
      e = pa[playId] = {
        name: playResult.playName ?? playId,
        category: playResult.category ?? null,
        poss: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, tov: 0, pts: 0,
      }
    }
    e.poss++
    const sa = playResult.shotAttempt
    if (sa) {
      if (sa.shotType === 'threePoint') {
        e.fg3a++
        if (sa.made) e.fg3m++
      } else {
        e.fg2a++
        if (sa.made) e.fg2m++
      }
    }
    const ft = playResult.freeThrows
    if (ft) {
      e.fta += ft.attempted || 0
      e.ftm += ft.made || 0
    }
    if (playResult.outcome === 'turnover') e.tov++
    e.pts += playResult.points || 0
  }

  processPlayResult(playResult, offense, defense, isHome) {
    const outcome = playResult.outcome
    const points = playResult.points || 0
    const shotAttempt = playResult.shotAttempt || null
    const freeThrows = playResult.freeThrows || null

    // Per-play-set analytics for the offense (2PT/3PT/FT/TO/points by play id).
    this._accumulatePlayAnalytics(playResult, isHome)

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

        // Assign assist — standard basketball rule: the passer is credited
        // if and only if the shooter takes fewer than 3 dribbles between
        // catching the pass and the shot. 3+ dribbles breaks the assist
        // link entirely; no pass on the play means no assist either way.
        const lastPasser = playResult.lastPasserId ?? null
        const dribbles = shotAttempt.dribblesSincePass
        const isAssist = shotAttempt.made
          && lastPasser
          && lastPasser !== shooterId
          && dribbles != null
          && dribbles < 3
          && boxScore[lastPasser]
        if (isAssist) {
          boxScore[lastPasser].assists++
        }

        // Save back
        if (isHome) {
          this.homeBoxScore = boxScore
        } else {
          this.awayBoxScore = boxScore
        }
      }
    }

    // Process free throws (team score already updated above via playResult.points)
    if (freeThrows) {
      const shooterId = freeThrows.shooterId ?? (shotAttempt ? shotAttempt.shooter : null)
      let boxScore = isHome ? this.homeBoxScore : this.awayBoxScore

      if (shooterId && boxScore[shooterId]) {
        boxScore[shooterId].freeThrowsAttempted += freeThrows.attempted
        boxScore[shooterId].freeThrowsMade += freeThrows.made
        boxScore[shooterId].points += freeThrows.made

        if (isHome) {
          this.homeBoxScore = boxScore
        } else {
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

      // Steal credit — ONLY live-ball `stolen` outcomes are steals (the
      // defender who forced it is stamped by PlayExecutionEngine; random
      // defender as a safety fallback). Generic turnovers are dead-ball
      // violations (travel, out of bounds, offensive foul) — by rule no
      // steal is ever credited for those.
      if (playResult.turnoverKind === 'stolen' && defense.length > 0) {
        let stealer = null
        if (playResult.stolenById) {
          stealer = defense.find(p => String(p.id) === String(playResult.stolenById)) || null
        }
        if (!stealer) {
          stealer = defense[Math.floor(Math.random() * defense.length)]
        }
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

    // Foul bookkeeping — personal foul on the committer, foul-out at 6
    // (auto-subbed so the game can never wedge; user teams also get
    // prompted at the next break). Defensive fouls also add a team foul.
    // OFFENSIVE fouls (charges — foul.type 'offensive') book against the
    // OFFENSIVE player and, per NBA rules, do NOT count toward the
    // team-foul penalty and never award free throws.
    const foul = playResult.foul || null
    if (foul && foul.byId) {
      const isOffensiveFoul = foul.type === 'offensive'
      const foulSide = isOffensiveFoul
        ? (isHome ? 'home' : 'away')
        : (isHome ? 'away' : 'home')
      const foulBoxScore = foulSide === 'home' ? this.homeBoxScore : this.awayBoxScore
      const foulerId = String(foul.byId)
      if (foulBoxScore[foulerId]) {
        foulBoxScore[foulerId].fouls = (foulBoxScore[foulerId].fouls ?? 0) + 1
      }
      if (!isOffensiveFoul) {
        this.teamFouls[foulSide] = (this.teamFouls[foulSide] ?? 0) + 1
      }
      if (foulBoxScore[foulerId] && foulBoxScore[foulerId].fouls >= 6) {
        this._handleFoulOut(foulerId, foulSide)
      }
    }

    // Handle rebound on miss
    let gotOffensiveRebound = false
    if (outcome === 'missed' || outcome === 'offensive_rebound') {
      gotOffensiveRebound = this.handleRebound(offense, defense, isHome)
    }

    // Handle block — credit the defender named in the narration
    // (playResult.blockedById, stamped by getBlockedDescription) so the
    // box-score block matches the call; weighted-random fallback for
    // results without the stamp (e.g. legacy paths).
    if (shotAttempt && shotAttempt.blocked) {
      const stampedBlocker = playResult.blockedById != null
        ? defense.find(p => String(p.id) === String(playResult.blockedById)) || null
        : null
      const blocker = stampedBlocker || this.selectBlocker(defense)
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
        ? (rebounder.last_name || rebounder.first_name || 'Unknown')
        : 'Unknown'
      const teamLabel = isHome ? 'home' : 'away'
      const mins = Math.floor(this.timeRemaining)
      const secs = Math.floor((this.timeRemaining - mins) * 60)
      const desc = T('{name} grabs the offensive rebound', { name: rebName })
      this.playByPlay.push({
        possession: this.possessionCount,
        quarter: this.currentQuarter,
        time: `${mins}:${String(secs).padStart(2, '0')}`,
        team: teamLabel,
        play_name: 'Offensive Rebound',
        play_id: null,
        outcome: 'offensive_rebound',
        points: 0,
        description: desc.text,
        descTpl: desc.tpl,
        descParams: desc.params,
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
  // FOUL-OUT HANDLING
  // =========================================================================

  /**
   * A player reached 6 personal fouls: replace them with the best eligible
   * bench player (position fit first, then overall). Empty bench → the
   * player stays on the floor (no crash, logged). User-team foul-outs are
   * additionally queued for the UI prompt at the next break — the auto-sub
   * still runs as a fallback so a stale client can never wedge the game.
   */
  _handleFoulOut(playerId, side) {
    const isHome = side === 'home'
    const lineup = isHome ? this.homeLineup : this.awayLineup

    const idx = lineup.findIndex(p => String(p.id) === String(playerId))
    if (idx === -1) return
    const fouledOut = lineup[idx]

    if (this.generateAnimationData) {
      const mins = Math.floor(this.timeRemaining)
      const secs = Math.floor((this.timeRemaining - mins) * 60)
      const desc = T('{name} fouls out (6 personal fouls)', {
        name: `${(fouledOut.first_name || '')} ${(fouledOut.last_name || '')}`,
      })
      this.playByPlay.push({
        possession: this.possessionCount,
        quarter: this.currentQuarter,
        time: `${mins}:${String(secs).padStart(2, '0')}`,
        team: side,
        play_name: 'Foul Out',
        play_id: null,
        outcome: 'foul_out',
        points: 0,
        description: desc.text,
        descTpl: desc.tpl,
        descParams: desc.params,
        home_score: this.homeScore,
        away_score: this.awayScore,
      })
    }

    const teamObj = isHome ? this.homeTeam : this.awayTeam
    if (this.isLiveGame && teamObj && teamObj.id === this.userTeamId) {
      this.pendingFoulOutIds.push(String(playerId))
    }

    this._replaceFouledOutPlayer(playerId, side)
  }

  /**
   * Swap a fouled-out player for the best eligible bench player (position
   * fit first, then overall). No-op when the bench is empty. Also used by
   * applyAdjustments to sanitize incoming lineups that would re-insert a
   * fouled-out player.
   */
  _replaceFouledOutPlayer(playerId, side) {
    const isHome = side === 'home'
    const lineup = isHome ? this.homeLineup : this.awayLineup
    const players = isHome ? this.homePlayers : this.awayPlayers
    const boxScore = isHome ? this.homeBoxScore : this.awayBoxScore

    const idx = lineup.findIndex(p => String(p.id) === String(playerId))
    if (idx === -1) return
    const fouledOut = lineup[idx]

    const onCourt = new Set(lineup.map(p => String(p.id)))
    const candidates = players.filter(p =>
      !onCourt.has(String(p.id)) &&
      !p.is_injured &&
      ((boxScore[p.id]?.fouls ?? 0) < 6)
    )
    if (candidates.length === 0) return

    const fouledPos = fouledOut.position
    candidates.sort((a, b) => {
      const aFit = (a.position === fouledPos || a.secondary_position === fouledPos) ? 1 : 0
      const bFit = (b.position === fouledPos || b.secondary_position === fouledPos) ? 1 : 0
      if (aFit !== bFit) return bFit - aFit
      return (b.overall_rating || 0) - (a.overall_rating || 0)
    })

    lineup[idx] = candidates[0]
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
        defenseRating = defenseAttr.perimeterDefense ?? defenseAttr.perimeterD ?? 70
        break
      case 'paint':
        defenseRating = defenseAttr.interiorDefense ?? defenseAttr.interiorD ?? 70
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
    const activatedBadges = []
    let activatedSynergies = []

    // Effect keys that apply to this playType. When a player has multiple
    // badges granting the same key (e.g. Deep Threes + Limitless Range both
    // grant deepRangeBoost), we take the MAX rather than summing — otherwise
    // stacked badges produce unrealistic 30%+ boosts.
    const relevantKeys = playType === 'three_pointer'
      ? ['catchShootBoost', 'cornerThreeBoost', 'deepRangeBoost', 'contestReduction']
      : playType === 'mid_range'
        ? ['movingShotBoost', 'contestReduction']
        : playType === 'paint'
          ? ['contestedLayupBoost', 'contactFinishBoost', 'floaterBoost', 'giantSlayerBoost']
          : []

    const maxEffects = {}
    for (const badge of badges) {
      const badgeId = badge.id
      const level = badge.level
      if (!this.badgeDefinitions[badgeId]) continue

      const effects = this.badgeDefinitions[badgeId].effects?.[level] || {}
      let touchedRelevantKey = false
      for (const key of relevantKeys) {
        const value = effects[key]
        if (value && value > 0) {
          maxEffects[key] = Math.max(maxEffects[key] || 0, value)
          touchedRelevantKey = true
        }
      }

      if (touchedRelevantKey) {
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

    let boost = 0
    for (const key of relevantKeys) {
      boost += maxEffects[key] || 0
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
   * Locate satisfied synergy pairs on a lineup for a given phase.
   *
   * Shot-phase evaluations are shooter-anchored: one of the two badges must
   * be on the supplied `shooter`. Defense / rebound / transition phases are
   * team-wide — any two distinct players holding the pair triggers the
   * synergy. Condition matching is NOT performed here; this just returns
   * candidates whose badge pair is present. The caller checks `condition`
   * against the actual context (shotType, play.category, clutchTime, etc.).
   *
   * @param {Array} lineup
   * @param {string} forPhase  'shot' | 'defense' | 'rebound' | 'transition'
   * @param {Object|null} shooter  required for `forPhase === 'shot'`
   * @returns {Array<{ synergy_name, badge1, badge2, condition, boost, player1, player2 }>}
   */
  findSynergyActivations(lineup, forPhase, shooter = null) {
    const activations = []
    for (const synergy of this.badgeSynergies) {
      const condition = synergy.effect?.condition
      const phase = CONDITION_TO_PHASE[condition] || 'shot'
      if (phase !== forPhase) continue

      let p1 = null
      let p2 = null

      if (forPhase === 'shot' && shooter) {
        const shooterIds = (shooter.badges || []).map(b => b.id)
        const shooterHas1 = shooterIds.includes(synergy.badge1_id)
        const shooterHas2 = shooterIds.includes(synergy.badge2_id)
        if (!shooterHas1 && !shooterHas2) continue
        const needBadge = shooterHas1 ? synergy.badge2_id : synergy.badge1_id
        for (const t of lineup) {
          if (!t || t === shooter) continue
          if (t.id != null && shooter.id != null && t.id === shooter.id) continue
          const ids = (t.badges || []).map(b => b.id)
          if (ids.includes(needBadge)) {
            p1 = shooterHas1 ? shooter : t
            p2 = shooterHas1 ? t : shooter
            break
          }
        }
      } else {
        for (const a of lineup) {
          if (!a) continue
          const ids = (a.badges || []).map(b => b.id)
          if (!p1 && ids.includes(synergy.badge1_id)) p1 = a
          if (!p2 && ids.includes(synergy.badge2_id) && a !== p1) p2 = a
        }
        // Self-match guard: if a single player holds both badges and no other
        // player completes the pair, no synergy fires.
        if (p1 && p2 && p1 === p2) p2 = null
      }

      if (p1 && p2) {
        activations.push({
          synergy_name: synergy.synergy_name || 'synergy',
          badge1: synergy.badge1_id,
          badge2: synergy.badge2_id,
          condition,
          boost: synergy.effect?.boost || {},
          effect: synergy.effect_type || synergy.synergy_name || 'synergy',
          player1: { id: p1.id, name: this._fullName(p1) },
          player2: { id: p2.id, name: this._fullName(p2) },
        })
      }
    }
    return activations
  }

  _fullName(p) {
    if (!p) return ''
    return (p.firstName || p.first_name || '') + ' ' + (p.lastName || p.last_name || '')
  }

  /**
   * Test whether a shot-phase synergy's condition matches the current shot
   * context. Used both by PlayExecutionEngine (during shot resolution) and
   * by GameSimulator's animation-list assembly.
   */
  shotSynergyMatches(activation, ctx) {
    switch (activation.condition) {
      case 'always': return true
      case 'three_pointer': return ctx.shotType === 'three_pointer'
      case 'mid_range': return ctx.shotType === 'mid_range'
      case 'paint': return ctx.shotType === 'paint'
      case 'at_rim': return ctx.shotType === 'paint'
      case 'catch_and_shoot': return ctx.dribblesSincePass === 0
      case 'corner_three':
        return ctx.shotType === 'three_pointer' && !!ctx.playId && ctx.playId.includes('corner')
      case 'clutch': return !!ctx.clutchTime
      case 'isolation': return ctx.playCategory === 'isolation'
      case 'pick_and_roll': return ctx.playCategory === 'pick_and_roll'
      case 'screen_play': return ctx.playCategory === 'pick_and_roll'
      case 'cutting': return ctx.playCategory === 'cut'
      case 'alley_oop': return !!ctx.isAlleyOop
      case 'mismatch': return !!ctx.isMismatch
      default: return false
    }
  }

  /**
   * Test whether a defense-phase synergy condition applies to the current
   * shot context. Used by PlayExecutionEngine to gate the boost subtraction.
   */
  defenseSynergyMatches(activation, ctx) {
    switch (activation.condition) {
      case 'team_defense': return true
      case 'interior_defense': return ctx.shotType === 'paint'
      case 'paint_defense': return ctx.shotType === 'paint'
      default: return false
    }
  }

  /**
   * Legacy entry point preserved for compatibility — `simulatePossession`
   * still calls this to fetch shot-phase animation activations. Returns
   * synergy activations for the supplied shooter that pass condition
   * matching against the supplied shot context.
   */
  calculateSynergyBoostWithActivations(shooter, teammates, shotCtx) {
    const candidates = this.findSynergyActivations(teammates, 'shot', shooter)
    const activatedSynergies = []
    let boost = 0
    for (const act of candidates) {
      if (!this.shotSynergyMatches(act, shotCtx)) continue
      boost += act.boost?.shotPercentage || 0
      boost += act.boost?.rollerFinishing || 0
      boost += act.boost?.screenEffectiveness || 0
      activatedSynergies.push(act)
    }
    return { boost, activatedSynergies }
  }

  // =========================================================================
  // MOMENTUM
  // =========================================================================

  /**
   * Apply the between-quarters momentum adjustment. Called at the start of
   * every quarter — bails out on Q1 (use the constructor's neutral 50/50).
   *
   * Real-life behavior we're modeling:
   *  - Short breaks (between Q1↔Q2 and Q3↔Q4): teams keep most of their
   *    swing but settle a notch toward neutral.
   *  - Halftime (Q2↔Q3): long break, locker-room reset — momentum returns
   *    to 50/50 and the rolling shot windows clear so post-half hot streaks
   *    are detected fresh.
   *
   * Active boost cooldown (`momentumCooldown`) clears each quarter — three
   * possessions of dampener doesn't carry across a break.
   */
  applyBetweenQuarterMomentum() {
    const q = this.currentQuarter
    if (q <= 1) return

    // Halftime — full reset.
    if (q === 3) {
      this.momentum = { home: 50, away: 50 }
      this.recentShots = { home: [], away: [] }
      this.momentumCooldown = { home: 0, away: 0 }
      return
    }

    // Short break (Q2, Q4) — 30% regression toward 50. Equivalent to ~4
    // possessions of the normal 8%-per-possession decay.
    const REGRESSION = 0.30
    this.momentum.home += (50 - this.momentum.home) * REGRESSION
    this.momentum.away += (50 - this.momentum.away) * REGRESSION
    this.momentumCooldown = { home: 0, away: 0 }
  }

  /**
   * Update per-team momentum after a possession resolves.
   *
   * Mechanics:
   * - Regress both teams toward 50 by 8% each possession (the always-on
   *   cooldown floor — ensures no team holds a hot/cold state forever).
   * - A made shot boosts the scoring team (+4 for 2pt, +6 for 3pt) and dings
   *   the opponent by half that. A 3-in-a-row hot run sets momentumCooldown
   *   to 3 possessions, during which subsequent makes contribute 30% of
   *   nominal — explicitly preventing runaway feedback loops.
   * - A turnover or miss decays the offense's momentum slightly.
   * - Hard caps [20, 80] so no team ever reaches 0/100.
   */
  updateMomentum(playResult, team) {
    const opp = team === 'home' ? 'away' : 'home'

    // Regression toward neutral (cooldown floor)
    this.momentum.home += (50 - this.momentum.home) * 0.08
    this.momentum.away += (50 - this.momentum.away) * 0.08

    // Tick down active boost cooldowns
    this.momentumCooldown.home = Math.max(0, this.momentumCooldown.home - 1)
    this.momentumCooldown.away = Math.max(0, this.momentumCooldown.away - 1)

    const scored = (playResult.points || 0) > 0
    const wasThree = scored && playResult.points >= 3
    const isTurnover = playResult.outcome === 'turnover' || playResult.outcome === 'stolen'

    // Record per-shooter attempt so cold-streak detection has data next time.
    const shotAttempt = playResult.shotAttempt
    if (shotAttempt && shotAttempt.shooter && shotAttempt.shooter !== 'unknown') {
      this.recordShooterAttempt(shotAttempt.shooter, !!shotAttempt.made)
    }

    if (scored) {
      this._recordShotForTeam(team, true)
      const cooled = this.momentumCooldown[team] > 0
      const nominal = wasThree ? 6 : 4
      const effective = cooled ? nominal * 0.3 : nominal
      this.momentum[team] = Math.min(80, this.momentum[team] + effective)
      this.momentum[opp]  = Math.max(20, this.momentum[opp]  - effective * 0.5)
      // Hot-run dampener: 3-in-a-row triggers the cooldown
      if (this._recentMakeStreak(team) >= 3) {
        this.momentumCooldown[team] = 3
      }
    } else if (isTurnover) {
      this.momentum[team] = Math.max(20, this.momentum[team] - 2)
      this.momentum[opp]  = Math.min(80, this.momentum[opp]  + 1)
    } else if (shotAttempt) {
      // Missed shot (shotAttempt set but no points)
      this._recordShotForTeam(team, false)
      this.momentum[team] = Math.max(20, this.momentum[team] - 1)
    }
  }

  /**
   * Append a make/miss to the team's rolling 5-shot window.
   */
  _recordShotForTeam(team, made) {
    const arr = this.recentShots[team]
    arr.push(made)
    if (arr.length > 5) arr.shift()
  }

  /**
   * Count trailing consecutive makes in the team's rolling window.
   */
  _recentMakeStreak(team) {
    const arr = this.recentShots[team]
    let streak = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]) streak++
      else break
    }
    return streak
  }

  /**
   * Record a shooter's individual attempt for personal cold-streak tracking.
   * Called by PlayExecutionEngine after each shot resolves.
   */
  recordShooterAttempt(shooterId, made) {
    if (!shooterId) return
    const arr = this.recentAttemptsByShooter[shooterId] ?? []
    arr.push(!!made)
    if (arr.length > 5) arr.shift()
    this.recentAttemptsByShooter[shooterId] = arr
    if (made) {
      // A make resets the bonus-burned flag so future cold spells can claim it again
      this.coldStreakBonusUsed.delete(shooterId)
    }
  }

  /**
   * True when the shooter has 5 recent attempts and made fewer than 25% of them
   * AND their team momentum is ≥ 60. One-shot bonus — second call returns false
   * until a make resets the flag.
   */
  shouldGrantColdStreakBonus(shooterId, team) {
    if (!shooterId) return false
    if (this.coldStreakBonusUsed.has(shooterId)) return false
    const attempts = this.recentAttemptsByShooter[shooterId] || []
    if (attempts.length < 5) return false
    const makes = attempts.filter(Boolean).length
    if (makes / attempts.length >= 0.25) return false
    const teamMomentum = this.momentum[team] ?? 50
    if (teamMomentum < 60) return false
    return true
  }

  /**
   * Mark the cold-streak bonus as burned for this shooter so it won't fire
   * again until they hit a make.
   */
  consumeColdStreakBonus(shooterId) {
    if (shooterId) this.coldStreakBonusUsed.add(shooterId)
  }

  // =========================================================================
  // FATIGUE & CHEMISTRY
  // =========================================================================

  /**
   * In-game bench fatigue recovery, called once per possession with the
   * possession's game-minute `duration`. Every player NOT in either on-court
   * lineup recovers fatigue proportional to the elapsed time, stamina-scaled
   * (mirrors the energy-regen scaling). This is the counterpart to the on-court
   * per-action accrual and, like it, is EPHEMERAL — restored to the pre-game
   * value in finalizeGame — so it drives the live display + in-game shot/sub
   * decisions without touching the persisted season meter.
   */
  _recoverBenchFatigue(duration) {
    if (!(duration > 0)) return
    const onCourt = new Set([...this.homeLineup, ...this.awayLineup].map(p => String(p.id)))
    const BASE = 1.0 // fatigue recovered per game-minute on the bench (tunable)
    for (const p of [...this.homePlayers, ...this.awayPlayers]) {
      if (!p?.id || onCourt.has(String(p.id))) continue
      const stam = p.attributes?.physical?.stamina ?? p.attributes?.stamina ?? 75
      const rate = BASE * (0.75 + (stam / 100) * 0.75) // stam 70 → ~1.28/game-min
      p.fatigue = Math.max(0, (p.fatigue ?? 0) - rate * duration)
    }
  }

  /**
   * Calculate fatigue modifier.
   */
  calculateFatigueModifier(player) {
    const stamina = (player.attributes && player.attributes.physical && player.attributes.physical.stamina) || 70
    const fatigue = player.fatigue || 0

    // Stamina damps the impact (a high-stamina star tires less severely), but
    // the coefficient (0.40) is steep enough that riding a player into the red
    // is a real cost: at fatigue 100 / stamina 70 this is ~-26% (was ~-16% at
    // 0.25). Applied to the shooter's make probability AND — separately — to a
    // fatigued defender's rating in PlayExecutionEngine, so fatigue bites on
    // both ends.
    const fatigueImpact = (fatigue / 100) * (1 - stamina / 200)

    return 1 - fatigueImpact * 0.40
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
   * Home court advantage applied to the home team's made-shot probability.
   * Baseline +1.5%, bumped to +2.5% when the home team's average morale is
   * ≥ 65 (engaged crowd / locker-room buy-in amplifying the edge). Sits in
   * the same magnitude band as the chemistry shot bonus so they stack
   * without one swamping the other.
   */
  calculateHomeCourtAdvantage(homeAvgMorale) {
    return homeAvgMorale >= 65 ? 0.025 : 0.015
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
    // Overtime is treated as "gloves off" — same semantics as playoffs.
    // Energy gates, restMode haircuts, and the strategy MPG cap all
    // lift in OT because the regulation budget is already spent and
    // coaches play their best lineup to win. Mirrors how real NBA
    // coaches handle OT (stars play the full overtime) and how this
    // engine already handles playoff games.
    const isHighStakes = this.isPlayoff || this.currentQuarter > 4

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
      isUserHomeLive,
      isHighStakes
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
      isUserAwayLive,
      isHighStakes
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
    // Skip presentation-only ball-flight keyframes ("The shot is up...",
    // bounce frames) — the feed entry should describe the deciding ACTION
    // ("X makes the three-pointer!"), which is the last non-flight keyframe.
    let lastKeyframe = {}
    for (let i = keyframes.length - 1; i >= 0; i--) {
      if (keyframes[i].actionType !== 'ball_flight' && keyframes[i].description) {
        lastKeyframe = keyframes[i]
        break
      }
    }
    if (!lastKeyframe.description && keyframes.length > 0) {
      lastKeyframe = keyframes[keyframes.length - 1]
    }

    let description = lastKeyframe.description || ''
    // Translation template + params for the line (stamped by
    // PlayExecutionEngine on the keyframe, or rebuilt with it below).
    let descTpl = lastKeyframe.descTpl ?? null
    let descParams = lastKeyframe.descParams ?? null

    // Shot possessions: the release keyframe is deliberately neutral ("puts
    // up the three-pointer...") so the on-court ticker doesn't spoil the
    // result before the flight animation — rebuild the definitive feed line
    // from the play result here. Blocked shots keep their keyframe text.
    const sa = playResult.shotAttempt
    if (
      sa && sa.shooterName && !sa.blocked && !sa.fouled &&
      ['made', 'missed', 'offensive_rebound'].includes(playResult.outcome)
    ) {
      const resultTpls = SHOT_RESULT_TPLS[sa.made ? 'made' : 'missed']
      const shotKey = sa.shotType === 'threePoint'
        ? 'threePoint'
        : sa.shotType === 'midRange' ? 'midRange' : 'paint'
      // Broadcast style: last name only (matches the keyframe descriptions).
      const shooterLast = sa.shooterName.trim().split(/\s+/).pop()
      const desc = T(resultTpls[shotKey], { shooter: shooterLast })
      description = desc.text
      descTpl = desc.tpl
      descParams = desc.params
    }

    // Free-throw possessions: the result line lives on flight keyframes we
    // just skipped — rebuild it from the play result instead. Standalone
    // attempts (attemptNo set) get per-attempt phrasing.
    const ft = playResult.freeThrows
    if (playResult.outcome === 'free_throws' && ft && ft.attempted > 0) {
      const box = team === 'home' ? this.homeBoxScore : this.awayBoxScore
      const fullName = (ft.shooterId && box[ft.shooterId]?.name) || 'Shooter'
      const shooterName = String(fullName).trim().split(/\s+/).pop() || 'Shooter'
      const desc = ft.attemptNo
        ? (ft.made > 0
            ? T('{shooter} makes free throw {attemptNo} of {totalAttempts}', { shooter: shooterName, attemptNo: ft.attemptNo, totalAttempts: ft.totalAttempts })
            : T('{shooter} misses free throw {attemptNo} of {totalAttempts}', { shooter: shooterName, attemptNo: ft.attemptNo, totalAttempts: ft.totalAttempts }))
        : T('{shooter} makes {made} of {attempted} free throws', { shooter: shooterName, made: ft.made, attempted: ft.attempted })
      description = desc.text
      descTpl = desc.tpl
      descParams = desc.params
    }

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
      description,
      descTpl,
      descParams,
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
      headshot: player.headshot || null,
      // Carry the custom-headshot flag through to the box-score record so the
      // BasketballCourt canvas picks the right resolver branch (custom SVG
      // in IDB vs bundled). Without this the live court always shows the
      // bundled face even after the user saves an edit.
      hasCustomHeadshot: player.hasCustomHeadshot ?? player.has_custom_headshot ?? false,
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
      headshot: stats.headshot || null,
      hasCustomHeadshot: stats.hasCustomHeadshot ?? false,
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
    // Restore each player's pre-game fatigue: the in-game per-action accrual is
    // ephemeral (see the snapshot in initializeGameFromData). This runs after
    // all quarters (so the live display / shot penalty / sub triggers already
    // used the accrued values) and BEFORE the bulk worker hands these same
    // objects to processPostGame — so post-game evolution adds only the
    // minute-bracket delta to the season fatigue instead of stacking the huge
    // accrual on top. Matches the (already-correct) user-game path.
    for (const p of [...this.homePlayers, ...this.awayPlayers]) {
      if (p && p._fatigueAtGameStart !== undefined) {
        p.fatigue = p._fatigueAtGameStart
        delete p._fatigueAtGameStart
      }
    }

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
      play_analytics: {
        home: this.homePlayAnalytics,
        away: this.awayPlayAnalytics,
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
      play_analytics: {
        home: this.homePlayAnalytics,
        away: this.awayPlayAnalytics,
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
    // Completed-only quarter count: mid-quarter (segmented pacing) the
    // current quarter is NOT complete. Legacy quarter pacing only serializes
    // at quarter boundaries (pendingPossessionTeam null), matching v4.
    const completedCount = this.pendingPossessionTeam != null
      ? this.currentQuarter - 1
      : this.currentQuarter
    return {
      version: 5,
      status: 'in_progress',
      currentQuarter: this.currentQuarter,
      completedQuarters: Array.from({ length: completedCount }, (_, i) => i + 1),
      pacingMode: this.pacingMode,
      midQuarter: this.pendingPossessionTeam != null
        ? {
            timeRemaining: this.timeRemaining,
            possessionTeam: this.pendingPossessionTeam,
            minutesSinceLastRotation: this.minutesSinceLastRotation,
            scoreAtQuarterStart: { ...this.scoreAtQuarterStart },
          }
        : null,
      momentum: { ...this.momentum },
      momentumCooldown: { ...this.momentumCooldown },
      teamFoulsThisQuarter: { ...this.teamFouls },
      userTimeoutsRemaining: this.userTimeoutsRemaining,
      // Transition trigger for the next possession (additive — old saves
      // lack it and restore to the safe 'dead_ball' default).
      nextPossessionStart: this.nextPossessionStart,
      pendingFoulOutIds: [...(this.pendingFoulOutIds || [])],
      pendingFreeThrows: this.pendingFreeThrows ? { ...this.pendingFreeThrows } : null,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      quarterScores: this.quarterScores,
      homeBoxScore: this.homeBoxScore,
      awayBoxScore: this.awayBoxScore,
      homePlayAnalytics: this.homePlayAnalytics,
      awayPlayAnalytics: this.awayPlayAnalytics,
      homeLineup: this.homeLineup.map(p => p.id),
      awayLineup: this.awayLineup.map(p => p.id),
      homePlayers: this.homePlayers.map(p => this.compactPlayerData(p)),
      awayPlayers: this.awayPlayers.map(p => this.compactPlayerData(p)),
      homeOffensiveScheme: this.homeOffensiveScheme,
      homeDefensiveScheme: this.homeDefensiveScheme,
      awayOffensiveScheme: this.awayOffensiveScheme,
      awayDefensiveScheme: this.awayDefensiveScheme,
      userDefensiveMatchups: this.userDefensiveMatchups,
      possessionCount: this.possessionCount,
      quarterEndPossessions: this.quarterEndPossessions,
      homeTeamId: this.homeTeam ? this.homeTeam.id : null,
      awayTeamId: this.awayTeam ? this.awayTeam.id : null,
      homeTeamName: this.homeTeam ? this.homeTeam.name : null,
      awayTeamName: this.awayTeam ? this.awayTeam.name : null,
      homeTeamAbbreviation: this.homeTeam?.abbreviation || null,
      awayTeamAbbreviation: this.awayTeam?.abbreviation || null,
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
      // In-game energy state — needed for mid-quarter resume (segmented
      // pacing); quarter-boundary resumes previously got away without it.
      energy: player.energy ?? 100,
      lastEnergyTickGameMinutes: player.lastEnergyTickGameMinutes ?? 0,
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
    this.homePlayAnalytics = state.homePlayAnalytics || {}
    this.awayPlayAnalytics = state.awayPlayAnalytics || {}
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

    if (state.userDefensiveMatchups !== undefined) {
      this.userDefensiveMatchups = state.userDefensiveMatchups
    }

    this.possessionCount = state.possessionCount
    this.quarterEndPossessions = state.quarterEndPossessions
    this.currentQuarter = state.currentQuarter

    // Rebuild lineups from IDs
    this.homeLineup = this.rebuildLineupFromIds(state.homeLineup, this.homePlayers)
    this.awayLineup = this.rebuildLineupFromIds(state.awayLineup, this.awayPlayers)

    // Restore team references (lightweight)
    this.homeTeam = { id: state.homeTeamId, name: state.homeTeamName || null, abbreviation: state.homeTeamAbbreviation || null }
    this.awayTeam = { id: state.awayTeamId, name: state.awayTeamName || null, abbreviation: state.awayTeamAbbreviation || null }

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

    // ---- v5 additive fields (all ??-defaulted so v4 saves resume cleanly
    // at quarter granularity with the foul/timeout state zeroed) ----
    this.pacingMode = state.pacingMode ?? 'quarter'
    this.momentum = state.momentum ?? { home: 50, away: 50 }
    this.momentumCooldown = state.momentumCooldown ?? { home: 0, away: 0 }
    this.teamFouls = state.teamFoulsThisQuarter ?? { home: 0, away: 0 }
    this.userTimeoutsRemaining = state.userTimeoutsRemaining ?? 4
    this.nextPossessionStart = state.nextPossessionStart ?? 'dead_ball'
    this.pendingFoulOutIds = state.pendingFoulOutIds ?? []
    this.pendingFreeThrows = state.pendingFreeThrows ?? null
    const mid = state.midQuarter ?? null
    if (mid) {
      this.timeRemaining = mid.timeRemaining
      this.pendingPossessionTeam = mid.possessionTeam ?? null
      this.minutesSinceLastRotation = mid.minutesSinceLastRotation ?? 0
      this.scoreAtQuarterStart = mid.scoreAtQuarterStart
        ?? { home: this.homeScore, away: this.awayScore }
    } else {
      this.pendingPossessionTeam = null
      this.minutesSinceLastRotation = 0
      this.scoreAtQuarterStart = { home: this.homeScore, away: this.awayScore }
    }

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

    // Pre-adjustment lineups — used below to identify newcomers when a
    // sanitization needs to displace someone (pending-FT shooter guard).
    const preLineupIds = {
      home: new Set(this.homeLineup.map(p => String(p.id))),
      away: new Set(this.awayLineup.map(p => String(p.id))),
    }

    // Accept both camelCase and snake_case field names
    const homeLineup = adjustments.homeLineup || adjustments.home_lineup || null
    const awayLineup = adjustments.awayLineup || adjustments.away_lineup || null
    const offStyle = adjustments.offensiveStyle || adjustments.offensive_style || null
    const defStyle = adjustments.defensiveStyle || adjustments.defensive_style || null
    // Updated defensive matchup overrides from the quarter-break editor.
    const matchups = adjustments.defensiveMatchups ?? adjustments.defensive_matchups
    if (matchups) this.userDefensiveMatchups = matchups

    // Pacing change on resume: the preview screen lets the user re-pick the
    // mode for an in-progress game. Applied before the segment/quarter loop
    // reads this.pacingMode, so it takes effect immediately. Switching is
    // safe at any save point — a mid-quarter state resumed into 'quarter'
    // simply runs one segment to the quarter end, and a quarter-boundary
    // state resumed into 'play'/'deadBall' starts the next quarter segmented.
    const pacing = adjustments.pacingMode ?? adjustments.pacing_mode ?? null
    if (pacing && ['quarter', 'play', 'deadBall'].includes(pacing)) {
      this.pacingMode = pacing
    }

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

    // Sanitize: an incoming lineup (e.g. a stale quarter-break selection)
    // must not re-insert a player who has fouled out.
    for (const side of ['home', 'away']) {
      const lineup = side === 'home' ? this.homeLineup : this.awayLineup
      const boxScore = side === 'home' ? this.homeBoxScore : this.awayBoxScore
      for (const p of [...lineup]) {
        if (p && (boxScore[p.id]?.fouls ?? 0) >= 6) {
          this._replaceFouledOutPlayer(p.id, side)
        }
      }
    }

    // Sanitize: the pending free-throw shooter cannot be substituted out
    // mid-trip (real rule — the fouled player shoots). If the incoming
    // lineup benched them, put them back in the slot of one of the
    // newcomers (defense-in-depth behind the subs-UI lock).
    const pendingFt = this.pendingFreeThrows
    if (pendingFt && pendingFt.shooterId != null) {
      const side = pendingFt.team
      const lineup = side === 'home' ? this.homeLineup : this.awayLineup
      const players = side === 'home' ? this.homePlayers : this.awayPlayers
      const shooterOnCourt = lineup.some(p => String(p.id) === String(pendingFt.shooterId))
      if (!shooterOnCourt) {
        const shooter = players.find(p => String(p.id) === String(pendingFt.shooterId))
        if (shooter) {
          // Displace the newcomer who took the shooter's place (a lineup
          // player who wasn't on court before this adjustment); fall back
          // to the last slot if every slot is a holdover.
          const newcomerIdx = lineup.findIndex(p => !preLineupIds[side].has(String(p.id)))
          lineup[newcomerIdx !== -1 ? newcomerIdx : lineup.length - 1] = shooter
        }
      }
    }
  }
}

export default GameSimulator
