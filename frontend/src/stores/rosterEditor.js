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
import { computeTeamOverall } from '@/utils/teamOverall'
import { CAP_SET_2026 } from '@/engine/data/salaryScale'
import { deriveOwnerExpectationFromRoster, deriveExpectationTierFromRoster } from '@/engine/season/OwnerExpectationService'

// Minimum players a team must carry before the campaign can start.
export const MIN_ROSTER_SIZE = 8

// Authored free-agent pool bounds for CUSTOM (non-fantasy) campaigns — the
// pool must be a real market (min) without flooding the league (max).
export const MIN_FA_POOL = 20
export const MAX_FA_POOL = 50

// Max TOTAL badge rows per authored player — learned levels AND cap-only
// "earnable later" rows both count. Editor rule (UI + finalize validation).
export const MAX_PLAYER_BADGES = 12

export const useRosterEditorStore = defineStore('rosterEditor', () => {
  const campaignId = ref(null)
  const campaign = ref(null)
  const teams = ref([])            // 30 teams, each with embedded `.coach`
  const activeTeamId = ref(null)
  const activeRoster = ref([])     // players for the active team (lazy-loaded)
  const freeAgents = ref([])       // fantasy: the draftable pool; standard custom: the FA market
  const teamOveralls = ref({})     // teamId → computed overall (team-grid badges)
  const faCount = ref(0)           // live FA-pool size (standard custom: FA card badge)

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
  // Which "start" the user picked ('generated' | 'scratch' | 'downloaded');
  // null until chosen.
  const startMode = computed(() => campaign.value?.settings?.customRosterStartMode ?? null)
  const hasStarted = computed(() => !!startMode.value)
  // Imported builds in a fantasy campaign skip team authoring entirely — every
  // player was routed into the draft pool. Scratch/generated fantasy authors a
  // full league exactly like a standard campaign (interchangeable), and the
  // draft pools everyone at draft time.
  const poolOnlyFantasy = computed(() => isFantasy.value && startMode.value === 'downloaded')
  const userTeamId = computed(() => campaign.value?.teamId ?? campaign.value?.team_id ?? null)

  const activeTeam = computed(() => teams.value.find(t => t.id === activeTeamId.value) ?? null)

  function _sync() {
    const s = useSyncStore()
    s.setActiveCampaign(campaignId.value)
    s.markDirty('custom_roster')
  }

  // One-time upgrade for in-progress custom builds that predate the 2026 cap
  // rebase. An un-finalized campaign has no live economy yet, so it's safe to
  // move it onto the 2026 cap set; finalized/live campaigns never load this
  // store and keep their legacy numbers. Idempotent — keyed on the absence of
  // settings.capNumbers. The 2025 start year/schedule stays (baked into
  // schedule dates and generated birth years at creation).
  async function _upgradeCapNumbers() {
    const c = campaign.value
    if (!c) return
    if (c.settings?.capNumbers) return
    const isCustom = (c.customRoster ?? c.custom_roster) === true
    const finalized = (c.rosterSetupCompleted ?? c.roster_setup_completed) === true
    if (!isCustom || finalized) return
    c.settings = c.settings ?? {}
    c.settings.capNumbers = { ...CAP_SET_2026 }
    await CampaignRepository.save(cloneForPersist(c))
    const all = await TeamRepository.getAllForCampaign(campaignId.value)
    await TeamRepository.saveBulk(all.map((t) => cloneForPersist({
      ...t,
      salaryCap: CAP_SET_2026.salaryCap,
      salary_cap: CAP_SET_2026.salaryCap,
    })))
    _sync()
  }

  async function load(id) {
    loading.value = true
    error.value = null
    try {
      campaignId.value = id
      campaign.value = await CampaignRepository.get(id)
      if (!campaign.value) throw new Error('Campaign not found')
      await _upgradeCapNumbers()
      await refreshTeams()
      activeTeamId.value = null
      activeRoster.value = []
      await refreshTeamOveralls()
    } catch (e) {
      error.value = e?.message ?? 'Failed to load the roster editor'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Re-read the team records from IDB (embedded coach included), keeping the
  // stable display order (user team first, then alphabetical). Needed when an
  // EXTERNAL editor wrote teams while this store's snapshot survived a
  // navigation — e.g. the coach headshot editor round-trip renames the coach
  // and saves the team; without this the roster editor shows the stale coach
  // until a hard reload.
  async function refreshTeams() {
    if (!campaignId.value) return
    const all = await TeamRepository.getAllForCampaign(campaignId.value)
    teams.value = all.sort((a, b) => {
      if (a.id === userTeamId.value) return -1
      if (b.id === userTeamId.value) return 1
      return (a.abbreviation ?? '').localeCompare(b.abbreviation ?? '')
    })
  }

  // Recompute every team's current overall (one bulk IDB read, grouped by
  // team). Display-only — feeds the badges on the team-select grid; failures
  // just leave stale/absent badges. Excludes free agents and retirees via
  // the canonical computeTeamOverall filters.
  async function refreshTeamOveralls() {
    if (!campaignId.value) return
    try {
      const all = await PlayerRepository.getAllForCampaign(campaignId.value)
      const byTeam = {}
      for (const p of all) {
        const tid = p.teamId ?? p.team_id
        if (!tid) continue
        ;(byTeam[tid] ??= []).push(p)
      }
      const map = {}
      for (const t of teams.value) map[t.id] = computeTeamOverall(byTeam[t.id] ?? [])
      teamOveralls.value = map
      // FA-pool badge count (teamless, excluding scouting prospects/retirees).
      faCount.value = all.filter((p) =>
        !(p.teamId ?? p.team_id)
        && !(p.isDraftProspect || p.is_draft_prospect)
        && !(p.isRetired || p.is_retired)).length
    } catch { /* display-only */ }
  }

  // Persist the chosen start mode. 'scratch' empties every team's roster; the
  // user must populate before finalizing. 'generated' keeps the roster the
  // campaign was created with. Idempotent-safe to call once.
  async function chooseStart(mode) {
    if (!campaign.value) return
    campaign.value.settings = campaign.value.settings ?? {}
    campaign.value.settings.customRosterStartMode = mode
    if (mode === 'scratch') {
      // Wipe all team rosters (and the free-agent pool) so the user builds from
      // nothing. Teams keep their coach; players are deleted. Identical for
      // fantasy — authoring is interchangeable; the draft pools everyone later.
      await PlayerRepository.deleteAllForCampaign(campaignId.value)
      activeRoster.value = []
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
      // The import wiped + re-id'd every player. Stamp the install so the
      // sync pull-merge stops "resurrecting" the OLD players still sitting
      // in the cloud snapshot (absent-local records normally merge in as
      // new-device additions — here they'd double every roster to 30).
      campaign.value.settings.rosterInstalledAt = new Date().toISOString()
      await CampaignRepository.save(cloneForPersist(campaign.value))
      // Coaches changed on the team records — refresh the list.
      teams.value = _sortTeams(await TeamRepository.getAllForCampaign(campaignId.value))
      dirtyIds.value = new Set()
      _sync()
      // Replace the cloud snapshot right away so the stale pre-import roster
      // can't linger there. Best-effort: if it fails (offline), the
      // rosterInstalledAt guard above still blocks resurrection on pull.
      try {
        await useSyncStore().pushChanges(campaignId.value, { isolated: true })
      } catch { /* retried by the normal event-driven sync */ }
      return result
    } finally {
      saving.value = false
    }
  }

  async function openTeam(teamId) {
    activeTeamId.value = teamId
    activeRoster.value = await PlayerRepository.getByTeam(campaignId.value, teamId)
    // No auto-selection: with nothing selected the view shows the TEAM
    // header (overall / owner / editable history) instead of a player hero.
    selectedId.value = null
  }

  async function openPool() {
    // Prospect filter is defensive: the FA index shouldn't include the
    // scouting class, but a stray flag must not surface it in the editor.
    freeAgents.value = (await PlayerRepository.getFreeAgents(campaignId.value))
      .filter((p) => !(p.isDraftProspect || p.is_draft_prospect))
    faCount.value = freeAgents.value.length
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

  // Fill the active team up to the 15-man cap with generated players —
  // scratch-mode QoL so a hand-built core doesn't require tapping Add Player
  // a dozen times. Each fill takes the position the roster is thinnest at
  // (ties resolve PG→C) and a randomized bench-grade overall so the results
  // read as role players, not fifteen identical 70s. Selection is left
  // untouched. Returns the number of players generated.
  // Generate players for `team` until `roster` (mutated in place) reaches the
  // 15-man cap: each fill takes the thinnest position (ties PG→C) and a
  // randomized bench-grade overall. Returns the new players (not persisted).
  function _generateFillPlayers(team, roster) {
    const added = []
    while (roster.length < MAX_ROSTER_SIZE) {
      const counts = Object.fromEntries(POSITIONS.map((pos) => [pos, 0]))
      for (const p of roster) {
        if (counts[p.position] !== undefined) counts[p.position]++
      }
      const position = POSITIONS.reduce((best, pos) => (counts[pos] < counts[best] ? pos : best))
      const player = generatePlayer({
        campaignId: campaignId.value,
        teamId: team.id,
        teamAbbreviation: team.abbreviation,
        position,
        overall: 60 + Math.floor(Math.random() * 15), // 60–74 bench/role grade
      })
      roster.push(player)
      added.push(player)
    }
    return added
  }

  async function fillRoster() {
    const team = activeTeam.value
    if (!team) return 0
    const added = _generateFillPlayers(team, activeRoster.value)
    if (!added.length) return 0
    await PlayerRepository.saveBulk(added.map((p) => cloneForPersist(p)))
    _sync()
    return added.length
  }

  // League-wide fill (the finalize modal's "generate the rest"): every team
  // except `excludeTeamId` (the user's — their roster is theirs to author)
  // gets topped up to 15. Returns { teams, players } counts.
  async function fillAllTeamRosters({ excludeTeamId = null } = {}) {
    const all = await PlayerRepository.getAllForCampaign(campaignId.value)
    const byTeam = new Map()
    for (const p of all) {
      const tid = p.teamId ?? p.team_id
      if (tid == null) continue
      if (!byTeam.has(tid)) byTeam.set(tid, [])
      byTeam.get(tid).push(p)
    }
    const added = []
    let teamsFilled = 0
    for (const team of teams.value) {
      if (team.id === excludeTeamId) continue
      const roster = byTeam.get(team.id) ?? []
      const newPlayers = _generateFillPlayers(team, roster)
      if (newPlayers.length) {
        teamsFilled++
        added.push(...newPlayers)
      }
    }
    if (added.length) {
      await PlayerRepository.saveBulk(added.map((p) => cloneForPersist(p)))
      // Keep an open team view coherent if it got filled.
      if (activeTeamId.value && activeTeamId.value !== excludeTeamId) {
        activeRoster.value = await PlayerRepository.getByTeam(campaignId.value, activeTeamId.value)
      }
      await refreshTeamOveralls()
      _sync()
    }
    return { teams: teamsFilled, players: added.length }
  }

  // How many NON-user teams sit below the minimum roster size — drives the
  // finalize modal's "generate the rest" affordance. Pool-only fantasy
  // (imported build): 0 — team rosters come from the draft, not authoring.
  async function countShortTeams() {
    if (poolOnlyFantasy.value) return 0
    const all = await PlayerRepository.getAllForCampaign(campaignId.value)
    const counts = new Map()
    for (const p of all) {
      const tid = p.teamId ?? p.team_id
      if (tid == null) continue
      counts.set(tid, (counts.get(tid) ?? 0) + 1)
    }
    let short = 0
    for (const team of teams.value) {
      if (team.id === userTeamId.value) continue
      if ((counts.get(team.id) ?? 0) < MIN_ROSTER_SIZE) short++
    }
    return short
  }

  async function addPoolPlayer() {
    // Authored FA markets are capped; only the imported-fantasy draft pool is
    // uncapped (it holds every player, 15 × teams and then some).
    if (!poolOnlyFantasy.value && freeAgents.value.length >= MAX_FA_POOL) return null
    const position = POSITIONS[freeAgents.value.length % POSITIONS.length]
    const player = generatePlayer({
      campaignId: campaignId.value,
      teamId: null,
      teamAbbreviation: 'FA',
      position,
      overall: 70,
    })
    freeAgents.value.push(player)
    faCount.value = freeAgents.value.length
    selectedId.value = player.id
    await PlayerRepository.save(cloneForPersist(player))
    _sync()
    return player
  }

  // Top the FA pool up to `target` with generated bench/role-grade players
  // (the finalize modal's "generate the rest" + the pool view's fill button).
  async function fillFreeAgentPool(target = MIN_FA_POOL) {
    await openPool()
    const added = []
    while (freeAgents.value.length + added.length < target) {
      const idx = freeAgents.value.length + added.length
      added.push(generatePlayer({
        campaignId: campaignId.value,
        teamId: null,
        teamAbbreviation: 'FA',
        position: POSITIONS[idx % POSITIONS.length],
        overall: 58 + Math.floor(Math.random() * 12), // 58–69 market grade
      }))
    }
    if (!added.length) return 0
    await PlayerRepository.saveBulk(added.map((p) => cloneForPersist(p)))
    freeAgents.value.push(...added)
    faCount.value = freeAgents.value.length
    _sync()
    return added.length
  }

  // How many FAs short of the minimum the pool is (0 for pool-only fantasy —
  // its pool has its own draft-size rule). Drives the finalize modal's
  // generate CTA.
  async function freeAgentShortfall() {
    if (poolOnlyFantasy.value) return 0
    const pool = (await PlayerRepository.getFreeAgents(campaignId.value))
      .filter((p) => !(p.isDraftProspect || p.is_draft_prospect))
    return Math.max(0, MIN_FA_POOL - pool.length)
  }

  async function removePlayer(player, fromPool = false) {
    await PlayerRepository.delete(campaignId.value, player.id)
    const list = fromPool ? freeAgents : activeRoster
    const i = list.value.findIndex((p) => p.id === player.id)
    if (i >= 0) list.value.splice(i, 1)
    if (fromPool) faCount.value = freeAgents.value.length
    _clearDirty(player.id)
    if (selectedId.value === player.id) {
      // Team view: drop back to the team header. Pool: keep a row selected
      // (there's no team header to fall back to).
      selectedId.value = fromPool ? (list.value[0]?.id ?? null) : null
    }
    _sync()
  }

  // Author draft-pick ownership: move picks between teams' draftPicks arrays
  // (mirrors the trade path's transfer mechanics — currentOwnerId both
  // casings + isTraded; original_team_abbreviation NEVER changes, it's the
  // "via X" credit and the draft-order slot key). Assignments:
  // [{ pickId, newOwnerId }]. Persists every touched team.
  async function reassignDraftPicks(assignments) {
    if (!Array.isArray(assignments) || !assignments.length) return 0
    const teamById = new Map(teams.value.map((t) => [t.id, t]))
    // Global pick locator — a pick lives on exactly one team's array.
    const locate = (pickId) => {
      for (const t of teams.value) {
        const idx = (t.draftPicks ?? []).findIndex((p) => p.id === pickId)
        if (idx >= 0) return { team: t, idx }
      }
      return null
    }
    const touched = new Set()
    let moved = 0
    for (const { pickId, newOwnerId } of assignments) {
      const loc = locate(pickId)
      const dest = teamById.get(newOwnerId)
      if (!loc || !dest || loc.team.id === newOwnerId) continue
      const [pick] = loc.team.draftPicks.splice(loc.idx, 1)
      pick.currentOwnerId = dest.id
      pick.current_owner_id = dest.id
      const traded = dest.id !== (pick.originalTeamId ?? pick.original_team_id)
      pick.isTraded = traded
      pick.is_traded = traded
      dest.draftPicks = dest.draftPicks ?? []
      dest.draftPicks.push(pick)
      touched.add(loc.team.id)
      touched.add(dest.id)
      moved++
    }
    for (const id of touched) {
      const t = teamById.get(id)
      if (t) await TeamRepository.save(cloneForPersist(t))
    }
    if (moved) _sync()
    return moved
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
    // Legacy shape: fantasy setups created before scratch/generated authored
    // full leagues hold ONLY a draft pool (every team roster empty). Let a
    // draft-ready pre-change pool still finalize; anything short of that
    // (including a fresh scratch with nothing authored) gets the standard
    // per-team guidance of the new interchangeable model.
    let legacyPoolOnly = false
    if (isFantasy.value && !poolOnlyFantasy.value) {
      const all = await PlayerRepository.getAllForCampaign(campaignId.value)
      const live = all.filter((p) => !(p.isDraftProspect || p.is_draft_prospect))
      const teamsEmpty = !live.some((p) => (p.teamId ?? p.team_id) != null)
      legacyPoolOnly = teamsEmpty && live.length >= teams.value.length * 15
    }
    if (poolOnlyFantasy.value || legacyPoolOnly) {
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
        // The 15-man cap the rest of the game assumes (signings, AI logic).
        // The Add Player UI already stops at 15; this catches oversized
        // rosters arriving via imported builds or any other edge path.
        if (roster.length > MAX_ROSTER_SIZE) {
          problems.push(`${team.abbreviation ?? team.name}: ${roster.length} players — over the ${MAX_ROSTER_SIZE}-man limit.`)
        }
        _validatePlayers(roster, problems, team.abbreviation ?? team.name)
      }
      // Authored FA market bounds — the pool must exist (signings, AI
      // backfill) without flooding the league.
      const pool = (await PlayerRepository.getFreeAgents(campaignId.value))
        .filter((p) => !(p.isDraftProspect || p.is_draft_prospect))
      if (pool.length < MIN_FA_POOL) {
        problems.push(`Free agents: only ${pool.length} in the pool (min ${MIN_FA_POOL}).`)
      }
      if (pool.length > MAX_FA_POOL) {
        problems.push(`Free agents: ${pool.length} in the pool — over the ${MAX_FA_POOL} limit.`)
      }
      _validatePlayers(pool, problems, 'Free agents')
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
    // Badge stack cap — learned badges plus cap-only rows both count. First
    // offender per group (matches the ceiling check) so imports of stacked
    // rosters don't flood the modal.
    for (const p of players) {
      const badgeCount = new Set([
        ...(p.badges ?? []).map((b) => b.id),
        ...Object.keys(p.badgeCaps ?? {}),
      ]).size
      if (badgeCount > MAX_PLAYER_BADGES) {
        const pName = p.name ?? (`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'A player')
        problems.push(`${label}: ${pName} has ${badgeCount} badges — max ${MAX_PLAYER_BADGES}.`)
        break
      }
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
          // Mandate follows the authored roster: the AI's direction bias
          // prefers team.effectiveExpectation over the static owner tier, so
          // a stacked "rebuild" franchise trades like the contender it is
          // from day one (and vice versa).
          freshTeam.effectiveExpectation = deriveExpectationTierFromRoster(teamPlayers)
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
          // Owner expectation re-derived from the FINAL authored roster,
          // replacing the static per-franchise seed from createCampaign.
          // Check-in, subtasks, GM evaluation, and the season ratchet all
          // read via getEffectiveExpectation and pick this up unchanged.
          const derived = deriveOwnerExpectationFromRoster(userPlayers)
          fresh.settings.ownerExpectation = derived
          if (fresh.settings.gmContract) {
            fresh.settings.gmContract.expectationTiers = [derived.tier]
          }
        }
      }

      fresh.rosterSetupCompleted = true
      fresh.roster_setup_completed = true
      // Authored data is authoritative — block the first-load legacy
      // migrations that would rewrite it. backfillInitialRookies stamps the
      // 60 youngest players with draftYear=currentSeasonYear +
      // careerSeasons=0 when it finds no current-year rookies, steamrolling
      // authored draft history. In a custom league, rookies are whoever the
      // author gave the current draft year to (ROY/All-Rookie follow that).
      fresh.settings = fresh.settings ?? {}
      fresh.settings.initialRookiesBackfilled = true
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
    faCount, fillFreeAgentPool, freeAgentShortfall,
    teamOveralls, refreshTeamOveralls, refreshTeams,
    loading, saving, error,
    isFantasy, poolOnlyFantasy, startMode, hasStarted, userTeamId, activeTeam,
    selectedId, selectedPlayer, dirtyIds, isDirty,
    select, markDirtyPlayer, saveDirty, discardDirty, refreshPlayerFromDb,
    load, chooseStart, openTeam, openPool, applyDownloadedBuild,
    addPlayer, addPoolPlayer, removePlayer, fillRoster, fillAllTeamRosters, countShortTeams,
    refreshDerived, savePlayer, saveTeamCoach, reassignDraftPicks,
    validate, finalize, $reset,
  }
})
