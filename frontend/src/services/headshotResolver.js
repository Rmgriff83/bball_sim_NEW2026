import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'

// Eagerly-loaded bundled base SVG library. The map key is the absolute path
// emitted by Vite (e.g. '/src/assets/headshots/headshot_001_black.svg'); the
// value is the Vite-processed module whose `.default` is the asset URL.
//
// Two pools share the same filename → URL space:
//   1. The procedural pool at `headshots/` (regenerated each build by
//      `regen:headshots` against the latest layer SVGs + palettes.json).
//   2. The admin-authored premades at `headshots-premade/` (hand-curated
//      composed SVGs, see headshotPremades.js for the editor-side glob).
//
// Player generation picks filenames from EITHER pool (see
// listAvailableHeadshotFilenames below), so the resolver has to be able to
// look both up the same way. Premades are loaded WITHOUT `?raw` here — we
// only need the URL for the <img src> path; the editor's separate raw glob
// in headshotPremades.js still handles inline composition.
const POOL_SVGS = import.meta.glob('@/assets/headshots/*.svg', { eager: true })
const PREMADE_SVGS = import.meta.glob('@/assets/headshots-premade/*.svg', { eager: true })

// Map filename → URL once at module load. Players store just the filename
// (e.g. 'headshot_001_black.svg' or 'premade_005.svg') in `player.headshot`.
const BASE_BY_FILENAME = (() => {
  const map = new Map()
  for (const source of [POOL_SVGS, PREMADE_SVGS]) {
    for (const [path, mod] of Object.entries(source)) {
      const filename = path.split('/').pop()
      if (filename) map.set(filename.toLowerCase(), mod.default)
    }
  }
  return map
})()

/**
 * Sorted list of every filename available for random assignment to a
 * generated player — union of the procedural pool and the admin-authored
 * premades. Used by CampaignManager's generatePlayer and the
 * RookieGenerationService so both campaign init and rookie classes draw
 * from the same combined catalog.
 *
 * Sorted so callers seeded by index get a deterministic mapping regardless
 * of the underlying Vite glob iteration order.
 */
const _ALL_HEADSHOT_FILENAMES = (() => {
  const names = new Set()
  for (const source of [POOL_SVGS, PREMADE_SVGS]) {
    for (const path of Object.keys(source)) {
      const filename = path.split('/').pop()
      if (filename) names.add(filename)
    }
  }
  return [...names].sort()
})()

export function listAvailableHeadshotFilenames() {
  return _ALL_HEADSHOT_FILENAMES.slice()
}

// Cache of blob URLs we've minted for custom SVGs so repeated reads don't
// re-create a Blob every render. Key: `${campaignId}:${playerId}`. Invalidated
// explicitly by callers via invalidateCustomHeadshot() when a headshot is
// saved or deleted.
const customCache = new Map()

/**
 * Resolve the right image src for a player:
 *   1) custom override (IDB) if player.hasCustomHeadshot
 *   2) bundled base SVG matched by `player.headshot` filename
 *   3) null (caller falls back to the lucide User icon)
 *
 * @param {object} player — must have id; optionally hasCustomHeadshot, headshot
 * @param {string|number|null} campaignId — required when player.hasCustomHeadshot is true
 * @returns {Promise<string|null>}
 */
export async function resolveHeadshotSrc(player, campaignId) {
  if (!player) return null

  const hasCustom = player.hasCustomHeadshot ?? player.has_custom_headshot ?? false
  // Box-score records use player_id; team/roster records use id. Accept both.
  const pid = player.id ?? player.player_id ?? player.playerId
  if (hasCustom && campaignId != null && pid != null) {
    const cacheKey = `${campaignId}:${pid}`
    if (customCache.has(cacheKey)) return customCache.get(cacheKey)
    try {
      const record = await PlayerHeadshotRepository.get(campaignId, pid)
      if (record?.svgContent) {
        const blob = new Blob([record.svgContent], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        customCache.set(cacheKey, url)
        return url
      }
    } catch (err) {
      console.warn('[headshotResolver] custom lookup failed', err)
    }
  }

  if (player.headshot) {
    return BASE_BY_FILENAME.get(String(player.headshot).toLowerCase()) ?? null
  }

  return null
}

/**
 * Drop the cached blob URL for a custom headshot. Call after saving a new
 * custom SVG, deleting one, or when a campaign is unloaded. Revokes the blob
 * URL so the memory backing it is reclaimed.
 */
export function invalidateCustomHeadshot(campaignId, playerId) {
  if (campaignId == null || playerId == null) return
  const cacheKey = `${campaignId}:${playerId}`
  const url = customCache.get(cacheKey)
  if (url) URL.revokeObjectURL(url)
  customCache.delete(cacheKey)
}

/**
 * Drop every cached blob URL. Used on logout / campaign switch where we want
 * a clean slate without per-player invalidation calls.
 */
export function clearCustomHeadshotCache() {
  for (const url of customCache.values()) {
    URL.revokeObjectURL(url)
  }
  customCache.clear()
}

/**
 * Synchronously resolve only the bundled base SVG for a player. Used by the
 * canvas-based BasketballCourt preload path, which can't await per-image
 * lookups. Custom overrides fall through to the bundled headshot for that
 * one render path; a future pass can wire preload into the async resolver.
 */
export function resolveBaseHeadshotSrc(player) {
  if (!player?.headshot) return null
  return BASE_BY_FILENAME.get(String(player.headshot).toLowerCase()) ?? null
}
