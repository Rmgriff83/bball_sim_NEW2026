import { BADGE_SYNERGIES } from '../config/GameConfig.js'
import { SYNERGIES } from '../data/synergies.js'

/**
 * BadgeSynergyService
 *
 * Finds badge synergies between players on a roster and calculates
 * development boosts, in-game performance boosts, chemistry contributions,
 * and Dynamic Duo pairs.
 *
 * Translated from backend BadgeSynergyService.php.
 * All game logic and math are preserved exactly.
 */

const LEVEL_VALUES = { bronze: 1, silver: 2, gold: 3, hof: 4 }
const SYNERGY_BOOST_BY_MIN_LEVEL = { 1: 0.03, 2: 0.05, 3: 0.06, 4: 0.08 }

export class BadgeSynergyService {
  constructor () {
    this.config = BADGE_SYNERGIES
    this.synergies = this._loadSynergies()
  }

  // ---------------------------------------------------------------------------
  // Synergy loading
  // ---------------------------------------------------------------------------

  /**
   * Load badge synergies from the static data file.
   * Falls back to hardcoded defaults if the import is empty.
   * @returns {Object[]}
   * @private
   */
  _loadSynergies () {
    if (SYNERGIES && SYNERGIES.length > 0) {
      return SYNERGIES
    }
    return this._getDefaultSynergies()
  }

  /**
   * Get default synergies if the data file is unavailable.
   * @returns {Object[]}
   * @private
   */
  _getDefaultSynergies () {
    return [
      { badge1_id: 'dimer', badge2_id: 'catch_and_shoot', effect: 'shooting_boost', magnitude: 5 },
      { badge1_id: 'lob_city_passer', badge2_id: 'lob_city_finisher', effect: 'alley_oop_boost', magnitude: 10 },
      { badge1_id: 'brick_wall', badge2_id: 'pick_and_roller', effect: 'screen_boost', magnitude: 5 },
      { badge1_id: 'anchor', badge2_id: 'intimidator', effect: 'interior_defense_boost', magnitude: 8 },
      { badge1_id: 'floor_general', badge2_id: 'deadeye', effect: 'team_shooting_boost', magnitude: 3 },
      { badge1_id: 'floor_general', badge2_id: 'catch_and_shoot', effect: 'team_shooting_boost', magnitude: 3 },
      { badge1_id: 'floor_general', badge2_id: 'corner_specialist', effect: 'team_shooting_boost', magnitude: 3 },
    ]
  }

  // ---------------------------------------------------------------------------
  // Core synergy detection
  // ---------------------------------------------------------------------------

  /**
   * Find all badge synergies between two players.
   * @param {Object[]} playerABadges - Array of badge objects with { id, level }
   * @param {Object[]} playerBBadges - Array of badge objects with { id, level }
   * @returns {Object[]}
   */
  findBadgeSynergies (playerABadges, playerBBadges) {
    const foundSynergies = []

    const aBadgeIds = playerABadges.map(b => b.id)
    const bBadgeIds = playerBBadges.map(b => b.id)

    for (const synergy of this.synergies) {
      const badge1 = synergy.badge1_id ?? ''
      const badge2 = synergy.badge2_id ?? ''

      // Check if player A has badge1 and player B has badge2
      if (aBadgeIds.includes(badge1) && bBadgeIds.includes(badge2)) {
        foundSynergies.push({
          synergy,
          badge1_level: this._getBadgeLevel(playerABadges, badge1),
          badge2_level: this._getBadgeLevel(playerBBadges, badge2),
        })
      }

      // Check reverse direction
      if (aBadgeIds.includes(badge2) && bBadgeIds.includes(badge1)) {
        foundSynergies.push({
          synergy,
          badge1_level: this._getBadgeLevel(playerABadges, badge2),
          badge2_level: this._getBadgeLevel(playerBBadges, badge1),
        })
      }
    }

    return foundSynergies
  }

  // ---------------------------------------------------------------------------
  // Development boost
  // ---------------------------------------------------------------------------

  /**
   * Calculate development boost from badge synergies.
   * @param {Object} player
   * @param {Object[]} roster
   * @returns {number}
   */
  calculateDevelopmentBoost (player, roster) {
    const playerBadges = player.badges ?? []
    if (playerBadges.length === 0) {
      return 0.0
    }

    let totalBoost = 0.0

    for (const teammate of roster) {
      if ((teammate.id ?? '') === (player.id ?? 'no-match')) {
        continue
      }

      const teammateBadges = teammate.badges ?? []
      const synergies = this.findBadgeSynergies(playerBadges, teammateBadges)

      for (const synergyData of synergies) {
        const boost = this._calculateSingleSynergyBoost(synergyData)
        totalBoost += boost
      }
    }

    // Cap at max boost
    return Math.min(totalBoost, this.config.development_boost_max ?? 0.15)
  }

  /**
   * Calculate boost from a single synergy.
   * Uses the lower of the two badge levels to determine the tier.
   * @param {Object} synergyData
   * @returns {number}
   * @private
   */
  _calculateSingleSynergyBoost (synergyData) {
    const level1 = LEVEL_VALUES[synergyData.badge1_level ?? 'bronze'] ?? 1
    const level2 = LEVEL_VALUES[synergyData.badge2_level ?? 'bronze'] ?? 1
    const minLevel = Math.min(level1, level2)

    return SYNERGY_BOOST_BY_MIN_LEVEL[minLevel] ?? 0.03
  }

