#!/usr/bin/env node
// =============================================================================
// audit-i18n-coverage.js
// =============================================================================
// Guardrail for the build-time i18n pipeline (vendor/wl-i18n). Checks:
//
//   1. Bare text nodes in in-scope .vue templates (should be {{ $t('...') }}).
//   2. Unbound literal placeholder=/title=/alt= attributes (should be :bound
//      through $t). aria-label is deliberately exempt — main.js keys the
//      cancel-SFX heuristic on English aria-label values.
//   3. Template literals inside $t(` / tDynamic(` calls — the extractor only
//      matches quoted single-line literals, so these silently never translate.
//   4. Locale-file placeholder integrity: every {token} in a source key must
//      survive in its translation ({token}s are interpolated at runtime).
//
// (Scheme duplication between GameConfig.js and CoachingEngine.js is handled
// in wl-i18n.config.js by extracting from BOTH files — they had already
// drifted when this audit was written, so parity can't be enforced here.)
//
// Suppression: put <!-- i18n-ignore --> on the line above a template line to
// skip it, or add exact strings to ALLOWED_TEXT below.
//
// Run via `npm run audit:i18n`. Wired into `prebuild` once the UI wrap is
// complete.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Out of scope for translation (internal tooling).
const EXCLUDED_DIRS = [
  join(ROOT, 'src/views/admin'),
  join(ROOT, 'src/components/admin'),
]

// Exact text nodes that are legitimately untranslated: stat/position
// abbreviations, universal notation, endonyms in the language picker.
const ALLOWED_TEXT = new Set([
  'VS', 'vs', 'OVR', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F',
  'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'MIN', 'GP', 'W', 'L',
  'FG', 'FGA', 'FG%', '3PT', '3PA', '3P%', 'FT', 'FTA', 'FT%', '+/-', 'PER',
  'English', 'Español', 'Português', 'Français', 'Deutsch', 'Italiano', 'Română',
  'OK', 'ok', 'X', 'x', 'i',
])

function listVueFiles(dirOrFile) {
  const abs = join(ROOT, dirOrFile)
  let stat
  try {
    stat = statSync(abs)
  } catch {
    return []
  }
  if (stat.isFile()) return abs.endsWith('.vue') ? [abs] : []
  if (EXCLUDED_DIRS.some(d => abs === d || abs.startsWith(d + '/'))) return []
  const out = []
  for (const entry of readdirSync(abs)) {
    out.push(...listVueFiles(join(dirOrFile, entry)))
  }
  return out
}

const vueFiles = [
  ...listVueFiles('src'),
  join(ROOT, 'src/App.vue'),
].filter((v, i, a) => a.indexOf(v) === i)

const problems = { bareText: [], literalAttrs: [], templateLiterals: [], bareFormatters: [], localeTokens: [] }

// --- Checks 1 & 2: template text nodes and literal attributes -------------
const HAS_WORD = /[A-Za-z]{2,}/

