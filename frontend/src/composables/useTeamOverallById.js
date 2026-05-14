import { ref } from 'vue'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { computeTeamOverall } from '@/utils/teamOverall'

// Module-level cache so the same `(campaignId, teamId)` doesn't re-fetch
// across components — multiple team logos rendered in one view (next game
// box, broadcast header, game preview) all read from the same ref.
const cache = new Map()

function cacheKey(campaignId, teamId) {
  return `${campaignId}:${teamId}`
}

/**
 * Reactive overall for any team (user or AI). Returns a ref that starts
 * null and resolves once players load from IndexedDB. Same ref is returned
 * for repeated calls with the same key so the badge stays in sync across
 * mount sites.
 */
export function useTeamOverallById(campaignId, teamId) {
  if (!campaignId || !teamId) {
    return ref(null)
  }
  const key = cacheKey(campaignId, teamId)
  const existing = cache.get(key)
  if (existing) return existing

  const r = ref(null)
  cache.set(key, r)
  PlayerRepository.getByTeam(campaignId, teamId)
    .then(players => {
      r.value = computeTeamOverall(players)
    })
    .catch(() => {
      r.value = null
    })
  return r
}

/**
 * Force a re-fetch for a team — call after roster changes (trades, signings,
 * AI moves) so the badge re-evaluates.
 */
export async function refreshTeamOverall(campaignId, teamId) {
  if (!campaignId || !teamId) return
  const key = cacheKey(campaignId, teamId)
  const r = cache.get(key) ?? ref(null)
  cache.set(key, r)
  try {
    const players = await PlayerRepository.getByTeam(campaignId, teamId)
    r.value = computeTeamOverall(players)
  } catch {
    r.value = null
  }
}

export function invalidateTeamOverallCache() {
  cache.clear()
}
