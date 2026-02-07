<script setup>
import { ref, onMounted, watch, computed } from 'vue'

const props = defineProps({
  width: {
    type: Number,
    default: 800
  },
  height: {
    type: Number,
    default: 500
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
    default: 'home' // 'home' or 'away'
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
  // Animation mode props
  animationMode: {
    type: Boolean,
    default: false
  },
  // Interpolated positions from usePlayAnimation (keyed by player ID)
  interpolatedPositions: {
    type: Object,
    default: () => ({})
  },
  // Interpolated ball position
  interpolatedBallPosition: {
    type: Object,
    default: null
  },
  // Player roster data for animation mode (to get names/numbers)
  homeRoster: {
    type: Array,
    default: () => []
  },
  awayRoster: {
    type: Array,
    default: () => []
  },
  // Show movement trails
  showTrails: {
    type: Boolean,
    default: true
  }
})

// Store previous positions for trails
const positionHistory = ref({})

const canvas = ref(null)
const ctx = ref(null)

// Court dimensions (NBA regulation court scaled)
const courtWidth = computed(() => props.width)
const courtHeight = computed(() => props.height)

// Scale factors
const scaleX = computed(() => courtWidth.value / 94) // NBA court is 94 feet
const scaleY = computed(() => courtHeight.value / 50) // NBA court is 50 feet

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
  c.fillStyle = '#CD853F' // Hardwood color
  c.fillRect(0, 0, w, h)

  // Court markings
  c.strokeStyle = '#FFFFFF'
  c.lineWidth = 2
  c.fillStyle = '#FFFFFF'

  // Outer boundary
  c.strokeRect(2, 2, w - 4, h - 4)

  // Center court line
  c.beginPath()
  c.moveTo(w / 2, 2)
  c.lineTo(w / 2, h - 2)
  c.stroke()

  // Center circle
  c.beginPath()
  c.arc(w / 2, h / 2, 6 * sy, 0, Math.PI * 2)
  c.stroke()

  // Inner center circle
  c.beginPath()
  c.arc(w / 2, h / 2, 2 * sy, 0, Math.PI * 2)
  c.stroke()

  // Draw both sides of the court
  drawHalfCourt(c, 0, sx, sy, w, h, false) // Left side
  drawHalfCourt(c, w, sx, sy, w, h, true) // Right side (mirrored)

  // Add court texture overlay
  drawWoodGrain(c, w, h)

  // Animation mode rendering
  if (props.animationMode) {
    // Draw movement trails
    if (props.showTrails) {
      drawMovementTrails(c)
    }

    // Draw players from interpolated positions
    drawAnimatedPlayers(c)

    // Draw ball from interpolated position
    if (props.interpolatedBallPosition) {
      const ballX = props.interpolatedBallPosition.x * w
      const ballY = props.interpolatedBallPosition.y * h
      const inFlight = props.interpolatedBallPosition.inFlight
      drawBall(c, ballX, ballY, inFlight)
    }
  } else {
    // Standard mode rendering
    if (props.showPlayers && props.playerPositions.length > 0) {
      drawPlayers(c)
    }

    // Draw ball
    if (props.ballPosition) {
      drawBall(c, props.ballPosition.x * w, props.ballPosition.y * h)
    }
  }
}

function drawHalfCourt(c, startX, sx, sy, w, h, mirrored) {
  const dir = mirrored ? -1 : 1
  const offset = mirrored ? startX : 0

  // Three-point line (23.75 feet at top, 22 feet in corners)
  c.beginPath()
  // Corner three
  c.moveTo(offset + dir * 4 * sx, 3 * sy)
  c.lineTo(offset + dir * 14 * sx, 3 * sy)
  // Arc
  c.arc(offset + dir * 5.25 * sx, h / 2, 23.75 * sx, -Math.asin(22/23.75), Math.asin(22/23.75))
  c.moveTo(offset + dir * 14 * sx, h - 3 * sy)
  c.lineTo(offset + dir * 4 * sx, h - 3 * sy)
  c.stroke()

  // Paint/Key (16 feet wide, 19 feet long)
  const paintWidth = 16 * sy
  const paintLength = 19 * sx
  const paintTop = (h - paintWidth) / 2

  c.strokeRect(offset + (mirrored ? -paintLength : 0), paintTop, paintLength, paintWidth)

  // Free throw circle
  c.beginPath()
  c.arc(offset + dir * 19 * sx, h / 2, 6 * sy, mirrored ? Math.PI / 2 : -Math.PI / 2, mirrored ? -Math.PI / 2 : Math.PI / 2)
  c.stroke()

  // Free throw line dashed part
  c.setLineDash([5, 5])
  c.beginPath()
  c.arc(offset + dir * 19 * sx, h / 2, 6 * sy, mirrored ? -Math.PI / 2 : Math.PI / 2, mirrored ? Math.PI / 2 : -Math.PI / 2)
  c.stroke()
  c.setLineDash([])

  // Restricted area (4 feet radius)
  c.beginPath()
  c.arc(offset + dir * 5.25 * sx, h / 2, 4 * sx, mirrored ? Math.PI / 2 : -Math.PI / 2, mirrored ? -Math.PI / 2 : Math.PI / 2)
  c.stroke()

  // Backboard
  c.lineWidth = 4
  c.beginPath()
  c.moveTo(offset + dir * 4 * sx, h / 2 - 3 * sy)
  c.lineTo(offset + dir * 4 * sx, h / 2 + 3 * sy)
  c.stroke()
  c.lineWidth = 2

  // Rim
  c.beginPath()
  c.arc(offset + dir * 5.25 * sx, h / 2, 0.75 * sx, 0, Math.PI * 2)
  c.stroke()
}

