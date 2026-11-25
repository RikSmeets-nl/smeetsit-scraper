# smeetsit-scraper

Haalt boekhouddata op die niet via een API beschikbaar is en stuurt die naar portal.smeetsit.nl
(`POST /api/ingest/{entity}`, HMAC-SHA256). Draait dagelijks op GitHub Actions; bewaart zelf geen data.

| Script | Bron | Entiteit |
|---|---|---|
| `snelstart.mjs` | SnelStart Web | `smeetsit` |
| `jortt.mjs` | Jortt (webrapporten, W&V per jaar) | `software` |

Lokaal: secrets in `~/.config/agents/smeetsit-portal/{snelstart,jortt-software,scraper}.env`
(`scraper.env` bevat `PORTAL_URL` en `INGEST_SECRET`). Op GitHub: repository secrets met dezelfde namen.

```bash
npm ci && npx playwright install chromium
node snelstart.mjs --discover   # alleen lokaal: legt API-antwoorden vast in discover/ (gitignored)
node snelstart.mjs --dry        # scrapen zonder push -> out/snelstart.json
node jortt.mjs --dry
```
