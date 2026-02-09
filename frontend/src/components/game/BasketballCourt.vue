<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { NBA_COURT, COURT_CANVAS } from '@/config/courtConfig'

const MOBILE_BREAKPOINT = 620

const props = defineProps({
  width: {
    type: Number,
    default: COURT_CANVAS.DEFAULT_WIDTH
  },
  height: {
    type: Number,
    default: COURT_CANVAS.DEFAULT_HEIGHT
  },
  homeTeam: {
    type: Object,
    default: null
  },
  awayTeam: {
    type: Object,
    default: null
  },
  activePossession: {
    type: String,
    default: 'home'
  },
  ballPosition: {
    type: Object,
    default: () => ({ x: 0.5, y: 0.5 })
  },
  playerPositions: {
    type: Array,
    default: () => []
  },
  showPlayers: {
    type: Boolean,
    default: true
  },
  animationMode: {
    type: Boolean,
    default: false
  },
  interpolatedPositions: {
    type: Object,
    default: () => ({})
  },
  interpolatedBallPosition: {
    type: Object,
    default: null
  },
  homeRoster: {
    type: Array,
    default: () => []
  },
  awayRoster: {
    type: Array,
    default: () => []
  },
  showTrails: {
    type: Boolean,
    default: true
  },
  playName: {
    type: String,
    default: ''
  },
  playDescription: {
    type: String,
    default: ''
  },
  playTeamAbbreviation: {
    type: String,
    default: ''
  },
  playTeamColor: {
    type: String,
    default: '#3B82F6'
  },
  gameClock: {
    type: String,
    default: ''
  },
  activatedBadges: {
    type: Array,
    default: () => []
  }
})

const positionHistory = ref({})
const canvas = ref(null)
const ctx = ref(null)
const isMobile = ref(window.innerWidth <= MOBILE_BREAKPOINT)

// Score animation state
const scoreAnimation = ref(null)  // { points: 2|3, progress: 0-1, startTime: timestamp }

// Badge animation state
const badgeAnimations = ref([])  // Array of { badgeId, level, playerName, x, y, progress, startTime }
const lastAnimatedBadges = ref('')  // Track last animated badges to prevent duplicates

// Crowd celebration animation state
const crowdCelebrations = ref([])  // Array of { emoji, x, y, progress, startTime }

// On-court defensive animation state (emanates from player position)
const defensiveAnimations = ref([])  // Array of { emoji, x, y, progress, startTime, dx, dy }

// Defensive celebration emojis
const defensiveEmojis = ['🛡️', '🚫', '✋', '💪', '🔒', '❌']

// Crowd jumping animation state
const crowdJumping = ref(false)
const crowdJumpStartTime = ref(0)
const jumpingFans = ref([])  // Array of { index, delay } - which fans are jumping and their start delay
const jumpingTeam = ref('home')  // Which team's fans are jumping ('home' or 'away')

// Stable away fan indices (so they don't change every frame)
const stableAwayFanIndices = ref(new Set())

function handleResize() {
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
}

function triggerScoreAnimation(points = 2, isHomeTeam = true) {
  scoreAnimation.value = {
    points,
    progress: 0,
    startTime: performance.now()
  }
  animateScore()

  // Trigger crowd celebration - home fans for home scores, away fans for away scores
  triggerCrowdCelebration(isHomeTeam)
}

function animateScore() {
  if (!scoreAnimation.value) return

  const elapsed = performance.now() - scoreAnimation.value.startTime
  const duration = 1200  // 1.2 seconds
  scoreAnimation.value.progress = Math.min(1, elapsed / duration)

  drawCourt()

  if (scoreAnimation.value.progress < 1) {
    requestAnimationFrame(animateScore)
  } else {
    scoreAnimation.value = null
    drawCourt()
  }
}

/**
 * Trigger defensive animation at a player's position on the court.
 * Creates emojis that burst outward from the player who was blocked/stolen.
 * @param {number} x - X position (0-1 normalized)
 * @param {number} y - Y position (0-1 normalized)
 * @param {string} type - 'block' or 'steal'
 */
function triggerDefensiveAnimationAtPosition(x, y, type = 'block') {
  const emojis = type === 'block' ? ['🛡️', '✋', '🚫', '❌']
               : type === 'steal' ? ['🔒', '💪', '👊', '⚡']
               : ['🛡️', '💪', '🔒', '✋']

  // Create single emoji that rises up from the player position
  defensiveAnimations.value.push({
    emoji: emojis[Math.floor(Math.random() * emojis.length)],
    x,  // Normalized position
    y,
    dx: 0,
    dy: -0.15,  // Rise upward
    progress: 0,
    startTime: performance.now()
  })

  if (defensiveAnimations.value.length === 1) {
    animateDefensiveAnimations()
  }
}

function animateDefensiveAnimations() {
  if (defensiveAnimations.value.length === 0) return

  const now = performance.now()
  const duration = 800  // 0.8 seconds

  defensiveAnimations.value = defensiveAnimations.value.filter(anim => {
    const elapsed = now - anim.startTime
    anim.progress = Math.min(1, elapsed / duration)
    return anim.progress < 1
  })

  drawCourt()

  if (defensiveAnimations.value.length > 0) {
    requestAnimationFrame(animateDefensiveAnimations)
  }
}

/**
 * Trigger a badge activation animation at a player's position.
 * @param {Object} badge - Badge info { badgeId, level, playerName, playerId }
 * @param {number} x - X position (0-1)
 * @param {number} y - Y position (0-1)
 */
function triggerBadgeAnimation(badge, x = 0.5, y = 0.5) {
  const animation = {
    ...badge,
    x,
    y,
    progress: 0,
    startTime: performance.now()
  }
  badgeAnimations.value.push(animation)
  animateBadges()
}

function animateBadges() {
  if (badgeAnimations.value.length === 0) return

  const now = performance.now()
  const duration = 1500  // 1.5 seconds

  // Update all badge animations
  badgeAnimations.value = badgeAnimations.value.filter(anim => {
    const elapsed = now - anim.startTime
    anim.progress = Math.min(1, elapsed / duration)
    return anim.progress < 1  // Keep only active animations
  })

  drawCourt()

  if (badgeAnimations.value.length > 0) {
    requestAnimationFrame(animateBadges)
  } else {
    drawCourt()
  }
}

/**
 * Trigger crowd celebration when a team scores
 * @param {boolean} isHomeTeam - Whether the scoring team is home
 */
