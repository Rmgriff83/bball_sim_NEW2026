<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { NBA_COURT, COURT_CANVAS } from '@/config/courtConfig'
import { resolveHeadshotSrc } from '@/services/headshotResolver'
import { useSyncStore } from '@/stores/sync'

const syncStore = useSyncStore()

// Canvas-side image cache. Keys differentiate bundled (filename, content-stable)
// from custom (player.id, content may change when the user re-edits).
//   bundled:<filename>  — cached forever
//   custom:<playerId>   — re-resolved on each preload so post-edit saves
//                         replace the prior image in the same canvas session
const headshotImageCache = {}
const headshotLoadPromises = {}

function _cacheKey(player) {
  if (!player) return null
  const hasCustom = player.hasCustomHeadshot ?? player.has_custom_headshot ?? false
  // Box-score records use player_id (snake_case); roster/team records use id.
  // Check both so the custom branch fires regardless of which shape the
  // caller passes in.
  const pid = player.id ?? player.player_id ?? player.playerId
  if (hasCustom && pid) return `custom:${pid}`
  if (player.headshot) return `bundled:${player.headshot}`
  return null
}

function getHeadshotImage(player) {
  const key = _cacheKey(player)
  if (!key) return null
  return headshotImageCache[key] || null
}

/**
 * Preload every headshot referenced by the supplied players. Returns a Promise
 * that resolves once each image has either loaded or errored — never rejects
 * (a 404 on one headshot shouldn't block the rest of the canvas from rendering).
 *
 * Custom headshots (hasCustomHeadshot=true) are re-resolved on every preload
 * call so a save made mid-session lands in the canvas the next time the
 * lineup updates. Bundled headshots stay cached after first load.
 */
function preloadHeadshots(players) {
  if (!Array.isArray(players) || players.length === 0) return Promise.resolve()
  const campaignId = syncStore.activeCampaignId
  const promises = []
  const seen = new Set()

  for (const player of players) {
    const key = _cacheKey(player)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const isCustom = key.startsWith('custom:')
    if (!isCustom && headshotLoadPromises[key]) {
      promises.push(headshotLoadPromises[key])
      continue
    }

    const promise = (async () => {
      const url = await resolveHeadshotSrc(player, campaignId)
      if (!url) return
      const img = new Image()
      img.src = url
      headshotImageCache[key] = img
      if (img.complete && img.naturalWidth > 0) return
      await new Promise(resolve => {
        const done = () => resolve()
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      })
    })().catch(() => { /* swallow — never reject from preload */ })

    headshotLoadPromises[key] = promise
    promises.push(promise)
  }
  return Promise.all(promises)
}

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
  playTeamIsAway: {
    type: Boolean,
    default: false
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
  },
  activatedSynergies: {
    type: Array,
    default: () => []
  },
  // Dead-ball stoppage overlay (live segmented pacing only): when true the
  // bottom-right description bubble hides and a centered bubble takes over,
  // showing the same play description + Subs/Adjust/Continue actions.
  stoppageMode: {
    type: Boolean,
    default: false
  },
  // The play's definitive result line ("X makes the three-pointer!") shown
  // under the description inside the stoppage bubble.
  stoppageResult: {
    type: String,
    default: ''
  },
  allowSubs: {
    type: Boolean,
    default: false
  },
  simulating: {
    type: Boolean,
    default: false
  },
  // Timeout sequence: players slide off to their sidelines and a centered
  // TIMEOUT bubble counts down (skippable). The parent flips this on when
  // a called timeout fires at a play end, and off after 'timeout-complete'.
  timeoutMode: {
    type: Boolean,
    default: false
  },
  // Seconds left on the timeout clock — owned by the parent (GameView runs
  // the interval) so other surfaces (coaches overlay) can show it too.
  timeoutSecondsLeft: {
    type: Number,
    default: 30
  }
})

const emit = defineEmits(['stoppage-subs', 'stoppage-adjust', 'stoppage-continue', 'timeout-complete'])

