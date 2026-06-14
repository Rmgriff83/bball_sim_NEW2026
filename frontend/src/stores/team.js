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
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { recalculateOverall } from '@/engine/evolution/PlayerEvolution'
import { applyCoachChangePenalty } from '@/engine/evolution/MoraleService'
import { BADGES } from '@/engine/data/badges'
import {
  PLAYER_BADGE_COSTS,
  getBadgeStoreEntries,
  getMaxBadgeLevel,
  nextPlayerBadgeLevel,
  compareBadgeLevels,
} from '@/engine/data/playerBadgeStore'
import { getCoachActionBudget, getCoachTrainBudget, getCoachResignCost, COACH_MEETING_EXTRA_COST } from '@/engine/data/coaches'
import { selectBestCoachingScheme } from '@/engine/coaching/CoachStrategyService'
import api from '@/composables/useApi'

/**
 * Convert a raw playerStats record (cumulative totals) into the per-game
 * shape used by `player.season_stats` / `player.season_playoff_stats`.
 * Returns `null` if the player hasn't played any games in the bucket.
 */
function _buildPerGameStats(raw) {
  if (!raw || !raw.gamesPlayed || raw.gamesPlayed <= 0) return null
  const gp = raw.gamesPlayed
  const fgm = raw.fieldGoalsMade ?? raw.fgm ?? 0
  const fga = raw.fieldGoalsAttempted ?? raw.fga ?? 0
  const fg3m = raw.threePointersMade ?? raw.fg3m ?? 0
  const fg3a = raw.threePointersAttempted ?? raw.fg3a ?? 0
  const ftm = raw.freeThrowsMade ?? raw.ftm ?? 0
  const fta = raw.freeThrowsAttempted ?? raw.fta ?? 0
  const fgPctVal = fga > 0 ? Math.round((fgm / fga) * 1000) / 10 : 0
  const threePctVal = fg3a > 0 ? Math.round((fg3m / fg3a) * 1000) / 10 : 0
  const ftPctVal = fta > 0 ? Math.round((ftm / fta) * 1000) / 10 : 0
  return {
    games_played: gp,
    gamesPlayed: gp,
    ppg: Math.round((raw.points / gp) * 10) / 10,
    rpg: Math.round((raw.rebounds / gp) * 10) / 10,
    apg: Math.round((raw.assists / gp) * 10) / 10,
    spg: Math.round((raw.steals / gp) * 10) / 10,
    bpg: Math.round((raw.blocks / gp) * 10) / 10,
    mpg: Math.round((raw.minutesPlayed / gp) * 10) / 10,
    fg_pct: fgPctVal,
    fgPct: fgPctVal,
    three_pct: threePctVal,
    threePct: threePctVal,
    ft_pct: ftPctVal,
    ftPct: ftPctVal,
    // Raw totals for detail views
    points: raw.points,
    rebounds: raw.rebounds,
    assists: raw.assists,
    steals: raw.steals,
    blocks: raw.blocks,
    turnovers: raw.turnovers,
    minutesPlayed: raw.minutesPlayed,
    fgm,
    fga,
    fg3m,
    fg3a,
    ftm,
    fta,
  }
}

/**
 * Attach season_stats (per-game averages) to each player in an array.
 * Also attaches season_playoff_stats from the parallel playoff-only bucket
 * on seasonData when present — null when the player hasn't played a playoff
 * game yet. Mutates player objects in place.
 */
