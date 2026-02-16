export const StoragePersistence = {
  async requestPersistence() {
    if (!navigator.storage?.persist) return false

    const isPersisted = await navigator.storage.persisted()
    if (isPersisted) return true

    return navigator.storage.persist()
  },

  async checkPersistence() {
    if (!navigator.storage?.persisted) return false
    return navigator.storage.persisted()
  },

  async getStorageEstimate() {
    if (!navigator.storage?.estimate) return null

    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage,
      quota: estimate.quota,
      usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2),
    }
  },
}