const positionHistory = ref({})
const canvas = ref(null)
const ctx = ref(null)
const isMobile = ref(window.innerWidth <= MOBILE_BREAKPOINT)

// Flips to true once every roster headshot has finished loading (or errored
// out). Reactive watchers that drive the canvas redraw skip while this is
// false, so the first paint always has the headshots it needs in cache.
const headshotsReady = ref(false)

// Score animation state
const scoreAnimation = ref(null)  // { points: 2|3, progress: 0-1, startTime: timestamp }

// Badge animation state
const badgeAnimations = ref([])  // Array of { badgeId, level, playerName, x, y, progress, startTime }
const lastAnimatedBadges = ref('')  // Track last animated badges to prevent duplicates
const animatedBadgeKeys = ref(new Set()) // Per-badge dedupe within a possession; reset when the list shrinks (= new possession)

// Synergy animation state — synergies take precedence over individual badge
// animations for the players involved (handled in usePlayAnimation by
// filtering out their badges). Renders in the cosmic purple used elsewhere
// for synergy indicators.
const synergyAnimations = ref([])
const animatedSynergyKeys = ref(new Set())

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

// ---- Timeout sequence: slide-off + countdown display -----------------------
// On timeoutMode rising edge we snapshot every player's current interpolated
// position and tween their x past their sideline (home → left, away → right)
// with the same self-contained RAF pattern as the other canvas FX. The
// snapshot persists while timeoutMode holds so paused redraws keep the
// players off-court; the next segment's own keyframes walk them back in.
// The countdown itself is parent-owned (timeoutSecondsLeft prop).
const TIMEOUT_SLIDE_MS = 900
const timeoutSlide = ref(null) // { players: [{x, y, targetX, playerId, lineupIndex}], progress }

function startTimeoutSlide() {
  const homeIds = new Set(props.homeRoster.map(p => String(p.id ?? p.player_id)))
  const players = Object.entries(props.interpolatedPositions || {}).map(([playerId, pos]) => ({
    playerId,
    x: pos.x,
    y: pos.y,
    lineupIndex: pos.lineupIndex ?? null,
    targetX: homeIds.has(String(playerId)) ? -0.08 : 1.08,
  }))
  timeoutSlide.value = { players, progress: 0, startTime: performance.now() }
  animateTimeoutSlide()
}

function animateTimeoutSlide() {
  if (!timeoutSlide.value || !props.timeoutMode) return
  const elapsed = performance.now() - timeoutSlide.value.startTime
  timeoutSlide.value.progress = Math.min(1, elapsed / TIMEOUT_SLIDE_MS)
  drawCourt()
  if (timeoutSlide.value.progress < 1) {
    requestAnimationFrame(animateTimeoutSlide)
  }
}

// Positions to draw while the timeout is up: each player lerped from their
// frozen spot toward (and past) their sideline. hasBall is always false —
// the ball is holstered for the duration.
function timeoutSlidePositions() {
  const slide = timeoutSlide.value
  if (!slide) return null
  const t = slide.progress
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  const positions = {}
  for (const p of slide.players) {
    positions[p.playerId] = {
      x: p.x + (p.targetX - p.x) * eased,
      y: p.y,
      hasBall: false,
      lineupIndex: p.lineupIndex,
    }
  }
  return positions
}

watch(() => props.timeoutMode, (active) => {
  if (active) {
    startTimeoutSlide()
  } else {
    timeoutSlide.value = null
    positionHistory.value = {} // no trails from the slide-off on resume
    drawCourt()
  }
})

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
 * Trigger a synergy activation animation — same shape as the regular badge
 * pop, just colored in the cosmic purple used elsewhere for synergy
 * indicators. The badge animations for the players involved are suppressed
 * upstream (in `usePlayAnimation.currentActivatedBadges`) so this is the
 * sole effect that fires for them.
 *
 * @param {Object} synergy - { synergy_name, badge1, badge2, player1, player2 }
 * @param {number} x - anchor x (normalized 0-1) — defaults to the shooter
 * @param {number} y - anchor y (normalized 0-1)
 */
