import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'

// ---------------------------------------------------------------------------
// Helpers: snake_case -> camelCase key transformation
// ---------------------------------------------------------------------------

/**
 * Convert a single snake_case string to camelCase.
 * Leaves strings that are already camelCase (or have no underscores) unchanged.
 *
 * Examples:
 *   'current_date'  -> 'currentDate'
 *   'home_team_id'  -> 'homeTeamId'
 *   'id'            -> 'id'
 */
function snakeToCamel(str) {
  return str.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())
}

/**
 * Recursively transform every key of an object (or array of objects) from
 * snake_case to camelCase.  Primitive values are returned as-is.
 */
function transformObject(obj) {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(transformObject)
  if (typeof obj !== 'object') return obj

  // Date objects should pass through untouched
  if (obj instanceof Date) return obj

  const transformed = {}
  for (const [key, value] of Object.entries(obj)) {
    transformed[snakeToCamel(key)] = transformObject(value)
  }
  return transformed
}

// ---------------------------------------------------------------------------
// Transform functions – map specific API shapes to IndexedDB shapes
// ---------------------------------------------------------------------------

/**
 * Transform the full API export response into the shape expected by the
 * various IndexedDB repositories.
 *
 * Expected API shape (from GET /api/campaigns/:id/export-full):
 * {
 *   campaign: { id, name, current_date, game_year, team_id, ... },
 *   teams:    [ { id, name, primary_color, secondary_color, lineup_settings, ... } ],
 *   players:  [ { id, first_name, last_name, team_id, overall_rating, potential_rating, attributes: { ... } } ],
 *   seasons:  [ { year, schedule: [ { game_date, home_team_id, away_team_id, ... } ], standings, ... } ]
 * }
 *
 * Returns { campaign, teams, players, seasons } with camelCase keys and
 * campaignId stamped onto every child record.
 */
export function transformApiCampaign(apiData) {
  const campaignId = apiData.campaign?.id ?? apiData.id

  // --- Campaign -----------------------------------------------------------
  const campaign = transformObject(apiData.campaign ?? apiData)
  // Ensure the id stays numeric / consistent
  campaign.id = campaignId

  // --- Teams --------------------------------------------------------------
  const teams = (apiData.teams || []).map((team) => {
    const t = transformObject(team)
    t.campaignId = campaignId
    return t
  })

  // --- Players ------------------------------------------------------------
  const players = (apiData.players || []).map((player) => {
    const p = transformObject(player)
    p.campaignId = campaignId
    // Normalise the free-agent flag to 0/1 for IndexedDB index compatibility
    if (p.isFreeAgent === true) p.isFreeAgent = 1
    if (p.isFreeAgent === false || p.isFreeAgent === undefined) p.isFreeAgent = p.isFreeAgent ?? 0
    return p
  })

  // --- Seasons ------------------------------------------------------------
  const seasons = (apiData.seasons || []).map((season) => {
    const s = transformObject(season)
    s.campaignId = campaignId

    // Transform each schedule entry's keys as well (the recursive
    // transformObject already handles this, but we ensure campaignId is set
    // on the season-level record for the compound key)
    if (Array.isArray(s.schedule)) {
      s.schedule = s.schedule.map((entry) => {
        const e = typeof entry === 'object' && entry !== null ? entry : {}
        return e
      })
    }

    return s
  })

  return { campaign, teams, players, seasons }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the given campaign needs to be migrated into IndexedDB.
 * Returns `true` when NO local data exists for this campaign.
 */
export async function needsMigration(campaignId) {
  try {
    const existing = await CampaignRepository.get(campaignId)
    return !existing
  } catch {
    // If the DB hasn't been initialised yet, migration is definitely needed
    return true
  }
}

/**
 * Return a lightweight status object describing the migration state for a
 * campaign.
 *
 * @param  {number|string} campaignId
 * @return {{ migrated: boolean, localDataExists: boolean }}
 */
export async function getMigrationStatus(campaignId) {
  try {
    const existing = await CampaignRepository.get(campaignId)
    const localDataExists = !!existing
    return {
      migrated: localDataExists,
      localDataExists,
    }
  } catch {
    return {
      migrated: false,
      localDataExists: false,
    }
  }
}

/**
 * Fetch the full campaign payload from the server and hydrate IndexedDB.
 *
 * @param  {number|string} campaignId  The campaign to migrate
 * @param  {object}        apiClient   An axios-like HTTP client (must expose `.get()`)
 * @return {{ success: boolean, stats: { teams: number, players: number, seasons: number } }}
 */
export async function migrateFromServer(campaignId, apiClient) {
  // 1. Fetch the full export from the backend
  const response = await apiClient.get(`/api/campaigns/${campaignId}/export-full`)
  const apiData = response.data ?? response

  // 2. Transform the payload from snake_case API format to camelCase
  const { campaign, teams, players, seasons } = transformApiCampaign(apiData)

  // 3. Persist campaign record
  await CampaignRepository.save(campaign)

  // 4. Persist teams in bulk
  if (teams.length > 0) {
    await TeamRepository.saveBulk(teams)
  }

  // 5. Persist players in bulk
  if (players.length > 0) {
    await PlayerRepository.saveBulk(players)
  }

  // 6. Persist each season record
  for (const season of seasons) {
    await SeasonRepository.save(season)
  }

  return {
    success: true,
    stats: {
      teams: teams.length,
      players: players.length,
      seasons: seasons.length,
    },
  }
}