function triggerCrowdCelebration(isHomeTeam = true) {
  const w = courtWidth.value
  const h = courtHeight.value
  const crowdH = crowdAreaHeight.value
  const celebrationEmojis = ['🎉', '🙌', '👏', '💪', '⭐', '🏀']

  // Both home and away fans show emojis ~75% of the time
  const showEmojis = Math.random() < 0.75

  if (showEmojis) {
    // Fewer celebrations for away team (they have fewer fans)
    const numCelebrations = isHomeTeam ? (4 + Math.floor(Math.random() * 3)) : (2 + Math.floor(Math.random() * 2))

    for (let i = 0; i < numCelebrations; i++) {
      const delay = i * 80  // Stagger the celebrations
      setTimeout(() => {
        let emojiX, emojiY
        if (isMobile.value) {
          // Mobile: crowd is on right side, so x is near right edge, y is random along height
          emojiX = w - crowdH + (Math.random() * crowdH * 0.5)
          emojiY = h * (0.1 + Math.random() * 0.8)
        } else {
          // Desktop: crowd is below baseline, so x is random across width
          emojiX = w * (0.1 + Math.random() * 0.8)
          emojiY = null  // Will be calculated in draw function
        }
        crowdCelebrations.value.push({
          emoji: celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)],
          x: emojiX,
          y: emojiY,
          progress: 0,
          startTime: performance.now()
        })
        if (crowdCelebrations.value.length === 1) {
          animateCrowdCelebrations()
        }
      }, delay)
    }
  }

  // Always trigger jumping fans for the scoring team
  triggerCrowdJump(isHomeTeam)
}

/**
 * Trigger defensive celebration (blocks, steals, stops)
 * Now just triggers crowd jump - on-court animations are handled by triggerDefensiveAnimationAtPosition
 * @param {boolean} isHomeTeam - Whether the defending team is home
 * @param {string} type - 'block', 'steal', or 'stop' (kept for API compatibility)
 */
function triggerDefensiveCelebration(isHomeTeam = true, type = 'block') {
  // Trigger crowd jump for the defending team's fans
  triggerCrowdJump(isHomeTeam)
}

/**
 * Trigger fans to jump up and down
 * @param {boolean} isHomeTeam - Whether the scoring team is home (determines which fans jump)
 */
function triggerCrowdJump(isHomeTeam = true) {
  // Don't start a new jump if one is already in progress
  if (crowdJumping.value) return

  const totalFans = isMobile.value ? 20 : 18  // Match crowd density (mobile: 1 cameraman + 19 fans in 2 rows)
  jumpingTeam.value = isHomeTeam ? 'home' : 'away'

  // Get indices of fans for the scoring team
  const fans = []
  const teamFanIndices = []
  for (let i = 0; i < totalFans; i++) {
    const isAwayFan = stableAwayFanIndices.value.has(i)
    if (isHomeTeam && !isAwayFan) {
      teamFanIndices.push(i)
    } else if (!isHomeTeam && isAwayFan) {
      teamFanIndices.push(i)
    }
  }

  // ALL fans of the scoring team jump with staggered timing
  teamFanIndices.forEach(fanIndex => {
    fans.push({
      index: fanIndex,
      delay: Math.random() * 150  // 0-150ms staggered start
    })
  })

  jumpingFans.value = fans
  crowdJumping.value = true
  crowdJumpStartTime.value = performance.now()
  animateCrowdJump()
}

function animateCrowdJump() {
  if (!crowdJumping.value) return

  const elapsed = performance.now() - crowdJumpStartTime.value
  const duration = 600  // Total jump animation duration

  if (elapsed >= duration + 150) {  // Account for max delay
    crowdJumping.value = false
    jumpingFans.value = []
    drawCourt()
    return
  }

  drawCourt()
  requestAnimationFrame(animateCrowdJump)
}

/**
 * Calculate jump offset for a fan
 * @param {number} fanIndex - Index of the fan
 * @returns {number} Y offset (negative = up)
 */
function getJumpOffset(fanIndex) {
  if (!crowdJumping.value) return 0

  const fan = jumpingFans.value.find(f => f.index === fanIndex)
  if (!fan) return 0

  const elapsed = performance.now() - crowdJumpStartTime.value - fan.delay
  if (elapsed < 0) return 0  // Hasn't started yet

  const jumpDuration = 500
  const progress = Math.min(1, elapsed / jumpDuration)

  // Sine wave for smooth up and down motion - smaller jump for smaller crowd
  const jumpHeight = isMobile.value ? 5 : 6
  return -Math.sin(progress * Math.PI) * jumpHeight
}

function animateCrowdCelebrations() {
  if (crowdCelebrations.value.length === 0) return

  const now = performance.now()
  const duration = 1200  // 1.2 seconds

  // Update all celebration animations
  crowdCelebrations.value = crowdCelebrations.value.filter(anim => {
    const elapsed = now - anim.startTime
    anim.progress = Math.min(1, elapsed / duration)
    return anim.progress < 1
  })

  drawCourt()

  if (crowdCelebrations.value.length > 0) {
    requestAnimationFrame(animateCrowdCelebrations)
  } else {
    drawCourt()
  }
}

function drawCrowdCelebrations(c, courtH, crowdH) {
  const w = courtWidth.value

  crowdCelebrations.value.forEach(anim => {
    const { emoji, x, y: storedY, progress } = anim

    // Easing
    const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)

    // Fade out in second half
    const fadeProgress = Math.max(0, (progress - 0.4) / 0.6)
    const opacity = 1 - fadeProgress

    // Scale with slight bounce at start - smaller on mobile
    const scaleProgress = Math.min(1, progress * 3)
    const baseScale = isMobile.value ? 14 : 18
    const scale = 0.5 + 0.5 * Math.min(1, scaleProgress * 1.2)

    let drawX, drawY

    if (isMobile.value) {
      // Mobile: float leftward from right side (where fans are)
      const floatAmount = 40 * easeOutQuad(progress)
      drawX = x - floatAmount  // Float left toward court
      drawY = storedY
    } else {
      // Desktop: float upward from bottom (baseline crowd area)
      const riseAmount = 50 * easeOutQuad(progress)
      drawX = x
      drawY = courtH + crowdH * 0.3 - riseAmount
    }

    c.save()
    c.translate(drawX, drawY)

    // Counter-rotate on mobile so emoji appears upright after canvas rotation
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)
    }

    c.globalAlpha = opacity
    c.font = `${baseScale * scale}px Arial`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(emoji, 0, 0)

    c.restore()
  })
}

