<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTradeStore } from '@/stores/trade'
import { useTeamStore } from '@/stores/team'
import { GlassCard, BaseButton, BaseModal, LoadingSpinner, StatBadge } from '@/components/ui'
import { User, ArrowRight, ArrowLeft, X, Check, AlertCircle, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus, Package, Users, Repeat, AlertTriangle, CheckCircle, Info, Star, Calendar, DollarSign } from 'lucide-vue-next'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['trade-completed'])

const router = useRouter()
const tradeStore = useTradeStore()
const teamStore = useTeamStore()

// Wizard state
const loading = ref(true)
const showTradeWizard = ref(false)
const wizardStep = ref(1) // 1: Your assets, 2: Team selection, 3: Their assets
const assetTab = ref('players') // 'players' or 'picks'

// Confirmation modal state
const showConfirmModal = ref(false)
const confirmModalState = ref('confirm') // 'confirm', 'loading', 'result'

// Step definitions for the wizard
const wizardSteps = [
  { number: 1, title: 'Your Assets', description: 'Select assets to trade away', icon: Package },
  { number: 2, title: 'Trade Partner', description: 'Choose a team to trade with', icon: Users },
  { number: 3, title: 'Their Assets', description: 'Select assets to receive', icon: Repeat },
]

const tradeableTeams = computed(() => tradeStore.tradeableTeams)
const selectedTeam = computed(() => tradeStore.selectedTeam)
const selectedTeamRoster = computed(() => tradeStore.selectedTeamRoster)
const selectedTeamPicks = computed(() => tradeStore.selectedTeamPicks)
const userAssets = computed(() => tradeStore.userAssets)
const userOffering = computed(() => tradeStore.userOffering)
const userRequesting = computed(() => tradeStore.userRequesting)
const canProposeTrade = computed(() => tradeStore.canProposeTrade)
const proposing = computed(() => tradeStore.proposing)
const lastProposalResult = computed(() => tradeStore.lastProposalResult)

// Wizard navigation validation
const canWizardNext = computed(() => {
  if (wizardStep.value === 1) {
    return userOffering.value.length > 0
  }
  if (wizardStep.value === 2) {
    return selectedTeam.value !== null
  }
  if (wizardStep.value === 3) {
    return userRequesting.value.length > 0
  }
  return false
})

const canWizardBack = computed(() => wizardStep.value > 1)

const canSubmitTrade = computed(() => {
  return userRequesting.value.length > 0 && userOffering.value.length > 0 && tradeValidation.value.isValid
})

// Trade validation logic
const tradeValidation = computed(() => {
  const issues = []
  const warnings = []

  // Check if we have assets on both sides
  if (userOffering.value.length === 0) {
    issues.push('You must select at least one asset to trade away')
  }
  if (userRequesting.value.length === 0) {
    issues.push('You must select at least one asset to receive')
  }

  // Salary matching rules (NBA-style: within 125% + $100K for teams over cap)
  const outgoingSalary = tradeStore.userOfferingSalary
  const incomingSalary = tradeStore.userRequestingSalary
  const salaryDiff = tradeStore.salaryDifference

  if (outgoingSalary > 0 || incomingSalary > 0) {
    // Calculate allowed salary difference (simplified: 125% rule)
    const maxIncoming = outgoingSalary * 1.25 + 100000
    const minIncoming = outgoingSalary * 0.75 - 100000

    if (incomingSalary > maxIncoming && outgoingSalary > 0) {
      const overBy = incomingSalary - maxIncoming
      issues.push(`Incoming salary exceeds limit by ${formatSalary(overBy)}. Add more outgoing salary or reduce incoming.`)
    }

    // Warn about significant salary imbalance
    if (Math.abs(salaryDiff) > 5000000) {
      if (salaryDiff > 0) {
        warnings.push(`You're taking on ${formatSalary(salaryDiff)} more in salary`)
      } else {
        warnings.push(`You're shedding ${formatSalary(Math.abs(salaryDiff))} in salary`)
      }
    }
  }

  // Check roster size implications
  const playersOut = userOffering.value.filter(a => a.type === 'player').length
  const playersIn = userRequesting.value.filter(a => a.type === 'player').length
  const rosterChange = playersIn - playersOut

  if (rosterChange > 0) {
    warnings.push(`This trade adds ${rosterChange} player${rosterChange > 1 ? 's' : ''} to your roster`)
  } else if (rosterChange < 0) {
    warnings.push(`This trade removes ${Math.abs(rosterChange)} player${Math.abs(rosterChange) > 1 ? 's' : ''} from your roster`)
  }

  return {
    isValid: issues.length === 0 && userOffering.value.length > 0 && userRequesting.value.length > 0,
    issues,
    warnings,
    salaryOut: outgoingSalary,
    salaryIn: incomingSalary,
    salaryDiff
  }
})

onMounted(async () => {
  try {
    await Promise.all([
      tradeStore.fetchTradeableTeams(props.campaignId),
      tradeStore.fetchUserAssets(props.campaignId)
    ])
  } catch (err) {
    console.error('Failed to load trade data:', err)
  } finally {
    loading.value = false
  }
})

// When selecting a team, fetch their details
watch(() => tradeStore.selectedTeamId, async (teamId) => {
  if (teamId) {
    try {
      await tradeStore.fetchTeamDetails(props.campaignId, teamId)
    } catch (err) {
      console.error('Failed to load team details:', err)
    }
  }
})

// Wizard navigation
function startTradeWizard() {
  wizardStep.value = 1
  assetTab.value = 'players'
  showTradeWizard.value = true
}

function closeTradeWizard() {
  showTradeWizard.value = false
  // Clear trade state when closing the wizard
  tradeStore.clearTrade()
  tradeStore.clearSelectedTeam()
  wizardStep.value = 1
  assetTab.value = 'players'
}

function wizardNext() {
  if (canWizardNext.value && wizardStep.value < 3) {
    wizardStep.value++
    assetTab.value = 'players' // Reset tab when changing steps
  } else if (wizardStep.value === 3 && canSubmitTrade.value) {
    // Move to confirmation
    showTradeWizard.value = false
    openConfirmModal()
  }
}

function wizardBack() {
  if (wizardStep.value > 1) {
    wizardStep.value--
    assetTab.value = 'players'
  }
}

function selectTeam(team) {
  // Clear requesting assets when changing teams
  tradeStore.userRequesting.splice(0)
  tradeStore.selectTeam(team)
}

function addPlayerToOffer(player) {
  tradeStore.addToUserOffering({
    type: 'player',
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    position: player.position,
    overallRating: player.overallRating,
    contractSalary: player.contractSalary,
    contractYearsRemaining: player.contractYearsRemaining,
    tradeValue: player.tradeValue,
    age: player.age,
  })
}

function addPickToOffer(pick) {
  tradeStore.addToUserOffering({
    type: 'pick',
    id: pick.id,
    year: pick.year,
    round: pick.round,
    displayName: pick.display_name,
    tradeValue: pick.trade_value,
    originalTeamAbbreviation: pick.original_team_abbreviation,
    projectedPosition: pick.projected_position,
  })
}

function addPlayerToRequest(player) {
  tradeStore.addToUserRequesting({
    type: 'player',
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    position: player.position,
    overallRating: player.overallRating,
    contractSalary: player.contractSalary,
    contractYearsRemaining: player.contractYearsRemaining,
    tradeValue: player.tradeValue,
    age: player.age,
  })
}

function addPickToRequest(pick) {
  tradeStore.addToUserRequesting({
    type: 'pick',
    id: pick.id,
    year: pick.year,
    round: pick.round,
    displayName: pick.display_name,
    tradeValue: pick.trade_value,
    originalTeamAbbreviation: pick.original_team_abbreviation,
    projectedPosition: pick.projected_position,
  })
}

function removeFromOffer(asset) {
  tradeStore.removeFromUserOffering(asset)
}

function removeFromRequest(asset) {
  tradeStore.removeFromUserRequesting(asset)
}

// Get the roster/picks based on wizard step
const wizardRoster = computed(() => {
  if (wizardStep.value === 1) {
    return userAssets.value.roster || []
  }
  return selectedTeamRoster.value || []
})

const wizardPicks = computed(() => {
  if (wizardStep.value === 1) {
    return userAssets.value.picks || []
  }
  return selectedTeamPicks.value || []
})

