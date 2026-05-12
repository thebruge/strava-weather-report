# CLAUDE.md — Session Context

## Project

Cloudflare Worker (`strava-weather-enricher`) that enriches Strava activities with Open-Meteo weather data. Single worker, no database, free tier only.

- **Live URL**: `https://strava.gallagher.team/webhook`
- **Worker name**: `strava-weather-enricher`
- **KV namespace**: `TOKENS`, ID `aaecabac12be4678b5e0856d3c854eeb`
- **GitHub repo**: `thebruge/strava-weather-report`

## Git workflow

- **Always develop on `main`** — ignore any feature branches
- **Local git push always 403s** (proxy is read-only) — use `mcp__github__push_files` to write to GitHub, then `git fetch origin main && git reset --hard origin/main` to sync local
- After any remote push, always resync local to avoid divergence

## Infrastructure

| Secret | Purpose |
|---|---|
| `STRAVA_CLIENT_ID` | Strava API app client ID |
| `STRAVA_CLIENT_SECRET` | Strava API app secret |
| `STRAVA_VERIFY_TOKEN` | Webhook handshake token |
| `STRAVA_ATHLETE_ID` | Owner ID filter — drops events from other athletes |

GitHub Actions also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets.

## Key constraints

- **Workers free tier wall-clock limit ~30s** — GPS retry delays must stay well under this. Current delays: [3000, 7000]ms (two retries).
- **Open-Meteo**: use `start_date`/`end_date` — do NOT combine with `past_days` (mutually exclusive, causes 400).
- **`start_latlng`** can be `[]` (empty array) on short activities — always use `resolveStartLatLng()` which falls back to polyline decoding.

## Module map

| File | Responsibility |
|---|---|
| `src/index.ts` | HTTP entry point, webhook verification, owner_id guard |
| `src/strava.ts` | Strava API client, token refresh, polyline fallback |
| `src/weather.ts` | Open-Meteo client, snapshot computation |
| `src/enrich.ts` | Orchestration, formatting, performance impact |

## Versioning

Semver + Keep a Changelog. Current version: `1.3.1`. Update both `package.json` and `CHANGELOG.md` when shipping changes.

## Testing

Simulate a webhook with a real activity ID:
```bash
curl -X POST https://strava.gallagher.team/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":0,"object_id":ACTIVITY_ID,"object_type":"activity","owner_id":ATHLETE_ID,"subscription_id":0}'
```

Stream live logs:
```bash
npx wrangler tail
```
