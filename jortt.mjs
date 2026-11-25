// Jortt-webscraper voor JKC Software B.V. (W&V-historie per jaar; de Jortt-API geeft alleen boekjaar-tot-nu).
// Port van scraper/scrape.mjs uit de JKC-portal, teruggebracht tot één administratie.
//   node jortt.mjs              -> 2018..huidig jaar, push naar portal
//   node jortt.mjs 2025 2026    -> alleen die jaren
//   node jortt.mjs --dry        -> niet pushen, schrijf out/jortt-software.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, need } from './lib/env.mjs';
import { num, parseEuro, validYear } from './lib/contract.mjs';
import { push } from './lib/push.mjs';

const env = loadEnv(path.join(os.homedir(), '.config/agents/smeetsit-portal/jortt-software.env'), path.join(os.homedir(), '.config/agents/smeetsit-portal/scraper.env'), '.env');
const DRY = process.argv.includes('--dry');
need(env, 'JORTT_WEB_EMAIL', 'JORTT_WEB_PASSWORD', ...(DRY ? [] : ['PORTAL_URL', 'INGEST_SECRET']));
const ORG = { name: env.JORTT_ADMINISTRATIE || 'JKC Software B.V.', kw: new RegExp(env.JORTT_ADMINISTRATIE_KW || 'software', 'i') };

const reportURL = (y, slug) => `https://app.jortt.nl/new_reports/list/ll/new_reports/${slug}/pp/page_wrapper/centered/period_date/${y}-12-31/period_cycle/year`;

function parsePL(j) {
  const rev = j.opbrengsten || [], cost = j.kosten || [];
  const parents = new Set([...rev, ...cost].map((n) => n.parent_ledger_account_id).filter(Boolean));
  const leaves = (list) => list.filter((n) => !parents.has(n.ledger_account_id))
    .map((n) => ({ name: n.name, amount: Math.abs(num(n.total)) })).filter((c) => c.amount !== 0).sort((a, b) => b.amount - a.amount);
  const tax = (j.winstbelasting || []).reduce((s, n) => (/vennootschapsbelasting/i.test(n.name) ? s + Math.abs(num(n.total)) : s), 0);
  return {
    opbrengsten: Math.abs(num(j.total_opbrengsten)),
    kosten: Math.abs(num(j.total_kosten)),
    winst: num(j.profit_before_tax ?? j.possible_profit),
    winstbelasting: tax,
    winst_na_belasting: num(j.grand_total_profit ?? j.profit_before_tax),
    revenue: leaves(rev),
    cost_groups: cost.filter((n) => n.depth === 1).map((n) => ({ name: n.name, amount: Math.abs(num(n.total)) })),
    cost_leaves: leaves(cost),
    months: (j.profit_loss_for_graph || []).map((g) => ({
      month: (g.period?.start_date || '').slice(0, 7),
      omzet: Math.abs(num(g.total_opbrengsten)), kosten: Math.abs(num(g.total_kosten)), winst: num(g.possible_profit),
    })).filter((m) => m.month),
  };
}

function parseBalance(j) {
  const by = {};
  for (const n of j.balance || []) by[n.key] = num(n.total);
  const ev = by.balans_eigen_vermogen || 0, act = by.balans_activa || 0;
  return {
    vaste_activa: by.balans_vaste_activa || 0, vlottende_activa: by.balans_vlottende_activa || 0,
    liquide_middelen: by.balans_liquide_middelen || 0, totaal_activa: act, eigen_vermogen: ev,
    kortlopende_schulden: by.balans_kortlopende_schulden || 0, langlopende_schulden: by.balans_langlopende_schulden || 0,
    solvabiliteit: act ? Math.round((ev / act) * 1000) / 10 : null,
  };
}

async function captureJson(page, url, match, ok) {
  let hit = null;
  const h = async (r) => {
    if (hit || !r.url().includes(match) || !(r.headers()['content-type'] || '').includes('json')) return;
    try { const j = await r.json(); if (ok(j)) hit = j; } catch {}
  };
  page.on('response', h);
  await page.goto(url, { waitUntil: 'networkidle' });
  for (let i = 0; i < 60 && !hit; i++) await page.waitForTimeout(300);
  page.off('response', h);
  return hit;
}

