#!/usr/bin/env node

// Vendored fork of wl-translate.js for build-time-only translations.
// Differences from the original:
//   - String sources: extracted $t() literals + committed dynamic-strings
//     manifest + game-data dynamicSources from wl-i18n.config.js.
//   - Diff target: local src/locales/{lang}.json files (committed to git),
//     not the CDN. Only strings missing locally are sent to the API.
//   - Output: flat { "English source": "Translated" } maps written locally.
//     The backend still writes its CDN files as a side effect; ignored.
//   - Identity backfill: the API drops results where translated === original;
//     those are stored as identity locally so they are never re-sent.
//   - Placeholder integrity: a translation that loses a {token} present in
//     the source is discarded (source kept) with a warning.
//   - --dry-run prints counts and exits before any API call (no license
//     needed); --no-prune keeps locale keys no longer in the string set.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { extractStrings } from '../src/extractor.js'
import { translateStrings } from '../src/client.js'

const cwd = process.cwd()
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const prune = !argv.includes('--no-prune')
// --soft-fail (used by `npm run release` via translate:release): any failure
// prints a loud warning and exits 0 so a WebLinguist outage can never block a
// release — the build proceeds with the committed locale files and NEW strings
// ship as English fallbacks. Manual `npm run translate` stays hard-fail.
const softFail = argv.includes('--soft-fail')

function fail(message) {
  if (message) console.error(message)
  if (softFail) {
    console.warn('')
    console.warn('⚠⚠⚠ TRANSLATION FAILED — continuing with the COMMITTED locale files. ⚠⚠⚠')
    console.warn('⚠ NEW strings will ship as English fallbacks in this release.')
    console.warn('⚠ Run `npm run translate` when resolved, then ship the updated locales.')
    console.warn('')
    process.exit(0)
  }
  process.exit(1)
}

// Catch-all for unexpected throws (config/dynamicSources/IO) so soft-fail
// covers paths that don't route through fail() explicitly.
process.on('uncaughtException', (err) => {
  fail(`Unexpected error: ${err?.message ?? err}`)
})
process.on('unhandledRejection', (err) => {
  fail(`Unexpected error: ${err?.message ?? err}`)
})

