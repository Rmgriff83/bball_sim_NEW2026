// Config for vendor/wl-i18n/bin/translate.js (npm run translate).
//
// dynamicSources enumerate game-data display strings that reach the UI via
// $tDynamic() lookups (never via $t() literals, so the extractor can't see
// them). Each is an async fn returning string[]; they run under plain Node,
// so every imported data module must stay import-free (they currently are).
// Proper nouns (player/coach/owner names, team names/cities) are deliberately
// excluded — they are never translated.
import { readFileSync } from 'node:fs'

const labelRegex = (file, re) =>
  [...readFileSync(new URL(file, import.meta.url), 'utf-8').matchAll(re)].map(m => m[1])

// Extract quoted display strings from a module-level const block inside a file
// (used for .vue files, which plain Node can't import). `marker` is the const's
// opening text; extraction stops at the block's closing bracket line.
const blockStrings = (file, marker, re = /(?:label|title|description):\s*(['"])((?:(?!\1).)*)\1/g) => {
  const src = readFileSync(new URL(file, import.meta.url), 'utf-8')
  const start = src.indexOf(marker)
  if (start === -1) return []
  const end = src.slice(start).search(/\n[}\]]/)
  const block = end === -1 ? src.slice(start) : src.slice(start, start + end + 2)
  return [...block.matchAll(re)].map(m => m[2] ?? m[1])
}

