import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { coachingEngine } from '@/engine/simulation/CoachingEngine'
import { OFFENSIVE_SCHEMES, DEFENSIVE_SCHEMES } from '@/engine/simulation/CoachingEngine'
import { getStrategyDisplayInfo, getDefaultTargetMinutes } from '@/engine/simulation/SubstitutionEngine'
import { SUBSTITUTION_STRATEGIES } from '@/engine/config/GameConfig'
import { useSyncStore } from '@/stores/sync'
import { recalculateOverall } from '@/engine/evolution/PlayerEvolution'

/**
 * Attach season_stats (per-game averages) to each player in an array.
 * Mutates player objects in place.
 */
async function _attachSeasonStats(players, campaignId) {
  if (!players || players.length === 0) return

  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return

  const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? 2025
  const allPlayerStats = await SeasonRepository.getPlayerStats(campaignId, seasonYear)
  if (!allPlayerStats || typeof allPlayerStats !== 'object') return

  for (const player of players) {
    if (!player) continue
    const raw = allPlayerStats[player.id]
    if (raw && raw.gamesPlayed > 0) {
      const gp = raw.gamesPlayed
      player.season_stats = {
        games_played: gp,
        gamesPlayed: gp,
        ppg: Math.round((raw.points / gp) * 10) / 10,
        rpg: Math.round((raw.rebounds / gp) * 10) / 10,
        apg: Math.round((raw.assists / gp) * 10) / 10,
        spg: Math.round((raw.steals / gp) * 10) / 10,
        bpg: Math.round((raw.blocks / gp) * 10) / 10,
        mpg: Math.round((raw.minutesPlayed / gp) * 10) / 10,
        fg_pct: raw.fieldGoalsAttempted > 0
          ? Math.round((raw.fieldGoalsMade / raw.fieldGoalsAttempted) * 1000) / 10
          : 0,
        fgPct: raw.fieldGoalsAttempted > 0
          ? Math.round((raw.fieldGoalsMade / raw.fieldGoalsAttempted) * 1000) / 10
          : 0,
        three_pct: raw.threePointersAttempted > 0
          ? Math.round((raw.threePointersMade / raw.threePointersAttempted) * 1000) / 10
          : 0,
        threePct: raw.threePointersAttempted > 0
          ? Math.round((raw.threePointersMade / raw.threePointersAttempted) * 1000) / 10
          : 0,
        ft_pct: raw.freeThrowsAttempted > 0
          ? Math.round((raw.freeThrowsMade / raw.freeThrowsAttempted) * 1000) / 10
          : 0,
        ftPct: raw.freeThrowsAttempted > 0
          ? Math.round((raw.freeThrowsMade / raw.freeThrowsAttempted) * 1000) / 10
          : 0,
        // Raw totals for detail views
        points: raw.points,
        rebounds: raw.rebounds,
        assists: raw.assists,
        steals: raw.steals,
        blocks: raw.blocks,
        turnovers: raw.turnovers,
        minutesPlayed: raw.minutesPlayed,
        fgm: raw.fieldGoalsMade,
        fga: raw.fieldGoalsAttempted,
        fg3m: raw.threePointersMade,
        fg3a: raw.threePointersAttempted,
        ftm: raw.freeThrowsMade,
        fta: raw.freeThrowsAttempted,
      }
    } else {
      player.season_stats = null
    }
  }
}