function togglePlayerSelection(player) {
  if (wizardStep.value === 1) {
    if (tradeStore.isInOffering('player', player.id)) {
      removeFromOffer({ type: 'player', id: player.id })
    } else {
      addPlayerToOffer(player)
    }
  } else if (wizardStep.value === 3) {
    if (tradeStore.isInRequesting('player', player.id)) {
      removeFromRequest({ type: 'player', id: player.id })
    } else {
      addPlayerToRequest(player)
    }
  }
}

function togglePickSelection(pick) {
  if (wizardStep.value === 1) {
    if (tradeStore.isInOffering('pick', pick.id)) {
      removeFromOffer({ type: 'pick', id: pick.id })
    } else {
      addPickToOffer(pick)
    }
  } else if (wizardStep.value === 3) {
    if (tradeStore.isInRequesting('pick', pick.id)) {
      removeFromRequest({ type: 'pick', id: pick.id })
    } else {
      addPickToRequest(pick)
    }
  }
}

function isPlayerSelected(playerId) {
  if (wizardStep.value === 1) {
    return tradeStore.isInOffering('player', playerId)
  }
  return tradeStore.isInRequesting('player', playerId)
}

function isPickSelected(pickId) {
  if (wizardStep.value === 1) {
    return tradeStore.isInOffering('pick', pickId)
  }
  return tradeStore.isInRequesting('pick', pickId)
}

function openConfirmModal() {
  confirmModalState.value = 'confirm'
  showConfirmModal.value = true
}

async function confirmAndProposeTrade() {
  try {
    confirmModalState.value = 'loading'
    await tradeStore.proposeTrade(props.campaignId)
    confirmModalState.value = 'result'
  } catch (err) {
    console.error('Trade proposal failed:', err)
    confirmModalState.value = 'result'
  }
}

async function executeTrade() {
  try {
    confirmModalState.value = 'loading'
    await tradeStore.executeTrade(props.campaignId)

    // Refresh user assets and team roster
    await Promise.all([
      tradeStore.fetchUserAssets(props.campaignId),
      teamStore.fetchTeam(props.campaignId)
    ])

    showConfirmModal.value = false

    // Reset trade state and emit event to switch to team tab
    tradeStore.clearTrade()
    tradeStore.clearSelectedTeam()
    wizardStep.value = 1
    emit('trade-completed')
  } catch (err) {
    console.error('Trade execution failed:', err)
    confirmModalState.value = 'result'
  }
}

function resetTrade() {
  tradeStore.clearTrade()
  tradeStore.clearSelectedTeam()
  wizardStep.value = 1
  showConfirmModal.value = false
  showTradeWizard.value = false
}

function closeConfirmModal() {
  showConfirmModal.value = false
  confirmModalState.value = 'confirm'

  // If rejected or invalid, go back to wizard to try again
  if (lastProposalResult.value?.decision === 'reject' || lastProposalResult.value?.decision === 'invalid') {
    showTradeWizard.value = true
    wizardStep.value = 3
  }
}

function formatSalary(salary) {
  return tradeStore.formatSalary(salary)
}

function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6',
  }
  return colors[position] || '#6B7280'
}

function getDirectionIcon(direction) {
  if (direction === 'contending') return TrendingUp
  if (direction === 'rebuilding') return TrendingDown
  return Minus
}

// Convert trade value to star rating (1-5)
function getAssetStars(asset) {
  if (asset.type === 'player') {
    // For players, use overall rating to determine stars
    const rating = asset.overallRating || 75
    if (rating >= 88) return 5
    if (rating >= 82) return 4
    if (rating >= 76) return 3
    if (rating >= 70) return 2
    return 1
  } else {
    // For picks, use trade value or projected position
    const projected = asset.projectedPosition || 30
    if (projected <= 5) return 5
    if (projected <= 14) return 4
    if (projected <= 30) return 3
    if (projected <= 45) return 2
    return 1
  }
}

function formatContractYears(years) {
  if (!years || years <= 0) return 'Expiring'
  if (years === 1) return '1 yr'
  return `${years} yrs`
}
</script>

