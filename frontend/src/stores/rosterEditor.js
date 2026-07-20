// =============================================================================
// rosterEditor store — backs the Full Custom Roster editor (custom_roster IAP)
// =============================================================================
// Loaded when a campaign was created with `customRoster: true` and hasn't been
// finalized. The campaign + its teams/players already exist and are persisted;
// this store edits those rows IN PLACE (saveBulk / save + syncStore.markDirty)
// so the user can save mid-creation and resume. Finalize validates, stamps the
// derived overall/potential, flips `rosterSetupCompleted`, and hands off to the
// campaign home (or the fantasy draft room).

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { cloneForPersist } from '@/utils/cloneForPersist'
import { useSyncStore } from '@/stores/sync'
import { generatePlayer } from '@/engine/campaign/CampaignManager'
import { importRosterBuild } from '@/engine/community/RosterBuildImporter'
import { initializeTeamLineup, initializeUserTeamLineup } from '@/engine/ai/AILineupService'
import { MAX_ROSTER_SIZE } from '@/engine/finance/FinanceManager'
import { generateAITargetMinutes } from '@/engine/simulation/SubstitutionEngine'
import {
  recalculateOverall,
  deriveOverallFromAttributes,
  derivePotential,
  ensureAttributeCaps,
} from '@/engine/evolution/PlayerEvolution'

// Minimum players a team must carry before the campaign can start.
export const MIN_ROSTER_SIZE = 8

