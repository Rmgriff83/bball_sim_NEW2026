import { t, tDynamic, setLocale, setConfig, getConfig, loadLocaleMessages, loadLocale, availableLocales, currentLocale, messages } from './i18n.js'
import TDynamic from './TDynamic.vue'

/**
 * Detect the best locale. Priority:
 * 1. localStorage 'language' (explicit user choice)
 * 2. Browser language (navigator.language / navigator.languages)
 * 3. Source language fallback
 *
 * Browser language matching tries exact match first (e.g. "fr-FR"),
 * then base code (e.g. "fr"), against the configured target languages.
 */
function detectLocale(sourceLanguage, targetLanguages) {
  // 1. Explicit user selection — including 'en': a French-device user who
  // deliberately switches to English must NOT be bounced back to French by
  // the browser-language fallback on next launch.
  let saved = null
  try { saved = localStorage.getItem('language') } catch { /* noop */ }
  if (saved) return saved.toLowerCase()

  // 2. Browser language fallback — use only the PRIMARY browser language.
  // navigator.languages contains ALL configured languages in preference order,
  // so iterating the full list would match secondary languages the user doesn't
  // want as their default (e.g. ['en-US', 'en', 'fr'] would pick 'fr' even
  // though the user switched back to English as primary).
  try {
    const primary = (navigator.languages?.[0] || navigator.language || '').toLowerCase()
    if (primary) {
      // Skip if primary language matches source (e.g. en-US when source is en)
      const primaryBase = primary.split('-')[0]
      if (primaryBase !== sourceLanguage) {
        if (targetLanguages.includes(primary)) return primary
        if (primaryBase !== primary && targetLanguages.includes(primaryBase)) return primaryBase
      }
    }
  } catch { /* SSR */ }

  return sourceLanguage
}

/**
 * Vue plugin for the vendored wl-i18n (build-time-only translations).
 *
 * Usage:
 *   import I18nPlugin from '@wl-i18n/plugin.js'
 *   app.use(I18nPlugin, { sourceLanguage: 'en' })
 *
 * targetLanguages defaults to the locale files present in /src/locales/,
 * so adding a generated locale automatically enables it.
 */
export default {
  install(app, options = {}) {
    const sourceLanguage = options.sourceLanguage || 'en'
    const targetLanguages = (options.targetLanguages?.length
      ? options.targetLanguages
      : availableLocales()
    ).map(l => l.toLowerCase())

    setConfig({ sourceLanguage, targetLanguages })

    // Detect locale from localStorage, browser language, or fallback
    const detected = detectLocale(sourceLanguage, targetLanguages)
    if (detected !== sourceLanguage) {
      currentLocale.value = detected
      loadLocale(detected) // fire-and-forget; UI shows English until the chunk lands
    }

    // Register $t and $tDynamic as global properties
    app.config.globalProperties.$t = t
    app.config.globalProperties.$tDynamic = tDynamic

    // Register global components
    app.component('TDynamic', TDynamic)

    // Provide via inject('i18n') for Composition API usage
    app.provide('i18n', { t, tDynamic, setLocale, getConfig, loadLocaleMessages, loadLocale, availableLocales, currentLocale, messages })
  }
}