<template>
  <div class="trade-center">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <p class="text-secondary mt-4">Loading trade center...</p>
    </div>

    <!-- Intro Page (shown when wizard is closed) -->
    <div v-else-if="!showTradeWizard" class="trade-intro">
      <GlassCard padding="xl" :hoverable="false">
        <div class="intro-content">
          <div class="intro-icon">
            <Repeat :size="64" />
          </div>
          <h2>Trade Center</h2>
          <p class="intro-description">
            Build your championship roster by trading with other teams in the league.
            Propose trades for players and draft picks to strengthen your team.
          </p>

          <div class="intro-steps">
            <div class="intro-step">
              <div class="intro-step-number">1</div>
              <div class="intro-step-info">
                <span class="intro-step-title">Select Your Assets</span>
                <span class="intro-step-desc">Choose players and picks to trade away</span>
              </div>
            </div>
            <div class="intro-step">
              <div class="intro-step-number">2</div>
              <div class="intro-step-info">
                <span class="intro-step-title">Choose Trade Partner</span>
                <span class="intro-step-desc">Pick a team to negotiate with</span>
              </div>
            </div>
            <div class="intro-step">
              <div class="intro-step-number">3</div>
              <div class="intro-step-info">
                <span class="intro-step-title">Request Assets</span>
                <span class="intro-step-desc">Select what you want in return</span>
              </div>
            </div>
          </div>

          <BaseButton variant="primary" size="lg" @click="startTradeWizard">
            <Repeat :size="20" />
            Start Trading
          </BaseButton>
        </div>
      </GlassCard>
    </div>

    <!-- Trade Wizard Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showTradeWizard"
          class="wizard-modal-overlay"
          @click.self="closeTradeWizard"
        >
          <div class="wizard-modal-container">
            <!-- Header -->
            <header class="wizard-modal-header">
              <h2 class="wizard-modal-title">{{ wizardSteps[wizardStep - 1]?.title || 'Trade Wizard' }}</h2>
              <button
                class="wizard-btn-close"
                @click="closeTradeWizard"
                aria-label="Close"
              >
                <X :size="20" />
              </button>
            </header>

            <!-- Content -->
            <main class="wizard-modal-content">
              <div class="wizard-content">
        <!-- Wizard Step Indicator -->
        <div class="wizard-step-indicator">
          <template v-for="(step, index) in wizardSteps" :key="step.number">
            <div
              class="wizard-step"
              :class="{
                active: wizardStep === step.number,
                completed: wizardStep > step.number
              }"
            >
              <div class="wizard-step-number">
                <Check v-if="wizardStep > step.number" :size="14" />
                <span v-else>{{ step.number }}</span>
              </div>
              <span class="wizard-step-title">{{ step.title }}</span>
            </div>
            <div v-if="index < wizardSteps.length - 1" class="wizard-step-connector" :class="{ completed: wizardStep > step.number }">
              <ChevronRight :size="14" />
            </div>
          </template>
        </div>

        <!-- Step 1: Your Assets -->
        <div v-if="wizardStep === 1" class="wizard-step-content">
          <p class="wizard-step-description">Select the players and draft picks you want to trade away.</p>

          <!-- Asset Tabs -->
          <div class="wizard-asset-tabs">
            <button
              class="wizard-asset-tab"
              :class="{ active: assetTab === 'players' }"
              @click="assetTab = 'players'"
            >
              <User :size="16" />
              Players ({{ wizardRoster.length }})
            </button>
            <button
              class="wizard-asset-tab"
              :class="{ active: assetTab === 'picks' }"
              @click="assetTab = 'picks'"
            >
              <Calendar :size="16" />
              Draft Picks ({{ wizardPicks.length }})
            </button>
          </div>

          <!-- Selected Summary -->
          <div v-if="userOffering.length > 0" class="wizard-selected-summary">
            <span class="selected-label">Selected to trade:</span>
            <div class="selected-chips">
              <div v-for="asset in userOffering" :key="`chip-${asset.type}-${asset.id}`" class="selected-chip">
                <span v-if="asset.type === 'player'">{{ asset.firstName }} {{ asset.lastName }}</span>
                <span v-else>{{ asset.year }} R{{ asset.round }}</span>
                <button class="chip-remove" @click.stop="removeFromOffer(asset)">
                  <X :size="12" />
                </button>
              </div>
            </div>
          </div>

          <!-- Players Grid -->
          <div v-if="assetTab === 'players'" class="wizard-asset-grid">
            <div
              v-for="player in wizardRoster"
              :key="player.id"
              class="wizard-asset-card player"
              :class="{ selected: isPlayerSelected(player.id) }"
              @click="togglePlayerSelection(player)"
            >
              <div class="wizard-asset-card-content">
                <div class="wizard-asset-avatar">
                  <User :size="24" />
                </div>
                <div class="wizard-asset-info">
                  <span class="wizard-asset-name">{{ player.firstName }} {{ player.lastName }}</span>
                  <div class="wizard-asset-meta">
                    <span class="wizard-asset-position" :style="{ backgroundColor: getPositionColor(player.position) }">
                      {{ player.position }}
                    </span>
                    <StatBadge :value="player.overallRating" size="xs" />
                    <span class="wizard-asset-age">{{ player.age }} yrs</span>
                  </div>
                  <div class="wizard-asset-contract">
                    <span class="wizard-asset-salary">{{ formatSalary(player.contractSalary) }}</span>
                    <span class="wizard-asset-years">{{ formatContractYears(player.contractYearsRemaining) }}</span>
                  </div>
                </div>
                <div class="wizard-asset-check">
                  <Check v-if="isPlayerSelected(player.id)" :size="20" />
                </div>
              </div>
            </div>
            <div v-if="wizardRoster.length === 0" class="wizard-asset-empty">
              No players available
            </div>
          </div>

          <!-- Picks Grid -->
          <div v-else class="wizard-asset-grid picks">
            <div
              v-for="pick in wizardPicks"
              :key="pick.id"
              class="wizard-asset-card pick"
              :class="{ selected: isPickSelected(pick.id) }"
              @click="togglePickSelection(pick)"
            >
              <div class="wizard-asset-card-content">
                <div class="wizard-asset-pick-year">{{ pick.year }}</div>
                <div class="wizard-asset-info">
                  <span class="wizard-asset-name">Round {{ pick.round }}</span>
                  <span v-if="pick.original_team_abbreviation" class="wizard-asset-pick-team">({{ pick.original_team_abbreviation }})</span>
                  <div v-if="pick.projected_position" class="wizard-asset-projection">
                    Projected #{{ pick.projected_position }}
                  </div>
                </div>
                <div class="wizard-asset-check">
                  <Check v-if="isPickSelected(pick.id)" :size="20" />
                </div>
              </div>
            </div>
            <div v-if="wizardPicks.length === 0" class="wizard-asset-empty">
              No draft picks available
            </div>
          </div>
        </div>

        <!-- Step 2: Trade Partner -->
        <div v-if="wizardStep === 2" class="wizard-step-content">
          <p class="wizard-step-description">Choose which team you want to trade with.</p>

          <div class="wizard-teams-grid">
            <button
              v-for="team in tradeableTeams"
              :key="team.id"
              class="wizard-team-card"
              :class="{ selected: selectedTeam?.id === team.id }"
              @click="selectTeam(team)"
            >
              <div class="wizard-team-header">
                <span class="wizard-team-abbr">{{ team.abbreviation }}</span>
                <Check v-if="selectedTeam?.id === team.id" :size="18" class="wizard-team-check" />
              </div>
              <span class="wizard-team-city">{{ team.city }} {{ team.name }}</span>
              <div class="wizard-team-meta">
                <span class="wizard-team-record">{{ team.record.wins }}-{{ team.record.losses }}</span>
                <span class="wizard-team-direction" :style="{ color: tradeStore.getDirectionColor(team.direction) }">
                  <component :is="getDirectionIcon(team.direction)" :size="14" />
                  {{ tradeStore.getDirectionLabel(team.direction) }}
                </span>
              </div>
            </button>
          </div>

          <!-- Selected Team Details -->
          <div v-if="selectedTeam" class="wizard-selected-team-details">
            <h4>{{ selectedTeam.city }} {{ selectedTeam.name }}</h4>
            <div class="wizard-team-stats">
              <div class="wizard-stat">
                <span class="wizard-stat-label">Record</span>
                <span class="wizard-stat-value">{{ selectedTeam.record.wins }}-{{ selectedTeam.record.losses }}</span>
              </div>
              <div class="wizard-stat">
                <span class="wizard-stat-label">Cap Space</span>
                <span class="wizard-stat-value">{{ formatSalary(selectedTeam.cap_space) }}</span>
              </div>
              <div class="wizard-stat">
                <span class="wizard-stat-label">Direction</span>
                <span class="wizard-stat-value" :style="{ color: tradeStore.getDirectionColor(selectedTeam.direction) }">
                  {{ tradeStore.getDirectionLabel(selectedTeam.direction) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 3: Their Assets -->
        <div v-if="wizardStep === 3" class="wizard-step-content">
          <p class="wizard-step-description">Select what you want from the {{ selectedTeam?.name }}.</p>

          <!-- Asset Tabs -->
          <div class="wizard-asset-tabs">
            <button
              class="wizard-asset-tab"
              :class="{ active: assetTab === 'players' }"
              @click="assetTab = 'players'"
            >
              <User :size="16" />
              Players ({{ wizardRoster.length }})
            </button>
            <button
              class="wizard-asset-tab"
              :class="{ active: assetTab === 'picks' }"
              @click="assetTab = 'picks'"
            >
              <Calendar :size="16" />
              Draft Picks ({{ wizardPicks.length }})
            </button>
          </div>

          <!-- Selected Summary -->
          <div v-if="userRequesting.length > 0" class="wizard-selected-summary receiving">
            <span class="selected-label">Requesting:</span>
            <div class="selected-chips">
              <div v-for="asset in userRequesting" :key="`chip-${asset.type}-${asset.id}`" class="selected-chip">
                <span v-if="asset.type === 'player'">{{ asset.firstName }} {{ asset.lastName }}</span>
                <span v-else>{{ asset.year }} R{{ asset.round }}</span>
                <button class="chip-remove" @click.stop="removeFromRequest(asset)">
                  <X :size="12" />
                </button>
              </div>
            </div>
          </div>

          <!-- Players Grid -->
          <div v-if="assetTab === 'players'" class="wizard-asset-grid">
            <div
              v-for="player in wizardRoster"
              :key="player.id"
              class="wizard-asset-card player"
              :class="{ selected: isPlayerSelected(player.id) }"
              @click="togglePlayerSelection(player)"
            >
              <div class="wizard-asset-card-content">
                <div class="wizard-asset-avatar">
                  <User :size="24" />
                </div>
                <div class="wizard-asset-info">
                  <span class="wizard-asset-name">{{ player.firstName }} {{ player.lastName }}</span>
                  <div class="wizard-asset-meta">
                    <span class="wizard-asset-position" :style="{ backgroundColor: getPositionColor(player.position) }">
                      {{ player.position }}
                    </span>
                    <StatBadge :value="player.overallRating" size="xs" />
                    <span class="wizard-asset-age">{{ player.age }} yrs</span>
                  </div>
                  <div class="wizard-asset-contract">
                    <span class="wizard-asset-salary">{{ formatSalary(player.contractSalary) }}</span>
                    <span class="wizard-asset-years">{{ formatContractYears(player.contractYearsRemaining) }}</span>
                  </div>
                </div>
                <div class="wizard-asset-check">
                  <Check v-if="isPlayerSelected(player.id)" :size="20" />
                </div>
              </div>
            </div>
            <div v-if="wizardRoster.length === 0" class="wizard-asset-empty">
              No players available
            </div>
          </div>

          <!-- Picks Grid -->
          <div v-else class="wizard-asset-grid picks">
            <div
              v-for="pick in wizardPicks"
              :key="pick.id"
              class="wizard-asset-card pick"
              :class="{ selected: isPickSelected(pick.id) }"
              @click="togglePickSelection(pick)"
            >
              <div class="wizard-asset-card-content">
                <div class="wizard-asset-pick-year">{{ pick.year }}</div>
                <div class="wizard-asset-info">
                  <span class="wizard-asset-name">Round {{ pick.round }}</span>
                  <span v-if="pick.original_team_abbreviation" class="wizard-asset-pick-team">({{ pick.original_team_abbreviation }})</span>
                  <div v-if="pick.projected_position" class="wizard-asset-projection">
                    Projected #{{ pick.projected_position }}
                  </div>
                </div>
                <div class="wizard-asset-check">
                  <Check v-if="isPickSelected(pick.id)" :size="20" />
                </div>
              </div>
            </div>
            <div v-if="wizardPicks.length === 0" class="wizard-asset-empty">
              No draft picks available
            </div>
          </div>

          <!-- Trade Validation Status -->
          <div v-if="userRequesting.length > 0 && userOffering.length > 0" class="wizard-trade-validation" :class="{ valid: tradeValidation.isValid, invalid: !tradeValidation.isValid }">
            <div class="validation-header">
              <CheckCircle v-if="tradeValidation.isValid" :size="18" class="validation-icon valid" />
              <AlertTriangle v-else :size="18" class="validation-icon invalid" />
              <span class="validation-title">
                {{ tradeValidation.isValid ? 'Trade is Valid' : 'Trade Invalid' }}
              </span>
            </div>

            <!-- Issues -->
            <div v-if="tradeValidation.issues.length > 0" class="validation-issues">
              <div v-for="(issue, idx) in tradeValidation.issues" :key="`issue-${idx}`" class="validation-item error">
                <AlertCircle :size="14" />
                <span>{{ issue }}</span>
              </div>
            </div>

            <!-- Warnings -->
            <div v-if="tradeValidation.warnings.length > 0" class="validation-warnings">
              <div v-for="(warning, idx) in tradeValidation.warnings" :key="`warn-${idx}`" class="validation-item warning">
                <Info :size="14" />
                <span>{{ warning }}</span>
              </div>
            </div>
          </div>
        </div>

              </div>
            </main>

            <!-- Footer -->
            <footer class="wizard-modal-footer">
              <button
                v-if="canWizardBack"
                class="wizard-btn-back"
                @click="wizardBack"
              >
                <ChevronLeft :size="18" />
                Back
              </button>
              <div v-else></div>

              <div class="wizard-nav-right">
                <button
                  v-if="wizardStep < 3"
                  class="wizard-btn-next"
                  @click="wizardNext"
                  :disabled="!canWizardNext"
                >
                  Next
                  <ChevronRight :size="18" />
                </button>
                <button
                  v-else
                  class="wizard-btn-next"
                  @click="wizardNext"
                  :disabled="!canSubmitTrade"
                >
                  Review Trade
                  <ArrowRight :size="18" />
                </button>
              </div>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Trade Confirmation Modal -->
    <BaseModal
      :show="showConfirmModal"
      @close="closeConfirmModal"
      :title="confirmModalState === 'confirm' ? 'Confirm Trade' : confirmModalState === 'loading' ? 'Processing Trade...' : lastProposalResult?.decision === 'accept' ? 'Trade Accepted!' : 'Trade Response'"
      size="lg"
      :closable="confirmModalState !== 'loading'"
    >
      <div class="trade-modal-content">
        <!-- Loading State -->
        <div v-if="confirmModalState === 'loading'" class="modal-loading">
          <LoadingSpinner size="lg" />
          <p>{{ lastProposalResult?.decision === 'accept' ? 'Completing trade...' : 'Evaluating trade proposal...' }}</p>
        </div>

        <!-- Confirm State - Show trade details with slot cards -->
        <template v-else-if="confirmModalState === 'confirm'">
          <p class="modal-subtitle">Review the trade details before proposing to {{ selectedTeam?.city }} {{ selectedTeam?.name }}.</p>

          <div class="modal-trade-slots">
            <!-- YOUR TEAM SIDE -->
            <div class="modal-team-section sending">
              <div class="modal-team-header">
                <span class="modal-team-label">Your Team Sends</span>
              </div>
              <div class="modal-assets-grid">
                <div
                  v-for="asset in userOffering"
                  :key="`modal-send-${asset.type}-${asset.id}`"
                  class="modal-asset-card"
                  :class="asset.type"
                >
                  <!-- Player Card -->
                  <template v-if="asset.type === 'player'">
                    <div class="modal-player-card">
                      <div class="modal-player-avatar">
                        <User :size="24" />
                      </div>
                      <div class="modal-player-info">
                        <span class="modal-player-name">{{ asset.firstName }} {{ asset.lastName }}</span>
                        <div class="modal-player-meta">
                          <span class="modal-position-badge" :style="{ backgroundColor: getPositionColor(asset.position) }">
                            {{ asset.position }}
                          </span>
                          <span class="modal-player-age">{{ asset.age }} yrs</span>
                        </div>
                        <div class="modal-player-contract">
                          <span class="modal-contract-salary">{{ formatSalary(asset.contractSalary) }}</span>
                          <span class="modal-contract-years">{{ formatContractYears(asset.contractYearsRemaining) }}</span>
                        </div>
                        <div class="modal-star-rating">
                          <Star v-for="s in getAssetStars(asset)" :key="s" :size="12" class="star filled" />
                          <Star v-for="s in (5 - getAssetStars(asset))" :key="`e-${s}`" :size="12" class="star empty" />
                        </div>
                      </div>
                    </div>
                  </template>
                  <!-- Pick Card -->
                  <template v-else>
                    <div class="modal-pick-card">
                      <div class="modal-pick-year">{{ asset.year }}</div>
                      <div class="modal-pick-info">
                        <span class="modal-pick-round">Round {{ asset.round }}</span>
                        <span v-if="asset.originalTeamAbbreviation" class="modal-pick-team">({{ asset.originalTeamAbbreviation }})</span>
                        <div class="modal-star-rating">
                          <Star v-for="s in getAssetStars(asset)" :key="s" :size="12" class="star filled" />
                          <Star v-for="s in (5 - getAssetStars(asset))" :key="`e-${s}`" :size="12" class="star empty" />
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <!-- TRADE DIRECTION INDICATOR -->
            <div class="modal-trade-direction">
              <div class="modal-arrow-container">
                <Repeat :size="28" />
              </div>
            </div>

            <!-- PARTNER TEAM SIDE -->
            <div class="modal-team-section receiving">
              <div class="modal-team-header">
                <span class="modal-team-badge">{{ selectedTeam?.abbreviation }}</span>
                <span class="modal-team-label">{{ selectedTeam?.name }} Send</span>
              </div>
              <div class="modal-assets-grid">
                <div
                  v-for="asset in userRequesting"
                  :key="`modal-recv-${asset.type}-${asset.id}`"
                  class="modal-asset-card"
                  :class="asset.type"
                >
                  <!-- Player Card -->
                  <template v-if="asset.type === 'player'">
                    <div class="modal-player-card">
                      <div class="modal-player-avatar">
                        <User :size="24" />
                      </div>
                      <div class="modal-player-info">
                        <span class="modal-player-name">{{ asset.firstName }} {{ asset.lastName }}</span>
                        <div class="modal-player-meta">
                          <span class="modal-position-badge" :style="{ backgroundColor: getPositionColor(asset.position) }">
                            {{ asset.position }}
                          </span>
                          <span class="modal-player-age">{{ asset.age }} yrs</span>
                        </div>
                        <div class="modal-player-contract">
                          <span class="modal-contract-salary">{{ formatSalary(asset.contractSalary) }}</span>
                          <span class="modal-contract-years">{{ formatContractYears(asset.contractYearsRemaining) }}</span>
                        </div>
                        <div class="modal-star-rating">
                          <Star v-for="s in getAssetStars(asset)" :key="s" :size="12" class="star filled" />
                          <Star v-for="s in (5 - getAssetStars(asset))" :key="`e-${s}`" :size="12" class="star empty" />
                        </div>
                      </div>
                    </div>
                  </template>
                  <!-- Pick Card -->
                  <template v-else>
                    <div class="modal-pick-card">
                      <div class="modal-pick-year">{{ asset.year }}</div>
                      <div class="modal-pick-info">
                        <span class="modal-pick-round">Round {{ asset.round }}</span>
                        <span v-if="asset.originalTeamAbbreviation" class="modal-pick-team">({{ asset.originalTeamAbbreviation }})</span>
                        <div class="modal-star-rating">
                          <Star v-for="s in getAssetStars(asset)" :key="s" :size="12" class="star filled" />
                          <Star v-for="s in (5 - getAssetStars(asset))" :key="`e-${s}`" :size="12" class="star empty" />
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Salary Summary -->
          <div v-if="tradeValidation.salaryOut > 0 || tradeValidation.salaryIn > 0" class="modal-salary-summary">
            <div class="modal-salary-row">
              <span class="modal-salary-label">Outgoing Salary:</span>
              <span class="modal-salary-value out">{{ formatSalary(tradeValidation.salaryOut) }}</span>
            </div>
            <div class="modal-salary-row">
              <span class="modal-salary-label">Incoming Salary:</span>
              <span class="modal-salary-value in">{{ formatSalary(tradeValidation.salaryIn) }}</span>
            </div>
            <div class="modal-salary-row net">
              <span class="modal-salary-label">Net Change:</span>
              <span class="modal-salary-value" :class="{ positive: tradeValidation.salaryDiff > 0, negative: tradeValidation.salaryDiff < 0 }">
                {{ tradeValidation.salaryDiff >= 0 ? '+' : '' }}{{ formatSalary(tradeValidation.salaryDiff) }}
              </span>
            </div>
          </div>

          <div class="modal-actions">
            <BaseButton variant="ghost" @click="closeConfirmModal">Cancel</BaseButton>
            <BaseButton variant="primary" @click="confirmAndProposeTrade">
              <Check :size="18" />
              Propose Trade
            </BaseButton>
          </div>
        </template>

        <!-- Result State -->
        <template v-else-if="confirmModalState === 'result'">
          <!-- Trade Summary in Result -->
          <div class="modal-trade-slots compact">
            <!-- YOUR TEAM SIDE -->
            <div class="modal-team-section sending compact">
              <div class="modal-team-header">
                <span class="modal-team-label">You Sent</span>
              </div>
              <div class="modal-assets-list">
                <div v-for="asset in userOffering" :key="`result-send-${asset.type}-${asset.id}`" class="modal-asset-item">
                  <template v-if="asset.type === 'player'">
                    <StatBadge :value="asset.overallRating" size="xs" />
                    <span>{{ asset.firstName }} {{ asset.lastName }}</span>
                  </template>
                  <template v-else>
                    <span class="pick-badge">{{ asset.year }}</span>
                    <span>Round {{ asset.round }} Pick</span>
                  </template>
                </div>
              </div>
            </div>

            <div class="modal-trade-direction compact">
              <Repeat :size="20" />
            </div>

            <!-- PARTNER TEAM SIDE -->
            <div class="modal-team-section receiving compact">
              <div class="modal-team-header">
                <span class="modal-team-badge sm">{{ selectedTeam?.abbreviation }}</span>
                <span class="modal-team-label">Sent</span>
              </div>
              <div class="modal-assets-list">
                <div v-for="asset in userRequesting" :key="`result-recv-${asset.type}-${asset.id}`" class="modal-asset-item">
                  <template v-if="asset.type === 'player'">
                    <StatBadge :value="asset.overallRating" size="xs" />
                    <span>{{ asset.firstName }} {{ asset.lastName }}</span>
                  </template>
                  <template v-else>
                    <span class="pick-badge">{{ asset.year }}</span>
                    <span>Round {{ asset.round }} Pick</span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Accept Result -->
          <div v-if="lastProposalResult?.decision === 'accept'" class="result-success">
            <CheckCircle :size="56" class="success-icon" />
            <h3>The {{ selectedTeam?.name }} have accepted your trade!</h3>
            <p class="text-secondary">Would you like to complete this trade?</p>
            <div class="modal-actions">
              <BaseButton variant="ghost" @click="closeConfirmModal">Cancel</BaseButton>
              <BaseButton variant="primary" @click="executeTrade">
                <Check :size="18" />
                Complete Trade
              </BaseButton>
            </div>
          </div>

          <!-- Reject Result -->
          <div v-else-if="lastProposalResult?.decision === 'reject'" class="result-reject">
            <AlertCircle :size="56" class="reject-icon" />
            <h3>Trade Rejected</h3>
            <p class="reject-reason">"{{ lastProposalResult.reason }}"</p>
            <p class="team-info text-secondary">
              The {{ selectedTeam?.name }} are currently
              <strong :style="{ color: tradeStore.getDirectionColor(lastProposalResult.team_direction) }">
                {{ tradeStore.getDirectionLabel(lastProposalResult.team_direction) }}
              </strong>
            </p>
            <div class="modal-actions centered">
              <BaseButton variant="primary" @click="closeConfirmModal">
                Try Another Trade
              </BaseButton>
            </div>
          </div>

          <!-- Invalid Result -->
          <div v-else-if="lastProposalResult?.decision === 'invalid'" class="result-invalid">
            <AlertTriangle :size="56" class="invalid-icon" />
            <h3>Invalid Trade</h3>
            <p class="invalid-reason">{{ lastProposalResult.reason }}</p>
            <div class="modal-actions centered">
              <BaseButton variant="primary" @click="closeConfirmModal">
                Start Over
              </BaseButton>
            </div>
          </div>
        </template>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.trade-center {
  width: 100%;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
}

/* Step Indicator */
.step-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding: 0 1rem;
}

.step {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  opacity: 0.6;
  transition: all 0.2s ease;
  position: relative;
}

.step.active {
  opacity: 1;
  border-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb), 0.1);
}