function drawBadgeAnimations(c) {
  const w = courtWidth.value
  const h = courtHeight.value

  badgeAnimations.value.forEach(anim => {
    const { badgeId, level, playerName, x, y, progress } = anim

    // Easing functions
    const easeOutBack = (t) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)

    // Animation phases
    const scaleProgress = Math.min(1, progress * 2.5)  // Scale up quickly
    const fadeProgress = Math.max(0, (progress - 0.5) / 0.5)  // Fade out second half
    const riseProgress = easeOutQuad(progress)

    // Calculate scale with bounce
    const scale = easeOutBack(scaleProgress) * 0.8

    // Calculate position (rise up)
    const riseAmount = 40 * riseProgress
    const canvasX = x * w
    const canvasY = (y * h) - riseAmount

    // Calculate opacity
    const opacity = 1 - fadeProgress

    // Badge level colors
    const levelColors = {
      hof: { bg: '#FFD700', glow: 'rgba(255, 215, 0, 0.6)' },      // Gold
      gold: { bg: '#FFA500', glow: 'rgba(255, 165, 0, 0.5)' },      // Orange
      silver: { bg: '#C0C0C0', glow: 'rgba(192, 192, 192, 0.4)' },  // Silver
      bronze: { bg: '#CD7F32', glow: 'rgba(205, 127, 50, 0.3)' }    // Bronze
    }
    const colors = levelColors[level] || levelColors.bronze

    c.save()
    c.translate(canvasX, canvasY)

    // Counter-rotate on mobile
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)
    }

    c.scale(scale, scale)
    c.globalAlpha = opacity

    // Draw glow effect
    const glowRadius = 30
    const gradient = c.createRadialGradient(0, 0, 0, 0, 0, glowRadius)
    gradient.addColorStop(0, colors.glow)
    gradient.addColorStop(1, 'transparent')
    c.beginPath()
    c.arc(0, 0, glowRadius, 0, Math.PI * 2)
    c.fillStyle = gradient
    c.fill()

    // Draw badge icon (shield shape)
    c.beginPath()
    c.moveTo(0, -15)
    c.lineTo(12, -8)
    c.lineTo(12, 5)
    c.lineTo(0, 15)
    c.lineTo(-12, 5)
    c.lineTo(-12, -8)
    c.closePath()
    c.fillStyle = colors.bg
    c.fill()
    c.strokeStyle = '#000'
    c.lineWidth = 2
    c.stroke()

    // Draw level indicator
    const levelText = level === 'hof' ? '★' : level[0].toUpperCase()
    c.font = 'bold 12px Arial'
    c.fillStyle = '#000'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(levelText, 0, 0)

    // Draw badge name below
    c.font = 'bold 10px Arial'
    c.fillStyle = '#FFFFFF'
    c.strokeStyle = '#000'
    c.lineWidth = 2
    const displayName = badgeId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    c.strokeText(displayName.substring(0, 12), 0, 28)
    c.fillText(displayName.substring(0, 12), 0, 28)

    c.restore()
  })
}

function drawDefensiveAnimations(c) {
  const w = courtWidth.value
  const h = courtHeight.value

  defensiveAnimations.value.forEach(anim => {
    const { emoji, x, y, dx, dy, progress } = anim

    // Easing for smooth animation
    const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)
    const easedProgress = easeOutQuad(progress)

    // Calculate position - start at player, burst outward
    const canvasX = (x + dx * easedProgress) * w
    const canvasY = (y + dy * easedProgress) * h

    // Fade out as it moves
    const opacity = 1 - progress

    // Scale: start bigger, shrink slightly
    const scale = 1.2 - (progress * 0.4)

    c.save()
    c.translate(canvasX, canvasY)

    // Counter-rotate on mobile
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)
    }

    c.globalAlpha = opacity
    c.font = `${Math.round(28 * scale)}px Arial`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(emoji, 0, 0)

    c.restore()
  })
}

const courtWidth = computed(() => props.width)
const courtHeight = computed(() => props.height)
// Smaller crowd on mobile, slightly smaller overall (mobile increased 10% for more space)
const crowdAreaHeight = computed(() => isMobile.value ? 38 : 35)
// On mobile, crowd is on the side so canvas height stays the same (no extra space needed at bottom)
// On desktop, crowd is below baseline so canvas height includes crowd area
const totalCanvasHeight = computed(() => isMobile.value ? props.height : props.height + crowdAreaHeight.value)

// Scale factors
// X maps court width (50 feet) to canvas width
// Y maps visible depth to canvas height
const scaleX = computed(() => courtWidth.value / NBA_COURT.FULL_WIDTH)
const scaleY = computed(() => courtHeight.value / COURT_CANVAS.VISIBLE_DEPTH)

// Court markings scale (shrink court elements by 15%)
const COURT_SCALE = 0.85

