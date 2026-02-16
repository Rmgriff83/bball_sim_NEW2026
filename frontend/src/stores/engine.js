/**
 * engine.js - Pinia store for managing the simulation Web Worker lifecycle.
 *
 * Responsibilities:
 * - Initialize worker on campaign load (with reference data)
 * - Provide reactive state for worker readiness
 * - Terminate worker on navigation away from campaign
 * - Expose the workerManager for direct use by other stores
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { workerManager } from '@/engine/workers/SimulationWorkerManager'
import { StoragePersistence } from '@/engine/db/StoragePersistence'

export const useEngineStore = defineStore('engine', () => {
  // State
  const ready = ref(false)
  const initializing = ref(false)
  const error = ref(null)
  const activeCampaignId = ref(null)

  // Getters
  const isReady = computed(() => ready.value && workerManager.isReady)

  // Actions

  /**
   * Initialize the simulation worker for a campaign.
   * Called when entering a campaign view.
   * Safe to call multiple times — skips if already initialized for this campaign.
   */
  async function initialize(campaignId) {
    // Already initialized for this campaign
    if (activeCampaignId.value === campaignId && ready.value) {
      return
    }

    initializing.value = true
    error.value = null

    try {
      await workerManager.initialize()
      activeCampaignId.value = campaignId
      ready.value = true

      // Request persistent storage on first campaign load (PWA safety)
      StoragePersistence.requestPersistence().catch(() => {})
    } catch (err) {
      error.value = err.message || 'Failed to initialize engine'
      ready.value = false
      throw err
    } finally {
      initializing.value = false
    }
  }

  /**
   * Terminate the worker and reset state.
   * Called when navigating away from a campaign.
   */
  function teardown() {
    workerManager.terminate()
    ready.value = false
    activeCampaignId.value = null
    error.value = null
  }

  /**
   * Get the worker manager instance for direct API calls.
   * Other stores call this to access simulateGame(), processWeekly(), etc.
   */
  function getWorker() {
    if (!ready.value) {
      throw new Error('Engine not initialized. Call initialize(campaignId) first.')
    }
    return workerManager
  }

  return {
    // State
    ready,
    initializing,
    error,
    activeCampaignId,
    // Getters
    isReady,
    // Actions
    initialize,
    teardown,
    getWorker,
  }
})
