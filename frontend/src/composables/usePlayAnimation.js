import { ref, computed, watch } from 'vue'

/**
 * Composable for managing play-by-play animation state and controls.
 */
export function usePlayAnimation() {
  // Animation state
  const animationData = ref(null)
  const currentPossessionIndex = ref(0)
  const currentKeyframeIndex = ref(0)
  const isPlaying = ref(false)
  const playbackSpeed = ref(1) // 0.5x, 1x, 2x, 4x
  const elapsedTime = ref(0)

  // Quarter break state
  const quarterEndIndices = ref([])
  const isQuarterBreak = ref(false)
  const completedQuarter = ref(0)
  const isLiveMode = ref(false)  // True for quarter-by-quarter simulation

  // Segmented pacing (play / deadBall modes): the loaded animation data is a
  // partial-quarter segment. `pendingBreakInfo` is the engine's breakInfo for
  // the loaded segment; when playback reaches the end of a non-quarter-final
  // segment we raise `isSegmentPause` instead of `isQuarterBreak`.
  const isSegmentPause = ref(false)
  const pendingBreakInfo = ref(null)

  // Animation frame ID for cleanup
  let animationFrameId = null
  let lastTimestamp = null

  // Delayed score display - syncs with the +2/+3 animation on court
  const displayedHomeScore = ref(0)
  const displayedAwayScore = ref(0)
  const displayedBoxScore = ref(null)
  // Momentum display refs — same staggered pattern as the scoreboard so the UI
  // swings on the same beat as the +2/+3 animation rather than jumping the
  // instant a possession's outcome is known.
  const displayedHomeMomentum = ref(50)
  const displayedAwayMomentum = ref(50)
  let scoreUpdateTimeout = null

  // Computed properties
  const totalPossessions = computed(() => {
    return animationData.value?.possessions?.length || 0
  })

  const currentPossession = computed(() => {
    if (!animationData.value?.possessions) return null
    return animationData.value.possessions[currentPossessionIndex.value] || null
  })

  const currentKeyframe = computed(() => {
    if (!currentPossession.value?.keyframes) return null
    return currentPossession.value.keyframes[currentKeyframeIndex.value] || null
  })

  const totalKeyframes = computed(() => {
    return currentPossession.value?.keyframes?.length || 0
  })

  const possessionDuration = computed(() => {
    return currentPossession.value?.duration || 0
  })

  const progress = computed(() => {
    if (!currentPossession.value) return 0
    const duration = possessionDuration.value
    if (duration <= 0) return 0
    return Math.min(1, elapsedTime.value / duration)
  })

  const currentPlayName = computed(() => {
    return currentPossession.value?.play_name || 'Unknown Play'
  })

  const currentTeam = computed(() => {
    return currentPossession.value?.team || 'home'
  })

  const currentQuarter = computed(() => {
    return currentPossession.value?.quarter || 1
  })

  /**
   * Running score - uses delayed display refs that sync with the +2/+3 animation.
   * Scores update ~1 second after possession changes (when score animation finishes).
   */
  const currentHomeScore = computed(() => displayedHomeScore.value)
  const currentAwayScore = computed(() => displayedAwayScore.value)
  const currentHomeMomentum = computed(() => displayedHomeMomentum.value)
  const currentAwayMomentum = computed(() => displayedAwayMomentum.value)

  /**
   * Force the displayed scores to a specific value. Used after a sim-to-end
   * jump from quarter break — the animation hasn't played the rest of the
   * game, so the displayed scores still reflect the previous quarter. The
   * caller passes the final scores from the simulation result.
   */
  function setDisplayedScores(home, away, boxScore = null) {
    if (scoreUpdateTimeout) {
      clearTimeout(scoreUpdateTimeout)
      scoreUpdateTimeout = null
    }
    if (typeof home === 'number') displayedHomeScore.value = home
    if (typeof away === 'number') displayedAwayScore.value = away
    if (boxScore) displayedBoxScore.value = boxScore
  }

  // Watch for possession changes and update scores with delay to sync with +2/+3 animation
  watch(currentPossessionIndex, (newIndex, oldIndex) => {
    // Clear any pending score update
    if (scoreUpdateTimeout) {
      clearTimeout(scoreUpdateTimeout)
      scoreUpdateTimeout = null
    }

    // Skip when resetting to 0 from a higher index (happens when loading new animation data)
    // The loadAnimationData function handles setting the correct starting scores
    if (newIndex === 0 && oldIndex > 0) return

    // Only process when moving forward through possessions
    if (newIndex <= oldIndex) return

    if (!animationData.value?.possessions) return

    // The possession that just finished
    const justFinished = animationData.value.possessions[oldIndex]
    // The possession before the one that just finished
    const beforeJustFinished = oldIndex > 0 ? animationData.value.possessions[oldIndex - 1] : null

    if (!justFinished) return

    // Target score is from the just-finished possession
    const targetHome = justFinished.home_score || 0
    const targetAway = justFinished.away_score || 0

    // Check if scoring happened in the just-finished possession
    const homeScored = targetHome !== (beforeJustFinished?.home_score || 0)
    const awayScored = targetAway !== (beforeJustFinished?.away_score || 0)

    // Get the box score from the just-finished possession
    const targetBoxScore = justFinished.box_score || null

    // Momentum is stamped on the just-finished possession too. Display it on
    // the same beat as the scoreboard so the bar swings *with* the +2/+3
    // animation rather than ahead of it.
    const targetHomeMomentum = justFinished.momentum?.home ?? displayedHomeMomentum.value
    const targetAwayMomentum = justFinished.momentum?.away ?? displayedAwayMomentum.value

    if (homeScored || awayScored) {
      // Scoring happened - delay update to sync with the +2/+3 animation
      scoreUpdateTimeout = setTimeout(() => {
        displayedHomeScore.value = targetHome
        displayedAwayScore.value = targetAway
        displayedBoxScore.value = targetBoxScore
        displayedHomeMomentum.value = targetHomeMomentum
        displayedAwayMomentum.value = targetAwayMomentum
      }, 250)
    } else {
      // No score change - update immediately
      displayedHomeScore.value = targetHome
      displayedAwayScore.value = targetAway
      displayedBoxScore.value = targetBoxScore
      displayedHomeMomentum.value = targetHomeMomentum
      displayedAwayMomentum.value = targetAwayMomentum
    }
  })

  /**
   * Current box score from animation data (updates per possession).
   * Uses delayed display ref that syncs with the +2/+3 animation.
   */
  const currentBoxScore = computed(() => {
    return displayedBoxScore.value
  })

  /**
   * Activated synergies from the current possession (for canvas animations).
   * Live-filtered by `elapsedTime` so each synergy fires when the play
   * actually completes (end-of-play, when the shot resolves).
   */
  const currentActivatedSynergies = computed(() => {
    const all = currentPossession.value?.activated_synergies || []
    if (all.length === 0) return all
    const cutoff = elapsedTime.value
    return all.filter(s => (s.time ?? 0) <= cutoff)
  })

  /**
   * Player ids participating in ANY synergy fired on this possession. Used
   * to SUPPRESS those players' individual badge animations — a synergy hit
   * takes precedence over the base badge animations for the players involved.
   *
   * Uses the FULL possession synergy list (not time-filtered) so badges are
   * suppressed for the entire play once we know a synergy will fire on it.
   * Otherwise badges fire early in the play, then the synergy hits late, and
   * the user has already seen a stream of triple-badge animations before the
   * synergy purple flourish takes over.
   */
  const synergySuppressedPlayerIds = computed(() => {
    const set = new Set()
    const all = currentPossession.value?.activated_synergies || []
    for (const s of all) {
      if (s.player1?.id) set.add(String(s.player1.id))
      if (s.player2?.id) set.add(String(s.player2.id))
    }
    return set
  })

  /**
   * Activated badges from current possession (for canvas animations).
   *
   * Live-filtered by `elapsedTime` so badges only enter the list when their
   * action has reached its end-of-action timestamp. Badges for players who
   * are part of an active synergy are filtered out so the synergy animation
   * is the sole effect shown for those players.
   *
   * Additionally, capped to ONE badge per player per possession — picking
   * the latest in `time` so the animation lands near play resolution rather
   * than firing at the start of an upstream pass/screen. Without this cap,
   * a player with multiple relevant badges (e.g. catch_and_shoot +
   * corner_specialist + deadeye on a corner three) would have all three
   * pop in succession via the 550ms stagger in BasketballCourt, producing
   * a noisy stream rather than a single readable beat.
   */
  const currentActivatedBadges = computed(() => {
    const all = currentPossession.value?.activated_badges || []
    if (all.length === 0) return all
    const cutoff = elapsedTime.value
    const suppressed = synergySuppressedPlayerIds.value

    // First pass: filter to badges that are due AND not synergy-suppressed.
    const due = all.filter(b => {
      if ((b.time ?? 0) > cutoff) return false
      if (suppressed.has(String(b.playerId))) return false
      return true
    })

    // Second pass: keep only the latest-in-time badge per player.
    const latestPerPlayer = new Map()
    for (const b of due) {
      const pid = String(b.playerId)
      const existing = latestPerPlayer.get(pid)
      if (!existing || (b.time ?? 0) >= (existing.time ?? 0)) {
        latestPerPlayer.set(pid, b)
      }
    }
    return [...latestPerPlayer.values()]
  })

  /**
   * Check if current possession ends a quarter (Q1-Q3 only, Q4 ends game).
   */
  const isAtQuarterEnd = computed(() => {
    if (!quarterEndIndices.value.length) return false
    // possession_id is 1-indexed, we need to match it
    const currentId = currentPossession.value?.possession_id
    // Only pause for Q1, Q2, Q3 (indices 0, 1, 2)
    const q1End = quarterEndIndices.value[0]
    const q2End = quarterEndIndices.value[1]
    const q3End = quarterEndIndices.value[2]
    return currentId === q1End || currentId === q2End || currentId === q3End
  })

  /**
   * Interpolate positions between two keyframes based on time.
   */
  const interpolatedPositions = computed(() => {
    if (!currentPossession.value?.keyframes || totalKeyframes.value === 0) {
      return {}
    }

    const keyframes = currentPossession.value.keyframes

    // Find the two keyframes we're between
    let prevKeyframe = keyframes[0]
    let nextKeyframe = keyframes[0]
    let prevTime = 0
    let nextTime = 0

    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i]
      const kfTime = kf.time || 0

      if (kfTime <= elapsedTime.value) {
        prevKeyframe = kf
        prevTime = kfTime
      }

      if (kfTime > elapsedTime.value) {
        nextKeyframe = kf
        nextTime = kfTime
        break
      } else {
        nextKeyframe = kf
        nextTime = kfTime
      }
    }

    // Calculate interpolation factor
    const duration = nextTime - prevTime
    const t = duration > 0 ? Math.min(1, (elapsedTime.value - prevTime) / duration) : 1

    // Interpolate player positions
    const positions = {}
    const prevPositions = prevKeyframe.positions || {}
    const nextPositions = nextKeyframe.positions || {}

    // Get all player IDs from both keyframes
    const playerIds = new Set([...Object.keys(prevPositions), ...Object.keys(nextPositions)])

    for (const playerId of playerIds) {
      const prev = prevPositions[playerId] || { x: 0.5, y: 0.5, hasBall: false }
      const next = nextPositions[playerId] || prev

      positions[playerId] = {
        x: lerp(prev.x, next.x, easeInOutQuad(t)),
        y: lerp(prev.y, next.y, easeInOutQuad(t)),
        hasBall: next.hasBall,
        lineupIndex: next.lineupIndex ?? prev.lineupIndex ?? null
      }
    }

    return positions
  })

  /**
   * Interpolate ball position between keyframes.
   */
  const interpolatedBallPosition = computed(() => {
    if (!currentPossession.value?.keyframes || totalKeyframes.value === 0) {
      return { x: 0.5, y: 0.5 }
    }

    const keyframes = currentPossession.value.keyframes

    // Find the two keyframes we're between
    let prevKeyframe = keyframes[0]
    let nextKeyframe = keyframes[0]
    let prevTime = 0
    let nextTime = 0

    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i]
      const kfTime = kf.time || 0

      if (kfTime <= elapsedTime.value) {
        prevKeyframe = kf
        prevTime = kfTime
      }

      if (kfTime > elapsedTime.value) {
        nextKeyframe = kf
        nextTime = kfTime
        break
      } else {
        nextKeyframe = kf
        nextTime = kfTime
      }
    }

    // Calculate interpolation factor
    const duration = nextTime - prevTime
    const t = duration > 0 ? Math.min(1, (elapsedTime.value - prevTime) / duration) : 1

    const prevBall = prevKeyframe.ball || { x: 0.5, y: 0.5 }
    const nextBall = nextKeyframe.ball || prevBall

    // Flight metadata rides the DESTINATION keyframe (set by the engine on
    // shot flights, miss bounces, and passes). The court is a TOP-DOWN view,
    // so apex "height" is a 0..1 scale factor for the renderer (ball swells
    // toward the camera mid-flight) — never a screen-space offset; the ball
    // travels the straight ground line between keyframes.
    //
    // `traveling` gates ALL motion effects: it's true only strictly between
    // two distinct keyframes, before arrival. Once the ball ARRIVES —
    // including sitting past the play's final keyframe during the
    // end-of-play hold (turnovers, dead balls) — spin and airborne effects
    // stop, even though we're still reading the same destination keyframe.
    const traveling = nextTime > prevTime && elapsedTime.value < nextTime
    const inFlight = traveling && (nextBall.inFlight || false)
    const height = inFlight
      ? (nextBall.height ?? 0) * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI)
      : 0

    const x = lerp(prevBall.x, nextBall.x, easeInOutQuad(t))
    const y = lerp(prevBall.y, nextBall.y, easeInOutQuad(t))

    return {
      x,
      y,
      inFlight,
      // Apex-height factor (0 at both endpoints, peaks mid-segment).
      height,
      // Spin only while traveling toward a spinning destination — freezes
      // the moment the ball arrives (catch / rim / net / turnover frame).
      spin: traveling ? (nextBall.spin ?? null) : null,
      // Swish: hold at the rim while the renderer shrinks/fades the ball
      // down through the net. throughT is progress through that drop.
      through: nextBall.through === true,
      throughT: nextBall.through === true ? Math.min(1, Math.max(0, t)) : 0,
    }
  })

  /**
   * Current action description.
   */
  const currentDescription = computed(() => {
    if (!currentKeyframe.value) return ''
    return currentKeyframe.value.description || ''
  })

  /**
   * Current action type.
   */
  const currentAction = computed(() => {
    if (!currentKeyframe.value) return ''
    return currentKeyframe.value.action || ''
  })

  // Methods

  /**
   * Load animation data from game result.
   * @param {Object} data - Animation data with possessions
   * @param {Object} options - Optional settings
   * @param {boolean} options.isLive - True for live quarter-by-quarter mode
   * @param {number} options.quarter - Current quarter number (for live mode)
   */
  function loadAnimationData(data, options = {}) {
    stop()
    // Clear any pending score update
    if (scoreUpdateTimeout) {
      clearTimeout(scoreUpdateTimeout)
      scoreUpdateTimeout = null
    }
    animationData.value = data
    currentPossessionIndex.value = 0
    currentKeyframeIndex.value = 0
    elapsedTime.value = 0

    // Initialize displayed scores and box score
    // Use provided starting scores if available, otherwise default to 0-0
    if (options.startingHomeScore !== undefined && options.startingAwayScore !== undefined) {
      displayedHomeScore.value = options.startingHomeScore
      displayedAwayScore.value = options.startingAwayScore
    } else {
      displayedHomeScore.value = 0
      displayedAwayScore.value = 0
    }
    // Reset momentum to neutral on new animation load.
    displayedHomeMomentum.value = 50
    displayedAwayMomentum.value = 50

    // Initialize box score from starting box score or first possession
    if (options.startingBoxScore) {
      displayedBoxScore.value = options.startingBoxScore
    } else if (data?.possessions?.[0]?.box_score) {
      displayedBoxScore.value = data.possessions[0].box_score
    } else {
      displayedBoxScore.value = null
    }

    // Initialize quarter break state
    quarterEndIndices.value = data?.quarter_end_indices || []
    isQuarterBreak.value = false
    // Segmented pacing: remember the break that ends this segment (null in
    // legacy quarter mode) so the end-of-data handler knows whether to raise
    // a segment pause or a quarter break.
    pendingBreakInfo.value = options.breakInfo ?? null
    isSegmentPause.value = false
    // For live mode, track the quarter we're about to play
    isLiveMode.value = options.isLive || false
    if (options.quarter) {
      completedQuarter.value = options.quarter - 1  // Will become this quarter when done
    } else {
      completedQuarter.value = 0
    }
  }

  /**
   * Start or resume animation playback.
   */
  function play() {
    if (!animationData.value || totalPossessions.value === 0) return

    isPlaying.value = true
    lastTimestamp = null
    animationFrameId = requestAnimationFrame(animationLoop)
  }

  /**
   * Pause animation playback.
   */
  function pause() {
    isPlaying.value = false
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  /**
   * Stop and reset animation.
   */
  function stop() {
    pause()
    currentPossessionIndex.value = 0
    currentKeyframeIndex.value = 0
    elapsedTime.value = 0
  }

  /**
   * Toggle play/pause.
   */
  function togglePlayPause() {
    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  /**
   * Go to next possession.
   */
  function nextPossession() {
    if (currentPossessionIndex.value < totalPossessions.value - 1) {
      currentPossessionIndex.value++
      currentKeyframeIndex.value = 0
      elapsedTime.value = 0
    }
  }

  /**
   * Go to previous possession.
   */
  function previousPossession() {
    if (currentPossessionIndex.value > 0) {
      currentPossessionIndex.value--
      currentKeyframeIndex.value = 0
      elapsedTime.value = 0
    }
  }

  /**
   * Jump to specific possession.
   */
  function goToPossession(index) {
    if (index >= 0 && index < totalPossessions.value) {
      currentPossessionIndex.value = index
      currentKeyframeIndex.value = 0
      elapsedTime.value = 0
    }
  }

  /**
   * Set playback speed.
   */
  function setSpeed(speed) {
    playbackSpeed.value = speed
  }

  /**
   * Seek to specific time within current possession.
   */
  function seekTo(time) {
    elapsedTime.value = Math.max(0, Math.min(time, possessionDuration.value))
    updateKeyframeIndex()
  }

  /**
   * Continue after quarter break.
   */
  function continueAfterQuarterBreak() {
    isQuarterBreak.value = false
    if (currentPossessionIndex.value < totalPossessions.value - 1) {
      currentPossessionIndex.value++
      currentKeyframeIndex.value = 0
      elapsedTime.value = 0
      play()
    }
  }

  /**
   * Animation loop.
   */
  function animationLoop(timestamp) {
    if (!isPlaying.value) return

    if (lastTimestamp === null) {
      lastTimestamp = timestamp
    }

    const deltaTime = (timestamp - lastTimestamp) / 1000 // Convert to seconds
    lastTimestamp = timestamp

    // Calculate effective speed - 1x displays as 1x but runs at 0.935 for smoother viewing
    const effectiveSpeed = playbackSpeed.value === 1 ? 0.935 : playbackSpeed.value

    // Update elapsed time based on playback speed
    elapsedTime.value += deltaTime * effectiveSpeed

    // Check if we've finished the current possession
    if (elapsedTime.value >= possessionDuration.value) {
      // Check for quarter break BEFORE advancing
      if (isAtQuarterEnd.value && completedQuarter.value < currentQuarter.value) {
        // Update displayed scores and box score immediately for quarter break
        // (no next possession means no +2/+3 animation to wait for)
        if (currentPossession.value) {
          displayedHomeScore.value = currentPossession.value.home_score || 0
          displayedAwayScore.value = currentPossession.value.away_score || 0
          displayedBoxScore.value = currentPossession.value.box_score || null
        }
        completedQuarter.value = currentQuarter.value
        isQuarterBreak.value = true
        pause()
        return
      }

      // Move to next possession
      if (currentPossessionIndex.value < totalPossessions.value - 1) {
        currentPossessionIndex.value++
        currentKeyframeIndex.value = 0
        elapsedTime.value = 0
      } else {
        // Reached end of animation data
        if (isLiveMode.value) {
          // Sync displayed scores/box to the final possession — there is no
          // next possession, so no +2/+3 animation to wait for.
          if (currentPossession.value) {
            displayedHomeScore.value = currentPossession.value.home_score || 0
            displayedAwayScore.value = currentPossession.value.away_score || 0
            displayedBoxScore.value = currentPossession.value.box_score || null
          }
          // Segmented pacing: a mid-quarter segment ends in a segment pause
          // (lightweight break bar), NOT a quarter break — completedQuarter
          // is left untouched so the quarter-break modal stays hidden.
          if (pendingBreakInfo.value && !pendingBreakInfo.value.quarterComplete) {
            isSegmentPause.value = true
            pause()
            return
          }
          // Quarter (or quarter-final segment) complete → quarter break.
          completedQuarter.value = currentQuarter.value
          isQuarterBreak.value = true
          pause()
          return
        } else {
          // Replay mode - animation complete
          pause()
          return
        }
      }
    }

    // Update keyframe index
    updateKeyframeIndex()

    // Continue animation
    animationFrameId = requestAnimationFrame(animationLoop)
  }

  /**
   * Update current keyframe index based on elapsed time.
   */
  function updateKeyframeIndex() {
    if (!currentPossession.value?.keyframes) return

    const keyframes = currentPossession.value.keyframes
    for (let i = 0; i < keyframes.length; i++) {
      const kfTime = keyframes[i].time || 0
      if (kfTime <= elapsedTime.value) {
        currentKeyframeIndex.value = i
      } else {
        break
      }
    }
  }

  /**
   * Cleanup on unmount.
   */
  function cleanup() {
    pause()
    if (scoreUpdateTimeout) {
      clearTimeout(scoreUpdateTimeout)
      scoreUpdateTimeout = null
    }
  }

  return {
    // State
    animationData,
    currentPossessionIndex,
    currentKeyframeIndex,
    isPlaying,
    playbackSpeed,
    elapsedTime,
    isQuarterBreak,
    completedQuarter,
    isLiveMode,
    isSegmentPause,
    pendingBreakInfo,

    // Computed
    totalPossessions,
    currentPossession,
    currentKeyframe,
    totalKeyframes,
    possessionDuration,
    progress,
    currentPlayName,
    currentTeam,
    currentQuarter,
    currentHomeScore,
    currentAwayScore,
    currentHomeMomentum,
    currentAwayMomentum,
    currentBoxScore,
    currentActivatedBadges,
    currentActivatedSynergies,
    interpolatedPositions,
    interpolatedBallPosition,
    currentDescription,
    currentAction,

    // Methods
    loadAnimationData,
    play,
    pause,
    stop,
    togglePlayPause,
    nextPossession,
    previousPossession,
    goToPossession,
    setSpeed,
    seekTo,
    continueAfterQuarterBreak,
    setDisplayedScores,
    cleanup
  }
}

// Utility functions

/**
 * Linear interpolation.
 */
function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Ease in-out quadratic for smooth animation.
 */
function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export default usePlayAnimation
