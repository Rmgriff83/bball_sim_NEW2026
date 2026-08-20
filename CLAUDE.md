# Project conventions

## ⚠️ LIVE PRODUCTION — 500+ real users, DO NOT BREAK EXISTING CAMPAIGNS

This app is shipping to **500+ active users** whose campaigns are persisted in
**IndexedDB on their own devices** (with cloud sync). There is no server-side
migration you can run for them — their saved data is whatever version created it.

**Every change MUST be backward-compatible with existing saved campaigns.** Before
touching anything that reads or writes persisted data (campaign settings, teams,
players, coaches/staff, gmContract, seasonData, headshots, rewards), verify:

- **Reads tolerate old shapes.** New/renamed fields are read with `??` defaults or
  `Array.isArray`/type guards — never assume a field exists on an old save.
- **New fields are additive & lazy.** Prefer creating them on first write; do not
  require them to pre-exist.
- **Data migrations are idempotent and guarded** by a `settings.*Done` flag, follow
  the existing `frontend/src/engine/migrations/backfill*.js` pattern, and only
  add/repair — never destructively rewrite fields you didn't create.
- **Derived-logic changes don't crash on old data** and degrade sensibly (behavior
  may change, but must not corrupt or throw).
- **No forced backend/DB-schema change** for a client-side feature.

When in doubt, trace the change against a legacy save shape and say so explicitly.
This constraint outranks feature convenience.

## i18n Rule — every user-visible string ships translated

The app is localized (es, pt, fr, de, it, ro) via a **build-time-only** pipeline:
the vendored package at `frontend/vendor/wl-i18n/` provides `$t`/`$tDynamic`;
translations are baked into committed `frontend/src/locales/*.json` by
`npm run translate` (never at runtime — the shipped app makes zero translation
API calls). `npm run audit:i18n` runs in `prebuild` and **fails the build** on
unwrapped template text, but it cannot see every category — the rules below
cover what it can't.

### Static UI strings (`$t` / `t`)
- Templates: `{{ $t('Back to Dashboard') }}`; attributes bound:
  `:placeholder="$t('Search players')"` (same for `title`/`alt`).
  **NEVER translate `aria-label`** — `main.js`'s cancel-SFX heuristic matches
  English `aria-label` values ("Close"/"Dismiss").
- Scripts (stores, services, composables, `.vue` script blocks):
  `import { t } from '@wl-i18n/i18n.js'` and call **at event/render time only**
  (inside functions/computeds) — a module-top-level or setup-time `t()` freezes
  the startup locale. Module-level display consts stay English and get
  `$tDynamic` at the render site instead.
- Authoring (the extractor is regex-based — these are hard constraints):
  single-line quoted literals only; interpolate with `{token}` params, never
  template literals or concatenation inside `$t()`/`t()`; one string per full
  sentence (never split into fragments); singular/plural = two complete
  strings; apostrophes → double-quote the string in text nodes/scripts, and in
  bound **attributes** avoid apostrophes entirely (rephrase to "will not" —
  HTML attribute quoting cannot nest them).

### Dynamic/data strings (`$tDynamic`)
- Data-driven display text (badge/play/achievement names & descriptions,
  scheme names, tier labels, owner blurbs, …) translates **at the render site
  only**: `{{ $tDynamic(badge.name) }}`. **Never mutate the data object** —
  many display strings double as lookup keys (archetype names, news
  categories) and are persisted in saves.
- Pass the **canonical string** as the lookup key, never a re-derived one
  (id-title-casing once produced "Catch And Shoot" vs canonical
  "Catch and Shoot" and silently skipped translation). For badges use
  `badgeDisplayName()` from `frontend/src/engine/data/badges.js`.
- **Every new data-string source must be enumerated** in
  `frontend/wl-i18n.config.js` `dynamicSources` — importable data modules via
  dynamic import; `.vue`-module consts and non-Node-importable files via the
  existing `blockStrings`/`labelRegex` helpers there. An un-enumerated string
  renders English **silently** (tDynamic falls back). The dev collector
  (`npm run dev` play-testing appends to `frontend/i18n/dynamic-strings.json`)
  is the safety net, not the plan.

### Engine-generated text (`T()` templates)
- Sim/engine code (`src/engine/**`) must **never import i18n** (it may run in
  a worker). Build user-visible lines with `T(tpl, params)` from
  `frontend/src/engine/simulation/commentaryTemplate.js`:
  `T('{name} drives to the basket', { name })` → emit the English `.text` as
  before PLUS additive tpl/params fields on the entry; the UI renders
  `x.tpl ? $tDynamic(x.tpl, x.params) : x.text`.
- Variant pools MUST use the `*_TPLS` const naming (arrays **or** keyed
  objects) — `wl-i18n.config.js` regex-extracts them by that name; a pool
  named anything else silently never translates. A **new engine file** using
  `T()` must be added to the config's extraction file list.
- Proper nouns and stat codes go in params, never in template text.