.step.completed {
  opacity: 1;
  border-color: var(--color-success);
}

.step.clickable {
  cursor: pointer;
}

.step.clickable:hover {
  background: rgba(var(--color-success-rgb), 0.15);
  border-color: var(--color-success);
  transform: translateY(-1px);
}

.step.clickable:hover .back-hint {
  opacity: 1;
  transform: translateX(0);
}

.back-hint {
  color: var(--color-success);
  opacity: 0;
  transform: translateX(4px);
  transition: all 0.2s ease;
  margin-left: 0.25rem;
}

.step-connector {
  display: flex;
  align-items: center;
  color: var(--color-text-tertiary);
  transition: color 0.2s ease;
}

.step-connector.completed {
  color: var(--color-success);
}

.step-number {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-elevated);
  border-radius: 50%;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.step.active .step-number {
  background: var(--color-primary);
  color: white;
}

.step.completed .step-number {
  background: var(--color-success);
  color: white;
}

.step-info {
  display: flex;
  flex-direction: column;
}

.step-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.step-description {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* ==================== PROMINENT TRADE SUMMARY ==================== */
.trade-summary-prominent {
  background: linear-gradient(135deg, rgba(30, 35, 50, 0.95), rgba(20, 25, 40, 0.98));
  border: 2px solid rgba(99, 102, 241, 0.3);
  border-radius: 16px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.trade-summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.trade-summary-header h3 {
  font-size: 1rem;
  font-weight: 700;
  color: #F3F4F6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.salary-balance {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  font-weight: 500;
}

.salary-out {
  color: #FCA5A5;
}

.salary-divider {
  color: rgba(255, 255, 255, 0.3);
}

.salary-in {
  color: #86EFAC;
}

.trade-slots-container {
  display: flex;
  align-items: stretch;
  gap: 1rem;
}

.trade-slot-section {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 1rem;
  transition: all 0.3s ease;
}

.trade-slot-section.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
}

.trade-slot-section.sending {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.02));
}