  /**
   * Get badge level from badges array.
   * @param {Object[]} badges
   * @param {string} badgeId
   * @returns {string}
   * @private
   */
  _getBadgeLevel (badges, badgeId) {
    for (const badge of badges) {
      if ((badge.id ?? '') === badgeId) {
        return badge.level ?? 'bronze'
      }
    }
    return 'bronze'
  }

  // ---------------------------------------------------------------------------
  // In-game boost
  // ---------------------------------------------------------------------------

  /**
   * Calculate in-game performance boost from synergies.
   * @param {Object} player
   * @param {Object[]} teammates
   * @returns {number}
   */
  calculateInGameBoost (player, teammates) {
    const playerBadges = player.badges ?? []
    if (playerBadges.length === 0) {
      return 0.0
    }

    let synergyCount = 0

    for (const teammate of teammates) {
      const teammateBadges = teammate.badges ?? []
      const synergies = this.findBadgeSynergies(playerBadges, teammateBadges)
      synergyCount += synergies.length
    }

    // Each synergy gives a small in-game boost
    const boost = synergyCount * (this.config.in_game_boost ?? 0.03)

    // Cap at reasonable amount
    return Math.min(boost, 0.12)
  }

  // ---------------------------------------------------------------------------
  // Chemistry
  // ---------------------------------------------------------------------------

  /**
   * Calculate chemistry contribution from synergies.
   * @param {Object[]} roster
   * @returns {number}
   */
  calculateChemistryContribution (roster) {
    let totalContribution = 0
    const countedPairs = {}

    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const playerA = roster[i]
        const playerB = roster[j]

        const synergies = this.findBadgeSynergies(
          playerA.badges ?? [],
          playerB.badges ?? []
        )

        if (synergies.length > 0) {
          const pairKey = (playerA.id ?? i) + '-' + (playerB.id ?? j)
          if (!countedPairs[pairKey]) {
            totalContribution += this.config.chemistry_contribution ?? 2
            countedPairs[pairKey] = true
          }
        }
      }
    }

    return totalContribution
  }

  // ---------------------------------------------------------------------------
  // Roster synergy reporting
  // ---------------------------------------------------------------------------

  /**
   * Get all synergy pairs on a roster.
   * @param {Object[]} roster
   * @returns {Object[]}
   */
  getRosterSynergies (roster) {
    const allSynergies = []

    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const playerA = roster[i]
        const playerB = roster[j]

        const synergies = this.findBadgeSynergies(
          playerA.badges ?? [],
          playerB.badges ?? []
        )

        if (synergies.length > 0) {
          allSynergies.push({
            playerA: {
              id: playerA.id ?? '',
              name: (playerA.firstName ?? playerA.first_name ?? '') + ' ' +
                    (playerA.lastName ?? playerA.last_name ?? ''),
            },
            playerB: {
              id: playerB.id ?? '',
              name: (playerB.firstName ?? playerB.first_name ?? '') + ' ' +
                    (playerB.lastName ?? playerB.last_name ?? ''),
            },
            synergies,
          })
        }
      }
    }

    return allSynergies
  }

  // ---------------------------------------------------------------------------
  // Dynamic Duos
  // ---------------------------------------------------------------------------

  /**
   * Find Dynamic Duo pairs on a roster.
   * Two players form a Dynamic Duo when they share 2+ synergies
   * and both badges in each synergy are gold or higher.
   * @param {Object[]} roster
   * @returns {Object[]}
   */
  findDynamicDuos (roster) {
    const duos = []
    const minSynergies = this.config.dynamic_duo_min_synergies ?? 2

    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const playerA = roster[i]
        const playerB = roster[j]

        const synergies = this.findBadgeSynergies(
          playerA.badges ?? [],
          playerB.badges ?? []
        )

        let goldPlusCount = 0
        for (const synergyData of synergies) {
          const level1 = LEVEL_VALUES[synergyData.badge1_level ?? 'bronze'] ?? 1
          const level2 = LEVEL_VALUES[synergyData.badge2_level ?? 'bronze'] ?? 1
          if (Math.min(level1, level2) >= 3) { // gold = 3
            goldPlusCount++
          }
        }

        if (goldPlusCount >= minSynergies) {
          duos.push({
            playerA: {
              id: playerA.id ?? '',
              name: (playerA.firstName ?? playerA.first_name ?? '') + ' ' +
                    (playerA.lastName ?? playerA.last_name ?? ''),
            },
            playerB: {
              id: playerB.id ?? '',
              name: (playerB.firstName ?? playerB.first_name ?? '') + ' ' +
                    (playerB.lastName ?? playerB.last_name ?? ''),
            },
            synergies,
          })
        }
      }
    }

    return duos
  }

  /**
   * Get Dynamic Duo attribute boost for a player.
   * Returns 0.02 if the player is part of any Dynamic Duo, else 0.0.
   * @param {Object} player
   * @param {Object[]} roster
   * @returns {number}
   */
  getDynamicDuoBoost (player, roster) {
    const playerId = player.id ?? ''
    const duos = this.findDynamicDuos(roster)

    for (const duo of duos) {
      if ((duo.playerA.id ?? '') === playerId || (duo.playerB.id ?? '') === playerId) {
        return this.config.dynamic_duo_boost ?? 0.02
      }
    }

    return 0.0
  }
}

export default BadgeSynergyService
