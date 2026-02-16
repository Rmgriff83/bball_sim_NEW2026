import { ref } from 'vue'
import { SYNERGIES } from '@/engine/data/synergies'

// Module-level singleton — cached across all consumers
const synergies = ref(SYNERGIES)
const loaded = ref(true)

const LEVEL_ORDER = { bronze: 1, silver: 2, gold: 3, hof: 4 }

function findBadge(player, badgeId) {
  if (!player?.badges) return null
  return player.badges.find(b => b.id === badgeId) || null
}

export function useBadgeSynergies() {
  function loadSynergies() {
    // No-op: synergies are bundled at build time
  }

  /**
   * For a given player, determine which of their badges are activated
   * by synergies with the other players in the lineup.
   *
   * Returns { activatedIds: Set<badgeId>, synergyDetails: Map<badgeId, [{synergyName, partnerName, description, playerBadgeLevel, partnerBadgeLevel}]> }
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
      const playerHasBadge1 = findBadge(player, syn.badge1_id)
      if (playerHasBadge1) {
        for (const mate of teammates) {
          const mateBadge = findBadge(mate, syn.badge2_id)
          if (mateBadge) {
            activatedIds.add(syn.badge1_id)
            if (!synergyDetails.has(syn.badge1_id)) synergyDetails.set(syn.badge1_id, [])
            synergyDetails.get(syn.badge1_id).push({
              synergyName: syn.synergy_name,
              partnerName: mate.name,
              description: syn.description,
              playerBadgeLevel: playerHasBadge1.level,
              partnerBadgeLevel: mateBadge.level,
            })
            break // one partner is enough for this direction
          }
        }
      }

      // Direction B: player has badge2, teammate has badge1
      const playerHasBadge2 = findBadge(player, syn.badge2_id)
      if (playerHasBadge2) {
        for (const mate of teammates) {
          const mateBadge = findBadge(mate, syn.badge1_id)
          if (mateBadge) {
            activatedIds.add(syn.badge2_id)
            if (!synergyDetails.has(syn.badge2_id)) synergyDetails.set(syn.badge2_id, [])
            synergyDetails.get(syn.badge2_id).push({
              synergyName: syn.synergy_name,
              partnerName: mate.name,
              description: syn.description,
              playerBadgeLevel: playerHasBadge2.level,
              partnerBadgeLevel: mateBadge.level,
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
        if (!hasBadge1 && findBadge(p, syn.badge1_id)) hasBadge1 = true
        if (!hasBadge2 && findBadge(p, syn.badge2_id)) hasBadge2 = true
        if (hasBadge1 && hasBadge2) break
      }

      // Ensure the two badges are on different players
      if (hasBadge1 && hasBadge2) {
        const playersWithBadge1 = valid.filter(p => findBadge(p, syn.badge1_id))
        const playersWithBadge2 = valid.filter(p => findBadge(p, syn.badge2_id))
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

  /**
   * Find Dynamic Duo pairs in a lineup.
   * Two players form a Dynamic Duo when they share 2+ synergies
   * and both badges in each synergy are gold or higher.
   *
   * Returns array of { playerA: { id, name }, playerB: { id, name } }
   */
  function getDynamicDuos(lineupPlayers) {
    const duos = []
    if (!lineupPlayers?.length || !synergies.value.length) return duos

    const valid = lineupPlayers.filter(p => p != null)

    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const playerA = valid[i]
        const playerB = valid[j]
        let goldPlusSynergyCount = 0

        for (const syn of synergies.value) {
          // Check direction A→B
          const aHas1 = playerA.badges?.find(b => b.id === syn.badge1_id)
          const bHas2 = playerB.badges?.find(b => b.id === syn.badge2_id)
          if (aHas1 && bHas2) {
            const minLevel = Math.min(LEVEL_ORDER[aHas1.level] ?? 0, LEVEL_ORDER[bHas2.level] ?? 0)
            if (minLevel >= 3) goldPlusSynergyCount++ // gold = 3
            continue
          }
          // Check direction B→A
          const aHas2 = playerA.badges?.find(b => b.id === syn.badge2_id)
          const bHas1 = playerB.badges?.find(b => b.id === syn.badge1_id)
          if (aHas2 && bHas1) {
            const minLevel = Math.min(LEVEL_ORDER[aHas2.level] ?? 0, LEVEL_ORDER[bHas1.level] ?? 0)
            if (minLevel >= 3) goldPlusSynergyCount++
          }
        }

        if (goldPlusSynergyCount >= 2) {
          duos.push({
            playerA: { id: playerA.id || playerA.player_id, name: playerA.name },
            playerB: { id: playerB.id || playerB.player_id, name: playerB.name },
          })
        }
      }
    }
    return duos
  }

  /**
   * Check if a player is part of a Dynamic Duo in the lineup.
   * Returns the partner's name if they are, or null.
   */
  function isPlayerInDynamicDuo(player, lineupPlayers) {
    if (!player) return null
    const playerId = player.id || player.player_id
    const duos = getDynamicDuos(lineupPlayers)
    for (const duo of duos) {
      if (duo.playerA.id === playerId) return duo.playerB.name
      if (duo.playerB.id === playerId) return duo.playerA.name
    }
    return null
  }

  return {
    synergies,
    loadSynergies,
    getActivatedBadges,
    getHypotheticalActivations,
    getLineupSynergyCount,
    getDynamicDuos,
    isPlayerInDynamicDuo,
  }
}
