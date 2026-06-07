# Vue 3 + Vite

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).

## Headshot asset pipeline

Headshot assets live in a DigitalOcean Space (`bball-sim-assets`, region `sfo3`)
and are pulled into the local bundle at build time via the `prebuild` step.
There are two distinct sets of assets:

- **Layers / premades / coach headshots** — admin-authored in the
  `/admin/headshots` editor; saves write directly to Spaces.
- **Procedural pool** (`src/assets/headshots/`) — generated offline from the
  layer files by `generate_headshots.py` and used as the auto-roster avatar
  pool at campaign creation.

### Required env vars

In `.env.production` (or `.env.local` for dev), with the same Spaces creds
used by the backend's `ASSETS_AWS_*` block:

```
ASSETS_AWS_BUCKET=bball-sim-assets
ASSETS_AWS_DEFAULT_REGION=sfo3
ASSETS_AWS_ENDPOINT=https://sfo3.digitaloceanspaces.com
ASSETS_AWS_ACCESS_KEY_ID=<key>
ASSETS_AWS_SECRET_ACCESS_KEY=<secret>
```

### npm scripts

| Command | What it does |
|---|---|
| `npm run sync:headshots` | Pull all six asset folders from Spaces into `src/assets/`. Wipes each local folder first so deletions propagate. Skip-with-warning if `ASSETS_AWS_BUCKET` is unset. |
| `npm run sync:headshots:upload` | Push local `src/assets/` folders → Spaces. One-off bootstrap or to publish a regenerated procedural pool. |
| `npm run build` | Runs `prebuild` (sync + audit) then `vite build`. |

### Regenerating the procedural pool

The pool gets refreshed any time you add or revise layer variants and want
new auto-roster combinations to pick from. Run from `frontend/src/assets/`:

```bash
./run_headshot_generator.sh -n 100
```

The wrapper activates `.headshot-venv/` and sets `DYLD_FALLBACK_LIBRARY_PATH`
so cairocffi finds Homebrew's libcairo on Apple Silicon.

**Flags** (pass through to `generate_headshots.py`):

| Flag | Default | Notes |
|---|---|---|
| `-n / --num N` | 10 | Count to emit |
| `-o / --out DIR` | `headshots` | Output dir, relative to cwd — defaults land in `src/assets/headshots/` when run from there |
| `-s / --seed N` | random | Reproducible run |
| `--size N` | 450 | Square canvas in px |
| `--headband-chance F` | 0.11 | Probability 0–1 a player gets a headband |
| `--ethnicity NAME` | randomized | Force one of `black / latino / white / asian / mixed` |
| `--png` | off | Also rasterize to PNG (requires `cairosvg` + `pillow` in the venv) |

### Full pipeline — adding new layer variants

```bash
cd frontend
npm run sync:headshots                  # 1. pull latest layers from Spaces
cd src/assets
./run_headshot_generator.sh -n 100      # 2. regen pool from updated layers
cd ../..
npm run sync:headshots:upload           # 3. push refreshed pool back to Spaces
npm run build                           # 4. bundle for deploy
```

Steps 2 + 3 are only needed when layer changes should also flow into the
procedural pool. Pure variant additions used only by the in-editor picker
can skip straight from step 1 → step 4.