function drawCourt() {
  if (!ctx.value) return

  const c = ctx.value
  const w = courtWidth.value
  const h = courtHeight.value
  const totalH = totalCanvasHeight.value
  const crowdH = crowdAreaHeight.value
  const sx = scaleX.value
  const sy = scaleY.value

  // Scaled factors for court markings (shrunk by COURT_SCALE)
  const csx = sx * COURT_SCALE
  const csy = sy * COURT_SCALE

  // Clear entire canvas including crowd area
  c.clearRect(0, 0, w, totalH)

  // Court background
  c.fillStyle = COURT_CANVAS.COLORS.HARDWOOD
  c.fillRect(0, 0, w, h)

  // Wood grain texture
  drawWoodGrain(c, w, h)

  // Draw crowd area below baseline with team colors
  const homeColor = props.homeTeam?.primary_color || '#3B82F6'
  const awayColor = props.awayTeam?.primary_color || '#EF4444'
  drawCrowdArea(c, w, h, crowdH, homeColor, awayColor)

  // Draw crowd celebrations
  if (crowdCelebrations.value.length > 0) {
    drawCrowdCelebrations(c, h, crowdH)
  }

  // Court markings
  c.strokeStyle = COURT_CANVAS.COLORS.COURT_LINES
  c.lineWidth = COURT_CANVAS.LINE_WIDTH.DEFAULT
  c.fillStyle = COURT_CANVAS.COLORS.COURT_LINES

  const centerX = w / 2
  const baselineY = h - 2

  // Baseline
  c.beginPath()
  c.moveTo(0, baselineY)
  c.lineTo(w, baselineY)
  c.stroke()

  // Sidelines
  c.beginPath()
  c.moveTo(2, 0)
  c.lineTo(2, h)
  c.moveTo(w - 2, 0)
  c.lineTo(w - 2, h)
  c.stroke()

  // Court element positions (scaled from feet to pixels)
  // Rim uses original scale, court markings use shrunk scale
  const rimY = h - (NBA_COURT.RIM_FROM_BASELINE * sy)
  const backboardY = h - (NBA_COURT.BACKBOARD_FROM_BASELINE * sy)
  const keyLength = NBA_COURT.KEY_LENGTH * csy
  const keyWidth = NBA_COURT.KEY_WIDTH * csx
  const ftLineY = h - keyLength
  const keyLeft = centerX - keyWidth / 2
  const keyRight = centerX + keyWidth / 2
  const ftCircleRadius = NBA_COURT.FT_CIRCLE_RADIUS * csx
  const restrictedRadius = NBA_COURT.RESTRICTED_RADIUS * csx

  // 3-Point Line - simple arc curving away from basket
  const threeArcRadius = NBA_COURT.THREE_POINT_ARC_RADIUS * csx
  const threeArcCenterY = rimY + (threeArcRadius * 0.15)  // Shift down 15%
  c.beginPath()
  c.arc(centerX, threeArcCenterY, threeArcRadius, Math.PI, 2 * Math.PI, false)
  c.stroke()

  // Key (paint area)
  c.strokeRect(keyLeft, ftLineY, keyWidth, keyLength - 2)

  // Free throw circle - solid half (away from basket)
  c.beginPath()
  c.arc(centerX, ftLineY, ftCircleRadius, Math.PI, 2 * Math.PI)
  c.stroke()

  // Free throw circle - dashed half (toward basket)
  c.setLineDash([5, 5])
  c.beginPath()
  c.arc(centerX, ftLineY, ftCircleRadius, 0, Math.PI)
  c.stroke()
  c.setLineDash([])

  // Restricted area arc
  c.beginPath()
  c.arc(centerX, rimY, restrictedRadius, Math.PI, 2 * Math.PI)
  c.stroke()

  // Backboard
  c.lineWidth = COURT_CANVAS.LINE_WIDTH.BACKBOARD
  const backboardWidth = NBA_COURT.BACKBOARD_WIDTH * sx
  c.beginPath()
  c.moveTo(centerX - backboardWidth / 2, backboardY)
  c.lineTo(centerX + backboardWidth / 2, backboardY)
  c.stroke()
  c.lineWidth = COURT_CANVAS.LINE_WIDTH.DEFAULT

  // Rim
  const rimRadius = (NBA_COURT.RIM_DIAMETER / 2) * sx
  c.beginPath()
  c.arc(centerX, rimY, rimRadius, 0, Math.PI * 2)
  c.strokeStyle = COURT_CANVAS.COLORS.RIM
  c.lineWidth = COURT_CANVAS.LINE_WIDTH.RIM
  c.stroke()
  c.strokeStyle = COURT_CANVAS.COLORS.COURT_LINES
  c.lineWidth = COURT_CANVAS.LINE_WIDTH.DEFAULT

  // Key hash marks
  const hashMarkLength = 2 * csx
  const hashPositions = [7, 11, 14, 17] // Feet from baseline
  hashPositions.forEach(pos => {
    const hashY = baselineY - pos * csy
    // Left side
    c.beginPath()
    c.moveTo(keyLeft - hashMarkLength, hashY)
    c.lineTo(keyLeft, hashY)
    c.stroke()
    // Right side
    c.beginPath()
    c.moveTo(keyRight, hashY)
    c.lineTo(keyRight + hashMarkLength, hashY)
    c.stroke()
  })

  // Animation mode rendering
  if (props.animationMode) {
    if (props.showTrails) {
      drawMovementTrails(c)
    }
    drawAnimatedPlayers(c)
    if (props.interpolatedBallPosition) {
      const ballX = props.interpolatedBallPosition.x * w
      const ballY = props.interpolatedBallPosition.y * h
      const inFlight = props.interpolatedBallPosition.inFlight
      drawBall(c, ballX, ballY, inFlight)
    }
  } else {
    if (props.showPlayers && props.playerPositions.length > 0) {
      drawPlayers(c)
    }
    if (props.ballPosition) {
      drawBall(c, props.ballPosition.x * w, props.ballPosition.y * h)
    }
  }

  // Draw score animation if active
  if (scoreAnimation.value) {
    drawScoreAnimation(c, centerX, rimY)
  }

  // Draw badge animations if active
  if (badgeAnimations.value.length > 0) {
    drawBadgeAnimations(c)
  }

  // Draw on-court defensive animations if active
  if (defensiveAnimations.value.length > 0) {
    drawDefensiveAnimations(c)
  }
}

function drawWoodGrain(c, w, h) {
  c.strokeStyle = COURT_CANVAS.COLORS.WOOD_GRAIN
  c.lineWidth = 1
  for (let y = 0; y < h; y += 15) {
    c.beginPath()
    c.moveTo(0, y)
    c.lineTo(w, y)
    c.stroke()
  }
}

/**
 * Draw crowd area - below baseline on desktop, above court on mobile (appears on right when rotated)
 */