.trade-slot-section.receiving {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(34, 197, 94, 0.02));
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.slot-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
}

.slot-edit-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.2s ease;
}

.slot-edit-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.slots-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.asset-slot {
  min-width: 140px;
  flex: 1;
}

.asset-slot.empty {
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: rgba(255, 255, 255, 0.25);
  font-size: 0.7rem;
}

.asset-slot.filled {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  overflow: hidden;
}

.asset-slot.filled.player {
  border-color: rgba(99, 102, 241, 0.4);
}

.asset-slot.filled.pick {
  border-color: rgba(139, 92, 246, 0.4);
}

/* Slot Player Card */
.slot-player-card {
  position: relative;
  padding: 0.6rem;
  display: flex;
  gap: 0.5rem;
}

.slot-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.8);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 2;
}

.asset-slot:hover .slot-remove {
  opacity: 1;
}

.player-avatar-slot {
  width: 36px;
  height: 36px;
  background: rgba(99, 102, 241, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
}

.player-slot-info {
  flex: 1;
  min-width: 0;
}

.player-slot-name {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #F3F4F6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.player-slot-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 3px;
}

.position-badge-sm {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  color: white;
}

.player-slot-contract {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
}

.contract-salary {
  color: #86EFAC;
}

.contract-years {
  color: rgba(255, 255, 255, 0.4);
}

/* Slot Pick Card */
.slot-pick-card {
  position: relative;
  padding: 0.6rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pick-year-slot {
  width: 40px;
  height: 36px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.pick-slot-info {
  flex: 1;
}

.pick-slot-round {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #F3F4F6;
}

.pick-slot-team {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.5);
}

/* Star Rating */
.star-rating {
  display: flex;
  align-items: center;
  gap: 1px;
}

.star.filled {
  color: #FBBF24;
  fill: #FBBF24;
}

.star.empty {
  color: rgba(255, 255, 255, 0.15);
}

/* Trade Direction */
.trade-direction {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 0.5rem;
  gap: 0.5rem;
}

.trade-arrow-container {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.3));
  border: 2px solid rgba(99, 102, 241, 0.4);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.partner-badge {
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
}

/* Pop-in Animation */
.asset-pop-enter-active {
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.asset-pop-leave-active {
  animation: popOut 0.2s ease-out;
}

@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes popOut {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.5);
  }
}

