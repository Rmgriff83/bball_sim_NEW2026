#!/usr/bin/env node
/**
 * Pull (default) or push (upload mode) the six headshot asset folders
 * between this repo's frontend/src/assets and the S3 bucket configured by
 * ASSETS_AWS_BUCKET. Runs as the `prebuild` step so that `vite build` always
 * bundles a fresh copy of admin-authored content. The `headshots/`
 * procedural pool is NOT touched — it's regenerated locally via
 * generate_headshots.py.
 *
 *   node scripts/sync-headshot-assets.mjs           # download S3 -> local
 *   node scripts/sync-headshot-assets.mjs upload    # upload local -> S3 (one-off bootstrap)
 *
 * If ASSETS_AWS_BUCKET is unset the script prints a warning and exits 0 so
 * builds without S3 creds (CI smoke tests, fresh clones, etc.) still
 * work against whatever is already on disk.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SYNC_FOLDERS = [
  'headshot-layers',
  'headshot-layers-upgraded',
  'headshot-layers-coaches',
  'headshot-layers-coaches-upgraded',
  'coach-headshots',
  'headshots-premade',
];

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const ASSETS_ROOT = path.join(FRONTEND_ROOT, 'src', 'assets');

const MODE = process.argv[2] === 'upload' ? 'upload' : 'download';

// Minimal .env loader so devs can put ASSETS_AWS_* in frontend/.env without
// an extra dotenv dependency. Skipped if a key is already in the process env
// (shell / CI takes precedence). Mirrors Vite's mode-aware lookup order so
// keys in `.env.production` are picked up — this script almost always runs
// against the production bucket (prebuild before `vite build`, or the
// explicit upload bootstrap), so we default mode to 'production' unless
// SYNC_HEADSHOT_MODE or NODE_ENV say otherwise.
async function loadDotenv() {
  const mode =
    process.env.SYNC_HEADSHOT_MODE || process.env.NODE_ENV || 'production';
  // Earlier entries win (we skip if a key is already set), so this list is
  // in highest → lowest priority order.
  const files = [
    `.env.${mode}.local`,
    `.env.${mode}`,
    '.env.local',
    '.env',
  ];
  for (const filename of files) {
    const file = path.join(FRONTEND_ROOT, filename);
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function warn(msg) {
  console.warn(`[sync-headshot-assets] ${msg}`);
}

function info(msg) {
  console.log(`[sync-headshot-assets] ${msg}`);
}

function makeClient() {
  // The assets bucket uses its own ASSETS_AWS_* env namespace so creds for
  // the campaigns bucket (AWS_*) stay independent. Each can fall back to
  // the other when only one IAM user is provisioned, but we prefer the
  // dedicated keys when present.
  //
  // The endpoint override is what lets this script talk to non-AWS
  // S3-compatible providers (DigitalOcean Spaces in this project's case,
  // e.g. ASSETS_AWS_ENDPOINT=https://sfo3.digitaloceanspaces.com).
  const region =
    process.env.ASSETS_AWS_DEFAULT_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1';
  const accessKeyId =
    process.env.ASSETS_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.ASSETS_AWS_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint =
    process.env.ASSETS_AWS_ENDPOINT || process.env.AWS_ENDPOINT || undefined;
  const credentials =
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined;
  const forcePathStyle =
    (process.env.ASSETS_AWS_USE_PATH_STYLE_ENDPOINT || 'false').toLowerCase() ===
    'true';
  return new S3Client({ region, credentials, endpoint, forcePathStyle });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function listKeys(client, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function wipeDir(dir) {
  // Remove and recreate so stale local files don't survive a sync where
  // they've been deleted on S3.
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(dir, { recursive: true });
}

async function downloadFolder(client, bucket, folder) {
  const localDir = path.join(ASSETS_ROOT, folder);
  await wipeDir(localDir);

  const keys = await listKeys(client, bucket, folder);
  if (keys.length === 0) {
    info(`${folder}: no objects in S3, leaving empty`);
    return 0;
  }

  let count = 0;
  for (const key of keys) {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await streamToBuffer(res.Body);
    // Key is `<folder>/<rest>`; strip the prefix to get the relative path.
    const rel = key.slice(folder.length + 1);
    const dest = path.join(localDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    count += 1;
  }
  info(`${folder}: pulled ${count} file(s)`);
  return count;
}

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function uploadFolder(client, bucket, folder) {
  const localDir = path.join(ASSETS_ROOT, folder);
  const files = await walk(localDir);
  if (files.length === 0) {
    info(`${folder}: no local files, skipping`);
    return 0;
  }

  let count = 0;
  for (const file of files) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    const key = `${folder}/${rel}`;
    const body = await fs.readFile(file);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(file),
      })
    );
    count += 1;
  }
  info(`${folder}: pushed ${count} file(s)`);
  return count;
}

async function main() {
  await loadDotenv();
  const bucket = process.env.ASSETS_AWS_BUCKET;
  if (!bucket) {
    warn(
      'ASSETS_AWS_BUCKET is unset — skipping headshot asset sync. Build will use whatever is currently on disk.'
    );
    return;
  }

  const client = makeClient();
  info(`mode=${MODE} bucket=${bucket}`);

  let total = 0;
  for (const folder of SYNC_FOLDERS) {
    if (MODE === 'upload') {
      total += await uploadFolder(client, bucket, folder);
    } else {
      total += await downloadFolder(client, bucket, folder);
    }
  }
  info(`done — ${total} file(s) ${MODE === 'upload' ? 'uploaded' : 'downloaded'}`);
}

main().catch((err) => {
  console.error('[sync-headshot-assets] failed:', err);
  process.exit(1);
});
