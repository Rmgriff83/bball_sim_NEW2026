import { generateContentHash } from './lib/hash/hashGenerator.js'

/**
 * Translate an array of strings via the app translation API.
 * Dispatches to the queue and polls for completion.
 *
 * @param {string[]} strings - Source strings to translate
 * @param {string} targetLanguage - Target language code (e.g. "es")
 * @param {Object} options
 * @param {string} options.apiUrl - Base URL of the API (e.g. "https://api.weblinguist.ai")
 * @param {string} options.licenseKey - App license key
 * @param {string} [options.sourceLanguage='en'] - Source language code
 * @param {string} [options.fileType='static'] - 'static' or 'dynamic'
 * @returns {Promise<Object>} Dictionary of { "source string": "translated string" }
 */
export async function translateStrings(strings, targetLanguage, { apiUrl, licenseKey, sourceLanguage = 'en', fileType = 'static' }) {
  const texts = strings.map(text => ({
    text,
    hash_id: generateContentHash(text)
  }))

  const baseUrl = apiUrl.replace(/\/$/, '')

  const response = await fetch(`${baseUrl}/api/ai/app-translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      license_key: licenseKey,
      texts,
      target_language: targetLanguage,
      source_language: sourceLanguage,
      file_type: fileType,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Translation API returned ${response.status}: ${body}`)
  }

  const data = await response.json()

  if (!data.success) {
    throw new Error(`Translation API error: ${data.error || 'Unknown error'}`)
  }

  // Async response — poll for completion
  if (response.status === 202 && data.batch_id) {
    return await pollBatchCompletion(baseUrl, data.batch_id, licenseKey)
  }

  // Legacy sync response (shouldn't happen anymore, but kept for safety)
  const dict = {}
  for (const item of data.translations) {
    dict[item.original] = item.translated
  }
  return dict
}

/**
 * Poll batch status until completed or failed.
 *
 * @param {string} baseUrl
 * @param {string} batchId
 * @param {string} licenseKey
 * @returns {Promise<Object>} Dictionary of { "source string": "translated string" }
 */
async function pollBatchCompletion(baseUrl, batchId, licenseKey) {
  const POLL_INTERVAL = 2000 // 2 seconds
  const MAX_WAIT = 300000    // 5 minutes

  const startTime = Date.now()

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL)

    const statusResponse = await fetch(
      `${baseUrl}/api/ai/batch/${batchId}/status?license_key=${licenseKey}`
    )

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) {
        throw new Error(`Batch ${batchId} not found or expired`)
      }
      continue // Retry on transient errors
    }

    const statusData = await statusResponse.json()
    const status = statusData.st || statusData.status

    if (status === 'completed') {
      // Build dictionary from results
      // Response uses shortened keys: r.t = translations array, each with o=original, r=translated
      const dict = {}
      const results = statusData.r || statusData.results || {}
      const translations = results.t || results.translations || []
      if (Array.isArray(translations)) {
        for (const item of translations) {
          const original = item.o || item.original
          const translated = item.r || item.translated
          if (original && translated && original !== translated) {
            dict[original] = translated
          }
        }
      }
      return dict
    }

    if (status === 'failed') {
      throw new Error(`Translation batch ${batchId} failed: ${statusData.error || 'Unknown error'}`)
    }

    // Still processing — continue polling
  }

  throw new Error(`Translation batch ${batchId} timed out after ${MAX_WAIT / 1000}s`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