async function login(page) {
  await page.goto('https://app.jortt.nl/inloggen', { waitUntil: 'networkidle' });
  for (const s of ['#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyButtonAccept']) {
    const b = page.locator(s);
    if (await b.count().catch(() => 0)) { await b.first().click({ timeout: 4000 }).catch(() => {}); break; }
  }
  await page.fill('input[type="email"], input[name*="mail" i]', env.JORTT_WEB_EMAIL);
  await page.fill('input[type="password"]', env.JORTT_WEB_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes('/inloggen'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
  if (page.url().includes('/inloggen')) throw new Error('Jortt-login mislukt');
}

async function selectOrg(page) {
  const cur = (await page.locator('#spec-profile-select-dropdown-root').innerText().catch(() => '')).split('\n')[0]?.trim();
  if (cur && ORG.kw.test(cur) && !/sandbox/i.test(cur)) return;
  await page.click('#spec-profile-select-button').catch(() => {});
  await page.waitForTimeout(1200);
  // Eerst exacte naam (menu-items zijn links), daarna kortste element dat op het keyword matcht.
  const exact = page.getByText(ORG.name, { exact: true });
  if (await exact.count().catch(() => 0)) { await exact.first().click({ timeout: 6000 }); await page.waitForTimeout(3000); return; }
  const opts = page.locator('a, [role="option"], [role="menuitem"], li, button');
  const n = await opts.count().catch(() => 0);
  let best = null;
  for (let i = 0; i < n; i++) {
    const t = (await opts.nth(i).innerText().catch(() => '')).trim();
    if (t && ORG.kw.test(t) && !/sandbox/i.test(t) && (!best || t.length < best.t.length)) best = { i, t };
  }
  if (best) { await opts.nth(best.i).click({ timeout: 6000 }); await page.waitForTimeout(3000); return; }
  // Eén administratie onder dit login: dan is er geen keuzelijst en zitten we al goed.
  if (!cur) return;
  throw new Error(`Administratie '${ORG.name}' niet gevonden (huidig: ${cur})`);
}

const argYears = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
const years = argYears.length ? argYears : Array.from({ length: new Date().getFullYear() - 2017 }, (_, i) => 2018 + i);

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ locale: 'nl-NL' }).then((c) => c.newPage());
try {
  await login(page);
  await selectOrg(page);
  const wv = {};
  for (const y of years) {
    const pl = await captureJson(page, reportURL(y, 'profit_and_loss'), 'new_reports/profit_and_loss',
      (j) => (j.profit_loss_for_graph?.length || 0) > 0 && String(j.profit_loss_for_graph[0]?.period?.period_year) === String(y));
    if (!pl) { console.log(`${y}: geen data`); continue; }
    const r = parsePL(pl);
    const bal = await captureJson(page, reportURL(y, 'balance'), 'new_reports/balance', (j) => Array.isArray(j.balance) && j.balance.length > 0);
    if (bal) r.balance = parseBalance(bal);
    if (validYear(r)) { wv[y] = r; console.log(`${y}: ok (${r.months.length} maanden)`); }
    else if (!r.opbrengsten && !r.kosten) console.log(`${y}: geen boekingen`);
    else console.warn(`${y}: faalt contract (${r.months.length} maanden), overgeslagen`);
  }
  const extra = { scraped_at: new Date().toISOString(), source: 'jortt-web' };
  const bt = await captureJson(page, 'https://app.jortt.nl/new_reports/list/ll/btw/list', '/jortt/page/btw/list', (j) => Array.isArray(j.vat_periods));
  if (bt) extra.btw = bt.vat_periods.map((v) => ({ period: v.name, total_vat: parseEuro(v.total_vat), status: v.period_status, submitted: !!v.submitted_to_irs }));

  if (!Object.keys(wv).length) throw new Error('Geen enkel geldig jaar gevonden; niets verstuurd.');
  const payload = { source: 'jortt-web', wv, extra };
  if (DRY) {
    fs.mkdirSync('out', { recursive: true });
    fs.writeFileSync('out/jortt-software.json', JSON.stringify(payload, null, 1));
    console.log('Dry run: out/jortt-software.json');
  } else {
    console.log('Ingest:', JSON.stringify(await push(env, 'software', payload)));
  }
} catch (e) {
  console.error('FOUT:', e.message);
  await page.screenshot({ path: 'jortt-fout.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