export default {
  srcDir: 'src',
  localesDir: 'src/locales',
  manifest: 'i18n/dynamic-strings.json',
  sourceLanguage: 'en',
  // Fallback if the license languages fetch fails (and used by --dry-run).
  targetLanguages: ['es', 'pt', 'fr', 'de', 'it', 'ro'],
  dynamicSources: [
    async () => (await import('./src/engine/data/badges.js')).BADGES.flatMap(b => [b.name, b.description]),
    async () => (await import('./src/engine/data/plays.js')).PLAYS.map(p => p.name),
    async () => (await import('./src/engine/data/achievements.js')).ACHIEVEMENTS.flatMap(a => [a.name, a.description]),
    async () => (await import('./src/engine/data/synergies.js')).SYNERGIES.flatMap(s => [s.synergy_name, s.description]),
    async () => (await import('./src/engine/data/coachBadges.js')).coachBadges.flatMap(b => [b.name, b.description]),
    async () => {
      const m = await import('./src/engine/data/personnelTiers.js')
      return [m.SCOUT_TIERS, m.PHYSICIAN_TIERS, m.STAFF_TRAINER_TIERS, m.ANALYST_TIERS]
        .flatMap(tiers => Object.values(tiers))
        .flatMap(tier => [tier.label, ...(tier.perks ?? []).flatMap(p => [p.label, p.description])])
    },
    // Archetype names double as badge-tag lookup keys — translated at render
    // time only; the data objects are never mutated.
    async () => (await import('./src/engine/data/archetypes.js')).ARCHETYPE_NAMES,
    async () => {
      const m = await import('./src/engine/data/owners.js')
      return [
        ...m.OWNERS.flatMap(o => [o.wealthSource, o.blurb]), // first/last names excluded (proper nouns)
        ...Object.values(m.EXPECTATION_LABEL),
        ...Object.values(m.EXPECTATION_BLURB_DEFAULT),
        ...Object.values(m.PATIENCE_LABEL),
        ...Object.values(m.MONEY_CONSCIOUSNESS_LABEL),
      ]
    },
    // Module-level display consts inside .vue files, rendered via $tDynamic —
    // Node can't import SFCs, so extract the const blocks by regex.
    async () => [
      ...blockStrings('./src/views/store/StoreView.vue', 'const unlockBundles = ['),
      ...blockStrings('./src/components/store/HeadshotEditorPromoModal.vue', 'const perks = [', /'((?:[^'\\]|\\.)+)'/g),
      ...blockStrings('./src/components/store/RosterEditorPromoModal.vue', 'const perks = [', /'((?:[^'\\]|\\.)+)'/g),
      ...blockStrings('./src/components/common/PersonnelAvatar.vue', 'const KIND_LABELS = {', /:\s*'((?:[^'\\]|\\.)+)'/g),
      'Personnel', // KIND_LABELS fallback in PersonnelAvatar
      ...blockStrings('./src/components/trade/TradeCenter.vue', 'const wizardSteps = ['),
      ...blockStrings('./src/views/roster/RosterSetupView.vue', 'const TALENT_TIERS = ['),
      ...blockStrings('./src/views/roster/DraftClassEditorView.vue', 'const ADD_TIERS = ['),
    ],
    // Campaign-create modal option cards (module consts in CampaignsView)
    // + GM career level tier labels.
    async () => [
      ...blockStrings('./src/views/dashboard/CampaignsView.vue', 'const leagueRosterOptions = ['),
      ...blockStrings('./src/views/dashboard/CampaignsView.vue', 'const draftModes = ['),
      ...blockStrings('./src/views/dashboard/CampaignsView.vue', 'const difficulties = ['),
      ...Object.values((await import('./src/engine/data/gmLevels.js')).GM_LEVEL_LABEL),
      'Unranked', // gmLevelLabel() fallback
    ],
    // Draft-board attribute tooltip names (full names shown on hover; the
    // short chip labels like CLS/MID stay untranslated abbreviations).
    async () => (await import('./src/utils/draftAttributes.js')).DRAFT_ATTRIBUTES.map(a => a.name),
    // Attribute display names are DERIVED at runtime (camelCase key →
    // "Close Shot" via formatAttrName in PlayerDetailModal) — replicate the
    // transform over the canonical key list so the derived strings translate.
    async () => {
      const m = await import('./src/engine/data/attributeSchema.js')
      return m.SCOUTABLE_ATTRIBUTES.map(key =>
        key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
      )
    },
    // Draft-night commentary templates (T() calls + *_TPLS pools; the
    // DraftAnnouncer's own t() literals are caught by the normal extractor).
    async () => {
      const src = readFileSync(new URL('./src/engine/draft/draftCommentary.js', import.meta.url), 'utf-8')
      return [
        ...[...src.matchAll(/\bT\(\s*(['"])((?:(?!\1).)*)\1/g)].map(m => m[2]),
        ...[...src.matchAll(/_TPLS = \[[\s\S]*?\n\]/g)].flatMap(block =>
          [...block[0].matchAll(/(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(m => m[2].replace(/\\'/g, "'"))
        ),
      ]
    },
    // Owner check-in dialogue templates (T() calls + *_TPLS pools, same
    // recipe as the news/PBP sources).
    async () => {
      const src = readFileSync(new URL('./src/engine/season/OwnerCheckInService.js', import.meta.url), 'utf-8')
      return [
        ...[...src.matchAll(/\bT\(\s*(['"])((?:(?!\1).)*)\1/g)].map(m => m[2]),
        // Pools are arrays OR keyed objects ({...}) — match both.
        ...[...src.matchAll(/_TPLS = [\[{][\s\S]*?\n[\]}]/g)].flatMap(block =>
          [...block[0].matchAll(/(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(m => m[2].replace(/\\'/g, "'"))
        ),
      ]
    },
    // Season-achievement labels + subtitle template (CampaignManager
    // _pushAchievement / achievements backfill — persisted records; old ones
    // fall back to stored English at render).
    async () => ['League Champions', 'Conference Champions', 'Playoff Berth', '{years} Season'],
    // Breaking-news category chips ('TRADE', 'DEADLINE', …) — persisted with
    // news records and used as logic keys; translated at display only.
    async () => labelRegex('./src/engine/season/BreakingNewsService.js', /category:\s*'((?:[^'\\]|\\.)+)'/g),
    // Personality trait display names — derived at runtime from the
    // PERSONALITY_TRAITS ids ('team_player' → 'Team Player'); replicate the
    // transform (CampaignManager imports app code, so regex the array).
    async () => {
      const src = readFileSync(new URL('./src/engine/campaign/CampaignManager.js', import.meta.url), 'utf-8')
      const m = src.match(/PERSONALITY_TRAITS = \[([^\]]*)\]/)
      if (!m) return []
      return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x =>
        x[1].split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
      )
    },
    // Owner sub-task catalog (label/description shown in check-in modal
    // task rows + OwnerTab). Static strings; regex the whole file.
    async () => labelRegex('./src/engine/season/OwnerSubtaskService.js', /(?:label|description):\s*'((?:[^'\\]|\\.)*)'/g).map(s => s.replace(/\\'/g, "'")),
    // Owner championship-congrats dialogue + reward rows (module consts in
    // the .vue, rendered via $tDynamic; unescape \' so keys match runtime).
    async () => [
      ...blockStrings('./src/components/team/OwnerCongratsModal.vue', 'const CONGRATS_VARIANTS = [', /'((?:[^'\\]|\\.)+)'/g).map(s => s.replace(/\\'/g, "'")),
      ...blockStrings('./src/components/team/OwnerCongratsModal.vue', 'const REWARDS = [', /(?:label|chip):\s*'((?:[^'\\]|\\.)+)'/g),
    ],
    // Facility staff cards (STAFF_CONFIG in FacilitiesTab.vue) — card/empty
    // titles, browse/release labels, toasts, perk-requirement lines, and perk
    // label/description pairs, all rendered via $tDynamic. The const uses
    // double quotes for strings containing apostrophes (never escaped quotes),
    // so the quote-agnostic regex needs no unescaping.
    async () => blockStrings(
      './src/components/team/FacilitiesTab.vue',
      'const STAFF_CONFIG = {',
      /(?:starLabel|emptyTitle|hireLabel|releaseLabel|releasedToast|releaseFailedToast|perkReq|label|description):\s*(['"])((?:(?!\1).)*)\1/g
    ),
    // Rough scheme-fit tier labels (FIT_TIERS in TeamManagementView.vue,
    // rendered via $tDynamic below Analytics facility Lv2).
    async () => blockStrings('./src/views/team/TeamManagementView.vue', 'const FIT_TIERS = [', /label:\s*'([^']+)'/g),
    // Facility names/descriptions/per-level perk lines (facilityTypes in
    // FacilitiesTab.vue, rendered via $tDynamic; unescape \' to match runtime).
    async () => blockStrings('./src/components/team/FacilitiesTab.vue', 'const facilityTypes = {', /'((?:[^'\\]|\\.)+)'/g).map(s => s.replace(/\\'/g, "'")),
    // Owner facility-preservation dialogue + reward label (module consts in
    // the .vue, rendered via $tDynamic; unescape \' so keys match runtime).
    async () => [
      ...blockStrings('./src/components/team/OwnerFacilityStaffModal.vue', 'const PRESERVE_VARIANTS = [', /'((?:[^'\\]|\\.)+)'/g).map(s => s.replace(/\\'/g, "'")),
      ...blockStrings('./src/components/team/OwnerFacilityStaffModal.vue', 'const REWARDS = [', /label:\s*'((?:[^'\\]|\\.)+)'/g),
    ],
    // Playoff token-award labels (module-level const in the playoff store,
    // rendered via $tDynamic on the token toast) — store imports pinia, so
    // regex the const block instead of importing.
    async () => {
      const src = readFileSync(new URL('./src/stores/playoff.js', import.meta.url), 'utf-8')
      const start = src.indexOf('PAYOUT_LABEL = {')
      const block = start === -1 ? '' : src.slice(start, src.indexOf('}', start))
      return [...block.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1])
    },
    // Headshot-editor layer labels (module-level const consumed by the editor UI).
    async () => {
      const src = readFileSync(new URL('./src/services/headshotComposer.js', import.meta.url), 'utf-8')
      const start = src.indexOf('export const LAYERS = [')
      const block = start === -1 ? '' : src.slice(start, src.indexOf('\n]', start))
      return [...block.matchAll(/label:\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1])
    },
    // Walkthrough step copy is pure data rendered via $tDynamic in the
    // walkthrough overlay component.
    async () => {
      const m = await import('./src/walkthroughs/registry.js')
      return Object.values(m.WALKTHROUGHS).flat().flatMap(step => [step.title, step.body].filter(Boolean))
    },
    // salaryScale labels live in a non-exported const and function returns.
    async () => labelRegex('./src/engine/data/salaryScale.js', /label:\s*'((?:[^'\\]|\\.)*)'/g),
    async () => {
      // Scheme dicts exist in BOTH GameConfig.js and CoachingEngine.js and
      // have drifted (CoachingEngine — the copy the UI displays — has newer
      // defensive schemes). Union both: GameConfig via import, CoachingEngine
      // via regex (it imports through the '@/' alias, so not Node-importable).
      const m = await import('./src/engine/config/GameConfig.js')
      const fromConfig = [
        ...Object.values(m.OFFENSIVE_SCHEMES),
        ...Object.values(m.DEFENSIVE_SCHEMES),
        ...Object.values(m.SUBSTITUTION_STRATEGIES),
      ].flatMap(s => [s.name, s.description].filter(Boolean))
      const ceSrc = readFileSync(new URL('./src/engine/simulation/CoachingEngine.js', import.meta.url), 'utf-8')
      const fromEngine = []
      for (const constName of ['OFFENSIVE_SCHEMES', 'DEFENSIVE_SCHEMES', 'SUBSTITUTION_STRATEGIES']) {
        const start = ceSrc.indexOf(`${constName} = {`)
        if (start === -1) continue
        const rest = ceSrc.slice(start)
        const end = rest.search(/\n(?:export )?const /)
        const block = end === -1 ? rest : rest.slice(0, end)
        for (const match of block.matchAll(/(?:name|description):\s*(['"])((?:(?!\1).)*)\1/g)) {
          fromEngine.push(match[2])
        }
      }
      return [...fromConfig, ...fromEngine]
    },
    // Live-game play-by-play commentary templates. The engine builds each
    // line via T('tpl', params) (commentaryTemplate.js) and stamps
    // descTpl/descParams on keyframes + feed entries; the UI translates via
    // $tDynamic(tpl, params). Enumerate BOTH the direct T('...') literals
    // and the `*_TPLS` variant-pool const blocks the engine picks from.
    async () => ['./src/engine/simulation/PlayExecutionEngine.js', './src/engine/simulation/GameSimulator.js'].flatMap(f => {
      const src = readFileSync(new URL(f, import.meta.url), 'utf-8')
      const fromCalls = [...src.matchAll(/\bT\(\s*(['"])((?:(?!\1).)*)\1/g)].map(m => m[2])
      const fromPools = [...src.matchAll(/\bconst\s+\w+_TPLS\s*=\s*\{[\s\S]*?\n\}/g)]
        .flatMap(m => [...m[0].matchAll(/(['"])((?:(?!\1).)*)\1/g)].map(x => x[2]))
      return [...fromCalls, ...fromPools]
    }),
    // News-generation templates. The services build each headline/body via
    // T('tpl', params) (commentaryTemplate.js) and stamp headline_tpl/
    // headline_params + body_tpl/body_params on news records; render sites
    // translate via $tDynamic(tpl, params) with fallback to the stored
    // English string. Enumerate BOTH the direct T('...') literals and the
    // `*_TPLS` variant-pool const blocks (object pools AND array pools) the
    // services pick from.
    async () => [
      './src/engine/season/NewsService.js',
      './src/engine/season/BreakingNewsService.js',
      './src/engine/evolution/EvolutionNewsService.js',
      './src/engine/season/AwardService.js',
      './src/engine/season/AllStarService.js',
      './src/engine/ai/AITradeService.js',
    ].flatMap(f => {
      const src = readFileSync(new URL(f, import.meta.url), 'utf-8')
      const fromCalls = [...src.matchAll(/\bT\(\s*(['"])((?:(?!\1).)*)\1/g)].map(m => m[2])
      const fromPools = [...src.matchAll(/\bconst\s+\w+_TPLS\s*=\s*[[{][\s\S]*?\n[\]}]/g)]
        .flatMap(m => [...m[0].matchAll(/(['"])((?:(?!\1).)*)\1/g)].map(x => x[2]))
      return [...fromCalls, ...fromPools]
    }),
  ],
}
