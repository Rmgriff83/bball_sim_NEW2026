import { ref } from 'vue'
import api from './useApi'

// Module-level singleton — cached across all consumers
const synergies = ref([])
const loaded = ref(false)
const loading = ref(false)

const LEVEL_ORDER = { bronze: 1, silver: 2, gold: 3, hof: 4 }

function meetsMinLevel(playerBadgeLevel, requiredLevel) {
  return (LEVEL_ORDER[playerBadgeLevel] ?? 0) >= (LEVEL_ORDER[requiredLevel] ?? 1)
}

function findBadge(player, badgeId, minLevel) {
  if (!player?.badges) return null
  return player.badges.find(
    b => b.id === badgeId && meetsMinLevel(b.level, minLevel)
  ) || null
}

export function useBadgeSynergies() {
  async function loadSynergies() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const { data } = await api.get('/api/badge-synergies')
      synergies.value = data
      loaded.value = true
    } catch (err) {
      console.error('Failed to load badge synergies:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * For a given player, determine which of their badges are activated
   * by synergies with the other players in the lineup.
   *
   * Returns { activatedIds: Set<badgeId>, synergyDetails: Map<badgeId, [{synergyName, partnerName, description}]> }
   */
  function getActivatedBadges(player, lineupPlayers) {
    const activatedIds = new Set()
    const synergyDetails = new Map()

    if (!player?.badges || !lineupPlayers?.length || !synergies.value.length) {
      return { activatedIds, synergyDetails }
    }

    const teammates = lineupPlayers.filter(
      p => p && (p.id || p.player_id) !== (player.id || player.player_id)
    )

    for (const syn of synergies.value) {
      // Direction A: player has badge1, teammate has badge2
      const playerHasBadge1 = findBadge(player, syn.badge1_id, syn.min_level1)
      if (playerHasBadge1) {
        for (const mate of teammates) {
          if (findBadge(mate, syn.badge2_id, syn.min_level2)) {
            activatedIds.add(syn.badge1_id)
            if (!synergyDetails.has(syn.badge1_id)) synergyDetails.set(syn.badge1_id, [])
            synergyDetails.get(syn.badge1_id).push({
              synergyName: syn.synergy_name,
              partnerName: mate.name,
              description: syn.description,
            })
            break // one partner is enough for this direction
          }
        }
      }

      // Direction B: player has badge2, teammate has badge1
      const playerHasBadge2 = findBadge(player, syn.badge2_id, syn.min_level2)
      if (playerHasBadge2) {
        for (const mate of teammates) {
          if (findBadge(mate, syn.badge1_id, syn.min_level1)) {
            activatedIds.add(syn.badge2_id)
            if (!synergyDetails.has(syn.badge2_id)) synergyDetails.set(syn.badge2_id, [])
            synergyDetails.get(syn.badge2_id).push({
              synergyName: syn.synergy_name,
              partnerName: mate.name,
              description: syn.description,
            })
            break
          }
        }
      }
    }

    return { activatedIds, synergyDetails }
  }

  /**
   * Compute what synergies would activate if a bench player replaced
   * the player at swapSlotIndex in the current lineup.
   *
   * Returns { count: number, activatedIds: Set }
   */
  function getHypotheticalActivations(benchPlayer, currentLineup, swapSlotIndex) {
    if (!benchPlayer || !currentLineup) return { count: 0, activatedIds: new Set() }

    // Build hypothetical lineup
    const hypothetical = currentLineup.map((p, i) =>
      i === swapSlotIndex ? benchPlayer : p
    ).filter(p => p != null)

    const { activatedIds } = getActivatedBadges(benchPlayer, hypothetical)
    return { count: activatedIds.size, activatedIds }
  }

  /**
   * Count total unique activated synergy pairs across the full lineup.
   */
  function getLineupSynergyCount(lineupPlayers) {
    if (!lineupPlayers?.length || !synergies.value.length) return 0

    const valid = lineupPlayers.filter(p => p != null)
    let count = 0

    for (const syn of synergies.value) {
      let hasBadge1 = false
      let hasBadge2 = false

      for (const p of valid) {
        if (!hasBadge1 && findBadge(p, syn.badge1_id, syn.min_level1)) hasBadge1 = true
        if (!hasBadge2 && findBadge(p, syn.badge2_id, syn.min_level2)) hasBadge2 = true
        if (hasBadge1 && hasBadge2) break
      }

      // Ensure the two badges are on different players
      if (hasBadge1 && hasBadge2) {
        const playersWithBadge1 = valid.filter(p => findBadge(p, syn.badge1_id, syn.min_level1))
        const playersWithBadge2 = valid.filter(p => findBadge(p, syn.badge2_id, syn.min_level2))
        const onDifferentPlayers = playersWithBadge1.some(p1 =>
          playersWithBadge2.some(p2 =>
            (p1.id || p1.player_id) !== (p2.id || p2.player_id)
          )
        )
        if (onDifferentPlayers) count++
      }
    }

    return count
  }

  return {
    synergies,
    loadSynergies,
    getActivatedBadges,
    getHypotheticalActivations,
    getLineupSynergyCount,
  }
}
