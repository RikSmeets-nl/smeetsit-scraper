// Mapping SnelStart Web (webapi.snelstart.nl) -> portal-contract.
// Vastgesteld met --discover op 25-11-2026:
//  - Reporting/RevenueFlow?startDate&endDate (ms)      -> omzet per maand, [ts, bedrag], huidig + vorig boekjaar
//  - Reporting/FinancialResultFlow?startDate&endDate   -> resultaat CUMULATIEF sinds begin boekjaar (per maand)
//  - KasBankBoeking/GetKasEnBankDagboekenWithBankSaldoInfo -> saldo per bankrekening
//  - Reporting/OpenSalesInvoiceSummaryNew, Reporting/InvoiceAgeAnalysis -> debiteuren
//  - BtwAangiftes/GetBtwAangiftesData                  -> btw per aangifte
// Per grootboekrekening is in deze endpoints geen uitsplitsing: revenue/cost_groups blijven leeg.
import { normalizeMonths } from './contract.mjs';

export const MAP = { ready: true };
const API = 'https://webapi.snelstart.nl';

/** Neem de headers over van een echte webapi-request van de SPA (Bearer-token + administratie-headers). */
export async function captureApiHeaders(page) {
  let headers = null;
  const h = (req) => {
    if (headers || !req.url().startsWith(API + '/Reporting/')) return;
    const all = req.headers();
    if (!all.authorization) return;
    headers = Object.fromEntries(Object.entries(all).filter(([k]) => !['host', 'content-length', 'cookie', 'accept-encoding'].includes(k)));
  };
  page.on('request', h);
  const dash = page.url().replace(/\/[^/]*$/, '/dashboard');
  await page.goto(dash.includes('/dashboard') ? dash : 'https://web.snelstart.nl/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 40 && !headers; i++) await page.waitForTimeout(250);
  page.off('request', h);
  if (!headers) throw new Error('Geen geautoriseerde webapi-request gezien op het dashboard.');
  return headers;
}

async function api(page, headers, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await page.request.get(url.toString(), { headers });
  if (!r.ok()) throw new Error(`${path}: HTTP ${r.status()}`);
  return r.json();
}

/** Eén boekjaar opbouwen uit omzetflow (per maand) en resultaatflow (cumulatief). */
export function buildYear(year, revFlow, cumResultFlow, { isCurrent = false, now = new Date() } = {}) {
  const months = [];
  let prevCum = 0;
  for (let i = 0; i < 12; i++) {
    // Positie i = maand i van het boekjaar. Let op: SnelStart zet de reeks van het VORIGE
    // boekjaar op de datums van het huidige jaar (voor de grafiek), dus de timestamp niet gebruiken.
    const omzet = revFlow[i]?.[1] ?? 0;
    const cum = cumResultFlow[i]?.[1] ?? prevCum;
    const future = isCurrent && (year > now.getUTCFullYear() || (year === now.getUTCFullYear() && i > now.getUTCMonth()));
    const winst = future ? 0 : cum - prevCum;
    if (!future) prevCum = cum;
    months.push({ month: `${year}-${String(i + 1).padStart(2, '0')}`, omzet: future ? 0 : omzet, kosten: future ? 0 : Math.round((omzet - winst) * 100) / 100, winst });
  }
  const norm = normalizeMonths(year, months);
  const opbrengsten = norm.reduce((s, m) => s + m.omzet, 0);
  const winst = norm.reduce((s, m) => s + m.winst, 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    opbrengsten: r2(opbrengsten), kosten: r2(opbrengsten - winst), winst: r2(winst),
    winstbelasting: 0, winst_na_belasting: r2(winst),
    revenue: [], cost_groups: [], cost_leaves: [], months: norm,
  };
}

/** Eén SnelStart-factuur naar het portal-formaat. */
export function mapInvoice(f) {
  // SnelStart geeft hier bedragen incl. btw (gecontroleerd: som = omzet x 1,21 in 2025 en 2026).
  // Excl. btw is omgerekend met 21%; de exacte omzet per jaar komt uit de omzetrapportage, niet uit deze lijst.
  const incl = Number(f.invoiceTotal ?? f.total) || 0;
  const excl = incl / 1.21;
  const open = f.remainingInvoiceTotal ?? f.remainingTotal;
  return {
    number: String(f.invoiceNumber || f.number || ''),
    customer: String(f.customerName || '').trim(),
    customer_code: f.customerCode ?? null,
    date: String(f.invoiceDate || f.date || '').slice(0, 10),
    excl: Math.round(excl * 100) / 100,
    incl: Math.round(incl * 100) / 100,
    open: open == null ? null : Math.round(Number(open) * 100) / 100,
    concept: !!f.isConcept,
  };
}

export async function scrapeAll(page, env) {
  const headers = await captureApiHeaders(page);
  const now = new Date();
  const firstYear = Number(env.SNELSTART_FIRST_YEAR || now.getUTCFullYear() - 5);
  const wv = {};
  // Per call krijg je boekjaar Y en Y-1; daarom met stappen van 2 terug.
  for (let y = now.getUTCFullYear(); y >= firstYear; y -= 2) {
    const params = { startDate: Date.UTC(y, 0, 1), endDate: Date.UTC(y, 11, 31) };
    const [rev, res] = await Promise.all([
      api(page, headers, '/Reporting/RevenueFlow', params),
      api(page, headers, '/Reporting/FinancialResultFlow', params),
    ]);
    const cur = buildYear(y, rev.flowOfCurrentBoekjaar, res.flowOfCurrentBoekjaar, { isCurrent: true, now });
    const prev = buildYear(y - 1, rev.flowOfPreviousBoekjaar, res.flowOfPreviousBoekjaar, { isCurrent: true, now });
    for (const [yy, r] of [[y, cur], [y - 1, prev]]) {
      if (yy >= firstYear && (r.opbrengsten !== 0 || r.kosten !== 0)) wv[yy] = r;
    }
  }

  const extra = {};
  const banks = await api(page, headers, '/KasBankBoeking/GetKasEnBankDagboekenWithBankSaldoInfo').catch(() => null);
  if (Array.isArray(banks)) extra.bank_accounts = banks.map((b) => ({ name: b.grootboekDescription, iban: b.iban || null, balance: Number(b.balance) || 0 }));

  const open = await api(page, headers, '/Reporting/OpenSalesInvoiceSummaryNew').catch(() => null);
  const age = await api(page, headers, '/Reporting/InvoiceAgeAnalysis').catch(() => null);
  if (age?.keys && age.salesInvoiceAmount) {
    extra.debtors = age.keys.map((k, i) => ({ number: null, customer: `Openstaand ${k}`, due_date: null, open: Number(age.salesInvoiceAmount[i]?.[1] ?? age.salesInvoiceAmount[i]) || 0 }))
      .filter((d) => d.open > 0);
  } else if (open) {
    extra.debtors = [{ number: null, customer: `${open.numberOfOpenInvoices} open facturen`, due_date: null, open: open.totalAmountOfOpenInvoices }];
  }

  const btw = await api(page, headers, '/BtwAangiftes/GetBtwAangiftesData').catch(() => null);
  if (btw?.btwAangiftes) {
    extra.btw = btw.btwAangiftes.map((a) => {
      const van = (a.aangiftePeriodeBeginDatum || '').slice(0, 10), tot = (a.aangiftePeriodeEindDatum || '').slice(0, 10);
      const r5g = a.rubriek5G || {};
      return {
        period: van && tot ? `${van} t/m ${tot}` : String(a.boekjaar?.startDate || '').slice(0, 4),
        total_vat: Number(r5g.btw || r5g.btwSchatting || 0),
        status: a.btwAangifteStatus ?? null,
        submitted: !!a.datumTijdVerzending,
        estimated: !!a.isAangifteGeschat,
      };
    });
  }
  // Openstaande posten (voor de balans): debiteuren en crediteuren, incl. btw.
  const inkoop = await api(page, headers, '/Reporting/OpenPurchaseInvoiceSummary').catch(() => null);
  extra.open_items = {
    debiteuren: Number(open?.totalAmountOfOpenInvoices) || 0, debiteuren_aantal: Number(open?.numberOfOpenInvoices) || 0,
    crediteuren: Number(inkoop?.totalAmountOfOpenInvoices) || 0, crediteuren_aantal: Number(inkoop?.numberOfOpenInvoices) || 0,
  };

  // Verkoopfacturen (alle, gepagineerd).
  try {
    const facturen = [];
    for (let skip = 0; skip < 5000; skip += 100) {
      const url = `${API}/Invoices/Search?statusFilter=0&skip=${skip}&take=100&sortDataFieldName=invoiceDate&sortDescending=true`;
      const r = await page.request.post(url, { headers: { ...headers, 'content-type': 'application/json' }, data: { rawSearchTerm: '', globalSearchTerms: [], columnSearchTerms: [] } });
      if (!r.ok()) throw new Error(`Invoices/Search: HTTP ${r.status()}`);
      const j = await r.json();
      const list = j.resultList || [];
      for (const f of list) facturen.push(mapInvoice(f));
      if (list.length < 100 || facturen.length >= (j.totalMatchCount || 0)) break;
    }
    extra.invoices = facturen.filter((f) => f.date);
  } catch (e) {
    console.warn('Facturen overgeslagen:', e.message);
  }
  return { wv, extra };
}
