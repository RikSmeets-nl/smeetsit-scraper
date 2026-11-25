// Zelfde contract als de portal (app/Support/WvContract.php) en de JKC-scraper.
export const num = (s) => { const v = parseFloat(String(s ?? '')); return Number.isNaN(v) ? 0 : v; };

/** NL-bedrag ("€ 1.234,56", "-1.234", "1234.5") naar getal. */
export function parseEuro(s) {
  if (typeof s === 'number') return s;
  if (s == null) return 0;
  const t = String(s).trim();
  const neg = /^-|\(.*\)|-\s*€|€\s*-/.test(t);
  let d = t.replace(/[^\d,.]/g, '');
  if (d.includes(',')) d = d.replace(/\./g, '').replace(',', '.');
  else if ((d.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(d)) d = d.replace(/\./g, '');
  const v = parseFloat(d);
  return Number.isNaN(v) ? 0 : neg ? -v : v;
}

export function validYear(r) {
  return !!r && Array.isArray(r.months) && r.months.length === 12 &&
    typeof r.winst === 'number' && (r.opbrengsten > 0 || r.kosten > 0) &&
    Array.isArray(r.revenue) && Array.isArray(r.cost_groups);
}

export function emptyMonths(year) {
  return Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, omzet: 0, kosten: 0, winst: 0 }));
}

/** Zorg dat een jaar exact 12 maanden heeft (ontbrekende maanden = 0). */
export function normalizeMonths(year, months) {
  const base = emptyMonths(year);
  for (const m of months || []) {
    const i = base.findIndex((b) => b.month === m.month);
    if (i >= 0) base[i] = { month: m.month, omzet: num(m.omzet), kosten: num(m.kosten), winst: num(m.winst ?? (num(m.omzet) - num(m.kosten))) };
  }
  return base;
}