async function _attachSeasonStats(players, campaignId) {
  if (!players || players.length === 0) return

  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return

  const seasonYear = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? 2025
  const allPlayerStats = await SeasonRepository.getPlayerStats(campaignId, seasonYear)
  const allPlayoffStats = await SeasonRepository.getPlayoffPlayerStats(campaignId, seasonYear)
  const hasRegular = allPlayerStats && typeof allPlayerStats === 'object'
  const hasPlayoff = allPlayoffStats && typeof allPlayoffStats === 'object'
  if (!hasRegular && !hasPlayoff) return

  for (const player of players) {
    if (!player) continue
    player.season_stats = hasRegular ? _buildPerGameStats(allPlayerStats[player.id]) : null
    player.season_playoff_stats = hasPlayoff ? _buildPerGameStats(allPlayoffStats[player.id]) : null
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
  const recommendedDefensiveScheme = ref(null)
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

  // Get bench players (not in lineup). Sort by rating desc with a stable
  // id-based tiebreaker so two players with the same rating don't flip-flop
  // across re-renders/navigations.
  const benchPlayers = computed(() => {
    const lineupIds = new Set(lineup.value.filter(id => id !== null))
    return roster.value
      .filter(p => p && !lineupIds.has(p.id))
      .sort((a, b) => {
        const ar = a.overallRating ?? a.overall_rating ?? 0
        const br = b.overallRating ?? b.overall_rating ?? 0
        if (br !== ar) return br - ar
        return String(a.id).localeCompare(String(b.id))
      })
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

  // Team chemistry — from team_chemistry field or computed from roster morale.
  // The engine writes morale to `player.personality.morale`; the top-level
  // `player.morale` is a legacy fallback that's rarely populated, so checking
  // both keeps the display in sync with what the simulator and evolution code
  // are actually mutating.
  const teamChemistry = computed(() => {
    if (team.value?.team_chemistry) return team.value.team_chemistry
    if (roster.value.length === 0) return 80
    const players = roster.value.filter(p => p !== null)
    if (players.length === 0) return 80
    const total = players.reduce((sum, p) => sum + (p.personality?.morale ?? p.morale ?? 80), 0)
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
          .sort((a, b) => {
            const ar = a.overallRating ?? a.overall_rating ?? 0
            const br = b.overallRating ?? b.overall_rating ?? 0
            if (br !== ar) return br - ar
            return String(a.id).localeCompare(String(b.id))
          })
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
      // Filter out draft prospects — they belong on the scouting page, not free agency
      freeAgents.value = (agents || []).filter(p => !p.isDraftProspect && !p.rookieTier)
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

      // Update player: assign to team with contract. BOTH casings on team_id
      // and is_free_agent are required — many AI flows OR-check both keys
      // (e.g. ensureMinimumRosters), and a stale snake_case `is_free_agent: 1`
      // would let an AI roster backfill scoop this player back.
      player.teamId = userTeamId
      player.team_id = userTeamId
      player.isFreeAgent = 0
      player.is_free_agent = 0
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

      // Update player: clear team, mark as free agent. Set both casings so
      // every AI/sim path agrees on the player's status.
      player.teamId = null
      player.team_id = null
      player.isFreeAgent = 1
      player.is_free_agent = 1
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
      // Build schemes from engine config and attach a per-scheme `effectiveness`
      // value computed against the current roster. The Fit % shown on the
      // scheme cards reads this field.
      const r = roster.value
      const withEffectiveness = (configs, kind) => {
        const out = {}
        for (const [id, scheme] of Object.entries(configs)) {
          const eff = kind === 'offensive'
            ? coachingEngine.calculateSchemeEffectiveness(id, r)
            : coachingEngine.calculateDefensiveSchemeEffectiveness(id, r)
          out[id] = { ...scheme, effectiveness: Math.round(eff) }
        }
        return out
      }
      const schemes = {
        offensive: withEffectiveness(OFFENSIVE_SCHEMES, 'offensive'),
        defensive: withEffectiveness(DEFENSIVE_SCHEMES, 'defensive'),
      }
      coachingSchemes.value = schemes

      // "Best Fit" recommendation = the scheme with the highest effectiveness
      // % we just computed. Previously the offensive side called
      // `coachingEngine.recommendScheme(roster)`, which uses a decision-tree
      // heuristic (avgSpeed, avgThreePoint, etc.) and could disagree with the
      // numeric fit % shown on the card. Defensive had no recommendation at
      // all. Picking the max from the already-computed per-scheme `effectiveness`
      // values guarantees the badge always sits on the highest-fit card on
      // both tabs.
      const pickHighest = (schemeMap, fallback) => {
        let best = null
        let bestEff = -Infinity
        for (const [id, s] of Object.entries(schemeMap ?? {})) {
          if ((s.effectiveness ?? 0) > bestEff) {
            bestEff = s.effectiveness
            best = id
          }
        }
        return best ?? fallback
      }
      if (r.length > 0) {
        recommendedScheme.value = pickHighest(schemes.offensive, 'balanced')
        recommendedDefensiveScheme.value = pickHighest(schemes.defensive, 'man')
      } else {
        recommendedScheme.value = 'balanced'
        recommendedDefensiveScheme.value = 'man'
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

  async function upgradePlayerAttribute(campaignId, playerId, category, attribute, pool = 'offense') {
    try {
      // Get the player from IndexedDB
      const player = await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      // Validate upgrade points from the correct pool
      const pointsField = pool === 'defense' ? 'defense_upgrade_points' : 'offense_upgrade_points'
      const currentPoints = player[pointsField] ?? 0
      if (currentPoints < 1.0) throw new Error('Not enough upgrade points')

      // Get current attribute value
      const currentValue = player.attributes?.[category]?.[attribute]
      if (currentValue === undefined) throw new Error('Invalid attribute')

      // Check potential cap
      const potential = player.potentialRating ?? player.potential_rating ?? 99
      if (currentValue >= potential) throw new Error('Attribute already at potential cap')

      // Apply the upgrade
      const newValue = Math.min(potential, currentValue + 1)
      player.attributes[category][attribute] = newValue

      // Deduct 1.0 from the correct pool
      const remaining = Math.round((currentPoints - 1.0) * 100) / 100
      player[pointsField] = remaining
      // Sync camelCase keys
      player.offenseUpgradePoints = player.offense_upgrade_points ?? 0
      player.defenseUpgradePoints = player.defense_upgrade_points ?? 0

      // Manual upgrade bump: the formula's per-attribute sensitivity is too
      // small (~0.02 per +1 attribute) for player-purchased upgrades to feel
      // meaningful. We add a fixed bump (`MANUAL_UPGRADE_BUMP`, 0.4) to the
      // unrounded overall on every spent upgrade point so ~2-3 upgrades
      // reliably yields +1 OVR (capped by potential). Tracked via
      // `_overallExact` so partial progress survives between recalcs.
      const baseExact = typeof player._overallExact === 'number'
        ? player._overallExact
        : (player.overallRating ?? player.overall_rating ?? 70)
      player._overallExact = Math.min(potential, baseExact + MANUAL_UPGRADE_BUMP)

      // Recalculate overall rating (will preserve the bump via _overallExact)
      recalculateOverall(player)

      // Save to IndexedDB
      await PlayerRepository.save(player)
      useSyncStore().markDirty()

      // Update local roster
      const idx = roster.value.findIndex(p => p.id === playerId)
      if (idx !== -1) {
        roster.value[idx].attributes[category][attribute] = newValue
        roster.value[idx][pointsField] = remaining
        roster.value[idx].offenseUpgradePoints = player.offenseUpgradePoints
        roster.value[idx].defenseUpgradePoints = player.defenseUpgradePoints
        roster.value[idx].offense_upgrade_points = player.offense_upgrade_points
        roster.value[idx].defense_upgrade_points = player.defense_upgrade_points
        roster.value[idx].overall_rating = player.overall_rating
        roster.value[idx].overallRating = player.overallRating
      }

      return {
        new_value: newValue,
        remaining_points: remaining,
        new_overall: player.overall_rating ?? player.overallRating,
      }
    } catch (err) {
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // Upgrade-point purchase
  // ---------------------------------------------------------------------------
  // Users can buy offensive or defensive upgrade points with tokens. Each
  // pool is capped at 3 purchases per season (so 6 total per player, split
  // 3/3). Pricing is a flat 500 tokens per point. The counter resets every
  // season — `seasonUpgradePurchases.year` is checked against the campaign's
  // current season year on each purchase and zeroed if stale.

  const UPGRADE_POINT_PRICES = [500, 500, 500]
  const UPGRADE_POINT_MAX_PER_POOL = 3

  // Each spent upgrade point bumps the player's unrounded overall by this
  // amount (see `upgradePlayerAttribute`). Hoisted here so the headroom /
  // purchase-availability calc uses the SAME constant as the actual upgrade
  // application — keeps the two layers in lockstep.
  const MANUAL_UPGRADE_BUMP = 0.4

  function _getSeasonPurchases(player, currentSeasonYear) {
    const existing = player.seasonUpgradePurchases ?? player.season_upgrade_purchases ?? null
    if (existing && existing.year === currentSeasonYear) {
      return { ...existing }
    }
    return { year: currentSeasonYear, offense: 0, defense: 0 }
  }

  function _getUpgradePointPrice(purchasesSoFar) {
    return UPGRADE_POINT_PRICES[Math.min(purchasesSoFar, UPGRADE_POINT_PRICES.length - 1)]
  }

  function _getUpgradeHeadroom(player) {
    // Headroom = how many MORE upgrade points the player can absorb before
    // their unrounded overall (`_overallExact`) hits potential. Each spent
    // upgrade adds `MANUAL_UPGRADE_BUMP` (0.4) to the unrounded overall, and
    // any unspent points already in the player's pool will eventually do the
    // same — count those against the headroom too.
    const exact = typeof player._overallExact === 'number'
      ? player._overallExact
      : (player.overall_rating ?? player.overallRating ?? 0)
    const potential = player.potential_rating ?? player.potentialRating ?? 99
    const pendingPoints = (player.offense_upgrade_points ?? player.offenseUpgradePoints ?? 0)
                        + (player.defense_upgrade_points ?? player.defenseUpgradePoints ?? 0)
    const remainingOvr = Math.max(0, potential - exact - pendingPoints * MANUAL_UPGRADE_BUMP)
    return Math.floor(remainingOvr / MANUAL_UPGRADE_BUMP)
  }

  /**
   * Purchase a single offense or defense upgrade point for the given player.
   * Returns { tokens, points, purchasesThisSeason, nextPrice }.
   */
  async function purchaseUpgradePoint(campaignId, playerId, pool) {
    if (pool !== 'offense' && pool !== 'defense') {
      throw new Error('Invalid pool')
    }
    const player = await PlayerRepository.get(campaignId, playerId)
    if (!player) throw new Error('Player not found')

    const campaign = await CampaignRepository.get(campaignId)
    const currentSeasonYear = campaign?.currentSeasonYear ?? new Date().getFullYear()

    const purchases = _getSeasonPurchases(player, currentSeasonYear)
    const purchasesInPool = purchases[pool] ?? 0
    if (purchasesInPool >= UPGRADE_POINT_MAX_PER_POOL) {
      throw new Error(`${pool === 'defense' ? 'Defense' : 'Offense'} purchase cap reached for this season`)
    }

    if (_getUpgradeHeadroom(player) < 1) {
      throw new Error('No headroom — overall is already at potential')
    }

    const price = _getUpgradePointPrice(purchasesInPool)
    const authStore = useAuthStore()
    const currentTokens = authStore.profile?.tokens ?? 0
    if (currentTokens < price) {
      throw new Error('Not enough tokens')
    }

    // Deduct tokens via backend
    const response = await api.post('/api/user/tokens', { amount: -price })
    if (authStore.profile) {
      authStore.profile.tokens = response.data.tokens
    }

    // Apply the point + record the purchase
    const pointsField = pool === 'defense' ? 'defense_upgrade_points' : 'offense_upgrade_points'
    const camelField = pool === 'defense' ? 'defenseUpgradePoints' : 'offenseUpgradePoints'
    player[pointsField] = (player[pointsField] ?? 0) + 1
    player[camelField] = player[pointsField]
    purchases[pool] = purchasesInPool + 1
    player.seasonUpgradePurchases = purchases
    player.season_upgrade_purchases = purchases

    await PlayerRepository.save(player)
    useSyncStore().markDirty()

    // Mirror into local roster cache
    const idx = roster.value.findIndex(p => p.id === playerId)
    if (idx !== -1) {
      roster.value[idx][pointsField] = player[pointsField]
      roster.value[idx][camelField] = player[camelField]
      roster.value[idx].seasonUpgradePurchases = purchases
      roster.value[idx].season_upgrade_purchases = purchases
    }

    return {
      tokens: response.data.tokens,
      points: player[pointsField],
      purchasesThisSeason: purchases,
      nextPrice: purchases[pool] >= UPGRADE_POINT_MAX_PER_POOL
        ? null
        : _getUpgradePointPrice(purchases[pool]),
    }
  }

  /**
   * Compute the read-only price/availability info for a pool, used by the UI
   * to render the buy button label, disabled state, and tooltip.
   */
  function getUpgradePointPurchaseInfo(player, pool, currentSeasonYear, userTokens = 0) {
    if (!player || (pool !== 'offense' && pool !== 'defense')) return null
    const purchases = _getSeasonPurchases(player, currentSeasonYear)
    const purchasesInPool = purchases[pool] ?? 0
    const remainingInPool = Math.max(0, UPGRADE_POINT_MAX_PER_POOL - purchasesInPool)
    const headroom = _getUpgradeHeadroom(player)
    const reachedSeasonCap = purchasesInPool >= UPGRADE_POINT_MAX_PER_POOL
    const noHeadroom = headroom < 1
    const price = reachedSeasonCap ? null : _getUpgradePointPrice(purchasesInPool)
    const insufficientTokens = price != null && userTokens < price
    return {
      price,
      purchasesInPool,
      remainingInPool,
      headroom,
      reachedSeasonCap,
      noHeadroom,
      insufficientTokens,
      canPurchase: !reachedSeasonCap && !noHeadroom && !insufficientTokens,
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
    recommendedDefensiveScheme.value = null
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

  // ---------------------------------------------------------------------------
  // Player badge store
  // ---------------------------------------------------------------------------

  /**
   * Purchase or upgrade a badge for one of the user's players. Validates
   * eligibility (position + attribute fit + potential cap), debits tokens
   * via the auth API, mutates `player.badges` (level up or insert as bronze),
   * and persists. Mirrors the coach badge store flow but routed through the
   * store so the modal stays thin.
   *
   * @returns {{ player, level }} the updated player + the level just purchased
   */
  async function purchasePlayerBadge(campaignId, playerId, badgeId) {
    loading.value = true
    error.value = null
    try {
      // Prefer the in-memory roster entry — any open PlayerDetailModal is
      // bound to THIS object reference (parent views like
      // TeamManagementView pass `selectedPlayer.value` which points at a
      // roster entry). Mutating the same object in place lets the modal's
      // `normalizedPlayer` computed re-evaluate without a parent re-render.
      // Fall back to a fresh IDB load only if the player isn't on the
      // currently-loaded roster (defensive).
      const player = roster.value.find(p => p?.id === playerId)
        ?? await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      const badge = BADGES.find(b => b.id === badgeId)
      if (!badge) throw new Error('Badge not found')

      const maxLevel = getMaxBadgeLevel(player, badge)
      if (!maxLevel) throw new Error('This badge is not available for this player')

      const ownedEntry = (player.badges ?? []).find(b => b?.id === badgeId)
      const currentLevel = ownedEntry?.level ?? null
      if (compareBadgeLevels(currentLevel, maxLevel) >= 0) {
        throw new Error(`Already at this player's max level (${maxLevel.toUpperCase()})`)
      }
      const next = nextPlayerBadgeLevel(currentLevel)
      if (!next || compareBadgeLevels(next, maxLevel) > 0) {
        throw new Error('No further upgrade available')
      }

      const cost = PLAYER_BADGE_COSTS[next]
      if (cost == null) throw new Error('Cost not found for this level')
      const authStore = useAuthStore()
      const tokens = authStore.profile?.tokens ?? 0
      if (tokens < cost) throw new Error('Insufficient tokens')

      // Deduct via backend (single source of truth for token balance)
      const response = await api.post('/api/user/tokens', { amount: -cost })
      if (authStore.profile) {
        authStore.profile.tokens = response.data.tokens
      }

      // Update or insert badge entry. Preserve `source: 'master'` when a
      // master-seeded badge is being upgraded — useful for future UI
      // distinctions.
      const existing = Array.isArray(player.badges) ? [...player.badges] : []
      const idx = existing.findIndex(b => b?.id === badgeId)
      const newEntry = {
        id: badgeId,
        level: next,
        source: 'purchased',
        purchasedAt: new Date().toISOString(),
      }
      if (idx >= 0) {
        const prev = existing[idx]
        existing[idx] = {
          ...newEntry,
          source: prev.source === 'master' ? 'master' : 'purchased',
        }
      } else {
        existing.push(newEntry)
      }
      // Direct property assignment on the existing player object — Vue's
      // deep reactivity picks this up because `roster.value` is a Pinia ref
      // wrapping the array, and `player` is one of its tracked entries.
      player.badges = existing

      // IndexedDB's structured clone can't serialize Vue's reactive proxies
      // (DataCloneError). Pass a plain deep clone to the repo so persistence
      // succeeds without disturbing the in-memory reactive entry.
      await PlayerRepository.save(JSON.parse(JSON.stringify(player)))

      useSyncStore().markDirty()
      return { player, level: next }
    } catch (err) {
      error.value = err.message || 'Failed to purchase player badge'
      throw err
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Player Training (idler-style reward loop)
  // ---------------------------------------------------------------------------
  // Real-time training sessions that grant a random open badge or upgrade
  // when the timer expires. Tied to the coach's per-season train budget
  // (`coach.trainActionsRemaining`) and accelerated by the 4-star Staff
  // Trainer "Accelerated Training" perk.

  const TRAINING_BASE_MS = 1 * 60 * 60 * 1000          // 1 hour
  const TRAINING_PERK_MS = 20 * 60 * 1000               // 20 minutes
  const TRAINING_REWARD_WEIGHTS = { bronze: 100, silver: 40, gold: 15, hof: 5 }

  /** Pick a single entry from `entries` with weight = TRAINING_REWARD_WEIGHTS[entry.nextLevel]. */
  function _pickWeightedTrainingReward(entries) {
    const weighted = entries
      .filter(e => e?.nextLevel)
      .map(e => ({ entry: e, w: TRAINING_REWARD_WEIGHTS[e.nextLevel] ?? 1 }))
    const total = weighted.reduce((sum, x) => sum + x.w, 0)
    if (total <= 0) return null
    let r = Math.random() * total
    for (const x of weighted) {
      r -= x.w
      if (r <= 0) return x.entry
    }
    return weighted[weighted.length - 1].entry
  }

  /** Returns true when the user's hired 4-star Staff Trainer has the
   *  Accelerated Training perk unlocked at the team's current training
   *  facility level. Mirrors the perk-gate check in `_getStaffTrainerPerks`
   *  on the game store. */
  function _hasAcceleratedTrainerPerk(campaign, teamFacilitiesLevel) {
    const st = campaign?.settings?.staff_trainer
    if (!st || !Array.isArray(st.perks)) return false
    const facilityLevel = teamFacilitiesLevel ?? 1
    return st.perks.some(p => p?.key === 'accelerated_training' && (p.requiredLevel ?? 0) <= facilityLevel)
  }

  /**
   * Start a training session for a player. Consumes one
   * `coach.trainActionsRemaining`. Refuses if budget is depleted, a session
   * is already in flight, or the player has nothing left to learn.
   */
  async function startTrainingSession(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const player = roster.value.find(p => p?.id === playerId)
        ?? await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      // No reward available — caller should be hiding the button, but
      // double-guard at the store level.
      const eligible = getBadgeStoreEntries(player).filter(e => e.nextLevel)
      if (eligible.length === 0) throw new Error('No badges or upgrades available for this player')

      const campaign = await CampaignRepository.get(campaignId)
      const teamData = await TeamRepository.get(campaignId, campaign?.teamId)
      if (!teamData?.coach) throw new Error('No coach hired')

      if (teamData.coach.activeTraining) {
        throw new Error('A training session is already in progress')
      }
      const budget = teamData.coach.trainActionsRemaining ?? 0
      if (budget <= 0) throw new Error('No training actions left this season')

      const useFastTimer = _hasAcceleratedTrainerPerk(campaign, teamData?.facilities?.training)
      const startedAt = new Date().toISOString()
      const endsAt = new Date(Date.now() + (useFastTimer ? TRAINING_PERK_MS : TRAINING_BASE_MS)).toISOString()

      teamData.coach.trainActionsRemaining = budget - 1
      teamData.coach.activeTraining = {
        playerId,
        startedAt,
        endsAt,
        trainerSpeedupApplied: useFastTimer,
      }
      await TeamRepository.save(teamData)

      // Mirror to in-memory caches so any open modal / nav badge picks up
      // the new state without a refetch.
      if (coach.value) {
        coach.value.trainActionsRemaining = teamData.coach.trainActionsRemaining
        coach.value.activeTraining = teamData.coach.activeTraining
      }
      if (team.value) team.value.coach = teamData.coach

      useSyncStore().markDirty()
      return { activeTraining: teamData.coach.activeTraining, trainActionsRemaining: teamData.coach.trainActionsRemaining }
    } catch (err) {
      error.value = err.message || 'Failed to start training session'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Claim the reward for a completed training session. Picks a random
   * badge/upgrade from the player's eligible pool (weighted toward bronze)
   * and mutates `player.badges`. Mirrors `purchasePlayerBadge`'s mutation
   * block — same shape, no token deduction.
   */
  async function claimTrainingReward(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      // Pre-flight: if we have a stale in-memory snapshot from before another
      // device claimed the reward, this read returns the post-claim state (no
      // activeTraining). Distinguish "already claimed elsewhere" from a true
      // input error so the UI can react gracefully — show a friendly toast
      // and silently refresh state instead of a generic red "failed" toast.
      const campaign = await CampaignRepository.get(campaignId)
      const teamData = await TeamRepository.get(campaignId, campaign?.teamId)
      const active = teamData?.coach?.activeTraining
      if (!active || active.playerId !== playerId) {
        // Force the in-memory store to match IndexedDB so the claim button
        // disappears immediately — the UI was showing a stale ready-to-claim
        // state from before the sync race.
        try {
          if (coach.value) coach.value.activeTraining = teamData?.coach?.activeTraining ?? null
          if (team.value) team.value.coach = teamData?.coach ?? team.value.coach
        } catch (_) { /* non-fatal */ }
        const err = new Error('Reward was already claimed on another device')
        err.code = 'ALREADY_CLAIMED'
        throw err
      }
      if (new Date(active.endsAt).getTime() > Date.now()) {
        throw new Error('Training not yet complete')
      }

      const player = roster.value.find(p => p?.id === playerId)
        ?? await PlayerRepository.get(campaignId, playerId)
      if (!player) throw new Error('Player not found')

      const eligible = getBadgeStoreEntries(player).filter(e => e.nextLevel)
      // Pool may have emptied between start and claim (e.g. user spent
      // tokens to buy everything mid-session). Fall back to clearing
      // activeTraining without an award so the user isn't stuck.
      if (eligible.length === 0) {
        teamData.coach.activeTraining = null
        await TeamRepository.save(teamData)
        if (coach.value) coach.value.activeTraining = null
        if (team.value) team.value.coach = teamData.coach
        useSyncStore().markDirty()
        return { badge: null, level: null }
      }

      const picked = _pickWeightedTrainingReward(eligible) ?? eligible[0]
      const badge = BADGES.find(b => b.id === picked.badge.id)

      // Apply the badge mutation — same shape as purchasePlayerBadge.
      const existing = Array.isArray(player.badges) ? [...player.badges] : []
      const idx = existing.findIndex(b => b?.id === picked.badge.id)
      const newEntry = {
        id: picked.badge.id,
        level: picked.nextLevel,
        source: 'trained',
        trainedAt: new Date().toISOString(),
      }
      if (idx >= 0) {
        const prev = existing[idx]
        existing[idx] = { ...newEntry, source: prev.source === 'master' ? 'master' : 'trained' }
      } else {
        existing.push(newEntry)
      }
      player.badges = existing

      teamData.coach.activeTraining = null

      await Promise.all([
        PlayerRepository.save(JSON.parse(JSON.stringify(player))),
        TeamRepository.save(teamData),
      ])

      if (coach.value) coach.value.activeTraining = null
      if (team.value) team.value.coach = teamData.coach

      useSyncStore().markDirty()
      return { badge, level: picked.nextLevel, badgeId: picked.badge.id }
    } catch (err) {
      error.value = err.message || 'Failed to claim training reward'
      throw err
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Coach hire / fire
  // ---------------------------------------------------------------------------

  /**
   * Sign a coach from the campaign's free-agent pool. Deducts tokens (if the
   * coach has a hireCost > 0), promotes the candidate onto team.coach with a
   * fresh 2-season contract, and removes the candidate from
   * campaign.settings.availableCoaches. Mirrors the scout/trainer hire flow.
   */
  async function hireCoach(campaignId, coachId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const pool = Array.isArray(campaign.settings?.availableCoaches)
        ? campaign.settings.availableCoaches
        : []
      const candidate = pool.find(c => c.id === coachId)
      if (!candidate) throw new Error('Coach is no longer available')

      const authStore = useAuthStore()
      const tokens = authStore.profile?.tokens ?? 0
      const cost = candidate.hireCost ?? 0
      if (cost > tokens) throw new Error('Insufficient tokens')

      // Deduct tokens (skip API round-trip when the hire is free)
      if (cost > 0) {
        const response = await api.post('/api/user/tokens', { amount: -cost })
        if (authStore.profile) {
          authStore.profile.tokens = response.data.tokens
        }
      }

      // Build the team-coach object: drop hireCost, add contract fields
      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      if (!teamData) throw new Error('Team not found')

      const currentSeason = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? 2025
      const { hireCost: _drop, ...coachWithoutCost } = candidate
      const newCoach = {
        ...coachWithoutCost,
        hiredSeason: currentSeason,
        contractYearsRemaining: 2,
        contract_years_remaining: 2,
        // Stamp the per-season "Coach Meeting" budget based on tier. Reset
        // each season in CampaignManager.startNewSeason and on re-sign in
        // resignCoach below.
        actionsRemaining: 0,
        // Separate per-season player-training budget — drives the
        // idler-style "Train" reward loop on the badges tab.
        trainActionsRemaining: 0,
        // In-flight training session ({ playerId, startedAt, endsAt,
        // trainerSpeedupApplied }) — null when no training running.
        activeTraining: null,
      }
      newCoach.actionsRemaining = getCoachActionBudget(newCoach)
      newCoach.trainActionsRemaining = getCoachTrainBudget(newCoach)

      // Mid-season coach replacement → small morale hit per player, scaled by
      // coachability/workEthic/personality. Skipped during offseason and when
      // team morale is already below 50 (firing is welcomed).
      const isReplacement = !!teamData.coach
      if (isReplacement) {
        const { updated } = applyCoachChangePenalty(roster.value, { phase: campaign.phase })
        if (updated.length > 0) {
          // `roster.value` players are Vue reactive proxies; IDB can't
          // structuredClone proxies → DataCloneError. Strip via JSON clone
          // before persisting (player records are plain JSON-safe).
          await PlayerRepository.saveBulk(JSON.parse(JSON.stringify(updated)))
        }
      }

      teamData.coach = newCoach

      // Auto-init the team's coaching scheme to fit the new coach + current
      // roster. A hire is the right moment to refresh because (a) on first
      // hire the team has no scheme set, and (b) on replacement the prior
      // coach's preferences shouldn't carry over. Preserves any custom sub
      // strategy the user picked previously.
      try {
        const rosterForScheme = await PlayerRepository.getByTeam(campaignId, userTeamId)
        const schemeFit = selectBestCoachingScheme(rosterForScheme, newCoach, teamData.coaching_scheme)
        teamData.coaching_scheme = {
          offensive: schemeFit.offensive,
          defensive: schemeFit.defensive,
          substitution: schemeFit.substitution,
        }
      } catch (schemeErr) {
        console.warn('[Team] Failed to auto-init coaching scheme on hire:', schemeErr)
      }

      await TeamRepository.save(teamData)

      // Remove from pool & save campaign
      campaign.settings = campaign.settings ?? {}
      campaign.settings.availableCoaches = pool.filter(c => c.id !== coachId)
      await CampaignRepository.save(campaign)

      // Update local refs so UI reacts immediately
      coach.value = newCoach
      if (team.value) team.value.coach = newCoach

      const campaignStore = useCampaignStore()
      if (campaignStore.currentCampaign?.id === campaignId) {
        campaignStore.currentCampaign.settings = {
          ...campaignStore.currentCampaign.settings,
          availableCoaches: campaign.settings.availableCoaches,
        }
      }

      useSyncStore().markDirty()
      return { coach: newCoach }
    } catch (err) {
      error.value = err.message || 'Failed to hire coach'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-sign the user team's current head coach for another 2 seasons. Resets
   * `contractYearsRemaining` to 2 and stamps a fresh `hiredSeason`. Costs tokens
   * scaled by the coach's tier (see getCoachResignCost) so a strong coach can't
   * be retained indefinitely for free. Surfaced as a button on the coach card
   * during the final year of the contract. Returns { coach, cost }.
   */
  async function resignCoach(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      if (!teamData) throw new Error('Team not found')
      if (!teamData.coach) throw new Error('No coach to re-sign')

      // Charge tokens up front (before mutating the contract) so a failed
      // deduction can't leave a re-signed coach the user didn't pay for.
      const authStore = useAuthStore()
      const cost = getCoachResignCost(teamData.coach)
      const tokens = authStore.profile?.tokens ?? 0
      if (cost > tokens) throw new Error('Insufficient tokens')
      if (cost > 0) {
        const response = await api.post('/api/user/tokens', { amount: -cost })
        if (authStore.profile) {
          authStore.profile.tokens = response.data.tokens
        }
      }

      const currentSeason = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? 2025
      teamData.coach.contractYearsRemaining = 2
      teamData.coach.contract_years_remaining = 2
      teamData.coach.hiredSeason = currentSeason
      // Renewing the contract restamps the per-season coach-meeting AND
      // training budgets so the user gets a fresh allotment for the new
      // deal. activeTraining is left untouched — a re-sign mid-season
      // shouldn't kill an in-flight reward.
      teamData.coach.actionsRemaining = getCoachActionBudget(teamData.coach)
      teamData.coach.trainActionsRemaining = getCoachTrainBudget(teamData.coach)

      await TeamRepository.save(teamData)

      coach.value = teamData.coach
      if (team.value) team.value.coach = teamData.coach

      useSyncStore().markDirty()
      return { coach: teamData.coach, cost }
    } catch (err) {
      error.value = err.message || 'Failed to re-sign coach'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Release the user team's current head coach. Mirrors the scout fire flow —
   * the coach is simply discarded (no buyout, no return-to-pool). The user
   * must hire a replacement from the pool before the next season can start.
   */
  async function fireCoach(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      if (!teamData) throw new Error('Team not found')

      // Mid-season firing → mild morale hit per player (skipped if team morale
      // already below 50, or during offseason).
      if (teamData.coach) {
        const { updated } = applyCoachChangePenalty(roster.value, { phase: campaign.phase })
        if (updated.length > 0) {
          // Strip Vue reactive proxies before persisting — IDB structuredClone
          // can't handle proxies (DataCloneError).
          await PlayerRepository.saveBulk(JSON.parse(JSON.stringify(updated)))
        }
      }

      teamData.coach = null
      await TeamRepository.save(teamData)

      coach.value = null
      if (team.value) team.value.coach = null

      useSyncStore().markDirty()
    } catch (err) {
      error.value = err.message || 'Failed to release coach'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Hold a 1-on-1 "Coach Meeting" with a player to bump their morale by a
   * flat +30 points (clamped to 100). Consumes one of the coach's per-season
   * meeting actions; if `purchasedAction` is true the user spends tokens
   * instead (used when `actionsRemaining` has hit 0).
   *
   * Order matters here: tokens are deducted BEFORE the morale mutation, so a
   * failed `/api/user/tokens` call doesn't leave a half-applied state.
   */
  async function holdCoachMeeting(campaignId, playerId, { purchasedAction = false } = {}) {
    loading.value = true
    error.value = null
    try {
      if (!campaignId || !playerId) throw new Error('Missing campaign or player')
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      if (!teamData?.coach) throw new Error('No coach signed')

      const playerRecord = await PlayerRepository.get(campaignId, playerId)
      if (!playerRecord) throw new Error('Player not found')

      const currentMorale = playerRecord.personality?.morale ?? playerRecord.morale ?? 80
      if (currentMorale >= 100) throw new Error('Morale already maxed')

      const coachObj = teamData.coach
      const remaining = coachObj.actionsRemaining ?? 0

      if (purchasedAction) {
        const authStore = useAuthStore()
        const tokens = authStore.profile?.tokens ?? 0
        if (tokens < COACH_MEETING_EXTRA_COST) throw new Error('Not enough tokens')
        const response = await api.post('/api/user/tokens', { amount: -COACH_MEETING_EXTRA_COST })
        if (authStore.profile) authStore.profile.tokens = response.data.tokens
      } else {
        if (remaining <= 0) throw new Error('No coach meeting actions remaining')
        coachObj.actionsRemaining = remaining - 1
      }

      // Apply the morale boost on the canonical (personality.morale) path,
      // mirror to the legacy top-level field so any code reading `p.morale`
      // sees the new value too.
      if (!playerRecord.personality) playerRecord.personality = {}
      const newMorale = Math.min(100, currentMorale + 30)
      playerRecord.personality.morale = newMorale
      playerRecord.morale = newMorale

      // Persist. JSON-clone strips Vue reactive wrappers before IDB writes.
      await PlayerRepository.save(JSON.parse(JSON.stringify(playerRecord)))
      await TeamRepository.save(teamData)

      // Mirror into local caches so the PlayerDetailModal's `moraleValue`
      // computed (and the button's "X left" counter) re-render immediately.
      const idx = roster.value.findIndex(p => p?.id === playerId)
      if (idx !== -1) {
        if (!roster.value[idx].personality) roster.value[idx].personality = {}
        roster.value[idx].personality.morale = newMorale
        roster.value[idx].morale = newMorale
      }
      coach.value = teamData.coach
      if (team.value) team.value.coach = teamData.coach

      useSyncStore().markDirty()
      return {
        morale: newMorale,
        actionsRemaining: coachObj.actionsRemaining ?? 0,
      }
    } catch (err) {
      error.value = err.message || 'Failed to hold coach meeting'
      throw err
    } finally {
      loading.value = false
    }
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
    recommendedDefensiveScheme,
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
    purchaseUpgradePoint,
    getUpgradePointPurchaseInfo,
    purchasePlayerBadge,
    startTrainingSession,
    claimTrainingReward,
    hireCoach,
    resignCoach,
    fireCoach,
    holdCoachMeeting,
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