### Persisted records (news, achievements — anything written to IndexedDB)
Stored English fields stay forever (500+ users' saves). New records get
**additive** `*_tpl`/`*_params` fields; render sites fall back to the stored
English string when the fields are absent. Never migrate or rewrite old
records.

### Dates
Never `toLocaleDateString('en-US', …)` — use `dateLocale()` from
`@wl-i18n/i18n.js` so weekday/month names follow the active locale.

### Do NOT translate
Proper nouns (player/coach/owner names, team names/cities), user-generated
content (campaign/build names, usernames), stat & position abbreviations
(PTS, REB, PG, OVR, 3PT, … — add `<!-- i18n-ignore -->` on the line above if
the audit flags one), enum/key strings, console/error internals, and the
endonyms in the language picker (a Spanish speaker must always find
"Español").

### Workflow after adding strings
1. `npm run translate:dry` — licenseless; prints the per-language delta.
2. `npm run translate` — reads `WL_LICENSE_KEY`/`WL_TRANSLATE_API_URL` from
   the gitignored frontend `.env.production`; only NEW strings are sent.
3. Commit `frontend/src/locales/*.json` + `frontend/i18n/dynamic-strings.json`.
4. If the MT keeps a term English (identity — common for basketball jargon
   like "Slasher"), hand-edit the key in the locale JSONs; the CLI never
   overwrites an existing entry, so manual fixes are permanent.

**`npm run release` runs translation automatically** (`translate:release`,
first step of the chain, so fresh locales are bundled into both web and native
builds). It is **soft-fail**: if the WebLinguist API is unreachable the release
prints a loud `⚠ TRANSLATION FAILED` warning and continues with the committed
locale files — new strings ship as English fallbacks; run `npm run translate`
and patch once the API is back. Manual `translate`/`translate:dry` stay
hard-fail so problems are never silent. After a release, commit any locale
files the run updated.

## Gameplay Wiring Rule

Every player **attribute** defined in `frontend/src/engine/data/attributeSchema.js`
and every **badge** defined in `frontend/src/engine/data/badges.js` MUST be
consumed by the simulation in the same change that introduces it.

Concretely, a new attribute or badge must be readable from at least one of:

- `frontend/src/engine/simulation/GameSimulator.js`
- `frontend/src/engine/simulation/PlayExecutionEngine.js`
- `frontend/src/engine/data/plays.js` (action `attributes.offense` /
  `attributes.defense` lists, or `badgeEffects` arrays)
- `frontend/src/engine/data/badgeKeysByAction.js` (the canonical effect-key
  contract for badge effects)
- `frontend/src/engine/coaching/` (scheme effectiveness, perks)

The `npm run audit:gameplay` script enforces this — it loads the canonical
attribute and badge lists, scans the simulation/coaching/data files, and
fails if any defined attribute or badge has zero consumer references. It
also runs as `prebuild`, so `npm run build` fails on drift.

If an attribute or badge is genuinely cosmetic (extremely rare — most
"flavor" can still affect gameplay peripherally), add it to
`frontend/src/engine/data/cosmeticAllowlist.js` instead. The list ships
empty by default; new entries should be justified in the PR description.

### Why this rule exists

In early development the catalog drifted: ~30 of 40 attributes and 77 of 87
badges were defined in the schema but never consulted by the simulation,
which meant players paying for badges or earning attribute upgrades got no
return. The audit script + wiring rule prevents that recurrence.

## Play Authoring Rule

**Whenever you create OR refine an offensive play in
`frontend/src/engine/data/plays.js`, follow this process — no exceptions.**

### 1. Research the real play FIRST (required)
Before writing any play object, **do a web search** for the actual basketball
action and read a coaching source (breakthroughbasketball, thehoopsgeek,
hooperuniversity, the Basketball Action Dictionary, coachesclipboard,
fastmodelsports, etc.). Capture, from the real play:
- its **alignment / who starts where** (and who initiates),
- the **signature action** that defines the set (the screen, cut, or handoff it
  is named for), and
- the real **decision points / reads** the ball-handler or cutter makes, and
  what each read leads to.

The authored play's structure and reads must reflect that research. Cite the
set/source in the PR or commit description.

### 2. Structural requirements (realism)
- **Perimeter initiation.** A half-court possession starts with the ball above
  the arc and an initiating dribble or entry pass. **Post-ups begin with a
  perimeter entry pass to a sealed post** — never with the big already holding
  the ball. Off-ball sets (floppy/zipper/Chicago) may start the shooter low, but
  a perimeter passer must hold/initiate the ball (define the ball's origin).
- **Model the signature action as a REAL action.** Any screen the set is named
  for must be a discrete `type: 'screen'` action performed by the screener — not
  a decorative unused role, a probability branch, or a mislabeled `cut`. This is
  load-bearing: defensive switching (`PlayExecutionEngine.maybeSwitchOnScreen`)
  and the play-preview animation both key on `action.type === 'screen'`.
- **Realistic reads.** Multi-option actions use a `type: 'decision'` node whose
  branches fit the play (a pick-and-roll reads roll / pop / pull / kick, not a
  lone jumper; an iso has a kick-out counter, not score-or-turnover).
- **Sane rates.** Unpressured iso/transition turnover branches ≈ 8–12%, not
  20–25%.

### 3. Schema & graph constraints (must pass verification)
- Reference **only existing attribute keys** (`attributeSchema.js`) in
  `attributes.offense`/`attributes.defense`, and **only real badge ids**
  (`badges.js`) in `badgeEffects` (a bogus badge is a silent no-op).
- Every outcome `next` must resolve to another action `id` in the play OR a
  terminal (`end_made` / `end_turnover` / `rebound_battle` / `free_throws`), and
  every action must be reachable and able to reach a shot/terminal (no
  dead/looping branch).
- Every `actor`/`receiver` must exist in the play's `roles`; coordinates are
  normalized 0–1 (x: 0 left → 1 right, y: 0 perimeter → ≈0.9 rim); `shotType`
  matches the shot.
- Keep `id`, `name`, `category`, and `tempo` stable when refining an existing
  play (scheme weighting, the playbook dropdowns, and saved data key off these).

### 4. Verify
Run the graph-integrity check (every play builds, every action reaches a
terminal, actors/receivers valid), then `npm run audit:gameplay` and
`npx vite build` — all must pass. Confirm category counts per scheme are
unchanged so `PlayService` selection weighting is unaffected.