function drawCrowdArea(c, w, courtH, crowdH, homeColor, awayColor) {
  // Scale factor for people (relative to court width) - smaller overall
  const personScale = (w / 400) * 0.8

  // Total fans depends on mobile vs desktop
  const totalFans = isMobile.value ? 20 : 18  // Mobile: 1 cameraman + 19 fans in 2 rows

  // Use stable away fan indices (generate once if empty or if count changed)
  if (stableAwayFanIndices.value.size === 0) {
    const numAwayFans = isMobile.value ? (4 + Math.floor(Math.random() * 2)) : (3 + Math.floor(Math.random() * 2))  // 4-5 on mobile, 3-4 on desktop
    while (stableAwayFanIndices.value.size < numAwayFans) {
      stableAwayFanIndices.value.add(Math.floor(Math.random() * totalFans))
    }
  }
  const awayFanIndices = stableAwayFanIndices.value

  let fanIndex = 0

  if (isMobile.value) {
    // Mobile: Draw crowd on the RIGHT SIDE of canvas (vertical strip)
    // When canvas rotates 90deg, this appears on the right side of the screen
    const crowdAreaX = w - crowdH  // Right edge of canvas

    // Draw dark floor/crowd area background on right side
    c.fillStyle = COURT_CANVAS.COLORS.CROWD_FLOOR || '#1a1a2e'
    c.fillRect(crowdAreaX, 0, crowdH + 5, courtH)

    // Add subtle gradient overlay
    const gradient = c.createLinearGradient(crowdAreaX, 0, crowdAreaX + crowdH, 0)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
    c.fillStyle = gradient
    c.fillRect(crowdAreaX, 0, crowdH + 5, courtH)

    // Mobile crowd positions - vertical strip on right side
    // Y positions spread along the court height, X is in the crowd area
    const crowdCenterX = crowdAreaX + crowdH / 2

    // First draw one cameraman at the top (facing the court action - left and up)
    c.save()
    c.translate(crowdCenterX, courtH * 0.06)
    c.rotate(-Math.PI * 0.6)  // Rotate to face court action (left and slightly up)
    drawCameraman(c, 0, 0, personScale * 0.75, homeColor)
    c.restore()
    fanIndex++

    // Standing fans spread vertically - dense crowd with varied positions
    // Two rows: front row (closer to court) and back row (further from court)
    const frontRowX = crowdAreaX + crowdH * 0.35
    const backRowX = crowdAreaX + crowdH * 0.7

    // Front row positions (closer to court, slightly larger)
    const frontRowPositions = [
      courtH * 0.12, courtH * 0.22, courtH * 0.32, courtH * 0.42,
      courtH * 0.52, courtH * 0.62, courtH * 0.72, courtH * 0.82, courtH * 0.92
    ]

    // Back row positions (offset from front row, slightly smaller)
    const backRowPositions = [
      courtH * 0.07, courtH * 0.17, courtH * 0.27, courtH * 0.37,
      courtH * 0.47, courtH * 0.57, courtH * 0.67, courtH * 0.77, courtH * 0.87, courtH * 0.97
    ]

    // Draw back row first (behind front row)
    backRowPositions.forEach((y, idx) => {
      const isAwayFan = awayFanIndices.has(fanIndex)
      const color = isAwayFan ? awayColor : homeColor
      const jumpOffset = getJumpOffset(fanIndex)
      c.save()
      c.translate(backRowX + jumpOffset, y)
      c.rotate(-Math.PI / 2)  // Rotate to face court
      drawStandingPersonAt(c, 0, 0, personScale * 0.75, color, idx + 10)  // Offset index for variety
      c.restore()
      fanIndex++
    })

    // Draw front row (in front)
    frontRowPositions.forEach((y, idx) => {
      const isAwayFan = awayFanIndices.has(fanIndex)
      const color = isAwayFan ? awayColor : homeColor
      const jumpOffset = getJumpOffset(fanIndex)
      c.save()
      c.translate(frontRowX + jumpOffset, y)
      c.rotate(-Math.PI / 2)  // Rotate to face court
      drawStandingPersonAt(c, 0, 0, personScale * 0.85, color, idx)
      c.restore()
      fanIndex++
    })
  } else {
    // Desktop: Draw crowd below baseline
    const baselineY = courtH - 2
    const crowdFloorY = baselineY + 2

    // Draw dark floor/crowd area background
    c.fillStyle = COURT_CANVAS.COLORS.CROWD_FLOOR || '#1a1a2e'
    c.fillRect(0, crowdFloorY, w, crowdH + 5)

    // Add subtle gradient overlay
    const gradient = c.createLinearGradient(0, crowdFloorY, 0, crowdFloorY + crowdH)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
    c.fillStyle = gradient
    c.fillRect(0, crowdFloorY, w, crowdH + 5)
    // Desktop: full crowd with cameramen, seated fans, and standing fans

    // Draw cameramen (larger, with cameras on tripods) - neutral colors
    const cameraPositions = [
      { x: w * 0.08, type: 'camera' },
      { x: w * 0.92, type: 'camera' },
    ]

    cameraPositions.forEach(pos => {
      drawCameraman(c, pos.x, crowdFloorY + 3, personScale, homeColor)
    })

    // Draw seated spectators/officials
    const spectatorPositions = [
      { x: w * 0.28, type: 'seated' },
      { x: w * 0.35, type: 'seated' },
      { x: w * 0.42, type: 'seated' },
      { x: w * 0.50, type: 'table' },  // Scorers table
      { x: w * 0.58, type: 'seated' },
      { x: w * 0.65, type: 'seated' },
      { x: w * 0.72, type: 'seated' },
    ]

    spectatorPositions.forEach(pos => {
      if (pos.type === 'table') {
        drawScorersTable(c, pos.x, crowdFloorY + 3, personScale)
      } else {
        const isAwayFan = awayFanIndices.has(fanIndex)
        const color = isAwayFan ? awayColor : homeColor
        const jumpOffset = getJumpOffset(fanIndex)
        drawSeatedPerson(c, pos.x, crowdFloorY + 6 + jumpOffset, personScale, color)
        fanIndex++
      }
    })

    // Draw standing people in back row
    const backRowPositions = [
      w * 0.10, w * 0.16, w * 0.22, w * 0.30, w * 0.38,
      w * 0.62, w * 0.70, w * 0.78, w * 0.84, w * 0.90
    ]

    backRowPositions.forEach(x => {
      const isAwayFan = awayFanIndices.has(fanIndex)
      const color = isAwayFan ? awayColor : homeColor
      const jumpOffset = getJumpOffset(fanIndex)
      drawStandingPerson(c, x, crowdFloorY + crowdH - 6 + jumpOffset, personScale, color)
      fanIndex++
    })
  }
}

/**
 * Draw a cameraman with TV camera on tripod
 */
function drawCameraman(c, x, y, scale, teamColor) {
  const s = scale

  // Tripod legs
  c.strokeStyle = '#333'
  c.lineWidth = 2 * s
  c.beginPath()
  c.moveTo(x, y + 25 * s)
  c.lineTo(x - 10 * s, y + 38 * s)
  c.moveTo(x, y + 25 * s)
  c.lineTo(x + 10 * s, y + 38 * s)
  c.moveTo(x, y + 25 * s)
  c.lineTo(x, y + 38 * s)
  c.stroke()

  // Camera body
  c.fillStyle = '#2d2d2d'
  c.fillRect(x - 12 * s, y + 10 * s, 24 * s, 15 * s)

  // Camera lens (pointing up at court)
  c.fillStyle = '#1a1a1a'
  c.beginPath()
  c.arc(x, y + 8 * s, 6 * s, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#4a6fa5'
  c.beginPath()
  c.arc(x, y + 8 * s, 4 * s, 0, Math.PI * 2)
  c.fill()

  // Operator (behind camera, facing court - we see their back)
  // Head
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x + 18 * s, y + 18 * s, 5 * s, 0, Math.PI * 2)
  c.fill()

  // Body (back facing us) - crew wears dark/neutral
  c.fillStyle = '#1a1a1a'
  c.fillRect(x + 13 * s, y + 23 * s, 10 * s, 14 * s)

  // Headphones
  c.strokeStyle = '#333'
  c.lineWidth = 2 * s
  c.beginPath()
  c.arc(x + 18 * s, y + 16 * s, 6 * s, Math.PI * 0.8, Math.PI * 0.2, true)
  c.stroke()
}

/**
 * Draw a photographer with camera (kneeling/crouching)
 */
function drawPhotographer(c, x, y, scale, teamColor) {
  const s = scale

  // Body (crouching, facing court - we see their back) - media vest
  c.fillStyle = '#374151'  // Gray media vest
  c.beginPath()
  c.ellipse(x, y + 18 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2)
  c.fill()

  // Head
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x, y + 5 * s, 5 * s, 0, Math.PI * 2)
  c.fill()

  // Hair
  c.fillStyle = '#4a3728'
  c.beginPath()
  c.arc(x, y + 3 * s, 5 * s, Math.PI, Math.PI * 2)
  c.fill()

  // Camera (held up to face, pointing at court)
  c.fillStyle = '#1a1a1a'
  c.fillRect(x - 8 * s, y + 2 * s, 7 * s, 6 * s)

  // Camera lens
  c.fillStyle = '#4a6fa5'
  c.beginPath()
  c.arc(x - 5 * s, y - 1 * s, 3 * s, 0, Math.PI * 2)
  c.fill()
}

