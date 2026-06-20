import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { useSyncStore } from '@/stores/sync'

export const useBreakingNewsStore = defineStore('breakingNews', () => {
  const queue = ref([])
  const currentItem = ref(null)
  const isShowing = ref(false)

  // Persist a news item into the current season's news feed. `isBreaking` flags
  // it for the breaking-news styling (Zap icon + BREAKING tag); regular feed
  // items omit it. Returns the persisted record (for the display queue id).
  async function _persistNews(item, campaignId, isBreaking) {
    const newsRecord = {
      id: `${isBreaking ? 'breaking' : 'news'}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      event_type: item.category?.toLowerCase() || (isBreaking ? 'breaking' : 'news'),
      headline: item.headline,
      body: item.body,
      date: item.date,
      is_breaking: isBreaking,
    }
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const year = campaign?.currentSeasonYear ?? campaign?.gameYear ?? campaign?.settings?.currentYear ?? new Date().getFullYear()
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (seasonData) {
        if (!seasonData.news) seasonData.news = []
        seasonData.news.push(newsRecord)
        await SeasonRepository.save(seasonData)
        useSyncStore().markDirty()
      }
    } catch (err) {
      console.error('Failed to persist news:', err)
    }
    return newsRecord
  }

  /**
   * Enqueue a breaking news item for display and persist to seasonData.news.
   */
  async function enqueue(item, campaignId) {
    const newsRecord = await _persistNews(item, campaignId, true)

    // Add to display queue
    const displayItem = { ...item, id: newsRecord.id }
    queue.value.push(displayItem)

    // Auto-show if nothing currently displayed
    if (!isShowing.value) {
      showNext()
    }
  }

  /**
   * Add a regular (non-breaking) item to the season news feed — persisted so it
   * shows in the news list, but NOT surfaced as a breaking-news banner. For
   * routine offseason items (e.g. AI coach hires/firings) that belong in the
   * feed rather than the breaking ticker.
   */
  async function addToFeed(item, campaignId) {
    await _persistNews(item, campaignId, false)
  }

  function showNext() {
    if (queue.value.length === 0) {
      currentItem.value = null
      isShowing.value = false
      return
    }
    currentItem.value = queue.value.shift()
    isShowing.value = true
  }

  function dismiss() {
    isShowing.value = false
    currentItem.value = null
    setTimeout(() => {
      showNext()
    }, 400)
  }

  function clear() {
    queue.value = []
    currentItem.value = null
    isShowing.value = false
  }

  return {
    queue,
    currentItem,
    isShowing,
    enqueue,
    addToFeed,
    dismiss,
    clear,
  }
})