export const useRosterEditorStore = defineStore('rosterEditor', () => {
  const campaignId = ref(null)
  const campaign = ref(null)
  const teams = ref([])            // 30 teams, each with embedded `.coach`
  const activeTeamId = ref(null)
  const activeRoster = ref([])     // players for the active team (lazy-loaded)
  const freeAgents = ref([])       // fantasy: the draftable pool

  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)

  // Bulk-table editing state: the selected row (drives the hero header +
  // which row shows chevrons) and the set of player ids with unsaved
  // in-memory edits (drives the contextual Save button + leave guards).
  const selectedId = ref(null)
  const dirtyIds = ref(new Set())
  const isDirty = computed(() => dirtyIds.value.size > 0)

  const selectedPlayer = computed(() =>
    activeRoster.value.find((p) => p.id === selectedId.value)
      ?? freeAgents.value.find((p) => p.id === selectedId.value)
      ?? null)

  function select(player) {
    selectedId.value = player?.id ?? null
  }

  function markDirtyPlayer(id) {
    if (!id) return
    const next = new Set(dirtyIds.value)
    next.add(id)
    dirtyIds.value = next
  }

  function _clearDirty(id) {
    if (!dirtyIds.value.has(id)) return
    const next = new Set(dirtyIds.value)
    next.delete(id)
    dirtyIds.value = next
  }

  // Persist every dirty player from the in-memory lists in one bulk write.
  async function saveDirty() {
    if (!dirtyIds.value.size) return
    saving.value = true
    try {
      const pool = [...activeRoster.value, ...freeAgents.value]
      const players = pool.filter((p) => dirtyIds.value.has(p.id))
      players.forEach(refreshDerived)
      await PlayerRepository.saveBulk(players.map(cloneForPersist))
      dirtyIds.value = new Set()
      _sync()
    } finally {
      saving.value = false
    }
  }

  // Refresh a single player's row from IndexedDB (e.g. after the headshot
  // editor wrote flags directly) without touching other in-memory edits.
  async function refreshPlayerFromDb(playerId) {
    const fresh = await PlayerRepository.get(campaignId.value, playerId)
    if (!fresh) return
    for (const list of [activeRoster, freeAgents]) {
      const i = list.value.findIndex((p) => p.id === playerId)
      if (i >= 0) list.value.splice(i, 1, fresh)
    }
  }

  // Discard unsaved edits by reloading the affected lists from IndexedDB.
  async function discardDirty() {
    dirtyIds.value = new Set()
    if (activeTeamId.value) {
      activeRoster.value = await PlayerRepository.getByTeam(campaignId.value, activeTeamId.value)
    }
    if (freeAgents.value.length) {
      freeAgents.value = await PlayerRepository.getFreeAgents(campaignId.value)
    }
  }

  const isFantasy = computed(() =>
    (campaign.value?.draftMode ?? campaign.value?.draft_mode) === 'fantasy')
  // Which "start" the user picked ('generated' | 'scratch'); null until chosen.
  const startMode = computed(() => campaign.value?.settings?.customRosterStartMode ?? null)
  const hasStarted = computed(() => !!startMode.value)
  const userTeamId = computed(() => campaign.value?.teamId ?? campaign.value?.team_id ?? null)

  const activeTeam = computed(() => teams.value.find(t => t.id === activeTeamId.value) ?? null)

  function _sync() {
    const s = useSyncStore()
    s.setActiveCampaign(campaignId.value)
    s.markDirty('custom_roster')
  }

  async function load(id) {
    loading.value = true
    error.value = null
    try {
      campaignId.value = id
      campaign.value = await CampaignRepository.get(id)
      if (!campaign.value) throw new Error('Campaign not found')
      const all = await TeamRepository.getAllForCampaign(id)
      // Stable display order: user team first, then alphabetical by abbreviation.
      teams.value = all.sort((a, b) => {
        if (a.id === userTeamId.value) return -1
        if (b.id === userTeamId.value) return 1
        return (a.abbreviation ?? '').localeCompare(b.abbreviation ?? '')
      })
      activeTeamId.value = null
      activeRoster.value = []
    } catch (e) {
      error.value = e?.message ?? 'Failed to load the roster editor'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Persist the chosen start mode. 'scratch' empties every team's roster; the
  // user must populate before finalizing. 'generated' keeps the roster the
  // campaign was created with. Idempotent-safe to call once.
  async function chooseStart(mode) {
    if (!campaign.value) return
    campaign.value.settings = campaign.value.settings ?? {}
    campaign.value.settings.customRosterStartMode = mode
    if (mode === 'scratch' && !isFantasy.value) {
      // Wipe all team rosters (and the free-agent pool) so the user builds from
      // nothing. Teams keep their coach; players are deleted.
      await PlayerRepository.deleteAllForCampaign(campaignId.value)
      activeRoster.value = []
      freeAgents.value = []
    } else if (mode === 'scratch' && isFantasy.value) {
      // Fantasy scratch: empty the draftable pool.
      await PlayerRepository.deleteAllForCampaign(campaignId.value)
      freeAgents.value = []
    }
    await CampaignRepository.save(cloneForPersist(campaign.value))
    _sync()
  }

  function _sortTeams(list) {
    return list.sort((a, b) => {
      if (a.id === userTeamId.value) return -1
      if (b.id === userTeamId.value) return 1
      return (a.abbreviation ?? '').localeCompare(b.abbreviation ?? '')
    })
  }

  // Apply a downloaded community build (Part B): the importer wipes the
  // generated league and installs the build's players/coaches/headshots.
  // Campaign stays in roster-setup for inspection before Finalize.
  async function applyDownloadedBuild(blob) {
    saving.value = true
    try {
      const result = await importRosterBuild(campaignId.value, blob)
      campaign.value.settings = campaign.value.settings ?? {}
      campaign.value.settings.customRosterStartMode = 'downloaded'
      await CampaignRepository.save(cloneForPersist(campaign.value))
      // Coaches changed on the team records — refresh the list.
      teams.value = _sortTeams(await TeamRepository.getAllForCampaign(campaignId.value))
      dirtyIds.value = new Set()
      _sync()
      return result
    } finally {
      saving.value = false
    }
  }

  async function openTeam(teamId) {
    activeTeamId.value = teamId
    activeRoster.value = await PlayerRepository.getByTeam(campaignId.value, teamId)
    // Auto-select the top row so the hero header is never empty.
    selectedId.value = activeRoster.value[0]?.id ?? null
  }

  async function openPool() {
    freeAgents.value = await PlayerRepository.getFreeAgents(campaignId.value)
    selectedId.value = freeAgents.value[0]?.id ?? null
  }

  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

  // Create a fresh, fully-shaped player (a neutral ~70-OVR base with valid
  // attributes + caps) the user then customizes. Used to populate empty rosters
  // in "Start from Scratch". Attached to the active team (or the free-agent pool
  // for fantasy). Persists immediately so it survives a mid-creation exit.
  async function addPlayer() {
    const team = activeTeam.value
    if (!team) return null
    // Same 15-man cap the rest of the game enforces (signings, AI contracts).
    if (activeRoster.value.length >= MAX_ROSTER_SIZE) return null
    const position = POSITIONS[activeRoster.value.length % POSITIONS.length]
    const player = generatePlayer({
      campaignId: campaignId.value,
      teamId: team.id,
      teamAbbreviation: team.abbreviation,
      position,
      overall: 70,
    })
    activeRoster.value.push(player)
    selectedId.value = player.id
    await PlayerRepository.save(cloneForPersist(player))
    _sync()
    return player
  }

  async function addPoolPlayer() {
    const position = POSITIONS[freeAgents.value.length % POSITIONS.length]
    const player = generatePlayer({
      campaignId: campaignId.value,
      teamId: null,
      teamAbbreviation: 'FA',
      position,
      overall: 70,
    })
    freeAgents.value.push(player)
    selectedId.value = player.id
    await PlayerRepository.save(cloneForPersist(player))
    _sync()
    return player
  }

  async function removePlayer(player, fromPool = false) {
    await PlayerRepository.delete(campaignId.value, player.id)
    const list = fromPool ? freeAgents : activeRoster
    const i = list.value.findIndex((p) => p.id === player.id)
    if (i >= 0) list.value.splice(i, 1)
    _clearDirty(player.id)
    if (selectedId.value === player.id) {
      selectedId.value = list.value[0]?.id ?? null
    }
    _sync()
  }

  // Recompute a player's derived overall + potential from its authored
  // attributes and per-attribute ceilings. Called after any attribute/cap edit
  // and as a safety pass at finalize. The overall is stamped directly from the
  // calibrated derive (matching what the editor displays live), then
  // recalculateOverall re-seeds the evolution anchor from that value so the
  // player develops correctly once the campaign starts.
  function refreshDerived(player) {
    ensureAttributeCaps(player)
    const ovr = deriveOverallFromAttributes(player.attributes, player.position ?? 'SF')
    player.overallRating = ovr
    player.overall_rating = ovr
    player._overallExact = ovr
    delete player._overallCalcAnchor // force recalculateOverall to keep `ovr` and re-anchor
    recalculateOverall(player)
    const pot = derivePotential(player)
    player.potentialRating = pot
    player.potential_rating = pot
    return player
  }

  async function savePlayer(player) {
    refreshDerived(player)
    await PlayerRepository.save(cloneForPersist(player))
    // Reflect the edit in whichever local list holds this player so the roster
    // rows (OVR/POT/name) update without a reload.
    for (const list of [activeRoster, freeAgents]) {
      const i = list.value.findIndex((p) => p.id === player.id)
      if (i >= 0) list.value.splice(i, 1, player)
    }
    _clearDirty(player.id)
    _sync()
  }

  async function saveTeamCoach(team) {
    await TeamRepository.save(cloneForPersist(team))
    // Replace the team in the list so the coach name/derived tier update live.
    const i = teams.value.findIndex((t) => t.id === team.id)
    if (i >= 0) teams.value.splice(i, 1, team)
    _sync()
  }

  // Validate the full league before the campaign can start. Returns an array of
  // human-readable problems (empty = ready to finalize).
  async function validate() {
    const problems = []
    if (isFantasy.value) {
      const pool = await PlayerRepository.getFreeAgents(campaignId.value)
      // The fantasy draft runs 15 rounds × every team — one player per pick.
      // An under-filled pool doesn't crash the draft, but the late rounds
      // field nobody and rosters come out thin, so require a full pool.
      const needed = teams.value.length * 15
      if (pool.length < needed) {
        problems.push(`Draft pool has ${pool.length} players; the draft makes ${needed} picks (15 rounds × ${teams.value.length} teams).`)
      }
      _validatePlayers(pool, problems, 'Pool')
    } else {
      for (const team of teams.value) {
        const roster = await PlayerRepository.getByTeam(campaignId.value, team.id)
        if (roster.length < MIN_ROSTER_SIZE) {
          problems.push(`${team.abbreviation ?? team.name}: only ${roster.length} players (min ${MIN_ROSTER_SIZE}).`)
        }
        _validatePlayers(roster, problems, team.abbreviation ?? team.name)
      }
    }
    for (const team of teams.value) {
      const coach = team.coach
      if (!coach || !(coach.name || coach.firstName)) {
        problems.push(`${team.abbreviation ?? team.name}: missing a head coach.`)
      }
    }
    return problems
  }

  function _validatePlayers(players, problems, label) {
    for (const p of players) {
      if (!(p.name || p.firstName)) { problems.push(`${label}: a player has no name.`); break }
    }
    // ceiling >= attribute for every attribute (prevents a cap forcing a down-clamp)
    for (const p of players) {
      const caps = p.attributeCaps
      if (!caps) continue
      for (const cat of Object.keys(p.attributes ?? {})) {
        for (const [k, v] of Object.entries(p.attributes[cat] ?? {})) {
          const cap = caps?.[cat]?.[k]
          if (typeof cap === 'number' && cap < v) {
            problems.push(`${label}: ${p.name ?? 'A player'} has a ceiling below current on ${k}.`)
            return
          }
        }
      }
    }
  }

  async function finalize() {
    saving.value = true
    error.value = null
    try {
      // Safety pass — deliberately light-touch. Players edited in the editor
      // were already re-derived on save (savePlayer); the
      // rest keep their generation-stamped overalls (re-deriving them here
      // would drift the league's carefully-banded ratings by the calibration
      // error, ±1-3 per player). Only repair players that are missing a cap
      // map or whose potential sits below their overall.
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId.value)
      const repaired = []
      for (const p of allPlayers) {
        let changed = false
        if (!p.attributeCaps) {
          ensureAttributeCaps(p)
          changed = true
        }
        const ovr = p.overallRating ?? p.overall_rating ?? 70
        const pot = p.potentialRating ?? p.potential_rating
        if (typeof pot !== 'number' || pot < ovr) {
          const derived = Math.max(ovr, derivePotential(p))
          p.potentialRating = derived
          p.potential_rating = derived
          changed = true
        }
        if (changed) repaired.push(p)
      }
      if (repaired.length) {
        await PlayerRepository.saveBulk(repaired.map(cloneForPersist))
      }

      const fresh = await CampaignRepository.get(campaignId.value)

      // Rebuild lineups + target minutes AND payroll for standard campaigns
      // (mirrors the creation-time step 7 and the fantasy draft's finalize).
      // The editor can delete/add players and edit salaries, so the
      // creation-time starter IDs, target_minutes maps, and total_payroll may
      // all be stale — target_minutes must be replaced wholesale (the old map
      // is keyed by dead IDs), and total_payroll is read by the trade system.
      // Fantasy campaigns skip this: the draft rebuilds lineups itself.
      if (!isFantasy.value) {
        for (const team of teams.value) {
          const teamPlayers = allPlayers.filter((p) => p.teamId === team.id)
          const freshTeam = await TeamRepository.get(campaignId.value, team.id)
          if (!freshTeam) continue
          if (teamPlayers.length) {
            const { starters, subStrategy } = initializeTeamLineup(teamPlayers)
            const targetMinutes = generateAITargetMinutes(teamPlayers, starters, subStrategy)
            freshTeam.lineup_settings = {
              ...freshTeam.lineup_settings,
              starters,
              subStrategy,
              target_minutes: targetMinutes,
            }
          }
          const payroll = teamPlayers.reduce(
            (sum, p) => sum + (Number(p.contractSalary ?? p.contract_salary) || 0), 0)
          freshTeam.total_payroll = payroll
          freshTeam.totalPayroll = payroll
          await TeamRepository.save(cloneForPersist(freshTeam))
        }
        const userPlayers = allPlayers.filter((p) => p.teamId === userTeamId.value)
        if (userPlayers.length) {
          const userStarters = initializeUserTeamLineup(userPlayers)
          const userMinutes = generateAITargetMinutes(userPlayers, userStarters, 'staggered')
          fresh.settings = fresh.settings ?? {}
          fresh.settings.lineup = {
            starters: userStarters,
            target_minutes: userMinutes,
            rotation: [],
          }
        }
      }

      fresh.rosterSetupCompleted = true
      fresh.roster_setup_completed = true
      await CampaignRepository.save(cloneForPersist(fresh))
      campaign.value = fresh
      _sync()
      return true
    } catch (e) {
      error.value = e?.message ?? 'Failed to finalize the roster'
      throw e
    } finally {
      saving.value = false
    }
  }

  function $reset() {
    campaignId.value = null
    campaign.value = null
    teams.value = []
    activeTeamId.value = null
    activeRoster.value = []
    freeAgents.value = []
    selectedId.value = null
    dirtyIds.value = new Set()
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    campaignId, campaign, teams, activeTeamId, activeRoster, freeAgents,
    loading, saving, error,
    isFantasy, startMode, hasStarted, userTeamId, activeTeam,
    selectedId, selectedPlayer, dirtyIds, isDirty,
    select, markDirtyPlayer, saveDirty, discardDirty, refreshPlayerFromDb,
    load, chooseStart, openTeam, openPool, applyDownloadedBuild,
    addPlayer, addPoolPlayer, removePlayer,
    refreshDerived, savePlayer, saveTeamCoach,
    validate, finalize, $reset,
  }
})