function drawWoodGrain(c, w, h) {
  c.strokeStyle = 'rgba(139, 90, 43, 0.15)'
  c.lineWidth = 1

  // Horizontal wood planks
  for (let y = 0; y < h; y += 20) {
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

    // Player circle
    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.fillStyle = isHome ? (props.homeTeam?.primary_color || '#3B82F6') : (props.awayTeam?.primary_color || '#EF4444')
    c.fill()
    c.strokeStyle = '#FFFFFF'
    c.lineWidth = 2
    c.stroke()

    // Jersey number
    c.fillStyle = '#FFFFFF'
    c.font = 'bold 10px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(player.number || (index + 1).toString(), x, y)
  })
}

function drawBall(c, x, y, inFlight = false) {
  // Ball shadow (offset more when in flight)
  const shadowOffset = inFlight ? 6 : 2
  c.beginPath()
  c.arc(x + shadowOffset, y + shadowOffset, 8, 0, Math.PI * 2)
  c.fillStyle = inFlight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.3)'
  c.fill()

  // Ball
  const gradient = c.createRadialGradient(x - 2, y - 2, 0, x, y, 8)
  gradient.addColorStop(0, '#FF8C00')
  gradient.addColorStop(1, '#FF4500')

  c.beginPath()
  c.arc(x, y, 8, 0, Math.PI * 2)
  c.fillStyle = gradient
  c.fill()

  // Ball lines
  c.strokeStyle = '#000000'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(x - 7, y)
  c.lineTo(x + 7, y)
  c.stroke()
  c.beginPath()
  c.arc(x, y, 6, 0, Math.PI * 2)
  c.stroke()

  // Add glow effect when ball is in flight
  if (inFlight) {
    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.strokeStyle = 'rgba(255, 140, 0, 0.5)'
    c.lineWidth = 2
    c.stroke()
  }
}

/**
 * Draw players from interpolated animation positions.
 */
function drawAnimatedPlayers(c) {
  const w = courtWidth.value
  const h = courtHeight.value
  const positions = props.interpolatedPositions

  // Build player lookup from rosters (handle both id and player_id formats)
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

  // Track positions for trails
  const newHistory = { ...positionHistory.value }

  // Draw each player
  Object.entries(positions).forEach(([playerId, pos]) => {
    const x = pos.x * w
    const y = pos.y * h
    const hasBall = pos.hasBall
    const player = playerLookup[playerId]
    const isHome = player?.team === 'home'

    // Update position history for trails
    if (!newHistory[playerId]) {
      newHistory[playerId] = []
    }
    newHistory[playerId].push({ x, y })
    // Keep only last 10 positions for trail
    if (newHistory[playerId].length > 10) {
      newHistory[playerId].shift()
    }

    // Player glow for ball handler
    if (hasBall) {
      c.beginPath()
      c.arc(x, y, 18, 0, Math.PI * 2)
      c.fillStyle = 'rgba(255, 165, 0, 0.3)'
      c.fill()
    }

    // Player circle
    c.beginPath()
    c.arc(x, y, 14, 0, Math.PI * 2)
    c.fillStyle = isHome
      ? (props.homeTeam?.primary_color || '#3B82F6')
      : (props.awayTeam?.primary_color || '#EF4444')
    c.fill()
    c.strokeStyle = hasBall ? '#FFD700' : '#FFFFFF'
    c.lineWidth = hasBall ? 3 : 2
    c.stroke()

    // Jersey number
    c.fillStyle = '#FFFFFF'
    c.font = 'bold 11px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(player?.number || '?'), x, y)
  })

  positionHistory.value = newHistory
}

/**
 * Draw movement trails for players.
 */
function drawMovementTrails(c) {
  const history = positionHistory.value

  Object.entries(history).forEach(([playerId, positions]) => {
    if (positions.length < 2) return

    // Build player lookup to get team color (handle both id and player_id formats)
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

    // Draw fading trail
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

    // Draw trail dots
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

/**
 * Clear position history (call when starting new possession).
 */
function clearTrails() {
  positionHistory.value = {}
}

// Initialize positions for a default formation
function getDefaultPositions() {
  return [
    // Home team (left side)
    { x: 0.15, y: 0.5, team: 'home', number: '1' }, // PG
    { x: 0.25, y: 0.25, team: 'home', number: '2' }, // SG
    { x: 0.25, y: 0.75, team: 'home', number: '3' }, // SF
    { x: 0.3, y: 0.35, team: 'home', number: '4' }, // PF
    { x: 0.3, y: 0.65, team: 'home', number: '5' }, // C
    // Away team (right side)
    { x: 0.85, y: 0.5, team: 'away', number: '1' }, // PG
    { x: 0.75, y: 0.25, team: 'away', number: '2' }, // SG
    { x: 0.75, y: 0.75, team: 'away', number: '3' }, // SF
    { x: 0.7, y: 0.35, team: 'away', number: '4' }, // PF
    { x: 0.7, y: 0.65, team: 'away', number: '5' }, // C
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

// Expose methods for external use
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
