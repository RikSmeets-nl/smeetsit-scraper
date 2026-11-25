import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEuro, normalizeMonths, validYear } from '../lib/contract.mjs';

test('parseEuro', () => {
  assert.equal(parseEuro('€ 1.234,56'), 1234.56);
  assert.equal(parseEuro('-1.234'), -1234);
  assert.equal(parseEuro('€ -12,5'), -12.5);
  assert.equal(parseEuro('1234.5'), 1234.5);
  assert.equal(parseEuro('(250,00)'), -250);
  assert.equal(parseEuro(null), 0);
});

test('normalizeMonths vult tot 12', () => {
  const m = normalizeMonths(2025, [{ month: '2025-03', omzet: 10, kosten: 4 }]);
  assert.equal(m.length, 12);
  assert.equal(m[2].winst, 6);
  assert.ok(validYear({ months: m, winst: 6, opbrengsten: 10, kosten: 4, revenue: [], cost_groups: [] }));
});
