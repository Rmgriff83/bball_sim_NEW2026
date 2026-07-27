import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { useToastStore } from '@/stores/toast'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'

const SYNC_COOLDOWN_MS = 300000 // 5 minutes — minimum time between event-driven syncs
const PUSH_STAGGER_MS = 250 // pause between sequential part uploads so each request lands independently

// Each push is split into these parts; one HTTP request per part, each well under
// PHP's post_max_size. Push order matters: meta first creates the server-side
// campaign record that the player/season/headshot parts attach to.
const PUSH_PARTS = ['meta', 'players_user', 'players_ai', 'players_fa', 'seasons', 'headshots']

// The array field per part that can be split across batched requests. `meta`
// is deliberately absent — it's campaign + 30 teams, always small, and it's
// what creates the server-side campaign row so it must land whole.
const PART_ARRAY_FIELD = {
  players_user: 'players',
  players_ai: 'players',
  players_fa: 'players',
  seasons: 'seasons',
  headshots: 'headshots',
}

// Target ceiling for any single request body on the wire — safely under a
// 1MB proxy `client_max_body_size` (the strictest plausible limit).
const WIRE_BUDGET_BYTES = 900 * 1024
// The server rejects batch counts above 500 (and would then treat each chunk
// as a full-part write — corrupting). Never send more.
const MAX_BATCH_CHUNKS = 500

/**
 * gzip + base64 a string via the browser-native CompressionStream. Returns
 * null when the API is unavailable (WebView < 16.4) or anything throws —
 * callers fall back to plain JSON, which is exactly the legacy wire format.
 */
async function _gzipBase64(str) {
  try {
    if (typeof CompressionStream === 'undefined') return null
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    // btoa needs a binary string; build it in slices so multi-MB buffers
    // don't blow the fromCharCode argument limit.
    let bin = ''
    const SLICE = 0x8000
    for (let i = 0; i < bytes.length; i += SLICE) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE))
    }
    return btoa(bin)
  } catch {
    return null
  }
}

/**
 * Greedy-pack items into chunks whose serialized size stays under `budget`
 * bytes (a single oversized item still gets its own chunk). Returns [items]
 * untouched when everything fits in one.
 */
function _chunkArrayByBytes(items, budget) {
  const chunks = []
  let current = []
  let size = 0
  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1
    if (current.length > 0 && size + itemSize > budget) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += itemSize
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * POST one payload, gz-wrapped as `{gz: <base64>}` when compression is
 * available AND actually shrinks the body; otherwise the legacy plain JSON.
 */
async function _postWire(api, campaignId, payload, timeout) {
  const raw = JSON.stringify(payload)
  const b64 = await _gzipBase64(raw)
  const body = b64 && b64.length + 24 < raw.length ? { gz: b64 } : payload
  return api.post(`/api/sync/${campaignId}/push`, body, { timeout })
}

/**
 * Push one part, splitting its array field into `batch: {i, n}` requests when
 * it exceeds the current byte budget. On a 413 the budget halves (floor
 * 128KB) and the part restarts from chunk 0 — safe, because the server only
 * replaces the stored part on the final chunk and chunk 0 wipes temp state.
 * A part that still 413s (or overflows the server's batch cap) throws with
 * `err.tooLarge = true` so the caller can surface a size-specific message.
 */
async function _postPart(api, campaignId, part, payload) {
  const field = PART_ARRAY_FIELD[part]
  const timeout = part === 'headshots' ? 30000 : 20000
  const compressionAvailable = typeof CompressionStream !== 'undefined'
  // Compressed budgets can be generous: this JSON/SVG compresses ≥4x, which
  // comfortably covers base64's +33% too.
  let rawBudget = compressionAvailable ? 4 * WIRE_BUDGET_BYTES : WIRE_BUDGET_BYTES

  for (let attempt = 0; ; attempt++) {
    const chunks = field ? _chunkArrayByBytes(payload[field], rawBudget) : null
    if (chunks && chunks.length > MAX_BATCH_CHUNKS) {
      const err = new Error(`Sync part "${part}" exceeds the maximum upload size`)
      err.tooLarge = true
      err.part = part
      throw err
    }
    try {
      if (!chunks || chunks.length <= 1) {
        await _postWire(api, campaignId, payload, timeout)
      } else {
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, PUSH_STAGGER_MS))
          }
          await _postWire(api, campaignId, {
            part,
            batch: { i, n: chunks.length },
            [field]: chunks[i],
            clientUpdatedAt: payload.clientUpdatedAt,
          }, timeout)
        }
      }
      return
    } catch (err) {
      const is413 = err?.response?.status === 413
      if (is413 && field && attempt < 4 && rawBudget > 128 * 1024) {
        rawBudget = Math.max(128 * 1024, Math.floor(rawBudget / 2))
        continue
      }
      if (is413) {
        err.tooLarge = true
        err.part = part
      }
      throw err
    }
  }
}