/* Step Content */
.step-content {
  margin-bottom: 1.5rem;
}

.step-header {
  margin-bottom: 1.25rem;
}

.step-header h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

/* Step Prompt (for modal-based selection) */
.step-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  background: linear-gradient(135deg, rgba(30, 35, 50, 0.9), rgba(20, 25, 40, 0.95));
  border: 2px dashed rgba(99, 102, 241, 0.3);
  border-radius: 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.step-prompt:hover {
  border-color: var(--color-primary);
  background: linear-gradient(135deg, rgba(40, 45, 60, 0.95), rgba(30, 35, 50, 0.98));
  transform: translateY(-2px);
}

.step-prompt-icon {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 50%;
  color: var(--color-primary);
  margin-bottom: 1.5rem;
}

.step-prompt-icon.receiving {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15));
  color: #10B981;
}

.step-prompt h3 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.step-prompt p {
  font-size: 0.95rem;
  color: var(--color-text-secondary);
  max-width: 400px;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

/* Asset Tabs */
.asset-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.asset-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.asset-tab:hover {
  background: var(--color-surface-hover);
}

.asset-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Assets Grid */
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
  max-height: 450px;
  overflow-y: auto;
}

.picks-grid {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

/* Player Asset Card */
.player-asset-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
}

.player-asset-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.player-asset-card.selected {
  background: rgba(59, 130, 246, 0.15);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.player-card-content {
  display: flex;
  align-items: stretch;
  padding: 0.875rem;
  gap: 0.75rem;
}

.player-card-avatar {
  width: 52px;
  height: 52px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.2));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
  align-self: flex-start;
}

.player-card-main {
  flex: 1;
  min-width: 0;
}

.player-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.player-card-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-card-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.position-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  color: white;
}

.player-age {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.player-card-contract {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.35rem;
}

.player-card-contract svg {
  color: #86EFAC;
}

.contract-term {
  color: rgba(255, 255, 255, 0.4);
}

.player-card-value {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.value-label {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
}

.player-card-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  color: var(--color-primary);
}

/* Pick Asset Card */
.pick-asset-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pick-asset-card:hover {
  border-color: #8B5CF6;
  transform: translateY(-2px);
}

.pick-asset-card.selected {
  background: rgba(139, 92, 246, 0.15);
  border-color: #8B5CF6;
}

.pick-card-content {
  display: flex;
  align-items: center;
  padding: 0.875rem;
  gap: 0.75rem;
}

.pick-card-year {
  width: 52px;
  height: 44px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.pick-card-main {
  flex: 1;
}

.pick-card-round {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.25rem;
}

.pick-card-team {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  margin-left: 0.25rem;
}

.pick-projection {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.25rem;
}

.pick-card-value {
  margin-top: 0.25rem;
}

.pick-card-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  color: #8B5CF6;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 2rem;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

/* Teams Grid */
.teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  max-height: 500px;
  overflow-y: auto;
}

.team-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.team-card:hover {
  border-color: var(--color-primary);
  background: rgba(40, 45, 55, 0.95);
}

.team-card.selected {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.2);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.team-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.team-abbr {
  font-size: 1.5rem;
  font-weight: 700;
  color: #F3F4F6;
}

.team-check {
  color: var(--color-primary);
}

.team-city {
  font-size: 0.75rem;
  color: #9CA3AF;
  display: block;
  margin-bottom: 0.5rem;
}

.team-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.team-record {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E5E7EB;
}

.team-direction {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
}

/* Selected Team Details */
.selected-team-details {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem;
}

.selected-team-details h4 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.team-stats {
  display: flex;
  gap: 2rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.stat-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Step Navigation */
.step-navigation {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.nav-right {
  display: flex;
  gap: 0.75rem;
}

/* Trade Validation Panel */
.trade-validation {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  border-radius: 10px;
  border: 2px solid;
}

.trade-validation.valid {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.4);
}

.trade-validation.invalid {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
}

.validation-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.validation-icon.valid {
  color: #10B981;
}

.validation-icon.invalid {
  color: #EF4444;
}

.validation-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.validation-issues,
.validation-warnings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.validation-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}

.validation-item.error {
  background: rgba(239, 68, 68, 0.15);
  color: #FCA5A5;
}

.validation-item.error svg {
  color: #EF4444;
  flex-shrink: 0;
  margin-top: 2px;
}

.validation-item.warning {
  background: rgba(245, 158, 11, 0.15);
  color: #FCD34D;
}

.validation-item.warning svg {
  color: #F59E0B;
  flex-shrink: 0;
  margin-top: 2px;
}

.validation-salary {
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.salary-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
}

.salary-row.diff {
  margin-top: 0.25rem;
  padding-top: 0.375rem;
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
  font-weight: 600;
}

.salary-label {
  color: var(--color-text-secondary);
}

.salary-value {
  font-weight: 500;
  color: var(--color-text-primary);
}

.salary-value.out {
  color: #FCA5A5;
}

.salary-value.in {
  color: #86EFAC;
}

.salary-value.positive {
  color: #EF4444;
}

.salary-value.negative {
  color: #10B981;
}

/* ==================== TRADE MODAL ==================== */
.trade-modal-content {
  padding: 0.5rem;
}

.modal-subtitle {
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

/* Modal Loading State */
.modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  gap: 1.5rem;
}

.modal-loading p {
  color: var(--color-text-secondary);
  font-size: 1rem;
}

/* Modal Trade Slots Layout */
.modal-trade-slots {
  display: flex;
  align-items: stretch;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.modal-trade-slots.compact {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.modal-team-section {
  flex: 1;
  background: rgba(0, 0, 0, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1rem;
}

.modal-team-section.sending {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.03));
  border-color: rgba(239, 68, 68, 0.25);
}

.modal-team-section.receiving {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(34, 197, 94, 0.03));
  border-color: rgba(34, 197, 94, 0.25);
}

.modal-team-section.compact {
  padding: 0.75rem;
  background: transparent;
  border: none;
}

.modal-team-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-team-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
}

.modal-team-section.sending .modal-team-label {
  color: #FCA5A5;
}

.modal-team-section.receiving .modal-team-label {
  color: #86EFAC;
}

.modal-team-badge {
  padding: 0.25rem 0.5rem;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(139, 92, 246, 0.3));
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
}

.modal-team-badge.sm {
  padding: 0.15rem 0.35rem;
  font-size: 0.65rem;
}

/* Modal Assets Grid */
.modal-assets-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.modal-asset-card {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  overflow: hidden;
}

.modal-asset-card.player {
  border-color: rgba(99, 102, 241, 0.35);
}

.modal-asset-card.pick {
  border-color: rgba(139, 92, 246, 0.35);
}

/* Modal Player Card */
.modal-player-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
}

.modal-player-avatar {
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.2));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.modal-player-info {
  flex: 1;
  min-width: 0;
}

.modal-player-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.25rem;
}

.modal-player-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.modal-position-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 3px;
  color: white;
}

.modal-player-age {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.modal-player-contract {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.modal-contract-salary {
  color: #86EFAC;
}

.modal-contract-years {
  color: rgba(255, 255, 255, 0.4);
}

.modal-star-rating {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Modal Pick Card */
.modal-pick-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
}

.modal-pick-year {
  width: 44px;
  height: 40px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.modal-pick-info {
  flex: 1;
}

.modal-pick-round {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.15rem;
}

.modal-pick-team {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  margin-left: 0.25rem;
}

/* Modal Trade Direction */
.modal-trade-direction {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.5rem;
}

.modal-trade-direction.compact {
  padding: 0 0.25rem;
  color: var(--color-text-tertiary);
}

.modal-arrow-container {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.3));
  border: 2px solid rgba(99, 102, 241, 0.4);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

/* Modal Assets List (compact) */
.modal-assets-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.modal-asset-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.pick-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem 0.4rem;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
}

/* Modal Salary Summary */
.modal-salary-summary {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.modal-salary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0;
  font-size: 0.875rem;
}

.modal-salary-row.net {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--color-border);
  font-weight: 600;
}

