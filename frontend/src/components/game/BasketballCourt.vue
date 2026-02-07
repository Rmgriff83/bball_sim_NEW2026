<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { NBA_COURT, COURT_CANVAS } from '@/config/courtConfig'

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
  }
})

const positionHistory = ref({})
const canvas = ref(null)
const ctx = ref(null)

const courtWidth = computed(() => props.width)
const courtHeight = computed(() => props.height)

// Scale factors
// X maps court width (50 feet) to canvas width
// Y maps visible depth to canvas height
const scaleX = computed(() => courtWidth.value / NBA_COURT.FULL_WIDTH)
const scaleY = computed(() => courtHeight.value / COURT_CANVAS.VISIBLE_DEPTH)

function drawCourt() {
  if (!ctx.value) return

  const c = ctx.value
  const w = courtWidth.value
  const h = courtHeight.value
  const sx = scaleX.value
  const sy = scaleY.value

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
  const rimY = h - (NBA_COURT.RIM_FROM_BASELINE * sy)
  const backboardY = h - (NBA_COURT.BACKBOARD_FROM_BASELINE * sy)
  const keyLength = NBA_COURT.KEY_LENGTH * sy
  const keyWidth = NBA_COURT.KEY_WIDTH * sx
  const ftLineY = h - keyLength
  const keyLeft = centerX - keyWidth / 2
  const keyRight = centerX + keyWidth / 2
  const ftCircleRadius = NBA_COURT.FT_CIRCLE_RADIUS * sx
  const restrictedRadius = NBA_COURT.RESTRICTED_RADIUS * sx

  // 3-Point Line
  // The NBA 3-point line has straight corners and an arc
  const threeArcRadius = NBA_COURT.THREE_POINT_ARC_RADIUS * sx
  const cornerThreeX = NBA_COURT.CORNER_THREE_FROM_SIDELINE * sx  // 3 feet from sideline

  // Calculate where the arc meets the straight corner sections
  // The corner 3 is 22 feet from basket, arc is 23.75 feet
  // At x = cornerThreeX from sideline, the arc y position is:
  // horizontalDist from center = centerX - cornerThreeX
  const horizontalDistFromCenter = centerX - cornerThreeX

  // The arc meets the corner line where the arc radius equals the distance
  // If arcRadius^2 = horizontalDist^2 + verticalDist^2
  // Then verticalDist = sqrt(arcRadius^2 - horizontalDist^2)
  let arcMeetPoint
  if (horizontalDistFromCenter <= threeArcRadius) {
    const verticalDistFromRim = Math.sqrt(threeArcRadius * threeArcRadius - horizontalDistFromCenter * horizontalDistFromCenter)
    arcMeetPoint = rimY - verticalDistFromRim
  } else {
    arcMeetPoint = rimY
  }

  // Draw 3-point line
  c.beginPath()

  // Left corner - straight line from baseline up to where arc begins
  c.moveTo(cornerThreeX, baselineY)
  c.lineTo(cornerThreeX, arcMeetPoint)

  // Arc portion
  // Calculate the angle where the arc meets the corner lines
  const arcStartAngle = Math.PI - Math.asin(horizontalDistFromCenter / threeArcRadius)
  const arcEndAngle = Math.asin(horizontalDistFromCenter / threeArcRadius)

  // Draw the arc (from left corner angle to right corner angle, going up and over)
  c.arc(centerX, rimY, threeArcRadius, arcStartAngle, arcEndAngle, false)

  // Right corner - straight line down to baseline
  c.lineTo(w - cornerThreeX, baselineY)
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
  const hashMarkLength = 2 * sx
  const hashPositions = [7, 11, 14, 17] // Feet from baseline
  hashPositions.forEach(pos => {
    const hashY = baselineY - pos * sy
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
  props.playerPositions.forEach((player, index) => {
    const x = player.x * courtWidth.value
    const y = player.y * courtHeight.value
    const isHome = player.team === 'home'

    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.fillStyle = isHome ? (props.homeTeam?.primary_color || '#3B82F6') : (props.awayTeam?.primary_color || '#EF4444')
    c.fill()
    c.strokeStyle = '#FFFFFF'
    c.lineWidth = 2
    c.stroke()

    c.fillStyle = '#FFFFFF'
    c.font = 'bold 10px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(player.number || (index + 1).toString(), x, y)
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

function drawAnimatedPlayers(c) {
  const w = courtWidth.value
  const h = courtHeight.value
  const positions = props.interpolatedPositions

  const playerLookup = {}
  props.homeRoster.forEach((player, idx) => {
    const playerId = player.id || player.player_id
    if (playerId) {
      playerLookup[playerId] = {
        ...player,
        id: playerId,
        team: 'home',
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

    c.fillStyle = '#FFFFFF'
    c.font = 'bold 11px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(player?.number || '?'), x, y)
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
})

watch(() => [
  props.ballPosition,
  props.playerPositions,
  props.width,
  props.height,
  props.animationMode,
  props.interpolatedPositions,
  props.interpolatedBallPosition
], () => {
  drawCourt()
}, { deep: true })

defineExpose({
  redraw: drawCourt,
  getDefaultPositions,
  clearTrails
})
</script>

<template>
  <div class="basketball-court-container">
    <canvas
      ref="canvas"
      :width="width"
      :height="height"
      class="basketball-court"
    />
  </div>
</template>

<style scoped>
.basketball-court-container {
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.basketball-court {
  display: block;
}
</style>