function triggerSynergyAnimation(synergy, x = 0.5, y = 0.4) {
  synergyAnimations.value.push({
    ...synergy,
    x,
    y,
    progress: 0,
    startTime: performance.now(),
  })
  animateSynergies()
}

function animateSynergies() {
  if (synergyAnimations.value.length === 0) return

  const now = performance.now()
  const duration = 1800  // 1.8 seconds — slightly longer than a badge

  synergyAnimations.value = synergyAnimations.value.filter(anim => {
    const elapsed = now - anim.startTime
    anim.progress = Math.min(1, elapsed / duration)
    return anim.progress < 1
  })

  drawCourt()

  if (synergyAnimations.value.length > 0) {
    requestAnimationFrame(animateSynergies)
  } else {
    drawCourt()
  }
}

/**
 * Trigger crowd celebration when a team scores
 * @param {boolean} isHomeTeam - Whether the scoring team is home
 */
function triggerCrowdCelebration(isHomeTeam = true) {
  // Crowd celebrates a score by jumping. Emoji pop-ups were removed — on older
  // phones the per-frame emoji draw loop (fillText + its own rAF) wasn't worth
  // slowing the base game animation for. The jump motion is cheap and stays.
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

/**
 * Render synergy activation pops. Same shape and animation curves as
 * `drawBadgeAnimations`, just colored in the cosmic purple
 * (#8B5CF6 / rgb(139,92,246)) used by the lineup tab's synergy indicators.
 */
function drawSynergyAnimations(c) {
  const w = courtWidth.value
  const h = courtHeight.value

  synergyAnimations.value.forEach(anim => {
    const { synergy_name, x, y, progress } = anim

    const easeOutBack = (t) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)

    const scaleProgress = Math.min(1, progress * 2.5)
    const fadeProgress = Math.max(0, (progress - 0.5) / 0.5)
    const riseProgress = easeOutQuad(progress)

    const scale = easeOutBack(scaleProgress) * 0.8
    const riseAmount = 40 * riseProgress
    const canvasX = x * w
    const canvasY = (y * h) - riseAmount
    const opacity = 1 - fadeProgress

    const PURPLE_FILL = '#8B5CF6'
    const PURPLE_LIGHT = '#C4B5FD'
    const PURPLE_GLOW = 'rgba(139, 92, 246, 0.55)'

    c.save()
    c.translate(canvasX, canvasY)
    if (isMobile.value) c.rotate(-Math.PI / 2)
    c.scale(scale, scale)
    c.globalAlpha = opacity

    // Glow halo
    const glowRadius = 30
    const gradient = c.createRadialGradient(0, 0, 0, 0, 0, glowRadius)
    gradient.addColorStop(0, PURPLE_GLOW)
    gradient.addColorStop(1, 'transparent')
    c.beginPath()
    c.arc(0, 0, glowRadius, 0, Math.PI * 2)
    c.fillStyle = gradient
    c.fill()

    // Shield (same path as the regular badge animation)
    c.beginPath()
    c.moveTo(0, -15)
    c.lineTo(12, -8)
    c.lineTo(12, 5)
    c.lineTo(0, 15)
    c.lineTo(-12, 5)
    c.lineTo(-12, -8)
    c.closePath()
    c.fillStyle = PURPLE_FILL
    c.fill()
    c.strokeStyle = '#000'
    c.lineWidth = 2
    c.stroke()

    // Center sparkle in light purple — mirrors the level letter slot on
    // regular badges. "✦" reads as a synergy / link indicator.
    c.font = 'bold 14px Arial'
    c.fillStyle = PURPLE_LIGHT
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('✦', 0, 0)

    // Synergy name below (same offset as badge name)
    const displayName = (synergy_name || 'Synergy').toUpperCase()
    c.font = 'bold 10px Arial'
    c.fillStyle = '#FFFFFF'
    c.strokeStyle = '#000'
    c.lineWidth = 2
    c.strokeText(displayName.substring(0, 14), 0, 28)
    c.fillText(displayName.substring(0, 14), 0, 28)

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
    if (props.timeoutMode) {
      // Timeout: players slide to their sidelines; no trails, no ball.
      const slidePositions = timeoutSlidePositions()
      if (slidePositions) {
        drawAnimatedPlayers(c, slidePositions)
      }
    } else {
      if (props.showTrails) {
        drawMovementTrails(c)
      }
      drawAnimatedPlayers(c)
      if (props.interpolatedBallPosition) {
        const ball = props.interpolatedBallPosition
        const airborne = ball.inFlight || ball.through
        const ballOffset = !airborne ? 16 : 0
        const ballX = ball.x * w - ballOffset
        const ballY = ball.y * h + ballOffset
        drawBall(c, ballX, ballY, airborne, ball)
      }
    }
  } else {
    if (props.showPlayers && props.playerPositions.length > 0) {
      drawPlayers(c)
    }
    if (props.ballPosition) {
      drawBall(c, props.ballPosition.x * w - 16, props.ballPosition.y * h + 16)
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

  // Draw synergy animations on top so the cosmic-purple flare reads above
  // the per-player badge effects.
  if (synergyAnimations.value.length > 0) {
    drawSynergyAnimations(c)
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

    const radius = 12
    const headshotRadius = 17
    const headshotImg = getHeadshotImage(player)
    const hasHeadshot = headshotImg && headshotImg.complete && headshotImg.naturalWidth > 0

    if (hasHeadshot) {
      c.save()
      c.beginPath()
      c.arc(x, y, headshotRadius, 0, Math.PI * 2)
      c.clip()
      if (isMobile.value) {
        c.translate(x, y)
        c.rotate(-Math.PI / 2)
        c.drawImage(headshotImg, -headshotRadius, -headshotRadius, headshotRadius * 2, headshotRadius * 2)
      } else {
        c.drawImage(headshotImg, x - headshotRadius, y - headshotRadius, headshotRadius * 2, headshotRadius * 2)
      }
      c.restore()

    } else {
      // Fallback circle (no headshot). Away team inverts the colors so the
      // home and away players are visually distinct even when their primary
      // colors are similar — white fill, team-color stroke, team-color text.
      const teamColor = isHome
        ? (props.homeTeam?.primary_color || '#3B82F6')
        : (props.awayTeam?.primary_color || '#EF4444')
      c.beginPath()
      c.arc(x, y, radius, 0, Math.PI * 2)
      if (isHome) {
        c.fillStyle = teamColor
        c.fill()
        c.strokeStyle = '#FFFFFF'
        c.lineWidth = 2
        c.stroke()
      } else {
        c.fillStyle = '#FFFFFF'
        c.fill()
        c.strokeStyle = teamColor
        c.lineWidth = 2.5
        c.stroke()
      }
    }

    // Draw position slot and last name (rotated on mobile to stay readable)
    c.save()
    c.translate(x, y)
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)
    }

    c.textAlign = 'center'
    c.textBaseline = 'middle'

    // Position slot (only show on fallback circles). Away players use the
    // team's primary color for the slot text since the circle background is
    // white; home players use white on the colored fill.
    if (!hasHeadshot) {
      c.fillStyle = isHome
        ? '#FFFFFF'
        : (props.awayTeam?.primary_color || '#EF4444')
      c.font = 'bold 10px Arial'
      c.fillText(slot, 0, 0)
    }

    // Last name below icon
    const drawRadius = hasHeadshot ? headshotRadius : radius
    const playerName = player.last_name || player.name || ''
    const lastName = playerName.includes(' ') ? playerName.split(' ').pop() : playerName
    if (lastName) {
      c.font = '9px Arial'
      c.fillStyle = 'rgba(0, 0, 0, 0.85)'
      c.textBaseline = 'top'
      c.fillText(lastName.substring(0, 8), 0, drawRadius + 4)
    }
    c.restore()
  })
}

