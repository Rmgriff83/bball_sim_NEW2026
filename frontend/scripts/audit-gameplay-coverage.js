#!/usr/bin/env node
// =============================================================================
// audit-gameplay-coverage.js
// =============================================================================
// Permanent guardrail: every player attribute defined in `attributeSchema.js`
// and every badge defined in `badges.js` MUST be consumed by the simulation
// engine. Cosmetic-only entries can be explicitly allow-listed in
// `cosmeticAllowlist.js`.
//
// Run via `npm run audit:gameplay`. Wired into the build via `prebuild`, so
// CI fails when someone adds a new attribute/badge without wiring it up.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Files / directories scanned for attribute & badge consumption. The audit
// fails on entries that don't appear in ANY of these.
const SIM_PATHS = [
  'src/engine/simulation',
  'src/engine/coaching',
  'src/engine/data/plays.js',
  'src/engine/data/badgeKeysByAction.js',
]

// Files where a definition counts as "self-reference" and is NOT credit toward
// the consumer search.
const DEFINITION_FILES = [
  'src/engine/data/attributeSchema.js',
  'src/engine/data/badges.js',
  'src/engine/data/playerBadgeStore.js',
]

function loadDataModule(relPath) {
  // Read raw text — we parse with regex so this script has no compile-time
  // dependency on the rest of the codebase.
  return readFileSync(join(ROOT, relPath), 'utf8')
}

function listFilesRecursive(dirOrFile) {
  const abs = join(ROOT, dirOrFile)
  let stat
  try {
    stat = statSync(abs)
  } catch {
    return []
  }
  if (stat.isFile()) return [abs]
  const out = []
  for (const entry of readdirSync(abs)) {
    out.push(...listFilesRecursive(join(dirOrFile, entry)))
  }
  return out
}

function readAttributeNames() {
  const src = loadDataModule('src/engine/data/attributeSchema.js')
  // Capture every quoted identifier inside the CANONICAL_ATTRIBUTES object.
  const block = src.match(/CANONICAL_ATTRIBUTES\s*=\s*{([\s\S]*?)\n}/)
  if (!block) throw new Error('Could not locate CANONICAL_ATTRIBUTES block')
  const names = new Set()
  for (const m of block[1].matchAll(/'([a-zA-Z][a-zA-Z0-9_]*)'/g)) {
    names.add(m[1])
  }
  return [...names]
}

function readBadges() {
  const src = loadDataModule('src/engine/data/badges.js')
  const badges = []
  // Each badge declaration looks like: { id: 'foo', name: ..., effects: { ... } }
  const re = /id:\s*'([a-z0-9_]+)'[\s\S]*?effects:\s*{\s*([\s\S]*?)}\s*}/g
  let match
  while ((match = re.exec(src)) !== null) {
    const id = match[1]
    const effectsBlock = match[2]
    const effectKeys = new Set()
    for (const km of effectsBlock.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]+)\s*:\s*[\d.]+/g)) {
      // Skip tier names themselves
      if (['bronze', 'silver', 'gold', 'hof'].includes(km[1])) continue
      effectKeys.add(km[1])
    }
    badges.push({ id, effectKeys: [...effectKeys] })
  }
  return badges
}

function readAllowlist() {
  try {
    const src = loadDataModule('src/engine/data/cosmeticAllowlist.js')
    const attributes = new Set()
    const badges = new Set()
    const attrBlock = src.match(/attributes\s*:\s*\[([\s\S]*?)\]/)
    if (attrBlock) {
      for (const m of attrBlock[1].matchAll(/'([a-zA-Z0-9_]+)'/g)) attributes.add(m[1])
    }
    const badgeBlock = src.match(/badges\s*:\s*\[([\s\S]*?)\]/)
    if (badgeBlock) {
      for (const m of badgeBlock[1].matchAll(/'([a-zA-Z0-9_]+)'/g)) badges.add(m[1])
    }
    return { attributes, badges }
  } catch {
    return { attributes: new Set(), badges: new Set() }
  }
}

