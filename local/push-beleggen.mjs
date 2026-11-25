// Stuurt de dagstanden van de beleggingsportefeuille naar de portal (POST /api/beleggen, HMAC).
// Draait lokaal op de Mac, na de dagelijkse beleggen-snapshot. Bron: ~/data/digest/beleggen-snapshots.json.
//   node local/push-beleggen.mjs          -> laatste 14 dagen
//   node local/push-beleggen.mjs --alles  -> hele historie (eerste keer)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, need } from '../lib/env.mjs';

const env = loadEnv(path.join(os.homedir(), '.config/agents/smeetsit-portal/scraper.env'));
need(env, 'PORTAL_URL', 'INGEST_SECRET');
const file = process.env.BELEGGEN_FILE || path.join(os.homedir(), 'data/digest/beleggen-snapshots.json');
const all = JSON.parse(fs.readFileSync(file, 'utf8')).snapshots || [];
const pick = process.argv.includes('--alles') ? all : all.slice(-14);
const snapshots = pick.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(Number(s.total_value)))
  .map((s) => ({ date: s.date, total_value: Number(s.total_value), positions: (s.positions || []).map((p) => ({ naam: p.naam, fondscode: p.fondscode, aandelen: Number(p.aandelen), koers: Number(p.koers), koers_datum: p.koers_datum, waarde: Number(p.waarde) })) }));
if (!snapshots.length) { console.error('Geen dagstanden gevonden.'); process.exit(1); }

const body = JSON.stringify({ snapshots });
const ts = Math.floor(Date.now() / 1000);
const rid = crypto.randomBytes(18).toString('base64url');
const sig = crypto.createHmac('sha256', env.INGEST_SECRET).update(`POST\n/api/beleggen\n${ts}\n${rid}\n${body}`).digest('hex');
const res = await fetch(`${env.PORTAL_URL.replace(/\/$/, '')}/api/beleggen`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Timestamp': String(ts), 'X-Request-Id': rid, 'X-Signature': sig, 'User-Agent': 'smeetsit-scraper' },
  body,
});
const text = await res.text();
if (!res.ok) { console.error(`Mislukt: HTTP ${res.status} ${text.slice(0, 300)}`); process.exit(1); }
console.log(`${new Date().toISOString()} verstuurd: ${snapshots.length} dagstanden ->`, text);
