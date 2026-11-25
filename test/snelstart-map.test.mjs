import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYear } from '../lib/snelstart-map.mjs';
import { validYear } from '../lib/contract.mjs';

test('cumulatief resultaat wordt per maand en kosten = omzet - resultaat', () => {
  const ts = (m) => Date.UTC(2025, m, 1);
  const rev = Array.from({ length: 12 }, (_, m) => [ts(m), 1000]);
  const cum = Array.from({ length: 12 }, (_, m) => [ts(m), 300 * (m + 1)]);
  const r = buildYear(2025, rev, cum, { isCurrent: true, now: new Date('2026-06-01') });
  assert.equal(r.opbrengsten, 12000);
  assert.equal(r.winst, 3600);
  assert.equal(r.kosten, 8400);
  assert.equal(r.months[3].winst, 300);
  assert.equal(r.months[3].kosten, 700);
  assert.ok(validYear(r));
});

test('vorig boekjaar met timestamps van huidig jaar landt in het juiste jaar', () => {
  const rev = Array.from({ length: 12 }, (_, m) => [Date.UTC(2026, m, 1), 50]);
  const cum = Array.from({ length: 12 }, (_, m) => [Date.UTC(2026, m, 1), 10 * (m + 1)]);
  const r = buildYear(2025, rev, cum, { isCurrent: true, now: new Date('2026-11-25') });
  assert.equal(r.months[0].month, '2025-01');
  assert.equal(r.opbrengsten, 600);
  assert.equal(r.winst, 120);
});

test('toekomstige maanden van lopend jaar tellen niet mee', () => {
  const ts = (m) => Date.UTC(2026, m, 1);
  const rev = Array.from({ length: 12 }, (_, m) => [ts(m), m < 11 ? 100 : 0]);
  const cum = Array.from({ length: 12 }, (_, m) => [ts(m), Math.min(m + 1, 11) * 10]);
  const r = buildYear(2026, rev, cum, { isCurrent: true, now: new Date('2026-11-25') });
  assert.equal(r.months[11].winst, 0);
  assert.equal(r.winst, 110);
});