.modal-salary-label {
  color: var(--color-text-secondary);
}

.modal-salary-value {
  font-weight: 500;
  color: var(--color-text-primary);
}

.modal-salary-value.out {
  color: #FCA5A5;
}

.modal-salary-value.in {
  color: #86EFAC;
}

.modal-salary-value.positive {
  color: #EF4444;
}

.modal-salary-value.negative {
  color: #10B981;
}

/* Modal Actions */
.modal-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.modal-actions.centered {
  justify-content: center;
}

/* Result States */
.result-success,
.result-reject,
.result-invalid {
  text-align: center;
  padding-top: 1rem;
}

.success-icon {
  color: var(--color-success);
  margin-bottom: 1rem;
}

.reject-icon {
  color: var(--color-error);
  margin-bottom: 1rem;
}

.invalid-icon {
  color: #F59E0B;
  margin-bottom: 1rem;
}

.result-success h3,
.result-reject h3,
.result-invalid h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.reject-reason,
.invalid-reason {
  font-size: 1rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  font-style: italic;
}

.team-info {
  margin-bottom: 0.5rem;
}

/* ==================== ASSET SELECTION MODAL ==================== */
.asset-selection-modal {
  padding: 0.5rem;
}

.asset-modal-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.asset-modal-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.asset-modal-tab:hover {
  background: var(--color-surface-hover);
}

.asset-modal-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.asset-modal-selected {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}

.selected-count {
  font-size: 0.8rem;
  color: var(--color-primary);
  font-weight: 600;
}

.asset-modal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
  max-height: 400px;
  overflow-y: auto;
  padding: 0.25rem;
}

.asset-modal-grid.picks {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.asset-modal-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.asset-modal-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.asset-modal-card.selected {
  background: rgba(59, 130, 246, 0.15);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.asset-modal-card.pick:hover {
  border-color: #8B5CF6;
}

.asset-modal-card.pick.selected {
  background: rgba(139, 92, 246, 0.15);
  border-color: #8B5CF6;
}

.asset-modal-card-content {
  display: flex;
  align-items: center;
  padding: 0.875rem;
  gap: 0.75rem;
}

.asset-modal-avatar {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.2));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.asset-modal-pick-year {
  width: 48px;
  height: 42px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.asset-modal-info {
  flex: 1;
  min-width: 0;
}

.asset-modal-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.25rem;
}

.asset-modal-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.asset-modal-position {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  color: white;
}

.asset-modal-age {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.asset-modal-contract {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.asset-modal-salary {
  color: #86EFAC;
}

.asset-modal-years {
  color: rgba(255, 255, 255, 0.4);
}

.asset-modal-pick-team {
  display: block;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.15rem;
}

.asset-modal-projection {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
}

.asset-modal-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  color: var(--color-primary);
}

.asset-modal-card.pick .asset-modal-check {
  color: #8B5CF6;
}

.asset-modal-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 2rem;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.asset-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

/* Clickable slot section */
.trade-slot-section.clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.trade-slot-section.clickable:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
}

.trade-slot-section.clickable .slot-placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.trade-slot-section.clickable:hover .slot-placeholder {
  color: rgba(255, 255, 255, 0.6);
}

/* Responsive */
@media (max-width: 900px) {
  .trade-slots-container {
    flex-direction: column;
  }

  .trade-direction {
    flex-direction: row;
    padding: 0.5rem 0;
  }

  .trade-arrow-container {
    transform: rotate(90deg);
  }
}

@media (max-width: 768px) {
  .step-indicator {
    flex-direction: column;
    gap: 0.5rem;
  }

  .step {
    width: 100%;
  }

  .step-connector {
    transform: rotate(90deg);
  }

  .back-hint {
    display: none;
  }

  .assets-grid {
    grid-template-columns: 1fr;
  }

  .teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  .modal-trade-slots {
    flex-direction: column;
  }

  .modal-trade-slots.compact {
    flex-direction: column;
  }

  .modal-trade-direction {
    padding: 0.5rem 0;
  }

  .modal-arrow-container {
    transform: rotate(90deg);
  }

  .modal-trade-direction.compact {
    padding: 0.25rem 0;
  }

  .trade-arrows {
    flex-direction: row;
    padding: 0.5rem 0;
  }

  .slots-grid {
    flex-direction: column;
  }

  .asset-slot {
    min-width: 100%;
  }

  .asset-modal-grid {
    grid-template-columns: 1fr;
    max-height: 350px;
  }

  .asset-modal-actions {
    flex-direction: column-reverse;
    gap: 0.5rem;
  }

  .asset-modal-actions button {
    width: 100%;
  }
}

/* ==================== TRADE INTRO PAGE ==================== */
.trade-intro {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem 0;
}

.intro-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem 1.5rem;
}

.intro-icon {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 50%;
  color: var(--color-primary);
  margin-bottom: 1.5rem;
}

.intro-content h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.intro-description {
  font-size: 1rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: 2rem;
  max-width: 450px;
}

.intro-steps {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 400px;
  margin-bottom: 2rem;
}

.intro-step {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  text-align: left;
}

.intro-step-number {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary), #8B5CF6);
  border-radius: 50%;
  font-size: 1rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.intro-step-info {
  flex: 1;
}

.intro-step-title {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.15rem;
}

.intro-step-desc {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

/* ==================== TRADE WIZARD MODAL ==================== */
.wizard-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.wizard-modal-container {
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.wizard-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.wizard-modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.wizard-btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.wizard-btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.wizard-modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.wizard-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.wizard-btn-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.wizard-btn-back:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.wizard-btn-next {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.wizard-btn-next:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.wizard-btn-next:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal transition */
.modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .wizard-modal-container {
  animation: wizardScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .wizard-modal-container {
  animation: wizardScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes wizardScaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes wizardScaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

.wizard-content {
  padding: 0;
}

/* Wizard Step Indicator */
.wizard-step-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.wizard-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  opacity: 0.5;
  transition: all 0.2s ease;
}

.wizard-step.active {
  opacity: 1;
  background: rgba(var(--color-primary-rgb), 0.1);
}

.wizard-step.completed {
  opacity: 1;
}

.wizard-step-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-elevated);
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.wizard-step.active .wizard-step-number {
  background: var(--color-primary);
  color: white;
}

.wizard-step.completed .wizard-step-number {
  background: var(--color-success);
  color: white;
}

.wizard-step-title {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.wizard-step.active .wizard-step-title {
  color: var(--color-text-primary);
  font-weight: 600;
}

.wizard-step-connector {
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
}

.wizard-step-connector.completed {
  color: var(--color-success);
}

/* Wizard Step Content */
.wizard-step-content {
  min-height: 400px;
  max-height: 500px;
  overflow-y: auto;
}

.wizard-step-description {
  text-align: center;
  color: var(--color-text-secondary);
  margin-bottom: 1.25rem;
}

/* Wizard Asset Tabs */
.wizard-asset-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.wizard-asset-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.wizard-asset-tab:hover {
  background: var(--color-surface-hover);
}

.wizard-asset-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Wizard Selected Summary */
.wizard-selected-summary {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(var(--color-primary-rgb), 0.1);
  border: 1px solid rgba(var(--color-primary-rgb), 0.2);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.wizard-selected-summary.receiving {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.2);
}

.selected-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  padding-top: 0.15rem;
}

.selected-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.selected-chip {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--color-text-primary);
}

.chip-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: rgba(239, 68, 68, 0.2);
  border: none;
  border-radius: 50%;
  color: #EF4444;
  cursor: pointer;
  transition: all 0.2s ease;
}

.chip-remove:hover {
  background: rgba(239, 68, 68, 0.4);
}

/* Wizard Asset Grid */
.wizard-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
  padding: 0.25rem;
}

