#!/usr/bin/env node
// scripts/redis-backup.mjs — dump and restore the whole Redis namespace.
//
// Why this exists: on 24 October 2026 the Upstash database behind this project
// was removed and every key went with it. The synced keys (player:*, lp:*,
// matches:lp, vods:*, tour:*) were rebuilt by re-running the sync, but the
// hand-entered coaching data had no other copy anywhere and could not be:
// scrims, VOD notes, champion-pool ratings, the calendar, draft plans, saved
// boards. CLAUDE.md had flagged that those keys were the only copy; this is
// the part that was missing.
//
//   node scripts/redis-backup.mjs                 → backups/redis-<date>.json
//   node scripts/redis-backup.mjs --out <file>
//   node scripts/redis-backup.mjs --restore <file>            (hand-entered only)
//   node scripts/redis-backup.mjs --restore <file> --all      (everything)
//   node scripts/redis-backup.mjs --restore <file> --dry-run
//
// Credentials come from .env.local, the same file `vercel env pull` writes.

import fs from 'node:fs';
import path from 'node:path';

/* Keys nothing else can regenerate. A restore touches only these by default:
   the synced keys are better rebuilt from their sources than from a snapshot
   that may be weeks stale. */
const IRREPLACEABLE = [
  /^scrims:/, /^vods-lib:/, /^vodnotes:/, /^pool:/, /^prep:/,
  /^calendar:/, /^drafts:saved:/, /^oppreport:/, /^draft:current$/,
];
const isIrreplaceable = k => IRREPLACEABLE.some(re => re.test(k));

function env() {
  const f = '.env.local';
  if (!fs.existsSync(f)) {
    throw new Error('.env.local not found — run: npx vercel env pull .env.local');
  }
  const out = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const url = out.KV_REST_API_URL, token = out.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN missing from .env.local');
  return { url, token };
}

async function cmd({ url, token }, ...parts) {
  const res = await fetch(`${url}/${parts.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (body.error) throw new Error(`${parts[0]}: ${body.error}`);
  return body.result;
}

// A write body can be large, so values go in the request body rather than the path.
async function post({ url, token }, command) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${command[0]}: ${body.error}`);
  return body.result;
}

async function backup(conn, outPath) {
  const keys = await cmd(conn, 'keys', '*');
  const data = {};
  let strings = 0, hashes = 0, fields = 0;

  for (const key of keys.sort()) {
    const type = await cmd(conn, 'type', key);
    if (type === 'string') {
      data[key] = { type, value: await cmd(conn, 'get', key) };
      strings++;
    } else if (type === 'hash') {
      // hgetall answers as a flat [field, value, field, value, …] list.
      const flat = await cmd(conn, 'hgetall', key);
      const obj = {};
      for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
      data[key] = { type, value: obj };
      hashes++; fields += Object.keys(obj).length;
    } else {
      console.warn(`  skipped ${key} (unsupported type ${type})`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    host: conn.url.replace(/^https?:\/\//, ''),
    keys: Object.keys(data).length,
    data,
  }, null, 2));

  const mb = (fs.statSync(outPath).size / 1048576).toFixed(2);
  console.log(`${outPath}  —  ${strings} strings, ${hashes} hashes (${fields} fields), ${mb} MB`);
  const kept = Object.keys(data).filter(isIrreplaceable);
  console.log(`irreplaceable keys captured: ${kept.length ? kept.join(', ') : 'none yet'}`);
}

async function restore(conn, file, { all, dryRun }) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Object.entries(snap.data)
    .filter(([k]) => all || isIrreplaceable(k));

  console.log(`${file} taken ${snap.takenAt} from ${snap.host}`);
  console.log(`restoring ${entries.length} of ${snap.keys} keys${all ? ' (all)' : ' (hand-entered only)'}${dryRun ? ' — DRY RUN' : ''}`);

  for (const [key, { type, value }] of entries) {
    const existing = await cmd(conn, 'exists', key);
    const label = `  ${existing ? 'overwrite' : 'create   '} ${key}`;
    if (dryRun) { console.log(label + ' (skipped)'); continue; }
    if (type === 'string') {
      await post(conn, ['SET', key, value]);
    } else {
      const flat = Object.entries(value).flatMap(([f, v]) => [f, typeof v === 'string' ? v : JSON.stringify(v)]);
      if (flat.length) await post(conn, ['HSET', key, ...flat]);
    }
    console.log(label);
  }
  if (!dryRun) console.log('done');
}

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

try {
  const conn = env();
  const restoreFrom = val('--restore');
  if (restoreFrom) {
    await restore(conn, restoreFrom, { all: flag('--all'), dryRun: flag('--dry-run') });
  } else {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await backup(conn, val('--out') ?? path.join('backups', `redis-${stamp}.json`));
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
