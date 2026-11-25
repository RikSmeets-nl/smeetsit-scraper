// SnelStart-webscraper voor Smeetsit (boekhouding: W&V, balans, bank, btw, debiteuren).
//
//   node snelstart.mjs --discover   -> inloggen, rondklikken, alle JSON-antwoorden + screenshots in discover/
//                                      (alleen lokaal draaien; bevat financiële data, staat in .gitignore)
//   node snelstart.mjs --dry        -> scrapen, niet pushen, out/snelstart.json
//   node snelstart.mjs              -> scrapen en naar de portal pushen
//
// SnelStart Web is een SPA die zijn data uit een JSON-API haalt. De scraper leest die
// API-antwoorden (zoals de Jortt-scraper), niet de HTML. De endpoints en velden staan in
// lib/snelstart-map.mjs en worden vastgesteld met --discover.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, need } from './lib/env.mjs';
import { validYear } from './lib/contract.mjs';
import { push } from './lib/push.mjs';
import { MAP, scrapeAll } from './lib/snelstart-map.mjs';

const env = loadEnv(path.join(os.homedir(), '.config/agents/smeetsit-portal/snelstart.env'), path.join(os.homedir(), '.config/agents/smeetsit-portal/scraper.env'), '.env');
const DISCOVER = process.argv.includes('--discover');
const DRY = process.argv.includes('--dry');
need(env, 'SNELSTART_EMAIL', 'SNELSTART_PASSWORD', ...(DISCOVER || DRY ? [] : ['PORTAL_URL', 'INGEST_SECRET']));

const START = env.SNELSTART_URL || 'https://web.snelstart.nl/';

async function clickIfVisible(page, selectors, timeout = 2500) {
  for (const s of selectors) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout }).catch(() => false)) { await el.click().catch(() => {}); return true; }
  }
  return false;
}

/** Login met e-mail/wachtwoord; werkt voor één- en tweestaps formulieren. Geen 2FA. */
export async function login(page) {
  await page.goto(START, { waitUntil: 'networkidle' });
  await clickIfVisible(page, ['button:has-text("Alles accepteren")', 'button:has-text("Accepteren")', '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyButtonDecline']);
  const email = page.locator('input[type="email"], input[name*="mail" i], input[id*="mail" i], input[name="username"], input[id="signInName"]').first();
  await email.waitFor({ timeout: 30000 });
  await email.fill(env.SNELSTART_EMAIL);
  const pw = page.locator('input[type="password"]').first();
  if (!(await pw.isVisible().catch(() => false))) {
    await clickIfVisible(page, ['button[type="submit"]', 'button:has-text("Volgende")', 'button:has-text("Doorgaan")', '#next']);
    await pw.waitFor({ timeout: 20000 });
  }
  await pw.fill(env.SNELSTART_PASSWORD);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    clickIfVisible(page, ['button[type="submit"]', 'button:has-text("Inloggen")', 'button:has-text("Aanmelden")', '#next'], 5000),
  ]);
  await page.waitForTimeout(4000);
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new Error('SnelStart-login mislukt (wachtwoordveld staat er nog). Controleer de gegevens of een extra verificatiestap.');
  }
  // Administratie kiezen als er een keuzescherm is.
  const adm = env.SNELSTART_ADMINISTRATIE;
  if (adm) await clickIfVisible(page, [`text="${adm}"`, `:text-matches("${adm}", "i")`], 4000);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function discover(page) {
  const dir = path.join('discover', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const seen = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await r.json();
      const i = seen.length;
      seen.push({ i, status: r.status(), method: r.request().method(), url: r.url() });
      fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.json`), JSON.stringify({ url: r.url(), status: r.status(), body }, null, 1));
    } catch {}
  });
  await login(page);
  await page.screenshot({ path: path.join(dir, 'na-login.png'), fullPage: true });
  // Menu-links verzamelen en de financieel relevante pagina's bezoeken.
  const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ text: a.innerText.trim(), href: a.href })).filter((l) => l.text));
  fs.writeFileSync(path.join(dir, 'links.json'), JSON.stringify(links, null, 1));
  const want = /rapport|winst|verlies|balans|bank|btw|debiteur|openstaand|grootboek|dashboard|overzicht|factur/i;
  const visit = [...new Map(links.filter((l) => want.test(l.text) && l.href.startsWith('http')).map((l) => [l.href, l])).values()].slice(0, 25);
  for (const l of visit) {
    console.log('bezoek:', l.text, l.href);
    await page.goto(l.href, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(dir, `pagina-${l.text.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`), fullPage: true }).catch(() => {});
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(seen, null, 1));
  console.log(`Discover klaar: ${seen.length} JSON-antwoorden, ${visit.length} pagina's -> ${dir}`);
}

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newContext({ locale: 'nl-NL', viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
try {
  if (DISCOVER) {
    await discover(page);
  } else {
    if (!MAP.ready) throw new Error('lib/snelstart-map.mjs is nog niet ingevuld: draai eerst --discover.');
    await login(page);
    const { wv, extra } = await scrapeAll(page, env);
    const valid = Object.fromEntries(Object.entries(wv).filter(([y, r]) => validYear(r) || (console.warn(`${y}: faalt contract`), false)));
    if (!Object.keys(valid).length) throw new Error('Geen geldig jaar; niets verstuurd.');
    const payload = { source: 'snelstart', wv: valid, extra: { ...extra, scraped_at: new Date().toISOString(), source: 'snelstart' } };
    if (DRY) {
      fs.mkdirSync('out', { recursive: true });
      fs.writeFileSync('out/snelstart.json', JSON.stringify(payload, null, 1));
      console.log('Dry run: out/snelstart.json', Object.keys(valid).join(', '));
    } else {
      console.log('Ingest:', JSON.stringify(await push(env, 'smeetsit', payload)));
    }
  }
} catch (e) {
  console.error('FOUT:', e.message);
  await page.screenshot({ path: 'snelstart-fout.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
