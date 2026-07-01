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
