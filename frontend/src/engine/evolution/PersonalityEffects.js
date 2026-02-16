import { PERSONALITY_TRAITS } from '../config/GameConfig.js'

/**
 * PersonalityEffects
 *
 * Calculates how a player's personality traits affect development,
 * in-game behaviour (usage, assists, clutch, technicals), and
 * team-wide modifiers such as leadership and mentoring.
 *
 * Translated from backend PersonalityEffects.php.
 * All game logic and math are preserved exactly.
 */
export class PersonalityEffects {
  constructor () {
    this.config = PERSONALITY_TRAITS
  }

  // ---------------------------------------------------------------------------
  // Development
  // ---------------------------------------------------------------------------

  /**
   * Calculate total development modifier from personality traits.
   * @param {Object} player - Plain player object
   * @returns {number}
   */
  getDevelopmentModifier (player) {
    const traits = player.personality?.traits ?? []
    let modifier = 0.0

    for (const trait of traits) {
      if (this.config[trait]?.development_bonus != null) {
        modifier += this.config[trait].development_bonus
      }
      if (this.config[trait]?.own_development_penalty != null) {
        modifier += this.config[trait].own_development_penalty
      }
    }

    // Work ethic multiplier (from mental attributes)
    const workEthic = player.attributes?.mental?.workEthic ?? 70
    if (workEthic >= 85) {
      modifier += 0.15 // High work ethic bonus
    } else if (workEthic <= 50) {
      modifier -= 0.10 // Low work ethic penalty
    }

    return modifier
  }

  // ---------------------------------------------------------------------------
  // Mentoring
  // ---------------------------------------------------------------------------

  /**
   * Calculate mentor bonus for a young player.
   * @param {Object} veteran
   * @param {Object} youngPlayer
   * @returns {number}
   */
  getMentorBonus (veteran, youngPlayer) {
    const veteranTraits = veteran.personality?.traits ?? []

    if (!veteranTraits.includes('mentor')) {
      return 0.0
    }

    const youngAge = this._calculateAge(youngPlayer)
    if (youngAge > 24) {
      return 0.0 // Too old for mentoring
    }

    const mentorConfig = this.config.mentor ?? {}
    return mentorConfig.young_player_boost ?? 0.15
  }

  /**
   * Find mentors on a roster for young players.
   * @param {Object} youngPlayer
   * @param {Object[]} roster
   * @returns {Object[]}
   */
  findMentorsForPlayer (youngPlayer, roster) {
    const mentors = []
    const youngAge = this._calculateAge(youngPlayer)

    if (youngAge > 24) {
      return mentors
    }

    const maxMentees = this.config.mentor?.max_mentees ?? 2
    const menteesCount = {}

    for (const player of roster) {
      if ((player.id ?? '') === (youngPlayer.id ?? 'no-match')) {
        continue
      }

      const traits = player.personality?.traits ?? []
      if (traits.includes('mentor')) {
        const mentorId = player.id ?? ''
        menteesCount[mentorId] = (menteesCount[mentorId] ?? 0) + 1

        if (menteesCount[mentorId] <= maxMentees) {
          mentors.push(player)
        }
      }
    }

    return mentors
  }

  // ---------------------------------------------------------------------------
  // Leadership
  // ---------------------------------------------------------------------------

  /**
   * Calculate leadership effect on team.
   * @param {Object} leader
   * @param {Object[]} roster - Not used in calculation but kept for API parity
   * @returns {{ chemistry_boost: number, development_boost: number }}
   */
  calculateLeadershipEffect (leader, roster) {
    const leaderTraits = leader.personality?.traits ?? []

    if (!leaderTraits.includes('leader')) {
      return { chemistry_boost: 0, development_boost: 0 }
    }

    const leaderConfig = this.config.leader ?? {}

    return {
      chemistry_boost: leaderConfig.chemistry_boost ?? 5,
      development_boost: leaderConfig.team_development ?? 0.05,
    }
  }

  // ---------------------------------------------------------------------------
  // In-game behaviour
  // ---------------------------------------------------------------------------

  /**
   * Check for technical foul based on personality.
   * @param {Object} player
   * @returns {boolean}
   */
  checkForTechnicalFoul (player) {
    const traits = player.personality?.traits ?? []

    if (!traits.includes('hot_head')) {
      return false
    }

    const chance = this.config.hot_head?.tech_foul_chance ?? 0.02
    return Math.random() <= chance
  }

  /**
   * Check for ejection based on personality.
   * @param {Object} player
   * @param {number} technicals - Number of technical fouls so far
   * @returns {boolean}
   */
  checkForEjection (player, technicals = 0) {
    // Auto-eject at 2 technicals
    if (technicals >= 2) {
      return true
    }

    const traits = player.personality?.traits ?? []
    if (!traits.includes('hot_head')) {
      return false
    }

    const chance = this.config.hot_head?.ejection_chance ?? 0.005
    return Math.random() <= chance
  }

  /**
   * Get usage rate modifier based on personality.
   * @param {Object} player
   * @returns {number}
   */
  getUsageModifier (player) {
    const traits = player.personality?.traits ?? []
    let modifier = 0.0

    if (traits.includes('ball_hog')) {
      modifier += this.config.ball_hog?.usage_boost ?? 0.10
    }

    if (traits.includes('team_player')) {
      modifier -= 0.05 // More willing to pass
    }

    return modifier
  }

  /**
   * Get assist rate modifier based on personality.
   * @param {Object} player
   * @returns {number}
   */
  getAssistModifier (player) {
    const traits = player.personality?.traits ?? []
    let modifier = 0.0

    if (traits.includes('ball_hog')) {
      modifier += this.config.ball_hog?.assist_penalty ?? -0.10
    }

    if (traits.includes('team_player')) {
      modifier += this.config.team_player?.assist_boost ?? 0.10
    }

    return modifier
  }

  /**
   * Get clutch performance modifier based on personality.
   * @param {Object} player
   * @returns {number}
   */
  getClutchModifier (player) {
    const traits = player.personality?.traits ?? []
    let modifier = 0.0

    if (traits.includes('competitor')) {
      const clutchBoost = this.config.competitor?.clutch_boost ?? 5
      modifier += clutchBoost / 100 // Convert to percentage
    }

    return modifier
  }

  /**
   * Get playoff performance modifier.
   * @param {Object} player
   * @returns {number}
   */
  getPlayoffModifier (player) {
    const traits = player.personality?.traits ?? []
    let modifier = 0.0

    if (traits.includes('competitor')) {
      modifier += this.config.competitor?.playoff_performance ?? 0.05
    }

    // Pressure can affect media darlings
    if (traits.includes('media_darling')) {
      modifier += this.config.media_darling?.pressure_penalty ?? -0.02
    }

    return modifier
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate player age from birth date.
   * @param {Object} player
   * @returns {number}
   * @private
   */
  _calculateAge (player) {
    const birthDate = player.birthDate ?? player.birth_date ?? null
    if (!birthDate) return 25

    const birth = new Date(birthDate)
    const now = new Date()
    let age = now.getFullYear() - birth.getFullYear()
    const monthDiff = now.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--
    }
    return age
  }

  /**
   * Get all trait effects summary for a player.
   * @param {Object} player
   * @returns {Object} Map of trait name to config values
   */
  getTraitEffectsSummary (player) {
    const traits = player.personality?.traits ?? []
    const effects = {}

    for (const trait of traits) {
      if (this.config[trait] != null) {
        effects[trait] = { ...this.config[trait] }
      }
    }

    return effects
  }
}

export default PersonalityEffects