/**
 * Draw scorers table with people behind it
 */
function drawScorersTable(c, x, y, scale) {
  const s = scale

  // Table
  c.fillStyle = '#2d2d2d'
  c.fillRect(x - 25 * s, y + 15 * s, 50 * s, 8 * s)

  // Table front panel
  c.fillStyle = '#1a1a1a'
  c.fillRect(x - 25 * s, y + 23 * s, 50 * s, 12 * s)

  // Monitors on table
  c.fillStyle = '#333'
  c.fillRect(x - 18 * s, y + 8 * s, 12 * s, 8 * s)
  c.fillRect(x + 6 * s, y + 8 * s, 12 * s, 8 * s)

  // Screen glow
  c.fillStyle = '#88ccff'
  c.fillRect(x - 16 * s, y + 10 * s, 8 * s, 4 * s)
  c.fillRect(x + 8 * s, y + 10 * s, 8 * s, 4 * s)

  // Person behind table (left)
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x - 12 * s, y + 2 * s, 4 * s, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#374151'
  c.fillRect(x - 16 * s, y + 6 * s, 8 * s, 10 * s)

  // Person behind table (right)
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x + 12 * s, y + 2 * s, 4 * s, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#374151'
  c.fillRect(x + 8 * s, y + 6 * s, 8 * s, 10 * s)
}

/**
 * Draw a seated person (facing court - we see their back)
 */
function drawSeatedPerson(c, x, y, scale, teamColor) {
  const s = scale

  // Chair
  c.fillStyle = '#374151'
  c.fillRect(x - 6 * s, y + 10 * s, 12 * s, 18 * s)

  // Body on chair - team color shirt
  c.fillStyle = teamColor
  c.fillRect(x - 5 * s, y + 8 * s, 10 * s, 12 * s)

  // Head
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x, y + 2 * s, 5 * s, 0, Math.PI * 2)
  c.fill()

  // Hair - varied colors
  const hairColors = ['#1a1a1a', '#4a3728', '#8b7355', '#2d1810']
  c.fillStyle = hairColors[Math.floor(Math.abs(x * 5) % hairColors.length)]
  c.beginPath()
  c.arc(x, y, 5 * s, Math.PI, Math.PI * 2)
  c.fill()
}

/**
 * Draw a standing person (facing court - we see their back)
 */
function drawStandingPerson(c, x, y, scale, teamColor) {
  const s = scale

  // Body - team color shirt
  c.fillStyle = teamColor
  c.beginPath()
  c.ellipse(x, y - 8 * s, 6 * s, 10 * s, 0, 0, Math.PI * 2)
  c.fill()

  // Head
  c.fillStyle = '#d4a574'
  c.beginPath()
  c.arc(x, y - 22 * s, 5 * s, 0, Math.PI * 2)
  c.fill()

  // Hair (varied colors)
  const hairColors = ['#1a1a1a', '#4a3728', '#8b7355', '#2d1810']
  c.fillStyle = hairColors[Math.floor(Math.abs(x * 3) % hairColors.length)]
  c.beginPath()
  c.arc(x, y - 24 * s, 5 * s, Math.PI, Math.PI * 2)
  c.fill()
}

/**
 * Draw a standing person at origin (0,0) - used after context transform
 * @param {number} personIndex - Index for variety in appearance
 */
function drawStandingPersonAt(c, x, y, scale, teamColor, personIndex = 0) {
  const s = scale

  // Variety based on personIndex - height, body width, head size
  const heightVariations = [1.0, 0.85, 1.1, 0.9, 1.05, 0.8, 0.95, 1.15, 0.88, 1.02]
  const bodyWidthVariations = [1.0, 1.2, 0.9, 1.3, 0.85, 1.15, 1.1, 0.95, 1.25, 1.0]
  const headSizeVariations = [1.0, 0.9, 1.1, 0.95, 1.05, 0.88, 1.0, 1.08, 0.92, 1.02]
  const skinTones = ['#d4a574', '#c68642', '#8d5524', '#e0ac69', '#f1c27d', '#6b4423']

  const heightMod = heightVariations[personIndex % heightVariations.length]
  const bodyWidthMod = bodyWidthVariations[personIndex % bodyWidthVariations.length]
  const headSizeMod = headSizeVariations[personIndex % headSizeVariations.length]
  const skinTone = skinTones[personIndex % skinTones.length]

  // Adjusted measurements
  const bodyWidth = 6 * s * bodyWidthMod
  const bodyHeight = 10 * s * heightMod
  const headRadius = 5 * s * headSizeMod
  const bodyY = y - 8 * s * heightMod
  const headY = y - (18 + 4 * heightMod) * s

  // Body - team color shirt (centered at x, with bottom at y)
  c.fillStyle = teamColor
  c.beginPath()
  c.ellipse(x, bodyY, bodyWidth, bodyHeight, 0, 0, Math.PI * 2)
  c.fill()

  // Head
  c.fillStyle = skinTone
  c.beginPath()
  c.arc(x, headY, headRadius, 0, Math.PI * 2)
  c.fill()

  // Hair (varied colors and styles based on personIndex)
  const hairColors = ['#1a1a1a', '#4a3728', '#8b7355', '#2d1810', '#654321', '#3d2314']
  const hasHair = personIndex % 5 !== 3  // Some people are bald
  if (hasHair) {
    c.fillStyle = hairColors[personIndex % hairColors.length]
    c.beginPath()
    c.arc(x, headY - 2 * s * headSizeMod, headRadius, Math.PI, Math.PI * 2)
    c.fill()
  }
}

function drawPlayers(c) {
  const slotLabels = ['PG', 'SG', 'SF', 'PF', 'C']

  props.playerPositions.forEach((player, index) => {
    const x = player.x * courtWidth.value
    const y = player.y * courtHeight.value
    const isHome = player.team === 'home'

    // Determine slot based on index within team (0-4 for each team's starters)
    const teamIndex = isHome
      ? props.playerPositions.filter((p, i) => i < index && p.team === 'home').length
      : props.playerPositions.filter((p, i) => i < index && p.team === 'away').length
    const slot = teamIndex < 5 ? slotLabels[teamIndex] : 'BN'

    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.fillStyle = isHome ? (props.homeTeam?.primary_color || '#3B82F6') : (props.awayTeam?.primary_color || '#EF4444')
    c.fill()
    c.strokeStyle = '#FFFFFF'
    c.lineWidth = 2
    c.stroke()

    // Draw position slot and last name (rotated on mobile to stay readable)
    c.save()
    c.translate(x, y)
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)  // Counter-rotate to stay upright when court is rotated
    }

    // Position slot (PG, SG, SF, PF, C)
    c.fillStyle = '#FFFFFF'
    c.font = 'bold 10px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(slot, 0, 0)

    // Last name below icon
    const playerName = player.last_name || player.name || ''
    const lastName = playerName.includes(' ') ? playerName.split(' ').pop() : playerName
    if (lastName) {
      c.font = '9px Arial'
      c.fillStyle = 'rgba(0, 0, 0, 0.85)'
      c.fillText(lastName.substring(0, 8), 0, 20)
    }
    c.restore()
  })
}