function readSimSources() {
  const files = []
  for (const p of SIM_PATHS) files.push(...listFilesRecursive(p))
  const sources = {}
  for (const f of files) {
    const rel = relative(ROOT, f)
    if (DEFINITION_FILES.includes(rel)) continue
    if (!f.endsWith('.js')) continue
    sources[rel] = readFileSync(f, 'utf8')
  }
  return sources
}

function isReferenced(name, sources) {
  // Word-boundary match. Allow trailing `.` `,` `(` etc. so we don't get
  // false-positives on substrings (e.g. `block` should not match `blockId`).
  const re = new RegExp(`\\b${name}\\b`)
  for (const src of Object.values(sources)) {
    if (re.test(src)) return true
  }
  return false
}

function main() {
  const attributeNames = readAttributeNames()
  const badges = readBadges()
  const allow = readAllowlist()
  const sources = readSimSources()

  const deadAttributes = []
  for (const attr of attributeNames) {
    if (allow.attributes.has(attr)) continue
    if (!isReferenced(attr, sources)) deadAttributes.push(attr)
  }

  const deadBadges = []
  const badgesWithoutAnyEffectRef = []
  for (const badge of badges) {
    if (allow.badges.has(badge.id)) continue
    const idHit = isReferenced(badge.id, sources)
    const anyEffectHit = badge.effectKeys.some(k => isReferenced(k, sources))
    if (!idHit && !anyEffectHit) {
      deadBadges.push(badge.id)
    } else if (!anyEffectHit) {
      // Badge id is referenced (e.g. listed in plays.js badgeEffects arrays)
      // but none of its effect keys are read by the simulation. That's the
      // "cosmetic-but-tracked" failure mode we want to flag.
      badgesWithoutAnyEffectRef.push(badge.id)
    }
  }

  // Effect keys referenced in plays.js that don't match any defined badge id —
  // catches the `tear_dropper` drift class.
  const playsSrc = sources['src/engine/data/plays.js'] || ''
  const referencedBadgeIds = new Set()
  for (const m of playsSrc.matchAll(/badgeEffects\s*:\s*{([\s\S]*?)}/g)) {
    for (const idMatch of m[1].matchAll(/'([a-z0-9_]+)'/g)) {
      referencedBadgeIds.add(idMatch[1])
    }
  }
  const knownIds = new Set(badges.map(b => b.id))
  const unknownReferences = [...referencedBadgeIds].filter(id => !knownIds.has(id))

  const total = attributeNames.length + badges.length
  const wired = total - deadAttributes.length - deadBadges.length - badgesWithoutAnyEffectRef.length
  console.log(`\n— Gameplay coverage audit —`)
  console.log(`Attributes: ${attributeNames.length - deadAttributes.length}/${attributeNames.length} wired`)
  console.log(`Badges:     ${badges.length - deadBadges.length - badgesWithoutAnyEffectRef.length}/${badges.length} wired`)
  console.log(`Total:      ${wired}/${total}`)

  let failed = false
  if (deadAttributes.length > 0) {
    failed = true
    console.log(`\nDead attributes (defined but never read by sim/coaching/plays):`)
    for (const a of deadAttributes) console.log(`  - ${a}`)
  }
  if (deadBadges.length > 0) {
    failed = true
    console.log(`\nDead badges (id never referenced AND no effect key consumed):`)
    for (const b of deadBadges) console.log(`  - ${b}`)
  }
  if (badgesWithoutAnyEffectRef.length > 0) {
    failed = true
    console.log(`\nBadges referenced by id only (no effect key consumed by sim — cosmetic):`)
    for (const b of badgesWithoutAnyEffectRef) console.log(`  - ${b}`)
  }
  if (unknownReferences.length > 0) {
    failed = true
    console.log(`\nplays.js references badge ids that don't exist in badges.js:`)
    for (const id of unknownReferences) console.log(`  - ${id}`)
  }
  if (failed) {
    console.log(`\nFix: wire each entry into GameSimulator.js / PlayExecutionEngine.js / plays.js / CoachingEngine.js,`)
    console.log(`or add it to src/engine/data/cosmeticAllowlist.js if it's intentionally display-only.\n`)
    process.exit(1)
  }
  console.log(`\nAll attributes & badges have at least one gameplay consumer. ✓\n`)
}

main()