// Minimal .env loader (mirrors scripts/sync-headshot-assets.mjs) so
// WL_LICENSE_KEY / WL_TRANSLATE_API_URL can live in the gitignored
// frontend .env files without a dotenv dependency. Keys are NOT VITE_-
// prefixed on purpose — Vite never exposes them to the client bundle.
// Shell env takes precedence over file values.
{
  const mode = process.env.NODE_ENV || 'production'
  for (const filename of [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env']) {
    const file = resolve(cwd, filename)
    if (!existsSync(file)) continue
    for (const rawLine of readFileSync(file, 'utf-8').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      if (process.env[key] !== undefined) continue
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

// Load config from package.json "wl-i18n" field or wl-i18n.config.js
let config = {}

try {
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf-8'))
  if (pkg['wl-i18n']) config = pkg['wl-i18n']
} catch { /* no package.json */ }

const configPath = resolve(cwd, 'wl-i18n.config.js')
if (existsSync(configPath)) {
  const mod = await import(configPath)
  config = { ...config, ...mod.default }
}

const srcDir = resolve(cwd, config.srcDir || 'src')
const localesDir = resolve(cwd, config.localesDir || 'src/locales')
const manifestPath = resolve(cwd, config.manifest || 'i18n/dynamic-strings.json')
const configTargetLanguages = (config.targetLanguages || []).map(l => l.toLowerCase())
const apiUrl = process.env.WL_TRANSLATE_API_URL || config.apiUrl || 'http://localhost:8090'
const licenseKey = process.env.WL_LICENSE_KEY || config.licenseKey || ''
const sourceLanguage = config.sourceLanguage || 'en'

const isTranslatable = s =>
  typeof s === 'string' && s.trim().length > 0 && !s.includes('${')

// --- Step 1: gather strings from all three sources ---
console.log(`Scanning ${srcDir} for $t() strings...`)
const staticStrings = await extractStrings(srcDir)

let manifestStrings = []
if (existsSync(manifestPath)) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    if (Array.isArray(parsed)) manifestStrings = parsed
  } catch {
    console.warn(`Warning: could not parse manifest at ${manifestPath}; ignoring.`)
  }
}

let dataStrings = []
for (const source of config.dynamicSources || []) {
  const result = await source()
  if (Array.isArray(result)) dataStrings.push(...result)
}

const allStrings = [...new Set(
  [...staticStrings, ...manifestStrings, ...dataStrings].filter(isTranslatable)
)].sort()

console.log(`Sources: static=${staticStrings.length} manifest=${manifestStrings.length} game-data=${dataStrings.length} → union=${allStrings.length}`)

if (allStrings.length === 0) {
  console.log('No strings found. Wrap UI text with $t() first.')
  process.exit(0)
}

// --- Step 2: resolve target languages (license → config fallback) ---
let targetLanguages = []
if (!dryRun && licenseKey && apiUrl) {
  try {
    const baseUrl = apiUrl.replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/api/license/languages?license_key=${licenseKey}`)
    if (response.ok) {
      const data = await response.json()
      if (Array.isArray(data.target_languages) && data.target_languages.length > 0) {
        // License may return BCP47 casing (es-MX); locale files/keys are lowercase.
        targetLanguages = data.target_languages.map(l => l.toLowerCase())
        console.log(`Using ${targetLanguages.length} language(s) from license: ${targetLanguages.join(', ')}`)
      }
    }
  } catch { /* API unavailable, fall back to config */ }
}

if (targetLanguages.length === 0 && configTargetLanguages.length > 0) {
  targetLanguages = configTargetLanguages
  console.log(`Using ${targetLanguages.length} language(s) from config: ${targetLanguages.join(', ')}`)
}

if (targetLanguages.length === 0) {
  fail('Error: No targetLanguages found. Configure them on your license or in wl-i18n.config.js.')
}

// --- Helpers ---
const localePath = lang => resolve(localesDir, `${lang}.json`)

function loadLocaleFile(lang) {
  const p = localePath(lang)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    console.warn(`Warning: could not parse ${p}; treating as empty.`)
    return {}
  }
}

function writeLocaleFile(lang, map) {
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]))
  mkdirSync(localesDir, { recursive: true })
  writeFileSync(localePath(lang), JSON.stringify(sorted, null, 2) + '\n')
}

const TOKEN_RE = /\{[a-zA-Z0-9_]+\}/g

function placeholdersIntact(source, translated) {
  const tokens = source.match(TOKEN_RE) || []
  return tokens.every(tok => translated.includes(tok))
}

// --- Dry run: report per-language deltas and exit before any API call ---
if (dryRun) {
  for (const lang of targetLanguages) {
    const existing = loadLocaleFile(lang)
    const newStrings = allStrings.filter(s => !(s in existing))
    const stale = prune ? Object.keys(existing).filter(k => !allStrings.includes(k)).length : 0
    console.log(`[${lang}] ${Object.keys(existing).length} existing, ${newStrings.length} new to translate${stale ? `, ${stale} stale (would prune)` : ''}`)
  }
  console.log('Dry run — no API calls made, no files written.')
  process.exit(0)
}

if (!licenseKey) {
  fail('Error: No license key configured. Set WL_LICENSE_KEY env var (or run with --dry-run).')
}

// --- Step 3: per language, translate the diff and write the locale file ---
const allSet = new Set(allStrings)
let hadFailure = false

for (const lang of targetLanguages) {
  const existing = loadLocaleFile(lang)
  const newStrings = allStrings.filter(s => !(s in existing))
  const merged = { ...existing }

  if (newStrings.length === 0) {
    console.log(`[${lang}] Up to date (${Object.keys(existing).length} strings).`)
  } else {
    console.log(`[${lang}] Translating ${newStrings.length} new string(s) (${Object.keys(existing).length} existing)...`)

    const BATCH_SIZE = 50
    const totalBatches = Math.ceil(newStrings.length / BATCH_SIZE)
    let batchNum = 0
    let failed = false

    for (let i = 0; i < newStrings.length; i += BATCH_SIZE) {
      const batch = newStrings.slice(i, i + BATCH_SIZE)
      batchNum++
      if (totalBatches > 1) {
        process.stdout.write(`[${lang}]   batch ${batchNum}/${totalBatches} (${batch.length} strings)...`)
      }

      let translations
      try {
        translations = await translateStrings(batch, lang, {
          apiUrl,
          licenseKey,
          sourceLanguage,
          fileType: 'static'
        })
      } catch (err) {
        console.error(`\n[${lang}] Translation failed on batch ${batchNum}: ${err.message}`)
        failed = true
        hadFailure = true
        break
      }

      let translated = 0
      for (const s of batch) {
        const result = translations[s]
        if (result && result !== s) {
          if (placeholdersIntact(s, result)) {
            merged[s] = result
            translated++
          } else {
            console.warn(`\n[${lang}] Placeholder lost in translation of: ${JSON.stringify(s)} → keeping source.`)
            merged[s] = s
          }
        } else {
          // Identity backfill: the API omits results where translated ===
          // original; store identity so the string is never re-sent.
          merged[s] = s
        }
      }

      if (totalBatches > 1) console.log(` ${translated} translated.`)

      // Persist after every batch so an interrupted run (Ctrl+C, network
      // drop) resumes exactly where it left off — the next run's local diff
      // only re-sends strings that never landed.
      writeLocaleFile(lang, merged)
    }

    if (!failed) {
      console.log(`[${lang}] Done: ${newStrings.length} new string(s) resolved.`)
    }
  }

  if (prune) {
    for (const key of Object.keys(merged)) {
      if (!allSet.has(key)) delete merged[key]
    }
  }

  writeLocaleFile(lang, merged)
}

if (hadFailure) {
  fail('Finished with errors.')
}
console.log('Done.')
process.exit(0)