function drawBall(c, x, y, inFlight = false) {
  const shadowOffset = inFlight ? 6 : 2
  c.beginPath()
  c.arc(x + shadowOffset, y + shadowOffset, 8, 0, Math.PI * 2)
  c.fillStyle = inFlight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.3)'
  c.fill()

  const gradient = c.createRadialGradient(x - 2, y - 2, 0, x, y, 8)
  gradient.addColorStop(0, '#FF8C00')
  gradient.addColorStop(1, '#FF4500')

  c.beginPath()
  c.arc(x, y, 8, 0, Math.PI * 2)
  c.fillStyle = gradient
  c.fill()

  c.strokeStyle = '#000000'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(x - 7, y)
  c.lineTo(x + 7, y)
  c.stroke()
  c.beginPath()
  c.arc(x, y, 6, 0, Math.PI * 2)
  c.stroke()

  if (inFlight) {
    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.strokeStyle = 'rgba(255, 140, 0, 0.5)'
    c.lineWidth = 2
    c.stroke()
  }
}

function drawScoreAnimation(c, centerX, rimY) {
  if (!scoreAnimation.value) return

  const { points, progress } = scoreAnimation.value

  // Easing function for smooth animation
  const easeOutBack = (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  }

  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)

  // Animation phases
  const scaleProgress = Math.min(1, progress * 2)  // First half: scale up
  const fadeProgress = Math.max(0, (progress - 0.6) / 0.4)  // Last 40%: fade out
  const riseProgress = easeOutQuad(progress)

  // Calculate scale with bounce
  const scale = easeOutBack(scaleProgress)

  // Calculate position (rise up from basket)
  const riseAmount = 60 * riseProgress
  const y = rimY - 30 - riseAmount

  // Calculate opacity
  const opacity = 1 - fadeProgress

  // Draw emoji and points text
  c.save()
  c.translate(centerX, y)

  // Counter-rotate on mobile
  if (isMobile.value) {
    c.rotate(-Math.PI / 2)
  }

  c.scale(scale, scale)
  c.globalAlpha = opacity

  // Draw fire emoji only for 3-pointers
  if (points === 3) {
    c.font = '24px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('🔥', 0, -16)
  }

  // Draw points text (smaller)
  c.font = 'bold 16px Arial'
  c.fillStyle = points === 3 ? '#FFD700' : '#FFFFFF'
  c.strokeStyle = '#000000'
  c.lineWidth = 2
  const textY = points === 3 ? 8 : 0
  c.strokeText(`+${points}`, 0, textY)
  c.fillText(`+${points}`, 0, textY)

  c.restore()
}

function drawAnimatedPlayers(c) {
  const w = courtWidth.value
  const h = courtHeight.value
  const positions = props.interpolatedPositions

  // Position slot labels
  const slotLabels = ['PG', 'SG', 'SF', 'PF', 'C']

  // Build player lookup from rosters (for team color and name info)
  const playerLookup = {}
  props.homeRoster.forEach((player) => {
    const playerId = player.id || player.player_id
    if (playerId) {
      playerLookup[playerId] = {
        ...player,
        id: playerId,
        team: 'home',
        number: player.jersey_number || player.jerseyNumber
      }
    }
  })
  props.awayRoster.forEach((player) => {
    const playerId = player.id || player.player_id
    if (playerId) {
      playerLookup[playerId] = {
        ...player,
        id: playerId,
        team: 'away',
        number: player.jersey_number || player.jerseyNumber
      }
    }
  })

  const newHistory = { ...positionHistory.value }

  Object.entries(positions).forEach(([playerId, pos]) => {
    const x = pos.x * w
    const y = pos.y * h
    const hasBall = pos.hasBall
    const player = playerLookup[playerId]
    const isHome = player?.team === 'home'

    if (!newHistory[playerId]) {
      newHistory[playerId] = []
    }
    newHistory[playerId].push({ x, y })
    if (newHistory[playerId].length > 10) {
      newHistory[playerId].shift()
    }

    if (hasBall) {
      c.beginPath()
      c.arc(x, y, 18, 0, Math.PI * 2)
      c.fillStyle = 'rgba(255, 165, 0, 0.3)'
      c.fill()
    }

    c.beginPath()
    c.arc(x, y, 14, 0, Math.PI * 2)
    c.fillStyle = isHome
      ? (props.homeTeam?.primary_color || '#3B82F6')
      : (props.awayTeam?.primary_color || '#EF4444')
    c.fill()
    c.strokeStyle = hasBall ? '#FFD700' : '#FFFFFF'
    c.lineWidth = hasBall ? 3 : 2
    c.stroke()

    // Determine slot from lineupIndex in position data (0-4 = starters, null = bench)
    const lineupIndex = pos.lineupIndex
    const slot = lineupIndex !== null && lineupIndex !== undefined && lineupIndex < 5
      ? slotLabels[lineupIndex]
      : 'BN'

    // Draw position slot and last name (rotated on mobile to stay readable)
    c.save()
    c.translate(x, y)
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)  // Counter-rotate to stay upright when court is rotated
    }

    // Position slot (PG, SG, SF, PF, C)
    c.fillStyle = '#FFFFFF'
    c.font = 'bold 10px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(slot, 0, 0)

    // Last name below icon
    const playerName = player?.last_name || player?.name || ''
    const lastName = playerName.includes(' ') ? playerName.split(' ').pop() : playerName
    if (lastName) {
      c.font = '9px Arial'
      c.fillStyle = 'rgba(0, 0, 0, 0.85)'
      c.fillText(lastName.substring(0, 8), 0, 22)
    }
    c.restore()
  })

  positionHistory.value = newHistory
}