// --- Ball spin & flight presentation (top-down view) ---
// The seam pattern rotates clockwise while the current flight segment carries
// a spin flag (shot 2.5 rev/s ≈ real backspin, pass 1.2 rev/s) and freezes
// the moment the segment resolves (rim contact, net, or catch) — the angle
// simply stops advancing when `spin` is absent. Apex height scales the ball
// up (closer to the overhead camera); a swish shrinks/fades it down through
// the net, away from the camera.
const BALL_SPIN_RPS = { shot: 2.5, pass: 1.2 }
const BALL_APEX_SCALE = 0.7
let ballSpinAngle = 0
let lastBallDrawTs = null

function drawBall(c, x, y, inFlight = false, ball = {}) {
  // Advance (or freeze) the spin angle based on real frame time.
  const now = performance.now()
  const rate = ball.spin ? (BALL_SPIN_RPS[ball.spin] ?? 0) : 0
  if (rate > 0 && lastBallDrawTs != null) {
    const dt = Math.min(0.1, (now - lastBallDrawTs) / 1000)
    ballSpinAngle = (ballSpinAngle + dt * rate * Math.PI * 2) % (Math.PI * 2)
  }
  lastBallDrawTs = now

  const height = ball.height ?? 0
  const throughT = ball.through ? (ball.throughT ?? 0) : 0
  const scale = ball.through
    ? 1 - 0.45 * throughT            // sinking through the net
    : 1 + BALL_APEX_SCALE * height   // swelling toward the camera at the apex
  const alpha = ball.through ? 1 - 0.65 * throughT : 1
  const r = 8 * scale

  c.save()
  c.globalAlpha = alpha

  // Shadow separates further from the ball the higher it flies; gone once
  // the ball is dropping through the net.
  if (!ball.through) {
    const shadowOffset = (inFlight ? 6 : 2) + height * 8
    c.beginPath()
    c.arc(x + shadowOffset, y + shadowOffset, 8, 0, Math.PI * 2)
    c.fillStyle = inFlight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.3)'
    c.fill()
  }

  const gradient = c.createRadialGradient(x - 2, y - 2, 0, x, y, r)
  gradient.addColorStop(0, '#FF8C00')
  gradient.addColorStop(1, '#FF4500')

  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fillStyle = gradient
  c.fill()

  // Seams — the ORIGINAL ball detail (one seam line + inner circle), just
  // drawn in a rotated frame so the line visibly turns while the ball spins.
  c.translate(x, y)
  c.rotate(ballSpinAngle)
  c.strokeStyle = '#000000'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(-r + 1, 0)
  c.lineTo(r - 1, 0)
  c.stroke()
  c.rotate(-ballSpinAngle)
  c.beginPath()
  c.arc(0, 0, r * 0.75, 0, Math.PI * 2)
  c.stroke()

  if (inFlight && !ball.through) {
    c.beginPath()
    c.arc(0, 0, r + 4, 0, Math.PI * 2)
    c.strokeStyle = 'rgba(255, 140, 0, 0.5)'
    c.lineWidth = 2
    c.stroke()
  }

  c.restore()
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

