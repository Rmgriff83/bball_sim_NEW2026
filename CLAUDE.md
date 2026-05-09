# Project conventions

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
