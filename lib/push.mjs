import crypto from 'node:crypto';

/** Stuur wv/extra naar de portal: POST /api/ingest/{entity} met HMAC-SHA256 over "timestamp.body". */
export async function push(env, entity, payload) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', env.INGEST_SECRET).update(`${ts}.${body}`).digest('hex');
  const url = `${env.PORTAL_URL.replace(/\/$/, '')}/api/ingest/${entity}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Timestamp': String(ts), 'X-Signature': sig, 'User-Agent': 'smeetsit-scraper' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ingest ${entity}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