export const useTeamStore = defineStore('team', () => {
  // State
  const team = ref(null)
  const roster = ref([])
  const coach = ref(null)
  const selectedPlayer = ref(null)
  const freeAgents = ref([])
  const allTeams = ref([])
  const coachingSchemes = ref({})
  const recommendedScheme = ref(null)
  const substitutionStrategies = ref({})
  const targetMinutes = ref({})
  const loading = ref(false)
  const error = ref(null)

  // Explicit lineup state - array of 5 player IDs in position order (PG, SG, SF, PF, C)
  const lineup = ref([null, null, null, null, null])

  // Cache tracking
  const _loadedCampaignId = ref(null)
  const _schemesCampaignId = ref(null)

  // Getters
  // Get full player objects for each lineup slot
  const starterPlayers = computed(() => {
    return lineup.value.map(playerId => {
      if (!playerId) return null
      return roster.value.find(p => p.id === playerId) || null
    })
  })

  // Get bench players (not in lineup)
  const benchPlayers = computed(() => {
    const lineupIds = new Set(lineup.value.filter(id => id !== null))
    return roster.value
      .filter(p => p && !lineupIds.has(p.id))
      .sort((a, b) => b.overall_rating - a.overall_rating)
  })

  // Check if lineup has all 5 positions filled
  const isLineupComplete = computed(() =>
    lineup.value.filter(id => id !== null).length === 5
  )

  // Legacy getters (based on roster order) - kept for backwards compatibility
  const starters = computed(() =>
    roster.value.filter((_, index) => index < 5)
  )

  const bench = computed(() =>
    roster.value.filter((_, index) => index >= 5)
  )

  const rosterByPosition = computed(() => {
    const positions = { PG: [], SG: [], SF: [], PF: [], C: [] }
    roster.value.forEach(player => {
      if (positions[player.position]) {
        positions[player.position].push(player)
      }
    })
    return positions
  })

  const totalSalary = computed(() =>
    roster.value.reduce((sum, player) => sum + (player.contract?.salary || 0), 0)
  )

  const capSpace = computed(() =>
    team.value ? team.value.salary_cap - totalSalary.value : 0
  )

  const averageOverall = computed(() => {
    if (roster.value.length === 0) return 0
    return Math.round(
      roster.value.reduce((sum, p) => sum + p.overall_rating, 0) / roster.value.length
    )
  })

  const totalTargetMinutes = computed(() =>
    Object.values(targetMinutes.value).reduce((sum, m) => sum + m, 0)
  )

  // Team chemistry — from team_chemistry field or computed from roster morale
  const teamChemistry = computed(() => {
    if (team.value?.team_chemistry) return team.value.team_chemistry
    if (roster.value.length === 0) return 80
    const players = roster.value.filter(p => p !== null)
    if (players.length === 0) return 80
    const total = players.reduce((sum, p) => sum + (p.morale ?? 80), 0)
    return Math.round(total / players.length)
  })

  // Chemistry modifier display string (e.g. "+1.2%" or "-0.5%")
  const chemistryModifier = computed(() => {
    const mod = (teamChemistry.value - 80) / 80 * 3
    const clamped = Math.max(-3, Math.min(3, mod))
    const sign = clamped >= 0 ? '+' : ''
    return `${sign}${clamped.toFixed(1)}%`
  })

  // Actions
  async function fetchTeam(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _loadedCampaignId.value === campaignId && team.value) {
      return { team: team.value, roster: roster.value, coach: coach.value }
    }

    loading.value = true
    error.value = null
    try {
      // Load campaign to get user team ID and lineup settings
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found for campaign')

      // Load team and roster in parallel
      const [teamData, rosterData] = await Promise.all([
        TeamRepository.get(campaignId, userTeamId),
        PlayerRepository.getByTeam(campaignId, userTeamId),
      ])

      if (!teamData) throw new Error('Team not found')

      team.value = teamData
      // Normalize player objects to ensure derived fields exist
      roster.value = (rosterData || []).map(p => {
        if (!p) return p
        if (!p.name) p.name = `${p.firstName || p.first_name || ''} ${p.lastName || p.last_name || ''}`.trim()
        if (!p.height && p.heightInches) p.height = `${Math.floor(p.heightInches / 12)}'${p.heightInches % 12}"`
        else if (!p.height && p.height_inches) p.height = `${Math.floor(p.height_inches / 12)}'${p.height_inches % 12}"`
        if (!p.weight) p.weight = p.weightLbs || p.weight_lbs || 0
        if (!p.age && p.birthDate) {
          const birth = new Date(p.birthDate)
          p.age = new Date().getFullYear() - birth.getFullYear()
        } else if (!p.age && p.birth_date) {
          const birth = new Date(p.birth_date)
          p.age = new Date().getFullYear() - birth.getFullYear()
        }
        return p
      })
      coach.value = teamData.coach || null

      // Populate lineup from campaign settings or default to first 5 roster players
      const savedLineup = campaign.settings?.lineup?.starters
      if (savedLineup && Array.isArray(savedLineup) && savedLineup.length === 5) {
        lineup.value = [...savedLineup]

        // Reorder roster so starters come first in lineup order, bench sorted by rating
        const starterSet = new Set(savedLineup.filter(id => id !== null))
        const starterObjs = savedLineup.map(id => roster.value.find(p => p && p.id === id)).filter(Boolean)
        const benchObjs = roster.value
          .filter(p => p && !starterSet.has(p.id))
          .sort((a, b) => (b.overallRating ?? b.overall_rating ?? 0) - (a.overallRating ?? a.overall_rating ?? 0))
        roster.value = [...starterObjs, ...benchObjs]
      } else if (rosterData && rosterData.length >= 5) {
        // Default: first 5 players in roster order
        lineup.value = rosterData.slice(0, 5).map(p => p.id)
      } else {
        lineup.value = [null, null, null, null, null]
      }

      // Populate target minutes
      const savedMinutes = campaign.settings?.lineup?.target_minutes
      if (savedMinutes && typeof savedMinutes === 'object') {
        targetMinutes.value = { ...savedMinutes }
      } else {
        targetMinutes.value = {}
      }

      // Attach target_minutes to each player object
      applyMinutesToRoster()

      // Attach season stats (per-game averages) to each player object
      await _attachSeasonStats(roster.value, campaignId)

      _loadedCampaignId.value = campaignId

      return { team: team.value, roster: roster.value, coach: coach.value }
    } catch (err) {
      error.value = err.message || 'Failed to fetch team'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchPlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const player = await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')
      // Attach season stats for player detail views
      await _attachSeasonStats([player], campaignId)
      selectedPlayer.value = player
      return { player }
    } catch (err) {
      error.value = err.message || 'Failed to fetch player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateLineup(campaignId, starters, rotation = []) {
    loading.value = true
    error.value = null
    try {
      // Convert reactive proxies to plain arrays for IndexedDB storage
      const plainStarters = [...starters]
      const plainRotation = [...rotation]

      // Update local state immediately for responsive UI
      if (Array.isArray(plainStarters) && plainStarters.length === 5) {
        lineup.value = [...plainStarters]
      }

      // Persist lineup to campaign settings
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const currentLineupSettings = campaign.settings?.lineup || {}
      await CampaignRepository.updateSettings(campaignId, {
        lineup: {
          ...currentLineupSettings,
          starters: plainStarters,
          rotation: plainRotation,
        },
      })
      useSyncStore().markDirty()

      // Reorder roster so starters come first in position order
      const starterSet = new Set(starters.filter(id => id !== null))
      const starterPlayers = starters
        .filter(id => id !== null)
        .map(id => roster.value.find(p => p.id === id))
        .filter(Boolean)
      const benchPlayersList = roster.value
        .filter(p => !starterSet.has(p.id))
        .sort((a, b) => (b.overall_rating ?? 0) - (a.overall_rating ?? 0))
      roster.value = [...starterPlayers, ...benchPlayersList]

      return { starters, rotation }
    } catch (err) {
      error.value = err.message || 'Failed to update lineup'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchAllTeams(campaignId) {
    loading.value = true
    error.value = null
    try {
      const teams = await TeamRepository.getAllForCampaign(campaignId)
      allTeams.value = teams || []
      return allTeams.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch teams'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTeamRoster(campaignId, teamId) {
    loading.value = true
    error.value = null
    try {
      const players = await PlayerRepository.getByTeam(campaignId, teamId)
      // Attach season stats so AI team views can display per-game averages
      await _attachSeasonStats(players, campaignId)
      return { roster: players || [] }
    } catch (err) {
      error.value = err.message || 'Failed to fetch team roster'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchFreeAgents(campaignId) {
    loading.value = true
    error.value = null
    try {
      const agents = await PlayerRepository.getFreeAgents(campaignId)
      freeAgents.value = agents || []
      return freeAgents.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch free agents'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signPlayer(campaignId, playerId, years, salary) {
    loading.value = true
    error.value = null
    try {
      // Get the player from free agents
      const player = await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      // Get user team ID
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.teamId ?? campaign?.userTeamId ?? campaign?.user_team_id
      if (!userTeamId) throw new Error('No user team found')

      // Update player: assign to team with contract
      player.teamId = userTeamId
      player.isFreeAgent = 0
      player.contractSalary = salary
      player.contract_salary = salary
      player.contractYearsRemaining = years
      player.contract_years_remaining = years
      await PlayerRepository.save(player)
      useSyncStore().markDirty()

      // Remove from free agents list
      freeAgents.value = freeAgents.value.filter(p => p.id !== playerId)

      // Add to roster
      roster.value.push(player)

      return { player }
    } catch (err) {
      error.value = err.message || 'Failed to sign player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function releasePlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      // Get the player
      const player = await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      // Update player: clear team, mark as free agent
      player.teamId = null
      player.isFreeAgent = 1
      player.contractSalary = 0
      player.contract_salary = 0
      player.contractYearsRemaining = 0
      player.contract_years_remaining = 0
      await PlayerRepository.save(player)
      useSyncStore().markDirty()

      // Remove from roster
      const rosterPlayer = roster.value.find(p => p.id === playerId)
      roster.value = roster.value.filter(p => p.id !== playerId)

      // Add to free agents
      if (rosterPlayer) {
        freeAgents.value.push({ ...rosterPlayer, contract: { years_remaining: 0, salary: 0 } })
      }
    } catch (err) {
      error.value = err.message || 'Failed to release player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchCoachingSchemes(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _schemesCampaignId.value === campaignId && Object.keys(coachingSchemes.value).length > 0) {
      return { schemes: coachingSchemes.value, recommended: recommendedScheme.value }
    }

    loading.value = true
    error.value = null
    try {
      // Build schemes from engine config -- no API call needed
      const schemes = {
        offensive: OFFENSIVE_SCHEMES,
        defensive: DEFENSIVE_SCHEMES,
      }
      coachingSchemes.value = schemes

      // Recommend a scheme based on current roster
      if (roster.value.length > 0) {
        recommendedScheme.value = coachingEngine.recommendScheme(roster.value)
      } else {
        recommendedScheme.value = 'balanced'
      }

      // Build substitution strategies from engine
      substitutionStrategies.value = SUBSTITUTION_STRATEGIES
      _schemesCampaignId.value = campaignId

      return { schemes, recommended: recommendedScheme.value, substitution_strategies: substitutionStrategies.value }
    } catch (err) {
      error.value = err.message || 'Failed to fetch coaching schemes'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateCoachingScheme(campaignId, offensiveScheme, defensiveScheme = null, substitutionStrategy = null) {
    loading.value = true
    error.value = null
    try {
      // Get current schemes if not provided
      const currentDefensive = team.value?.coaching_scheme?.defensive || 'man'
      const currentSubstitution = team.value?.coaching_scheme?.substitution || 'staggered'
      const payload = {
        offensive: offensiveScheme,
        defensive: defensiveScheme || currentDefensive,
        substitution: substitutionStrategy || currentSubstitution,
      }

      // Get user team ID from campaign
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.teamId ?? campaign?.userTeamId ?? campaign?.user_team_id
      if (!userTeamId) throw new Error('No user team found')

      // Persist to team data via TeamRepository
      await TeamRepository.updateCoachingScheme(campaignId, userTeamId, payload)

      // Update local team state
      if (team.value) {
        team.value.coaching_scheme = payload
      }

      return { coaching_scheme: payload }
    } catch (err) {
      error.value = err.message || 'Failed to update coaching scheme'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Apply current targetMinutes to each player object in roster
  function applyMinutesToRoster() {
    if (!roster.value?.length) return
    for (const player of roster.value) {
      if (!player) continue
      player.target_minutes = targetMinutes.value[player.id] ?? 0
    }
  }

  async function updateTargetMinutes(campaignId, minutes) {
    loading.value = true
    error.value = null
    try {
      // Convert reactive proxy to plain object for IndexedDB storage
      const plainMinutes = JSON.parse(JSON.stringify(minutes))

      // Persist to campaign settings
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const currentLineupSettings = campaign.settings?.lineup || {}
      await CampaignRepository.updateSettings(campaignId, {
        lineup: {
          ...currentLineupSettings,
          target_minutes: plainMinutes,
        },
      })

      targetMinutes.value = plainMinutes
      applyMinutesToRoster()

      return { target_minutes: minutes }
    } catch (err) {
      error.value = err.message || 'Failed to update target minutes'
      throw err
    } finally {
      loading.value = false
    }
  }

  function getDefaultMinutes(player, isStarter) {
    if (isStarter) return 32
    return 0
  }

  async function upgradePlayerAttribute(campaignId, playerId, category, attribute) {
    try {
      // Get the player from IndexedDB
      const player = await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      // Validate upgrade points
      const currentPoints = player.upgrade_points ?? player.upgradePoints ?? 0
      if (currentPoints <= 0) throw new Error('No upgrade points available')

      // Get current attribute value
      const currentValue = player.attributes?.[category]?.[attribute]
      if (currentValue === undefined) throw new Error('Invalid attribute')

      // Check potential cap
      const potential = player.potentialRating ?? player.potential_rating ?? 99
      if (currentValue >= potential) throw new Error('Attribute already at potential cap')

      // Apply the upgrade
      const newValue = Math.min(potential, currentValue + 1)
      player.attributes[category][attribute] = newValue

      // Deduct upgrade point
      const remainingPoints = currentPoints - 1
      player.upgrade_points = remainingPoints
      player.upgradePoints = remainingPoints

      // Recalculate overall rating
      recalculateOverall(player)

      // Save to IndexedDB
      await PlayerRepository.save(player)
      useSyncStore().markDirty()

      // Update local roster
      const idx = roster.value.findIndex(p => p.id === playerId)
      if (idx !== -1) {
        roster.value[idx].attributes[category][attribute] = newValue
        roster.value[idx].upgrade_points = remainingPoints
        roster.value[idx].upgradePoints = remainingPoints
        roster.value[idx].overall_rating = player.overall_rating
        roster.value[idx].overallRating = player.overallRating
      }

      return {
        new_value: newValue,
        remaining_points: remainingPoints,
        new_overall: player.overall_rating ?? player.overallRating,
      }
    } catch (err) {
      throw err
    }
  }

  function clearSelectedPlayer() {
    selectedPlayer.value = null
  }

  function clearTeam() {
    team.value = null
    roster.value = []
    coach.value = null
    lineup.value = [null, null, null, null, null]
    coachingSchemes.value = {}
    recommendedScheme.value = null
    substitutionStrategies.value = {}
    targetMinutes.value = {}
    _loadedCampaignId.value = null
    _schemesCampaignId.value = null
  }

  function invalidate() {
    _loadedCampaignId.value = null
    _schemesCampaignId.value = null
  }

  // Utility functions
  function getPositionColor(position) {
    const colors = {
      PG: '#3B82F6', // Blue
      SG: '#10B981', // Green
      SF: '#F59E0B', // Amber
      PF: '#EF4444', // Red
      C: '#8B5CF6', // Purple
    }
    return colors[position] || '#6B7280'
  }

  function getRatingColor(rating) {
    if (rating >= 90) return 'var(--color-success)'
    if (rating >= 80) return 'var(--color-tertiary)'
    if (rating >= 70) return 'var(--color-primary)'
    if (rating >= 60) return 'var(--color-warning)'
    return 'var(--color-error)'
  }

  function formatSalary(salary) {
    if (salary >= 1000000) {
      return `$${(salary / 1000000).toFixed(1)}M`
    }
    return `$${(salary / 1000).toFixed(0)}K`
  }

  return {
    // State
    team,
    roster,
    coach,
    lineup,
    selectedPlayer,
    freeAgents,
    allTeams,
    coachingSchemes,
    recommendedScheme,
    substitutionStrategies,
    targetMinutes,
    loading,
    error,
    // Getters
    starters,
    bench,
    starterPlayers,
    benchPlayers,
    isLineupComplete,
    rosterByPosition,
    totalSalary,
    capSpace,
    averageOverall,
    totalTargetMinutes,
    teamChemistry,
    chemistryModifier,
    // Actions
    fetchTeam,
    fetchPlayer,
    updateLineup,
    updateTargetMinutes,
    fetchAllTeams,
    fetchTeamRoster,
    fetchFreeAgents,
    signPlayer,
    releasePlayer,
    fetchCoachingSchemes,
    updateCoachingScheme,
    upgradePlayerAttribute,
    clearSelectedPlayer,
    clearTeam,
    invalidate,
    // Utilities
    getPositionColor,
    getRatingColor,
    formatSalary,
    getDefaultMinutes,
  }
})