export const useSyncStore = defineStore('sync', () => {
  // State
  const isSyncing = ref(false)
  const isPulling = ref(false)  // true while pullChanges is in flight (used for UI loaders)
  const lastSyncAt = ref(null)
  const isDirty = ref(false)
  const syncError = ref(null)
  const activeCampaignId = ref(null)
  const _lastEventSyncAt = ref(0) // timestamp of last event-driven sync
  const _visibilityHandler = ref(null)
  // Parts that still need to be pushed (failed or never attempted since last clean sync).
  // Lets a 413 on one part avoid re-pushing the parts that already succeeded.
  const _dirtyParts = ref(new Set(PUSH_PARTS))
  // Campaign ids known to not exist on the server yet (a pull 404'd). A brand-new
  // local campaign — e.g. during the live draft, before its first push — would
  // otherwise 404 on every visibility-focus pull and every fetchCampaign pull.
  // Cleared once a push creates the server row. Non-reactive (control flow only).
  const _serverMissing = new Set()

  // Getters
  const hasPendingChanges = computed(() => isDirty.value)

  const lastSyncText = computed(() => {
    if (!lastSyncAt.value) return 'Never synced'
    const date = new Date(lastSyncAt.value)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`

    return date.toLocaleDateString()
  })

  // Actions

  /**
   * Initialize sync state.
   * Simplified: just check if we have local data that might need syncing.
   */
  async function initFromCache() {
    // No granular dirty tracking to restore; isDirty starts false
    // and gets set whenever a write happens via markDirty()
  }

  /**
   * Set the active campaign for syncing.
   */
  function setActiveCampaign(campaignId) {
    activeCampaignId.value = campaignId
  }

  /**
   * Mark data as dirty (needs sync). Re-arms the full push part set because a
   * new local edit could touch any of campaign meta / players / seasons and
   * we don't track which slice changed.
   */
  async function markDirty(_key) {
    isDirty.value = true
    _dirtyParts.value = new Set(PUSH_PARTS)
  }

  /**
   * Clear dirty flag after successful sync.
   */
  async function clearDirty(_key) {
    isDirty.value = false
    _dirtyParts.value = new Set()
  }

  /**
   * Register event-driven sync triggers. No background interval — pushes now
   * happen on route-leave, visibility-hidden, app-close, sign-out, and the
   * profile-page "Save to Cloud" button.
   */
  function startAutoSync() {
    if (_visibilityHandler.value) return

    // Sync on visibility change:
    //   - HIDDEN: push if dirty (catches tab-close / app-background scenarios).
    //   - VISIBLE: pull from cloud. Catches the cross-device scenario where
    //     the user took an action on another device while this tab was
    //     backgrounded — without this pull, the in-memory stores keep showing
    //     stale state (e.g. "training reward ready to claim") and clicking
    //     fails with "No active training for this player" because the
    //     IndexedDB write from the other device's claim hasn't propagated.
    _visibilityHandler.value = async () => {
      if (document.hidden) {
        if (activeCampaignId.value && hasPendingChanges.value && !isSyncing.value) {
          syncNow()
        }
      } else if (activeCampaignId.value && !isPulling.value && !isSyncing.value) {
        // Tab regained focus. Pull cloud state silently — failures here are
        // non-fatal (offline, transient API error). On success the team/
        // player stores hydrate from the freshly-written IndexedDB so any
        // claim/action buttons reflect the actual current state.
        try {
          await pullChanges(activeCampaignId.value)
          // Re-hydrate the team store's reactive refs from the freshly-
          // updated IndexedDB. Without this, UI keeps rendering from the
          // memory snapshot loaded at original page mount.
          try {
            const { useTeamStore } = await import('@/stores/team')
            const teamStore = useTeamStore()
            await teamStore.fetchTeam(activeCampaignId.value, { force: true })
          } catch (refreshErr) {
            console.warn('[Sync] Team store refresh after visibility pull failed:', refreshErr)
          }
        } catch (pullErr) {
          // Silent — pull-on-focus is best-effort.
          console.warn('[Sync] Pull on visibility-visible failed:', pullErr?.message ?? pullErr)
        }
      }
    }
    document.addEventListener('visibilitychange', _visibilityHandler.value)
  }

  /**
   * Tear down event listeners. (Kept for symmetry / future use; not called today.)
   */
  function stopAutoSync() {
    if (_visibilityHandler.value) {
      document.removeEventListener('visibilitychange', _visibilityHandler.value)
      _visibilityHandler.value = null
    }
  }

  /**
   * Sync triggered by campaign route leave.
   * Respects the 5-minute cooldown.
   */
  function syncOnRouteLeave() {
    if (activeCampaignId.value && hasPendingChanges.value) {
      _eventDrivenSync()
    }
  }

  /**
   * Event-driven sync with 5-minute cooldown to avoid rapid-fire syncs.
   */
  async function _eventDrivenSync() {
    const now = Date.now()
    if (now - _lastEventSyncAt.value < SYNC_COOLDOWN_MS) return
    _lastEventSyncAt.value = now
    await syncNow()
  }

  /**
   * Serialize full campaign state from IndexedDB into a single payload.
   * Strips duplicate keys and heavy data to keep the snapshot under server limits.
   * Local IndexedDB retains full-fidelity data.
   */
  async function _serializeCampaignSnapshot(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    const teams = await TeamRepository.getAllForCampaign(campaignId)
    const players = await PlayerRepository.getAllForCampaign(campaignId)
    const seasons = await SeasonRepository.getAllForCampaign(campaignId)
    const headshots = await PlayerHeadshotRepository.getAllByCampaign(campaignId)

    // Historical seasons (anything older than the campaign's current season
    // year) are reduced to a minimal record-and-awards shell. The schedule
    // alone runs ~120 KB per past season and dominated the seasons chunk —
    // by season 3 the payload was tripping upstream proxies' 413 limits.
    // The strip needs the current-season year to make that distinction.
    const currentSeasonYear = campaign?.currentSeasonYear
      ?? campaign?.settings?.currentSeasonYear
      ?? null

    return {
      campaign,
      teams: teams.map(_stripTeamForSync),
      players: players.map(_stripPlayerForSync),
      seasons: seasons.map(s => _stripSeasonForSync(s, currentSeasonYear)),
      headshots,
      clientUpdatedAt: new Date().toISOString(),
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot size reduction helpers
  // -------------------------------------------------------------------------
  // Players have dual camelCase/snake_case keys (both serialized by JSON.stringify
  // even though they reference the same data in memory). Arrays like
  // development_history (up to 200 entries × 530 players × 2 copies) can push
  // the snapshot well over 20 MB. These helpers strip duplicates and trim heavy
  // arrays so the sync payload stays lean while IndexedDB keeps full fidelity.

  /** Keys to drop from player objects for sync (camelCase duplicates of snake_case). */
  const PLAYER_DROP_KEYS = [
    // Duplicate identity fields (keep snake_case)
    'firstName', 'lastName', 'secondaryPosition', 'jerseyNumber',
    'heightInches', 'weightLbs',
    // Duplicate rating fields
    'overallRating', 'potentialRating',
    // Duplicate contract fields
    'contractYearsRemaining', 'contractSalary', 'contractDetails',
    // Duplicate status fields
    'isInjured', 'injuryDetails',
    // Duplicate evolution fields (arrays — biggest savings)
    'developmentHistory', 'recentPerformances',
    'streakData', 'upgradePoints',
    'gamesPlayedThisSeason', 'minutesPlayedThisSeason', 'careerSeasons',
    // Duplicate award fields
    'allStarSelections', 'mvpAwards', 'finalsMvpAwards',
    'rookieOfTheYear', 'allNbaSelections', 'allNbaFirstTeam', 'allRookieTeam', 'allDefensiveTeam',
    // Duplicate misc
    'birthDate', 'wingspanInches', 'tradeValueTotal',
  ]

  function _stripPlayerForSync(player) {
    const slim = { ...player }

    // Remove camelCase duplicates
    for (const key of PLAYER_DROP_KEYS) {
      delete slim[key]
    }

    // Trim development_history to last 20 entries (from up to 200)
    if (Array.isArray(slim.development_history) && slim.development_history.length > 20) {
      slim.development_history = slim.development_history.slice(-20)
    }

    // Trim recent_performances to last 5 (from up to 10)
    if (Array.isArray(slim.recent_performances) && slim.recent_performances.length > 5) {
      slim.recent_performances = slim.recent_performances.slice(-5)
    }

    // Compact seasonHistory entries from cumulative totals to averaged per-game
    // stats — by season 3+ the raw form (530 players × ~350B × N seasons)
    // dominated the players chunk and pushed sync past PHP's post_max_size.
    if (Array.isArray(slim.seasonHistory)) {
      slim.seasonHistory = slim.seasonHistory.map(_compactSeasonHistoryEntry)
    }

    return slim
  }

  function _compactSeasonHistoryEntry(entry) {
    if (!entry) return entry
    if (entry._compact) return entry  // already compacted from a prior sync cycle
    const stats = entry.stats || {}
    const gp = stats.gamesPlayed ?? 0
    if (gp <= 0) {
      return {
        _compact: true,
        year: entry.year,
        teamId: entry.teamId,
        teamAbbreviation: entry.teamAbbreviation,
        gamesPlayed: 0,
        seasonHighs: entry.seasonHighs ?? {},
      }
    }

    const fga = stats.fieldGoalsAttempted ?? 0
    const fgm = stats.fieldGoalsMade ?? 0
    const tpa = stats.threePointersAttempted ?? 0
    const tpm = stats.threePointersMade ?? 0
    const fta = stats.freeThrowsAttempted ?? 0
    const ftm = stats.freeThrowsMade ?? 0
    const round1 = (n) => Math.round(n * 10) / 10

    return {
      _compact: true,
      year: entry.year,
      teamId: entry.teamId,
      teamAbbreviation: entry.teamAbbreviation,
      gamesPlayed: gp,
      ppg: round1((stats.points ?? 0) / gp),
      rpg: round1((stats.rebounds ?? 0) / gp),
      apg: round1((stats.assists ?? 0) / gp),
      spg: round1((stats.steals ?? 0) / gp),
      bpg: round1((stats.blocks ?? 0) / gp),
      topg: round1((stats.turnovers ?? 0) / gp),
      mpg: round1((stats.minutesPlayed ?? 0) / gp),
      fgPct: fga > 0 ? round1((fgm / fga) * 100) : 0,
      threePct: tpa > 0 ? round1((tpm / tpa) * 100) : 0,
      ftPct: fta > 0 ? round1((ftm / fta) * 100) : 0,
      // Preserve the season's single-game highs through sync compaction (tiny).
      seasonHighs: entry.seasonHighs ?? {},
    }
  }

  function _stripTeamForSync(team) {
    const slim = { ...team }
    // Note: draftPicks are KEPT in the sync payload. They were previously
    // stripped here under the assumption they could be regenerated, but no
    // pull-side regeneration ever existed — so any team that round-tripped
    // through the cloud came back with `draftPicks: undefined` and the
    // trade wizard saw zero picks for everyone. ~120KB across the league
    // is well within the per-chunk size budget.
    return slim
  }

  /**
   * Convert a season's `playerStats` map from cumulative totals into per-game
   * averages + shooting percentages. Used only for completed seasons in the
   * sync payload — the current season keeps raw totals so live UIs that divide
   * by gamesPlayed continue to work without a code path change.
   */
  function _compactPlayerStats(playerStats) {
    const compact = {}
    for (const [pid, stats] of Object.entries(playerStats)) {
      const gp = stats.gamesPlayed ?? stats.games_played ?? 0
      if (gp <= 0) continue

      const fga = stats.fga ?? stats.fieldGoalsAttempted ?? 0
      const fgm = stats.fgm ?? stats.fieldGoalsMade ?? 0
      const tpa = stats.tpa ?? stats.fg3a ?? stats.threePointersAttempted ?? 0
      const tpm = stats.tpm ?? stats.fg3m ?? stats.threePointersMade ?? 0
      const fta = stats.fta ?? stats.freeThrowsAttempted ?? 0
      const ftm = stats.ftm ?? stats.freeThrowsMade ?? 0

      const round1 = (n) => Math.round(n * 10) / 10

      compact[pid] = {
        _compact: true,
        playerId: stats.playerId ?? pid,
        playerName: stats.playerName ?? stats.player_name ?? '',
        teamId: stats.teamId ?? null,
        teamAbbreviation: stats.teamAbbreviation ?? stats.team_abbreviation ?? '',
        position: stats.position ?? '',
        gamesPlayed: gp,
        ppg: round1((stats.points ?? 0) / gp),
        rpg: round1((stats.rebounds ?? 0) / gp),
        apg: round1((stats.assists ?? 0) / gp),
        spg: round1((stats.steals ?? 0) / gp),
        bpg: round1((stats.blocks ?? 0) / gp),
        topg: round1((stats.turnovers ?? 0) / gp),
        mpg: round1((stats.minutesPlayed ?? 0) / gp),
        fgPct: fga > 0 ? round1((fgm / fga) * 100) : 0,
        threePct: tpa > 0 ? round1((tpm / tpa) * 100) : 0,
        ftPct: fta > 0 ? round1((ftm / fta) * 100) : 0,
      }
    }
    return compact
  }

  /**
   * Strip season data for sync.
   * Completed (past) seasons: drop the schedule, and compact the per-player
   * `playerStats` map from raw cumulative totals to averaged per-game stats
   * (PPG/RPG/APG/SPG/BPG/MPG + shooting percentages). Roughly 5x smaller per
   * entry — by season 3 the raw totals form pushed the JSON past PHP's default
   * `post_max_size` and sync 413'd. Compact form preserves historical leader
   * displays cross-device.
   * Current season: keep raw `playerStats` + stripped schedule so live league-
   * leader / rookie-ranking UIs (which divide totals by gamesPlayed) still work.
   * Compact entries carry `_compact: true` so consumers can branch on shape.
   */
  function _stripSeasonForSync(season, currentSeasonYear = null) {
    const slim = { ...season }
    const seasonYear = slim.year ?? slim.metadata?.year ?? null

    // A season is historical when its year is strictly less than the current
    // season year. Phase / isComplete flags are only set on the campaign,
    // not the season record, so the year comparison is the reliable signal.
    // Fall back to the legacy phase/isComplete check when we don't know
    // currentSeasonYear (defensive — newer callers always provide it).
    const isHistorical = currentSeasonYear != null && seasonYear != null
      ? seasonYear < currentSeasonYear
      : (slim.phase === 'offseason'
        || slim.phase === 'offseason_free_agency'
        || slim.phase === 'offseason_draft'
        || slim.isComplete
        || slim.is_complete)

    if (isHistorical) {
      // Historical seasons retain only what surfaces in archive UIs:
      //   - standings (regular-season record per team)
      //   - seasonAwards (MVP / Rookie of the Year / All-NBA / etc.)
      //   - allStarRosters (cosmetic but tiny and useful for retrospectives)
      //   - playoffs.champion + playoff record summary (no per-game detail)
      //   - metadata (year, ids, timestamps)
      //
      // Everything else — schedule, playerStats, teamStats, news, trades,
      // playoff bracket games, savedGameState — is dropped. The schedule
      // alone runs ~120 KB per season and was the main 413 offender.
      // Per-player and per-team season summaries already live on the
      // player/team records (`seasonHistory`, `awards`), so dropping these
      // doesn't lose anything user-visible.
      // Canonical playoff data lives on `season.playoffBracket` (not
      // `season.playoffs`). Keep a compact summary: champion, Finals MVP,
      // both conference winners + their Conference Finals MVPs. Drops the
      // per-round series arrays (the heavyweight part of the bracket).
      const bracket = slim.playoffBracket
      const playoffBracketSummary = bracket
        ? {
            champion: bracket.champion ?? null,
            finalsMVP: bracket.finalsMVP ?? null,
            east: bracket.east
              ? {
                  confChampion: bracket.east.confFinals?.winner ?? null,
                  confFinalsMVP: bracket.east.confFinalsMVP ?? null,
                }
              : null,
            west: bracket.west
              ? {
                  confChampion: bracket.west.confFinals?.winner ?? null,
                  confFinalsMVP: bracket.west.confFinalsMVP ?? null,
                }
              : null,
          }
        : null

      return {
        campaignId: slim.campaignId,
        year: seasonYear,
        metadata: slim.metadata,
        standings: slim.standings,
        seasonAwards: slim.seasonAwards ?? null,
        allStarRosters: slim.allStarRosters ?? null,
        playoffBracket: playoffBracketSummary,
        updatedAt: slim.updatedAt,
        _historical: true,
      }
    }

    // Current season: compact completed games' box scores and preserve
    // savedGameState for any game still in progress so cross-device play
    // can resume mid-game. Drop the per-game evolution blob — it's
    // regenerated post-game by simToEnd / continueGame.
    if (Array.isArray(slim.schedule)) {
      slim.schedule = slim.schedule.map(game => {
        const g = { ...game }
        delete g.evolution

        if (g.isComplete) {
          delete g.savedGameState
          if (g.boxScore) {
            g.boxScore = _compactBoxScore(g.boxScore)
          }
        }

        return g
      })
    }

    return slim
  }

  /**
   * Given a list of remote records and local records, return the subset of
   * remote records that should overwrite their local counterparts:
   *  - record exists remotely but not locally → take remote
   *  - record exists in both AND remote.updatedAt > local.updatedAt → take remote
   *  - otherwise → keep local (don't include in the result)
   *
   * This is the per-record analogue of the per-season comparison in pullChanges,
   * so a partial sync that leaves stale entries in the cloud can't clobber newer
   * local edits, but legitimate cross-device updates still flow through.
   */
  function _pickNewerRecords(remoteRecords, localRecords, getId) {
    const localById = new Map((localRecords || []).map(r => [getId(r), r]))
    const out = []
    for (const remote of remoteRecords) {
      const local = localById.get(getId(remote))
      if (!local) {
        out.push(remote)
        continue
      }
      const remoteAt = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0
      const localAt = local.updatedAt ? new Date(local.updatedAt).getTime() : 0
      if (remoteAt > localAt) {
        out.push(remote)
      }
    }
    return out
  }

  function _compactBoxScore(boxScore) {
    const compact = {}
    for (const side of ['home', 'away']) {
      compact[side] = (boxScore[side] ?? []).map(p => ({
        player_id: p.player_id ?? p.playerId ?? null,
        name: p.name ?? 'Unknown',
        points: p.points ?? 0,
        rebounds: p.rebounds ?? 0,
        assists: p.assists ?? 0,
        minutes: p.minutes ?? 0,
      }))
    }
    return compact
  }

  /**
   * Rebuild camelCase keys from snake_case when restoring from a stripped snapshot.
   * Ensures restored players have the same shape as locally-created ones.
   */
  function _hydratePlayerKeys(player) {
    const p = { ...player }

    // Identity
    if (p.first_name && !p.firstName) p.firstName = p.first_name
    if (p.last_name && !p.lastName) p.lastName = p.last_name
    if (p.secondary_position !== undefined && !p.secondaryPosition) p.secondaryPosition = p.secondary_position
    if (p.jersey_number !== undefined && !p.jerseyNumber) p.jerseyNumber = p.jersey_number
    if (p.height_inches !== undefined && !p.heightInches) p.heightInches = p.height_inches
    if (p.weight_lbs !== undefined && !p.weightLbs) p.weightLbs = p.weight_lbs
    if (p.birth_date && !p.birthDate) p.birthDate = p.birth_date

    // Ratings
    if (p.overall_rating !== undefined && !p.overallRating) p.overallRating = p.overall_rating
    if (p.potential_rating !== undefined && !p.potentialRating) p.potentialRating = p.potential_rating

    // Contract
    if (p.contract_years_remaining !== undefined && p.contractYearsRemaining === undefined) p.contractYearsRemaining = p.contract_years_remaining
    if (p.contract_salary !== undefined && p.contractSalary === undefined) p.contractSalary = p.contract_salary
    if (p.contract_details && !p.contractDetails) p.contractDetails = p.contract_details

    // Status
    if (p.is_injured !== undefined && p.isInjured === undefined) p.isInjured = p.is_injured
    if (p.injury_details !== undefined && !p.injuryDetails) p.injuryDetails = p.injury_details

    // Evolution
    if (p.development_history && !p.developmentHistory) p.developmentHistory = p.development_history
    if (p.recent_performances && !p.recentPerformances) p.recentPerformances = p.recent_performances
    if (p.streak_data !== undefined && p.streakData === undefined) p.streakData = p.streak_data
    if (p.upgrade_points !== undefined && p.upgradePoints === undefined) p.upgradePoints = p.upgrade_points
    if (p.games_played_this_season !== undefined && p.gamesPlayedThisSeason === undefined) p.gamesPlayedThisSeason = p.games_played_this_season
    if (p.minutes_played_this_season !== undefined && p.minutesPlayedThisSeason === undefined) p.minutesPlayedThisSeason = p.minutes_played_this_season
    if (p.career_seasons !== undefined && p.careerSeasons === undefined) p.careerSeasons = p.career_seasons

    // Awards
    if (p.all_star_selections !== undefined && p.allStarSelections === undefined) p.allStarSelections = p.all_star_selections
    if (p.mvp_awards !== undefined && p.mvpAwards === undefined) p.mvpAwards = p.mvp_awards
    if (p.finals_mvp_awards !== undefined && p.finalsMvpAwards === undefined) p.finalsMvpAwards = p.finals_mvp_awards
    if (p.rookie_of_the_year !== undefined && p.rookieOfTheYear === undefined) p.rookieOfTheYear = p.rookie_of_the_year
    if (p.all_nba_selections !== undefined && p.allNbaSelections === undefined) p.allNbaSelections = p.all_nba_selections
    if (p.all_nba_first_team !== undefined && p.allNbaFirstTeam === undefined) p.allNbaFirstTeam = p.all_nba_first_team
    if (p.all_rookie_team !== undefined && p.allRookieTeam === undefined) p.allRookieTeam = p.all_rookie_team
    if (p.all_defensive_team !== undefined && p.allDefensiveTeam === undefined) p.allDefensiveTeam = p.all_defensive_team

    return p
  }

  /**
   * Trigger immediate sync (for "Save to Cloud" button).
   * Serializes the full campaign snapshot and pushes to server in chunks.
   */
  async function syncNow() {
    if (!activeCampaignId.value) return
    if (isSyncing.value) return

    const toastStore = useToastStore()

    try {
      isSyncing.value = true
      syncError.value = null

      // Push snapshot in chunks to cloud
      await pushChanges(activeCampaignId.value)

      // All parts uploaded successfully — clean state.
      lastSyncAt.value = new Date().toISOString()
      isDirty.value = false
      _dirtyParts.value = new Set()

      toastStore.showSuccess('Saved to cloud', 2000)
    } catch (err) {
      syncError.value = err.message || 'Sync failed'
      if (err.tooLargeParts && err.tooLargeParts.length > 0) {
        // Size-specific: retrying the identical payload can't succeed, so
        // don't pretend it will. Local data is untouched either way.
        toastStore.showError(`Cloud save failed: "${err.tooLargeParts.join(', ')}" is too large for the server — your data is safe on this device`, 5000)
      } else if (err.failedParts && err.failedParts.length > 0) {
        const total = PUSH_PARTS.length
        toastStore.showError(`Sync partial: ${err.failedParts.length} of ${total} files failed - will retry`, 3500)
      } else {
        toastStore.showError('Sync failed - will retry', 3000)
      }
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Split players into three buckets:
   *   - user: players on the user's controlled team
   *   - ai:   players on the other 29 AI teams
   *   - fa:   free agents / retired (no team)
   * Done so each player file is small enough to stay well under PHP's
   * post_max_size; the `players_ai` chunk is what kept tripping the 413.
   */
  function _partitionPlayers(players, userTeamId) {
    const user = []
    const ai = []
    const fa = []
    for (const p of players) {
      const teamId = p.team_id ?? p.teamId ?? null
      if (!teamId) {
        fa.push(p)
      } else if (userTeamId != null && teamId === userTeamId) {
        user.push(p)
      } else {
        ai.push(p)
      }
    }
    return { user, ai, fa }
  }

  /**
   * Push campaign snapshot to the server in sequential, staggered requests:
   * meta, players_user, players_ai, players_fa, seasons, headshots. Each part
   * is its own HTTP POST so any single one staying under post_max_size keeps
   * the whole sync working. Failed parts stay in `_dirtyParts` so the next
   * push only retries the parts that didn't land.
   */
  async function pushChanges(campaignId, opts = {}) {
    const snapshot = await _serializeCampaignSnapshot(campaignId)

    // A missing local campaign must FAIL the push, not silently succeed —
    // otherwise syncNow clears isDirty/lastSyncAt for a push that never
    // happened and the data looks safely synced when it isn't.
    if (!snapshot.campaign) {
      throw new Error(`Cannot push: campaign ${campaignId} not found locally`)
    }

    const userTeamId = snapshot.campaign.teamId
      ?? snapshot.campaign.userTeamId
      ?? snapshot.campaign.team_id
      ?? snapshot.campaign.user_team_id
      ?? null

    const { user: playersUser, ai: playersAi, fa: playersFa } = _partitionPlayers(snapshot.players, userTeamId)

    // Anything not yet known to be clean must be (re-)pushed. New uploads
    // start with the full set dirty; partial-failure retries push only the
    // parts that previously failed.
    //
    // opts.isolated: recovery pushes for a NON-active campaign (e.g.
    // fetchCampaigns pushing a never-synced local campaign) use their own
    // full part set so they don't clobber the active campaign's retry
    // tracking in the shared `_dirtyParts`.
    let partsSet
    if (opts.isolated) {
      partsSet = new Set(PUSH_PARTS)
    } else {
      if (_dirtyParts.value.size === 0) {
        _dirtyParts.value = new Set(PUSH_PARTS)
      }
      partsSet = _dirtyParts.value
    }

    const payloads = {
      meta: {
        part: 'meta',
        campaign: snapshot.campaign,
        teams: snapshot.teams,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
      players_user: {
        part: 'players_user',
        players: playersUser,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
      players_ai: {
        part: 'players_ai',
        players: playersAi,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
      players_fa: {
        part: 'players_fa',
        players: playersFa,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
      seasons: {
        part: 'seasons',
        seasons: snapshot.seasons,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
      headshots: {
        part: 'headshots',
        headshots: snapshot.headshots,
        clientUpdatedAt: snapshot.clientUpdatedAt,
      },
    }

    const failed = []
    const tooLargeParts = []
    let first = true
    // meta must succeed before any other part on a brand-new campaign (server
    // creates the Campaign row on the meta push), so we always lead with it
    // when it's dirty. PUSH_PARTS order already starts with meta.
    const order = PUSH_PARTS.filter(p => {
      if (!partsSet.has(p)) return false
      // Skip an empty headshots payload — the backend's entitlement gate
      // 403s unentitled users, but there's also nothing to write either way
      // when no player has been customized. Mark clean so we don't retry.
      if (p === 'headshots' && (!snapshot.headshots || snapshot.headshots.length === 0)) {
        partsSet.delete(p)
        return false
      }
      return true
    })

    for (const part of order) {
      if (!first) {
        await new Promise(resolve => setTimeout(resolve, PUSH_STAGGER_MS))
      }
      first = false
      try {
        await _postPart(api, campaignId, part, payloads[part])
        partsSet.delete(part)
        // A successful push means the server row now exists — re-enable pulls.
        _serverMissing.delete(campaignId)
      } catch (err) {
        // Headshots are gated by the server-side feature unlock — a 403 here
        // just means the user hasn't (yet) had the entitlement webhook
        // fulfilled. Skip cleanly so we don't keep retrying every route-leave.
        const status = err?.response?.status
        if (part === 'headshots' && status === 403) {
          partsSet.delete(part)
          continue
        }
        failed.push(part)
        if (err?.tooLarge) tooLargeParts.push(part)
        // If meta failed on a fresh push, the other player/season requests
        // will 404 ("Campaign not found"). Skip them this cycle.
        if (part === 'meta') {
          break
        }
      }
    }

    if (failed.length > 0) {
      const err = new Error(`Sync partial: ${failed.length} of ${order.length} parts failed`)
      err.failedParts = failed
      err.tooLargeParts = tooLargeParts
      throw err
    }
  }

  /**
   * Pull latest data from the server and hydrate IndexedDB.
   * Compares remote clientUpdatedAt vs local updatedAt — remote wins if newer.
   */
  async function pullChanges(campaignId) {
    if (!campaignId) return null
    // Skip campaigns we already know aren't on the server yet (unsynced local
    // campaigns, e.g. a fresh fantasy draft). Avoids repeated 404s until the
    // first push lands and clears this flag.
    if (_serverMissing.has(campaignId)) return null
    isPulling.value = true
    try {
      return await _pullChangesInner(campaignId)
    } catch (err) {
      if (err?.response?.status === 404) {
        // No server row yet — remember and stop pulling until a push creates it.
        _serverMissing.add(campaignId)
        return null
      }
      throw err
    } finally {
      isPulling.value = false
    }
  }

  /**
   * Fetch the campaign snapshot, preferring chunked part pulls
   * (?part=meta|players_user|...). Each part response is small and the
   * server streams the stored JSON verbatim — this avoids the server-side
   * OOM that made big-campaign pulls 500 (and restores silently fail), and
   * keeps individual responses mobile-network friendly.
   *
   * Fallbacks:
   *  - Old server (ignores ?part → returns the full combined snapshot):
   *    detected by the full-snapshot shape and returned as-is.
   *  - Legacy campaign with only snapshot.json (?part=meta → 404
   *    "Part not available"): retried as a combined pull.
   * "Campaign not found" 404s propagate to the caller (drives _serverMissing).
   */
  async function _fetchSnapshot(campaignId) {
    const get = (params, timeout) => api.get(
      `/api/sync/${campaignId}/pull`,
      { skipErrorToast: true, timeout: timeout ?? 30000, ...(params ? { params } : {}) }
    )
    const isFullSnapshot = (d) => !!d && !!d.campaign
      && (Array.isArray(d.players) || Array.isArray(d.seasons))

    let meta
    try {
      const res = await get({ part: 'meta' })
      meta = res.data
    } catch (err) {
      if (err?.response?.status === 404 && err.response?.data?.message === 'Part not available') {
        // Legacy snapshot-only campaign — combined pull (bigger, longer timeout).
        const res = await get(null, 45000)
        return res.data
      }
      throw err
    }

    // Old server ignored ?part and sent the whole snapshot.
    if (isFullSnapshot(meta)) return meta

    const data = {
      campaign: meta?.campaign ?? null,
      teams: meta?.teams ?? [],
      clientUpdatedAt: meta?.clientUpdatedAt ?? null,
      players: [],
      seasons: [],
      headshots: [],
    }

    // Players: split parts, falling back to the legacy single 'players' part.
    let haveSplit = true
    for (const part of ['players_user', 'players_ai', 'players_fa']) {
      try {
        const res = await get({ part })
        if (isFullSnapshot(res.data)) return res.data
        if (Array.isArray(res.data?.players)) data.players.push(...res.data.players)
      } catch (err) {
        if (err?.response?.status === 404) { haveSplit = false; break }
        throw err
      }
    }
    if (!haveSplit) {
      data.players = []
      try {
        const res = await get({ part: 'players' })
        if (Array.isArray(res.data?.players)) data.players = res.data.players
      } catch (err) {
        if (err?.response?.status !== 404) throw err
      }
    }

    try {
      const res = await get({ part: 'seasons' })
      if (Array.isArray(res.data?.seasons)) data.seasons = res.data.seasons
    } catch (err) {
      if (err?.response?.status !== 404) throw err
    }

    try {
      const res = await get({ part: 'headshots' })
      if (Array.isArray(res.data?.headshots)) data.headshots = res.data.headshots
    } catch (err) {
      if (err?.response?.status !== 404) throw err
    }

    return data
  }

  async function _pullChangesInner(campaignId) {
    // Suppress the global error toast — callers already handle pull failures
    // gracefully (e.g. a freshly-created campaign 404s here until its first
    // push lands), so the user shouldn't see a "Campaign not found" toast.
    const data = await _fetchSnapshot(campaignId)

    const remoteUpdatedAt = data.clientUpdatedAt ? new Date(data.clientUpdatedAt).getTime() : 0

    // Helper: returns true if remote is newer than local
    function remoteIsNewer(localUpdatedAt) {
      if (!localUpdatedAt) return true
      const localTime = new Date(localUpdatedAt).getTime()
      return remoteUpdatedAt > localTime
    }

    // Hydrate IndexedDB from remote snapshot
    let usedRemote = false

    if (data.campaign) {
      const localCampaign = await CampaignRepository.get(campaignId)
      if (!localCampaign || remoteIsNewer(localCampaign.updatedAt)) {
        await CampaignRepository.saveFromRemote(data.campaign)
        usedRemote = true
        console.log('[Sync] Using remote campaign data (newer or no local)')
      } else {
        console.log('[Sync] Local campaign data is newer, keeping local')
      }
    }

    // Teams/players/seasons are pushed in independent chunks, so a partial sync
    // can leave the server with a fresh meta `clientUpdatedAt` paired with stale
    // teams/players/seasons. Compare each resource against its own local state
    // rather than cascading from the campaign-level `usedRemote` flag.

    if (data.teams && Array.isArray(data.teams) && data.teams.length > 0) {
      const localTeams = await TeamRepository.getAllForCampaign(campaignId)
      const teamsToWrite = _pickNewerRecords(data.teams, localTeams, t => t.id)
      if (teamsToWrite.length > 0) {
        await TeamRepository.saveBulkFromRemote(teamsToWrite)
        console.log(`[Sync] Updating ${teamsToWrite.length} teams from remote`)
      } else {
        console.log('[Sync] All local teams are up to date')
      }
    }

    // Recovery: campaigns synced before the strip-draftPicks fix have teams
    // in IndexedDB with `draftPicks` undefined or empty. Regenerate the
    // standard 5-year initial pick set (rounds 1 & 2) for any team that's
    // missing them so the trade wizard, draft order, and AI evaluators all
    // work. Picks already moved by trades aren't recoverable this way, but
    // a campaign that's never run a draft yet recovers cleanly.
    try {
      const campaignAfter = data.campaign
        ? data.campaign
        : await CampaignRepository.get(campaignId)
      const startGameYear = campaignAfter?.gameYear ?? 1
      const teamsAfter = await TeamRepository.getAllForCampaign(campaignId)
      const toRegenerate = teamsAfter.filter(t => !Array.isArray(t.draftPicks) || t.draftPicks.length === 0)
      if (toRegenerate.length > 0) {
        for (const team of toRegenerate) {
          const picks = []
          for (let yearOffset = 0; yearOffset < 5; yearOffset++) {
            const draftYear = startGameYear + yearOffset
            for (const round of [1, 2]) {
              picks.push({
                id: `${team.id}-${draftYear}-r${round}-recovered-${Math.random().toString(36).slice(2, 8)}`,
                campaignId,
                originalTeamId: team.id,
                currentOwnerId: team.id,
                original_team_abbreviation: team.abbreviation,
                year: draftYear,
                round,
                pick_number: null,
                projected_position: null,
                isTraded: false,
                display_name: `${draftYear} Round ${round} (${team.abbreviation})`,
                trade_value: round === 1 ? 5 : 0.5,
              })
            }
          }
          team.draftPicks = picks
        }
        await TeamRepository.saveBulk(toRegenerate)
        console.log(`[Sync] Regenerated draft picks for ${toRegenerate.length} teams (recovery)`)
      }
    } catch (regenErr) {
      console.warn('[Sync] Draft-pick regeneration recovery failed:', regenErr)
    }

    if (data.players && Array.isArray(data.players) && data.players.length > 0) {
      const localPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const playersToWrite = _pickNewerRecords(data.players, localPlayers, p => p.id)
      if (playersToWrite.length > 0) {
        const hydrated = playersToWrite.map(_hydratePlayerKeys)
        await PlayerRepository.saveBulkFromRemote(hydrated)
        console.log(`[Sync] Updating ${playersToWrite.length} players from remote`)
      } else {
        console.log('[Sync] All local players are up to date')
      }
    }

    if (data.headshots && Array.isArray(data.headshots) && data.headshots.length > 0) {
      const localHeadshots = await PlayerHeadshotRepository.getAllByCampaign(campaignId)
      const headshotsToWrite = _pickNewerRecords(
        data.headshots,
        localHeadshots,
        h => `${h.campaignId}:${h.playerId}`
      )
      if (headshotsToWrite.length > 0) {
        await PlayerHeadshotRepository.saveBulkFromRemote(headshotsToWrite)
        console.log(`[Sync] Updating ${headshotsToWrite.length} custom headshots from remote`)
      } else {
        console.log('[Sync] All local headshots are up to date')
      }
    }

    if (data.seasons && Array.isArray(data.seasons)) {
      for (const season of data.seasons) {
        const year = season.metadata?.year ?? season.year
        if (!year) continue
        const localSeason = await SeasonRepository.get(campaignId, year)
        const remoteSeasonUpdatedAt = season.updatedAt ?? season.metadata?.updatedAt ?? null
        const localSeasonUpdatedAt = localSeason?.updatedAt ?? localSeason?.metadata?.updatedAt ?? null
        // Treat a missing timestamp on either side as 0 — if local has no
        // `updatedAt` to defend with, remote wins; if remote is untimestamped,
        // local stays. The previous form returned `false` whenever EITHER
        // side was missing, which silently rejected legitimate remote
        // updates against locally-stamped-but-untracked rows.
        const remoteTime = remoteSeasonUpdatedAt ? new Date(remoteSeasonUpdatedAt).getTime() : 0
        const localTime = localSeasonUpdatedAt ? new Date(localSeasonUpdatedAt).getTime() : 0
        const remoteSeasonNewer = remoteTime > localTime
        if (!localSeason || remoteSeasonNewer) {
          await SeasonRepository.saveFromRemote(season)
          console.log(`[Sync] Using remote season ${year} data`)
        } else {
          console.log(`[Sync] Local season ${year} data is newer or equal, keeping local`)
        }
      }
    }

    return { ...data, usedRemote }
  }

  /**
   * Resolve conflict between local and remote data.
   * Strategy: Local always wins if it exists (local is the working copy).
   */
  function resolveConflict(localData, remoteData) {
    // If local data exists, it always wins (it's the active working copy)
    if (localData) {
      return { winner: 'local', data: localData }
    }
    // Only use remote if no local data exists
    return { winner: 'remote', data: remoteData }
  }

  /**
   * Fetch list of campaigns that exist on the server (for recovery + reconciliation).
   * Returns the array on success, or `null` on failure so callers can distinguish
   * "no campaigns" from "server unreachable" (important for not deleting local
   * campaigns when we're just offline).
   */
  async function fetchServerCampaigns() {
    try {
      const response = await api.get('/api/sync/campaigns')
      return response.data?.campaigns ?? []
    } catch {
      return null
    }
  }

  /**
   * Force-overwrite local IndexedDB with whatever is in S3 for this campaign.
   * Skips the timestamp-based merge that `pullChanges` does — the user pressed
   * "Pull from Cloud" specifically to nuke any divergent local state. Wipes
   * the campaign's teams/players/seasons rows first so records that were
   * deleted remotely don't linger locally.
   */
  async function forcePullFromCloud(campaignId) {
    if (!campaignId) throw new Error('forcePullFromCloud: campaignId required')

    isPulling.value = true
    const toastStore = useToastStore()
    try {
      const data = await _fetchSnapshot(campaignId)

      if (!data || !data.campaign) {
        throw new Error('No cloud snapshot found for this campaign')
      }

      await Promise.all([
        TeamRepository.deleteAllForCampaign(campaignId),
        PlayerRepository.deleteAllForCampaign(campaignId),
        SeasonRepository.deleteAllForCampaign(campaignId),
        PlayerHeadshotRepository.deleteAllForCampaign(campaignId),
      ])

      await CampaignRepository.saveFromRemote(data.campaign)

      if (Array.isArray(data.teams) && data.teams.length > 0) {
        await TeamRepository.saveBulkFromRemote(data.teams)
      }

      if (Array.isArray(data.players) && data.players.length > 0) {
        const hydrated = data.players.map(_hydratePlayerKeys)
        await PlayerRepository.saveBulkFromRemote(hydrated)
      }

      if (Array.isArray(data.seasons)) {
        for (const season of data.seasons) {
          if (!season) continue
          await SeasonRepository.saveFromRemote(season)
        }
      }

      if (Array.isArray(data.headshots) && data.headshots.length > 0) {
        await PlayerHeadshotRepository.saveBulkFromRemote(data.headshots)
      }

      lastSyncAt.value = new Date().toISOString()
      isDirty.value = false
      _dirtyParts.value = new Set()

      toastStore.showSuccess('Pulled from cloud', 2000)
      return data
    } catch (err) {
      const msg = err.message || 'Pull from cloud failed'
      syncError.value = msg
      toastStore.showError(msg, 3500)
      throw err
    } finally {
      isPulling.value = false
    }
  }

  /**
   * Queue a background sync check.
   * Push-only: just pushes local changes if dirty, never pulls.
   */
  async function queueSyncCheck(campaignId) {
    if (isDirty.value) {
      try {
        await pushChanges(campaignId)
        lastSyncAt.value = new Date().toISOString()
        isDirty.value = false
      } catch {
        // Ignore errors for background sync
      }
    }
  }

  return {
    // State
    isSyncing,
    isPulling,
    lastSyncAt,
    isDirty,
    syncError,
    activeCampaignId,
    // Getters
    hasPendingChanges,
    lastSyncText,
    // Actions
    initFromCache,
    setActiveCampaign,
    markDirty,
    clearDirty,
    startAutoSync,
    stopAutoSync,
    syncNow,
    syncOnRouteLeave,
    pushChanges,
    pullChanges,
    forcePullFromCloud,
    resolveConflict,
    fetchServerCampaigns,
    queueSyncCheck,
  }
})