function drawMovementTrails(c) {
  const history = positionHistory.value

  Object.entries(history).forEach(([playerId, positions]) => {
    if (positions.length < 2) return

    const playerLookup = {}
    props.homeRoster.forEach(player => {
      const id = player.id || player.player_id
      if (id) playerLookup[id] = { team: 'home' }
    })
    props.awayRoster.forEach(player => {
      const id = player.id || player.player_id
      if (id) playerLookup[id] = { team: 'away' }
    })

    const player = playerLookup[playerId]
    const isHome = player?.team === 'home'
    const baseColor = isHome
      ? (props.homeTeam?.primary_color || '#3B82F6')
      : (props.awayTeam?.primary_color || '#EF4444')

    c.beginPath()
    c.moveTo(positions[0].x, positions[0].y)
    for (let i = 1; i < positions.length; i++) {
      c.lineTo(positions[i].x, positions[i].y)
    }
    c.strokeStyle = baseColor
    c.lineWidth = 3
    c.globalAlpha = 0.3
    c.stroke()
    c.globalAlpha = 1.0

    positions.forEach((pos, i) => {
      const alpha = (i / positions.length) * 0.5
      c.beginPath()
      c.arc(pos.x, pos.y, 3, 0, Math.PI * 2)
      c.fillStyle = baseColor
      c.globalAlpha = alpha
      c.fill()
    })
    c.globalAlpha = 1.0
  })
}

function clearTrails() {
  positionHistory.value = {}
}

function getDefaultPositions() {
  return [
    { x: 0.5, y: 0.15, team: 'home', number: '1' },
    { x: 0.2, y: 0.25, team: 'home', number: '2' },
    { x: 0.8, y: 0.25, team: 'home', number: '3' },
    { x: 0.35, y: 0.5, team: 'home', number: '4' },
    { x: 0.65, y: 0.5, team: 'home', number: '5' },
    { x: 0.5, y: 0.25, team: 'away', number: '1' },
    { x: 0.25, y: 0.35, team: 'away', number: '2' },
    { x: 0.75, y: 0.35, team: 'away', number: '3' },
    { x: 0.4, y: 0.55, team: 'away', number: '4' },
    { x: 0.6, y: 0.55, team: 'away', number: '5' },
  ]
}

onMounted(() => {
  ctx.value = canvas.value.getContext('2d')
  drawCourt()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

watch(() => [
  props.ballPosition,
  props.playerPositions,
  props.width,
  props.height,
  props.animationMode,
  props.interpolatedPositions,
  props.interpolatedBallPosition,
  isMobile.value
], () => {
  drawCourt()
}, { deep: true })

// Reset away fan indices when mobile mode changes (different fan counts)
watch(() => isMobile.value, () => {
  stableAwayFanIndices.value = new Set()
})

// Watch for activated badges and trigger animations
watch(() => props.activatedBadges, (newBadges) => {
  if (!newBadges || newBadges.length === 0) {
    lastAnimatedBadges.value = ''
    return
  }

  // Create a unique key for this set of badges to prevent duplicate animations
  const badgeKey = newBadges.map(b => `${b.badgeId}-${b.playerId}-${b.time || 0}`).join('|')
  if (badgeKey === lastAnimatedBadges.value) return
  lastAnimatedBadges.value = badgeKey

  newBadges.forEach(badge => {
    // Find player position from interpolatedPositions
    const playerId = badge.playerId
    const playerPos = props.interpolatedPositions[playerId]

    if (playerPos) {
      triggerBadgeAnimation(badge, playerPos.x, playerPos.y)
    } else {
      // Default to center if player position not found
      triggerBadgeAnimation(badge, 0.5, 0.4)
    }
  })
}, { deep: true })

defineExpose({
  redraw: drawCourt,
  getDefaultPositions,
  clearTrails,
  triggerScoreAnimation,
  triggerBadgeAnimation,
  triggerCrowdCelebration,
  triggerDefensiveCelebration,
  triggerDefensiveAnimationAtPosition
})
</script>

<template>
  <div
    class="basketball-court-container"
    :style="isMobile ? { width: height + 'px', height: width + 'px' } : {}"
  >
    <canvas
      ref="canvas"
      :width="width"
      :height="totalCanvasHeight"
      class="basketball-court"
    />

    <!-- Game Clock Overlay (top left) -->
    <div v-if="gameClock" class="game-clock-overlay">
      <span class="game-clock-text">{{ gameClock }}</span>
    </div>

    <!-- Play Name Overlay (bottom left) -->
    <div v-if="playName" class="play-name-overlay">
      <span class="play-name-text">{{ playName }}</span>
    </div>

    <!-- Play Description Overlay (bottom right) -->
    <div v-if="playDescription" class="play-description-overlay">
      <div class="play-description-entry">
        <span
          class="play-team-badge"
          :style="{ backgroundColor: playTeamColor }"
        >
          {{ playTeamAbbreviation }}
        </span>
        <span class="play-description-text">{{ playDescription }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.basketball-court-container {
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  position: relative;
}

.basketball-court {
  display: block;
}

/* Game Clock Overlay - top left of court */
.game-clock-overlay {
  position: absolute;
  top: 8px;
  left: 5%;
  padding: 4px;
  z-index: 10;
  opacity: 0.75;
}

.game-clock-text {
  font-size: 1.25rem;
  font-weight: 700;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
  color: #000000;
}

/* Play Name Overlay - top right of court */
.play-name-overlay {
  position: absolute;
  top: 8px;
  right: 3%;
  padding: 4px 8px;
  border-radius: 4px;
  z-index: 10;
  opacity: 0.75;
}

.play-name-text {
  font-size: 10px;
  color: #000000;
  font-weight: 700;
}

/* Play Description Overlay - bottom right of court, above crowd area */
.play-description-overlay {
  position: absolute;
  bottom: 45px;
  right: 3%;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 10px;
  border-radius: 4px;
  max-width: 200px;
  z-index: 10;
  opacity: 0.75;
  animation: slideInFromRight 0.3s ease-out;
}

@keyframes slideInFromRight {
  from {
    transform: translateX(20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 0.75;
  }
}

.play-description-entry {
  display: flex;
  align-items: center;
  gap: 6px;
}

.play-team-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 2px;
  color: white;
  flex-shrink: 0;
}

.play-description-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.3;
}

/* Rotate court 90 degrees clockwise on mobile */
@media (max-width: 620px) {
  .basketball-court-container {
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: visible;
    /* Container is now sized as height x width via inline style */
  }

  .basketball-court {
    transform: rotate(90deg);
    transform-origin: center center;
    /* Canvas stays at original dimensions, rotation is purely visual */
  }

  /* Adjust overlays for rotated court on mobile */
  .game-clock-overlay {
    display: none;
  }

  /* Play scheme (play name) - top left on mobile */
  .play-name-overlay {
    top: 4px;
    left: 4px;
    right: auto;
    padding: 3px 6px;
    opacity: 0.75;
  }

  .play-name-text {
    font-size: 8px;
  }

  /* Contextual game news (play description) - top right on mobile */
  .play-description-overlay {
    top: 4px;
    right: 4px;
    bottom: auto;
    max-width: 150px;
    padding: 4px 8px;
    opacity: 0.75;
    animation: none;
  }

  .play-description-text {
    font-size: 9px;
  }

  .play-team-badge {
    font-size: 7px;
    padding: 1px 3px;
  }
}
</style>