for (const file of vueFiles) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)

  const tplStart = src.indexOf('<template>')
  const tplEnd = src.lastIndexOf('</template>')
  if (tplStart === -1 || tplEnd === -1) continue
  const template = src.slice(tplStart, tplEnd)

  const lines = template.split('\n')
  const tplLineOffset = src.slice(0, tplStart).split('\n').length - 1

  let inComment = false
  let ignoreNext = false
  let inTag = false
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    let line = rawLine

    // Track/strip HTML comments (incl. multi-line) and i18n-ignore markers.
    if (inComment) {
      const end = line.indexOf('-->')
      if (end === -1) continue
      line = line.slice(end + 3)
      inComment = false
    }
    line = line.replace(/<!--.*?-->/g, m => {
      if (m.includes('i18n-ignore')) ignoreNext = true
      return ''
    })
    const openIdx = line.indexOf('<!--')
    if (openIdx !== -1) {
      if (line.slice(openIdx).includes('i18n-ignore')) ignoreNext = true
      line = line.slice(0, openIdx)
      inComment = true
    }

    if (ignoreNext && line.trim() !== '') {
      // This is the first content line after an i18n-ignore comment — skip it.
      ignoreNext = false
      continue
    }

    const lineNo = tplLineOffset + i + 1

    // Check 2: unbound literal user-facing attributes ("placeholder=", not
    // ":placeholder="). aria-label intentionally exempt.
    for (const m of line.matchAll(/(^|[^:\w-])(placeholder|title|alt)="([^"]*)"/g)) {
      if (HAS_WORD.test(m[3]) && !ALLOWED_TEXT.has(m[3].trim())) {
        problems.literalAttrs.push(`${rel}:${lineNo} ${m[2]}="${m[3]}"`)
      }
    }

    // Check 1b: bare multi-word string literals inside mustache expressions
    // (ternaries like {{ cond ? 'Dark Mode' : 'Light Mode' }}) — invisible to
    // the bare-text check because mustaches are stripped. Multi-word only, so
    // enum keys ('settings') and class names don't false-positive.
    for (const mm of line.matchAll(/\{\{(.*?)\}\}/g)) {
      const expr = mm[1]
      if (/\$t(?:Dynamic)?\(|tDynamic\(/.test(expr)) continue
      for (const lit of expr.matchAll(/(['"])((?:(?!\1).)*?)\1/g)) {
        const s = lit[2]
        if (/[A-Za-z]{2,}\s+[A-Za-z]/.test(s) && !ALLOWED_TEXT.has(s.trim())) {
          problems.bareText.push(`${rel}:${lineNo} mustache literal "${s.length > 50 ? s.slice(0, 47) + '...' : s}"`)
        }
      }
    }

    // Check 1: bare text nodes. Strip mustaches and attribute strings, then
    // inspect what sits between tags / around them.
    const stripped = line
      .replace(/\{\{.*?\}\}/g, '')
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")
    for (const m of stripped.matchAll(/>([^<>{}]+)</g)) {
      const text = m[1].trim()
      if (text && HAS_WORD.test(text) && !ALLOWED_TEXT.has(text)) {
        problems.bareText.push(`${rel}:${lineNo} "${text.length > 60 ? text.slice(0, 57) + '...' : text}"`)
      }
    }
    // Text node occupying a whole line (between a tag on the previous line
    // and one on the next), e.g. multi-line <p> content. Track open-tag state
    // so attribute/expression lines inside a multi-line tag (`class="x"`,
    // `:class="[` continuations, `v-else`) aren't misread as text nodes.
    const wasInTag = inTag
    const lastOpen = stripped.lastIndexOf('<')
    const lastClose = stripped.lastIndexOf('>')
    if (lastOpen > lastClose) inTag = true
    else if (lastClose > lastOpen) inTag = false
    const bare = stripped.trim()
    if (
      !wasInTag && !inTag &&
      bare && !bare.includes('<') && !bare.includes('>') &&
      HAS_WORD.test(bare) && !ALLOWED_TEXT.has(bare)
    ) {
      problems.bareText.push(`${rel}:${lineNo} "${bare.length > 60 ? bare.slice(0, 57) + '...' : bare}"`)
    }
  }

  // Check 3: template literals inside translation calls (whole file, script too).
  const srcLines = src.split('\n')
  for (let i = 0; i < srcLines.length; i++) {
    if (/(?:\$t|\$tDynamic|(?<![a-zA-Z_.$])t|(?<![a-zA-Z_.])tDynamic)\(\s*`/.test(srcLines[i])) {
      problems.templateLiterals.push(`${rel}:${i + 1}`)
    }
  }

  // Check 3b: bare display-formatter calls in template mustaches — helpers
  // named format*Name / *DisplayName return translatable text and must be
  // rendered through $tDynamic (a bare call silently shows English). A
  // formatter that calls tDynamic() INTERNALLY (LeagueView convention) is
  // exempt — detected by inspecting its function body in this file.
  const translatesInternally = (name) => {
    const defIdx = src.search(new RegExp(`function ${name}\\s*\\(`))
    if (defIdx === -1) return false
    return /\btDynamic\(/.test(src.slice(defIdx, defIdx + 500))
  }
  const tplOnly = template.split('\n')
  for (let i = 0; i < tplOnly.length; i++) {
    for (const m of tplOnly[i].matchAll(/\{\{[^}]*?((format[A-Z]\w*Name|badgeDisplayName)\()/g)) {
      // Allow when wrapped anywhere inside the same mustache, or when the
      // formatter translates internally.
      const mustache = tplOnly[i].slice(tplOnly[i].lastIndexOf('{{', m.index))
      if (/(?:\$)?tDynamic\(\s*(?:format[A-Z]\w*Name|badgeDisplayName)\(/.test(mustache)) continue
      if (translatesInternally(m[2])) continue
      problems.bareFormatters.push(`${rel}:${tplLineOffset + i + 1} ${m[1]}...)`)
    }
  }
}

// Check 3 for .js files under src (stores, services, composables, engine).
function listJsFiles(dirOrFile) {
  const abs = join(ROOT, dirOrFile)
  let stat
  try {
    stat = statSync(abs)
  } catch {
    return []
  }
  if (stat.isFile()) return abs.endsWith('.js') ? [abs] : []
  const out = []
  for (const entry of readdirSync(abs)) {
    out.push(...listJsFiles(join(dirOrFile, entry)))
  }
  return out
}

for (const file of listJsFiles('src')) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  const srcLines = src.split('\n')
  for (let i = 0; i < srcLines.length; i++) {
    if (/(?:\$t|\$tDynamic|(?<![a-zA-Z_.$])t|(?<![a-zA-Z_.])tDynamic)\(\s*`/.test(srcLines[i])) {
      problems.templateLiterals.push(`${rel}:${i + 1}`)
    }
  }
}

// --- Check 4: locale-file placeholder integrity ---------------------------
const TOKEN_RE = /\{[a-zA-Z0-9_]+\}/g
const localesDir = join(ROOT, 'src/locales')
if (existsSync(localesDir)) {
  for (const entry of readdirSync(localesDir)) {
    if (!entry.endsWith('.json')) continue
    let map
    try {
      map = JSON.parse(readFileSync(join(localesDir, entry), 'utf8'))
    } catch {
      problems.localeTokens.push(`src/locales/${entry}: unparseable JSON`)
      continue
    }
    for (const [key, value] of Object.entries(map)) {
      const tokens = key.match(TOKEN_RE) || []
      for (const tok of tokens) {
        if (!String(value).includes(tok)) {
          problems.localeTokens.push(`src/locales/${entry}: ${tok} lost in translation of "${key.slice(0, 50)}"`)
        }
      }
    }
  }
}

// --- Report ----------------------------------------------------------------
const sections = [
  ['Bare template text (wrap in $t)', problems.bareText],
  ['Literal placeholder/title/alt attributes (bind through $t)', problems.literalAttrs],
  ['Template literals inside $t()/tDynamic() (extractor cannot see these)', problems.templateLiterals],
  ['Bare display-formatter in template (wrap in $tDynamic)', problems.bareFormatters],
  ['Locale placeholder integrity', problems.localeTokens],
]

let total = 0
for (const [title, list] of sections) {
  if (!list.length) continue
  total += list.length
  console.log(`\n✗ ${title}: ${list.length}`)
  const MAX = process.env.I18N_AUDIT_FULL ? Infinity : 25
  for (const item of list.slice(0, MAX)) console.log(`   ${item}`)
  if (list.length > MAX) console.log(`   ... and ${list.length - MAX} more (set I18N_AUDIT_FULL=1 for all)`)
}

if (total) {
  console.log(`\ni18n audit: ${total} problem(s).`)
  process.exit(1)
}
console.log('i18n audit: OK')
