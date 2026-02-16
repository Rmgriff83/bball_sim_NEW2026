import { getDB } from './GameDatabase'
import { BADGES } from '../data/badges'
import { SYNERGIES } from '../data/synergies'
import { ACHIEVEMENTS } from '../data/achievements'
import { PLAYS } from '../data/plays'

export const ReferenceDataRepository = {
  async initialize() {
    const db = await getDB()
    const tx = db.transaction(['badges', 'synergies', 'achievements', 'plays'], 'readwrite')

    // Only populate if empty
    const badgeCount = await tx.objectStore('badges').count()
    if (badgeCount === 0) {
      for (const badge of BADGES) {
        tx.objectStore('badges').put(badge)
      }
      for (const synergy of SYNERGIES) {
        tx.objectStore('synergies').put(synergy)
      }
      for (const achievement of ACHIEVEMENTS) {
        tx.objectStore('achievements').put(achievement)
      }
      for (const play of PLAYS) {
        tx.objectStore('plays').put(play)
      }
    }

    await tx.done
  },

  // Badges
  async getAllBadges() {
    const db = await getDB()
    return db.getAll('badges')
  },

  async getBadge(id) {
    const db = await getDB()
    return db.get('badges', id)
  },

  async getBadgesByCategory(category) {
    const badges = await this.getAllBadges()
    return badges.filter(b => b.category === category)
  },

  // Synergies
  async getAllSynergies() {
    const db = await getDB()
    return db.getAll('synergies')
  },

  async getSynergiesForBadge(badgeId) {
    const synergies = await this.getAllSynergies()
    return synergies.filter(s => s.badge1_id === badgeId || s.badge2_id === badgeId)
  },

  // Achievements
  async getAllAchievements() {
    const db = await getDB()
    return db.getAll('achievements')
  },

  async getAchievement(id) {
    const db = await getDB()
    return db.get('achievements', id)
  },

  async getAchievementsByCategory(category) {
    const achievements = await this.getAllAchievements()
    return achievements.filter(a => a.category === category)
  },

  // Plays
  async getAllPlays() {
    const db = await getDB()
    return db.getAll('plays')
  },

  async getPlay(id) {
    const db = await getDB()
    return db.get('plays', id)
  },
}
