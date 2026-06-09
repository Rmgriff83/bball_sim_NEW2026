#!/usr/bin/env node
/**
 * Wipe the local procedural-pool directory (`frontend/src/assets/headshots/`)
 * and re-run the Python generator to refill it with a fresh batch. Wired
 * into `prebuild` AFTER `sync:headshots`, so by the time this runs the
 * layer SVGs and `palettes.json` are already the latest S3 truth — meaning
 * the new pool reflects whatever the admin authored most recently.
 *
 * Skip-with-warning when the Python venv isn't present (CI servers, fresh
 * clones, etc.). Local Macs with `frontend/src/assets/.headshot-venv/`
 * regenerate normally; everywhere else the existing pool stays as a sane
 * fallback so builds don't fail just because cairocffi isn't installed.
 */

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const ASSETS_DIR = path.join(FRONTEND_ROOT, 'src', 'assets');
const POOL_DIR = path.join(ASSETS_DIR, 'headshots');
const WRAPPER = path.join(ASSETS_DIR, 'run_headshot_generator.sh');
const VENV_PYTHON = path.join(ASSETS_DIR, '.headshot-venv', 'bin', 'python');

// How many procedural headshots to generate per build. Picked to match the
// admin's stated baseline; bump up or down without touching this file by
// running `./run_headshot_generator.sh -n NNN` ad-hoc.
const POOL_SIZE = 345;

// Fixed seed so each build produces the SAME pool given the same layer
// SVGs + palettes.json. Existing players reference pool entries by
// filename (e.g. `headshot_037_white.svg`), so without a fixed seed every
// build would shift their faces. Holding the seed steady means:
//   - Same inputs → identical pool (no churn for existing players).
//   - Layer / palette edits propagate naturally because the underlying
//     random draws now sample from the new variant list / hex set.
// Override by editing this constant (or pass `-s NNN` to the wrapper
// script directly for an ad-hoc roll).
const POOL_SEED = 1;

function info(msg) {
  console.log(`[regen-headshots] ${msg}`);
}

function warn(msg) {
  console.warn(`[regen-headshots] ${msg}`);
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function wipeDir(dir) {
  // Mirror the wipeDir pattern in sync-headshot-assets.mjs so a deleted
  // pool entry in the previous run doesn't survive as a stale local file.
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(dir, { recursive: true });
}

function runGenerator() {
  return new Promise((resolve, reject) => {
    const args = ['-n', String(POOL_SIZE), '-s', String(POOL_SEED)];
    info(`running ${path.relative(FRONTEND_ROOT, WRAPPER)} ${args.join(' ')}`);
    // Pipe stdio through so the generator's own progress prints land in
    // the build log untouched.
    const child = spawn('bash', [WRAPPER, ...args], {
      stdio: 'inherit',
      cwd: ASSETS_DIR,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generator exited with code ${code}`));
    });
  });
}

async function main() {
  if (!(await fileExists(WRAPPER))) {
    warn(`wrapper script missing at ${WRAPPER} — skipping regen.`);
    return;
  }
  if (!(await fileExists(VENV_PYTHON))) {
    warn(
      `headshot venv not found at ${path.relative(FRONTEND_ROOT, VENV_PYTHON)} — skipping regen. ` +
        `(Local Macs need a .headshot-venv with cairosvg + pillow installed; CI/deploy environments without it are expected to skip and use whatever pool was bundled previously.)`,
    );
    return;
  }

  info(`wiping ${path.relative(FRONTEND_ROOT, POOL_DIR)}`);
  await wipeDir(POOL_DIR);

  await runGenerator();

  // Quick sanity check — the generator could exit 0 with zero files if
  // something silently went wrong in a sub-step. Surface that so the
  // build doesn't bundle an empty pool.
  const files = await fs.readdir(POOL_DIR);
  const svgCount = files.filter((f) => f.endsWith('.svg')).length;
  if (svgCount === 0) {
    throw new Error('generator produced no SVGs — refusing to ship an empty pool');
  }
  info(`done — ${svgCount} headshot(s) written`);
}

main().catch((err) => {
  console.error('[regen-headshots] failed:', err.message || err);
  process.exit(1);
});