.wizard-asset-grid.picks {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.wizard-asset-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.wizard-asset-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.wizard-asset-card.selected {
  background: rgba(59, 130, 246, 0.15);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.wizard-asset-card.pick:hover {
  border-color: #8B5CF6;
}

.wizard-asset-card.pick.selected {
  background: rgba(139, 92, 246, 0.15);
  border-color: #8B5CF6;
}

.wizard-asset-card-content {
  display: flex;
  align-items: center;
  padding: 0.875rem;
  gap: 0.75rem;
}

.wizard-asset-avatar {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.2));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.wizard-asset-pick-year {
  width: 48px;
  height: 42px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.wizard-asset-info {
  flex: 1;
  min-width: 0;
}

.wizard-asset-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.25rem;
}

.wizard-asset-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.wizard-asset-position {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  color: white;
}

.wizard-asset-age {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.wizard-asset-contract {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.wizard-asset-salary {
  color: #86EFAC;
}

.wizard-asset-years {
  color: rgba(255, 255, 255, 0.4);
}

.wizard-asset-pick-team {
  display: block;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.15rem;
}

.wizard-asset-projection {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
}

.wizard-asset-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  color: var(--color-primary);
}

.wizard-asset-card.pick .wizard-asset-check {
  color: #8B5CF6;
}

.wizard-asset-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 2rem;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

/* Wizard Teams Grid */
.wizard-teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.wizard-team-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.wizard-team-card:hover {
  border-color: var(--color-primary);
  background: rgba(40, 45, 55, 0.95);
}

.wizard-team-card.selected {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.2);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.wizard-team-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.wizard-team-abbr {
  font-size: 1.5rem;
  font-weight: 700;
  color: #F3F4F6;
}

.wizard-team-check {
  color: var(--color-primary);
}

.wizard-team-city {
  font-size: 0.75rem;
  color: #9CA3AF;
  display: block;
  margin-bottom: 0.5rem;
}

.wizard-team-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.wizard-team-record {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E5E7EB;
}

.wizard-team-direction {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
}

/* Wizard Selected Team Details */
.wizard-selected-team-details {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem;
}

.wizard-selected-team-details h4 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.wizard-team-stats {
  display: flex;
  gap: 2rem;
}

.wizard-stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.wizard-stat-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.wizard-stat-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Wizard Trade Validation */
.wizard-trade-validation {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  border: 2px solid;
}

.wizard-trade-validation.valid {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.4);
}

.wizard-trade-validation.invalid {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
}

.wizard-nav-right {
  display: flex;
  gap: 0.75rem;
}

/* Wizard Responsive */
@media (max-width: 768px) {
  .wizard-modal-container {
    max-width: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .wizard-modal-overlay {
    padding: 0;
  }

  .wizard-step-indicator {
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .wizard-step-title {
    display: none;
  }

  .wizard-asset-grid {
    grid-template-columns: 1fr;
  }

  .wizard-teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  .wizard-team-stats {
    flex-wrap: wrap;
    gap: 1rem;
  }
}

/* Light Mode Overrides */
[data-theme="light"] .wizard-modal-container {
  background: var(--color-bg-primary);
}

[data-theme="light"] .wizard-modal-header {
  border-bottom-color: var(--glass-border);
}

[data-theme="light"] .wizard-modal-footer {
  border-top-color: var(--glass-border);
}

[data-theme="light"] .wizard-btn-back {
  border-color: var(--glass-border);
}

[data-theme="light"] .wizard-btn-back:hover {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .wizard-asset-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .wizard-asset-card.selected {
  background: rgba(59, 130, 246, 0.1);
}

[data-theme="light"] .wizard-asset-card.pick.selected {
  background: rgba(139, 92, 246, 0.1);
}

[data-theme="light"] .wizard-asset-avatar {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
  color: rgba(0, 0, 0, 0.7);
}

[data-theme="light"] .wizard-asset-name {
  color: #1F2937;
}

[data-theme="light"] .wizard-asset-age {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .wizard-asset-salary {
  color: #059669;
}

[data-theme="light"] .wizard-asset-years {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .wizard-asset-pick-team {
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .wizard-asset-projection {
  color: rgba(0, 0, 0, 0.5);
}

/* Team Card Light Mode */
[data-theme="light"] .wizard-team-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .wizard-team-card:hover {
  background: rgba(245, 247, 250, 0.95);
}

[data-theme="light"] .wizard-team-card.selected {
  background: rgba(59, 130, 246, 0.1);
}

[data-theme="light"] .wizard-team-abbr {
  color: #1F2937;
}

[data-theme="light"] .wizard-team-city {
  color: #6B7280;
}

[data-theme="light"] .wizard-team-record {
  color: #374151;
}

/* Validation Light Mode */
[data-theme="light"] .validation-item.error {
  background: rgba(239, 68, 68, 0.1);
  color: #991B1B;
}

[data-theme="light"] .validation-item.warning {
  background: rgba(245, 158, 11, 0.1);
  color: #92400E;
}

[data-theme="light"] .validation-salary {
  border-top-color: rgba(0, 0, 0, 0.1);
}

/* Trade Summary/Confirmation Modal Light Mode */
[data-theme="light"] .trade-summary-prominent {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(245, 247, 250, 0.98));
  border-color: rgba(99, 102, 241, 0.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .trade-summary-header {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .trade-summary-header h3 {
  color: #1F2937;
}

[data-theme="light"] .salary-out {
  color: #DC2626;
}

[data-theme="light"] .salary-divider {
  color: rgba(0, 0, 0, 0.3);
}

[data-theme="light"] .salary-in {
  color: #059669;
}

[data-theme="light"] .trade-slot-section {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .slot-label {
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .slot-edit-btn {
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .slot-edit-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1F2937;
}

[data-theme="light"] .asset-slot.empty {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .slot-placeholder {
  color: rgba(0, 0, 0, 0.3);
}

[data-theme="light"] .asset-slot.filled {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .player-avatar-slot {
  background: rgba(99, 102, 241, 0.15);
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .player-slot-name {
  color: #1F2937;
}

[data-theme="light"] .player-slot-contract {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .contract-salary {
  color: #059669;
}

[data-theme="light"] .contract-years {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .pick-slot-round {
  color: #1F2937;
}

[data-theme="light"] .pick-slot-team {
  color: rgba(0, 0, 0, 0.5);
}

/* Modal Elements Light Mode */
[data-theme="light"] .modal-team-section {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .modal-team-header {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .modal-team-label {
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .modal-team-section.sending .modal-team-label {
  color: #DC2626;
}

[data-theme="light"] .modal-team-section.receiving .modal-team-label {
  color: #059669;
}

[data-theme="light"] .modal-asset-card {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .modal-player-avatar {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .modal-player-name {
  color: #1F2937;
}

[data-theme="light"] .modal-player-age {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .modal-contract-salary {
  color: #059669;
}

[data-theme="light"] .modal-contract-years {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .modal-pick-round {
  color: #1F2937;
}

[data-theme="light"] .modal-pick-team {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .modal-arrow-container {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  border-color: rgba(99, 102, 241, 0.3);
  color: #6366F1;
}

/* Asset Selection Cards Light Mode */
[data-theme="light"] .player-asset-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .player-asset-card.selected {
  background: rgba(59, 130, 246, 0.1);
}

[data-theme="light"] .player-card-avatar {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .player-card-name {
  color: #1F2937;
}

[data-theme="light"] .player-age {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .player-card-contract {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .player-card-contract svg {
  color: #059669;
}

[data-theme="light"] .contract-term {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .value-label {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .pick-asset-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .pick-asset-card.selected {
  background: rgba(139, 92, 246, 0.1);
}

[data-theme="light"] .pick-card-round {
  color: #1F2937;
}

[data-theme="light"] .pick-card-team {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .pick-projection {
  color: rgba(0, 0, 0, 0.5);
}

/* Non-Wizard Team Cards Light Mode */
[data-theme="light"] .team-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .team-card:hover {
  background: rgba(245, 247, 250, 0.95);
}

[data-theme="light"] .team-card.selected {
  background: rgba(59, 130, 246, 0.1);
}

[data-theme="light"] .team-abbr {
  color: #1F2937;
}

[data-theme="light"] .team-city {
  color: #6B7280;
}

[data-theme="light"] .team-record {
  color: #374151;
}

/* Asset Modal Cards Light Mode */
[data-theme="light"] .asset-modal-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .asset-modal-card.selected {
  background: rgba(59, 130, 246, 0.1);
}

[data-theme="light"] .asset-modal-card.pick.selected {
  background: rgba(139, 92, 246, 0.1);
}

[data-theme="light"] .asset-modal-avatar {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] .asset-modal-name {
  color: #1F2937;
}

[data-theme="light"] .asset-modal-age {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .asset-modal-salary {
  color: #059669;
}

[data-theme="light"] .asset-modal-years {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .asset-modal-pick-team {
  color: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .asset-modal-projection {
  color: rgba(0, 0, 0, 0.5);
}
</style>
