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

function handleResize() {
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
}

function triggerScoreAnimation(points = 2) {
  scoreAnimation.value = {
    points,
    progress: 0,
    startTime: performance.now()
  }
  animateScore()
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

const courtWidth = computed(() => props.width)
const courtHeight = computed(() => props.height)

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
  const sx = scaleX.value
  const sy = scaleY.value

  // Scaled factors for court markings (shrunk by COURT_SCALE)
  const csx = sx * COURT_SCALE
  const csy = sy * COURT_SCALE

  // Clear canvas
  c.clearRect(0, 0, w, h)

  // Court background
  c.fillStyle = COURT_CANVAS.COLORS.HARDWOOD
  c.fillRect(0, 0, w, h)

  // Wood grain texture
  drawWoodGrain(c, w, h)

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

  // Draw success emoji
  c.font = '32px Arial'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('🔥', 0, -20)

  // Draw points text
  c.font = 'bold 24px Arial'
  c.fillStyle = points === 3 ? '#FFD700' : '#FFFFFF'
  c.strokeStyle = '#000000'
  c.lineWidth = 3
  c.strokeText(`+${points}`, 0, 15)
  c.fillText(`+${points}`, 0, 15)

  c.restore()
}

function drawAnimatedPlayers(c) {
  const w = courtWidth.value
  const h = courtHeight.value
  const positions = props.interpolatedPositions

  // Position slot labels
  const slotLabels = ['PG', 'SG', 'SF', 'PF', 'C']

  const playerLookup = {}
  props.homeRoster.forEach((player, idx) => {
    const playerId = player.id || player.player_id
    if (playerId) {
      playerLookup[playerId] = {
        ...player,
        id: playerId,
        team: 'home',
        slot: idx < 5 ? slotLabels[idx] : 'BN',
        number: player.jersey_number || player.jerseyNumber || (idx + 1)
      }
    }
  })
  props.awayRoster.forEach((player, idx) => {
    const playerId = player.id || player.player_id
    if (playerId) {
      playerLookup[playerId] = {
        ...player,
        id: playerId,
        team: 'away',
        slot: idx < 5 ? slotLabels[idx] : 'BN',
        number: player.jersey_number || player.jerseyNumber || (idx + 1)
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
    c.fillText(player?.slot || '?', 0, 0)

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
  triggerBadgeAnimation
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
      :height="height"
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

/* Play Name Overlay - bottom left of court */
.play-name-overlay {
  position: absolute;
  bottom: 8px;
  left: 5%;
  padding: 4px 8px;
  border-radius: 4px;
  z-index: 10;
  opacity: 0.7;
}

.play-name-text {
  font-size: 10px;
  color: #000000;
  font-weight: 700;
}

/* Play Description Overlay - bottom right of court */
.play-description-overlay {
  position: absolute;
  bottom: 8px;
  right: 5%;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 10px;
  border-radius: 4px;
  max-width: 200px;
  z-index: 10;
  opacity: 0.75;
  animation: slideInFromLeft 0.3s ease-out;
}

@keyframes slideInFromLeft {
  from {
    transform: translateX(-20px);
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

  /* Hide overlays on mobile - they don't work well with rotation */
  .game-clock-overlay,
  .play-name-overlay,
  .play-description-overlay {
    display: none;
  }
}
</style>
