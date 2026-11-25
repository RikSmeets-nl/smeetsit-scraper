import fs from 'node:fs';

/** Lees KEY=VALUE uit een of meer .env-bestanden; process.env wint (GitHub Actions secrets). */
export function loadEnv(...files) {
  const env = {};
  for (const f of files) {
    if (!f || !fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return new Proxy(env, { get: (o, k) => process.env[k] || o[k] });
}

export function need(env, ...keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Ontbrekende variabelen: ${missing.join(', ')}`);
    process.exit(2);
  }
}