function drawAnimatedPlayers(c, positionsOverride = null) {
  const w = courtWidth.value
  const h = courtHeight.value
  const positions = positionsOverride || props.interpolatedPositions

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

    const radius = 14
    const headshotRadius = 19
    const headshotImg = getHeadshotImage(player)
    const hasHeadshot = headshotImg && headshotImg.complete && headshotImg.naturalWidth > 0

    if (hasHeadshot) {
      // Draw headshot clipped to circle
      c.save()
      c.beginPath()
      c.arc(x, y, headshotRadius, 0, Math.PI * 2)
      c.clip()
      if (isMobile.value) {
        c.translate(x, y)
        c.rotate(-Math.PI / 2)
        c.drawImage(headshotImg, -headshotRadius, -headshotRadius, headshotRadius * 2, headshotRadius * 2)
      } else {
        c.drawImage(headshotImg, x - headshotRadius, y - headshotRadius, headshotRadius * 2, headshotRadius * 2)
      }
      c.restore()

    } else {
      // Fallback: colored circle with position label
      c.beginPath()
      c.arc(x, y, radius, 0, Math.PI * 2)
      c.fillStyle = isHome
        ? (props.homeTeam?.primary_color || '#3B82F6')
        : (props.awayTeam?.primary_color || '#EF4444')
      c.fill()
      c.strokeStyle = hasBall ? '#FFD700' : '#FFFFFF'
      c.lineWidth = hasBall ? 3 : 2
      c.stroke()
    }

    const drawRadius = hasHeadshot ? headshotRadius : radius

    // Determine slot from lineupIndex in position data (0-4 = starters, null = bench)
    const lineupIndex = pos.lineupIndex
    const slot = lineupIndex !== null && lineupIndex !== undefined && lineupIndex < 5
      ? slotLabels[lineupIndex]
      : 'BN'

    // Draw position slot and last name (rotated on mobile to stay readable)
    c.save()
    c.translate(x, y)
    if (isMobile.value) {
      c.rotate(-Math.PI / 2)
    }

    c.textAlign = 'center'
    c.textBaseline = 'middle'

    // Position slot (only show on fallback circles)
    if (!hasHeadshot) {
      c.fillStyle = '#FFFFFF'
      c.font = 'bold 10px Arial'
      c.fillText(slot, 0, 0)
    }

    // Last name below icon
    const playerName = player?.last_name || player?.name || ''
    const lastName = playerName.includes(' ') ? playerName.split(' ').pop() : playerName
    if (lastName) {
      c.font = '9px Arial'
      c.fillStyle = 'rgba(0, 0, 0, 0.85)'
      c.textBaseline = 'top'
      c.fillText(lastName.substring(0, 8), 0, drawRadius + 4)
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

    // Faint path line only — the per-position dot breadcrumbs that used to
    // accompany it read as unexplained "extra players" scattered on the
    // court (especially after formation walks) and were removed.
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

onMounted(async () => {
  ctx.value = canvas.value.getContext('2d')
  // Wait for every headshot referenced by the supplied rosters to load before
  // the first paint, so we never flash colored placeholder circles before the
  // images settle in.
  try {
    await preloadHeadshots([...(props.homeRoster || []), ...(props.awayRoster || [])])
  } catch (_) { /* preloadHeadshots never rejects, but be safe */ }
  headshotsReady.value = true
  drawCourt()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// If the rosters change after mount (e.g. the parent loads them async or swaps
// in subs), preload any new headshots before we redraw. While preload is in
// flight we hold the canvas in its current state; once ready we draw.
watch(() => [props.homeRoster, props.awayRoster], async ([newHome, newAway]) => {
  headshotsReady.value = false
  try {
    await preloadHeadshots([...(newHome || []), ...(newAway || [])])
  } catch (_) { /* noop */ }
  headshotsReady.value = true
  drawCourt()
}, { deep: true })

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
  if (!headshotsReady.value) return
  drawCourt()
}, { deep: true })

// Reset away fan indices when mobile mode changes (different fan counts)
watch(() => isMobile.value, () => {
  stableAwayFanIndices.value = new Set()
})

// Watch for activated synergies. Synergies suppress the individual badge
// animations for participating players (handled upstream in
// usePlayAnimation.currentActivatedBadges), so this watcher just needs to
// fire the purple synergy flourish exactly once per (synergy, possession).
watch(() => props.activatedSynergies, (newSynergies, oldSynergies) => {
  if (!newSynergies || newSynergies.length === 0) {
    animatedSynergyKeys.value = new Set()
    return
  }
  if (oldSynergies && newSynergies.length < oldSynergies.length) {
    animatedSynergyKeys.value = new Set()
  }

  for (const syn of newSynergies) {
    const key = `${syn.synergy_name}-${syn.player1?.id}-${syn.player2?.id}-${syn.time || 0}`
    if (animatedSynergyKeys.value.has(key)) continue
    animatedSynergyKeys.value.add(key)

    // Anchor the pop at whoever currently has the ball — that's the
    // player whose action triggered the synergy (typically the shooter).
    // Fall back to the synergy's nominal player1 lookup, then to the
    // shooter id from props, then to a sensible default.
    const ballHolderEntry = Object.entries(props.interpolatedPositions || {})
      .find(([, pos]) => pos?.hasBall)
    const ballPos = ballHolderEntry ? ballHolderEntry[1] : null
    const p1Pos = props.interpolatedPositions?.[syn.player1?.id]
    const anchor = ballPos || p1Pos || { x: 0.5, y: 0.4 }
    triggerSynergyAnimation(syn, anchor.x, anchor.y)
  }
}, { deep: true })

// Watch for activated badges and trigger animations as they become due.
// usePlayAnimation live-filters this list by elapsedTime so badges grow
// progressively across a play. We dedupe per (badgeId, playerId, time) so
// each animation fires exactly once even if the list updates many times.
//
// Multiple badges that activate in the same possession (e.g. catch_and_shoot
// + corner_specialist on a corner-three release) used to all start their
// 1.5s pop animation at the same `performance.now()` — and since they
// share an (x, y) anchor at the player's position, they overlapped into
// a single unreadable stack. We now stagger their start times so each
// badge gets its own visible beat. The animator's existing progress filter
// (`progress < 1`) handles future-dated start times gracefully; the draw
// path skips rendering until progress > 0.
const BADGE_STAGGER_MS = 550

watch(() => props.activatedBadges, (newBadges, oldBadges) => {
  // Detect a possession reset: list shrunk to zero or shorter than before.
  // Reset the animated-keys set so the next possession's badges fire fresh.
  if (!newBadges || newBadges.length === 0) {
    animatedBadgeKeys.value = new Set()
    lastAnimatedBadges.value = ''
    return
  }
  if (oldBadges && newBadges.length < oldBadges.length) {
    animatedBadgeKeys.value = new Set()
  }

  let staggerIndex = 0
  for (const badge of newBadges) {
    const key = `${badge.badgeId}-${badge.playerId}-${badge.time || 0}`
    if (animatedBadgeKeys.value.has(key)) continue
    animatedBadgeKeys.value.add(key)

    const playerPos = props.interpolatedPositions[badge.playerId]
    const x = playerPos ? playerPos.x : 0.5
    const y = playerPos ? playerPos.y : 0.4
    const delay = staggerIndex * BADGE_STAGGER_MS
    staggerIndex++

    if (delay === 0) {
      triggerBadgeAnimation(badge, x, y)
    } else {
      // Snapshot the anchor at queue time so later badges still anchor to
      // where the player was when the play resolved, even if the player
      // moves during the stagger window.
      setTimeout(() => {
        triggerBadgeAnimation(badge, x, y)
      }, delay)
    }
  }
}, { deep: true })

defineExpose({
  redraw: drawCourt,
  getDefaultPositions,
  clearTrails,
  triggerScoreAnimation,
  triggerBadgeAnimation,
  triggerSynergyAnimation,
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

    <!-- Play Description Overlay (bottom right; yields to the stoppage
         bubble while a dead-ball break is up) -->
    <div v-if="playDescription && !stoppageMode" class="play-description-overlay">
      <div class="play-description-entry">
        <span
          class="play-team-badge"
          :class="{ 'away-team': playTeamIsAway }"
          :style="{ '--team-color': playTeamColor }"
        >
          {{ playTeamAbbreviation }}
        </span>
        <span class="play-description-text">{{ playDescription }}</span>
      </div>
    </div>

    <!-- Stoppage Overlay (centered): the play description in the same
         bubble style, plus the dead-ball actions. -->
    <div v-if="stoppageMode" class="stoppage-overlay">
      <div v-if="playDescription" class="stoppage-last-play-label">Last Play:</div>
      <div v-if="playDescription" class="play-description-entry">
        <span
          class="play-team-badge"
          :class="{ 'away-team': playTeamIsAway }"
          :style="{ '--team-color': playTeamColor }"
        >
          {{ playTeamAbbreviation }}
        </span>
        <span class="play-description-text">{{ playDescription }}</span>
      </div>
      <template v-if="stoppageResult && stoppageResult !== playDescription">
        <div class="stoppage-last-play-label stoppage-result-label">Result:</div>
        <div class="stoppage-result-text">{{ stoppageResult }}</div>
      </template>
      <div class="stoppage-actions">
        <button v-if="allowSubs" class="stoppage-btn" @click="emit('stoppage-subs')">Subs</button>
        <button v-if="allowSubs" class="stoppage-btn" @click="emit('stoppage-adjust')">Adjust</button>
        <button
          class="stoppage-btn stoppage-btn-continue"
          :disabled="simulating"
          @click="emit('stoppage-continue')"
        >
          <span v-if="simulating" class="stoppage-btn-loading"></span>
          <span v-else>Continue ▸</span>
        </button>
      </div>
    </div>

    <!-- Timeout Overlay (centered): same bubble family as the stoppage
         overlay — big countdown, skippable, with a shortcut into the
         coaches overlay (subs/settings while the clock runs). -->
    <div v-if="timeoutMode" class="stoppage-overlay timeout-overlay">
      <div class="timeout-title">Timeout</div>
      <div class="timeout-clock">0:{{ String(Math.max(0, timeoutSecondsLeft)).padStart(2, '0') }}</div>
      <div class="stoppage-actions">
        <button class="stoppage-btn" @click="emit('stoppage-adjust')">Coaching</button>
        <button
          class="stoppage-btn stoppage-btn-continue"
          :disabled="simulating"
          @click="emit('timeout-complete')"
        >
          <span v-if="simulating" class="stoppage-btn-loading"></span>
          <span v-else>Skip ▸</span>
        </button>
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
  background: var(--team-color, #6B7280);
}

/* AWAY TEAM TREATMENT — same inversion rule as the rest of the game logos. */
.play-team-badge.away-team {
  background: #FFFFFF;
  color: var(--team-color, #1a1520);
  border: 1px solid var(--team-color, #6B7280);
}

.play-description-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.3;
}

/* Centered dead-ball stoppage bubble — same family as the description
   overlay, promoted to center stage with the break actions attached. */
.stoppage-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.72);
  padding: 10px 12px;
  border-radius: 8px;
  max-width: 82%;
  z-index: 11;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  animation: stoppagePop 0.25s ease-out;
}

@keyframes stoppagePop {
  from {
    transform: translate(-50%, -50%) scale(0.92);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

.stoppage-last-play-label {
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: -4px; /* tucks the label against its description line */
}

.stoppage-result-label {
  color: rgba(239, 106, 79, 0.85); /* coral — marks the verified outcome */
  margin-top: 2px;
}

/* The play's verified outcome, under the description. Brighter/bolder than
   the description so the result reads as the headline of the two. */
.stoppage-result-text {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
  text-align: left;
  margin-top: -4px;
}

.stoppage-actions {
  display: flex;
  gap: 6px;
}

/* Timeout bubble: same base as .stoppage-overlay, content centered around
   the big countdown. */
.timeout-overlay {
  align-items: center;
  min-width: 110px;
}

.timeout-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.75);
}

.timeout-clock {
  font-family: 'Courier New', monospace;
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  letter-spacing: 0.04em;
}

.stoppage-btn {
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #e6e9f0;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.stoppage-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.stoppage-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.stoppage-btn-continue {
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
}

.stoppage-btn-continue:hover:not(:disabled) {
  background: #f4795f;
}

.stoppage-btn-loading {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: stoppageSpin 0.7s linear infinite;
  vertical-align: middle;
}

@keyframes stoppageSpin {
  to { transform: rotate(360deg); }
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
