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

  // Animation frame ID for cleanup
  let animationFrameId = null
  let lastTimestamp = null

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
   * Running score from current possession.
   */
  const currentHomeScore = computed(() => {
    return currentPossession.value?.home_score || 0
  })

  const currentAwayScore = computed(() => {
    return currentPossession.value?.away_score || 0
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
        hasBall: next.hasBall
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

    // Check if ball is in flight (for arc animation)
    const inFlight = nextBall.inFlight || false
    const arc = nextBall.arc || 0

    let x = lerp(prevBall.x, nextBall.x, easeInOutQuad(t))
    let y = lerp(prevBall.y, nextBall.y, easeInOutQuad(t))

    // Apply arc for passes
    if (inFlight && arc > 0) {
      // Parabolic arc: highest at t=0.5
      const arcHeight = arc * Math.sin(t * Math.PI)
      y -= arcHeight
    }

    return { x, y, inFlight }
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
    animationData.value = data
    currentPossessionIndex.value = 0
    currentKeyframeIndex.value = 0
    elapsedTime.value = 0
    // Initialize quarter break state
    quarterEndIndices.value = data?.quarter_end_indices || []
    isQuarterBreak.value = false
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

    // Update elapsed time based on playback speed
    elapsedTime.value += deltaTime * playbackSpeed.value

    // Check if we've finished the current possession
    if (elapsedTime.value >= possessionDuration.value) {
      // Check for quarter break BEFORE advancing
      if (isAtQuarterEnd.value && completedQuarter.value < currentQuarter.value) {
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
          // In live mode, reaching the end means quarter is complete
          // Trigger quarter break so user can continue to next quarter
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
