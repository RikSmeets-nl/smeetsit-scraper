// Mapping van SnelStart-API-antwoorden naar het portal-contract.
// Wordt ingevuld na `node snelstart.mjs --discover` met een echte login.
import { normalizeMonths } from './contract.mjs';

export const MAP = { ready: false };

/** @returns {Promise<{wv: Record<string, object>, extra: object}>} */
export async function scrapeAll(page, env) {
  void page; void env; void normalizeMonths;
  throw new Error('SnelStart-mapping nog niet geïmplementeerd.');
}
