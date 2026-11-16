# strava-weather-report

A Cloudflare Worker (`strava-weather-enricher`) that adds Open-Meteo weather to
new Strava activities' descriptions. One Worker, no database, free tier only.
`README.md`, `docs/architecture.md` and `docs/setup.md` cover the design and
setup; read them before changing behaviour.

- **Live URL:** `https://strava.gallagher.team/webhook`
- **KV namespace:** `TOKENS` (ID in `wrangler.toml`), holding the rotating Strava
  OAuth tokens

## Module map

| File | Responsibility |
|---|---|
| `src/index.ts` | HTTP entry point, webhook verification, owner_id guard |
| `src/strava.ts` | Strava API client, token refresh, polyline fallback |
| `src/weather.ts` | Open-Meteo client, snapshot computation |
| `src/enrich.ts` | Orchestration, formatting, performance impact |
| `src/logger.ts` | Axiom structured logging |

## Secrets

Worker secrets (set with `wrangler secret put`): `STRAVA_CLIENT_ID`,
`STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN`, `STRAVA_ATHLETE_ID` (drops events
from other athletes), and optionally `AXIOM_TOKEN` and `AXIOM_DATASET` (without
them, logs go to `console.log` only). GitHub Actions
needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets. Never
put secret values in the repo; `.dev.vars` and `.env*` are gitignored.

## Key constraints

- **Workers free tier wall-clock limit (~30s):** GPS retry delays must stay well
  under it. Current delays: [3000, 7000] ms (two retries).
- **Open-Meteo:** use `start_date`/`end_date` and never combine them with
  `past_days` (they're mutually exclusive and cause a 400).
- **`start_latlng`** can be `[]` on short activities; always use
  `resolveStartLatLng()`, which falls back to decoding the polyline.
- The `🌤 Weather conditions` marker (and the sport-aware header variants) is
  the idempotency guard against writing the weather twice. Keep old variants
  recognised when changing the format.

## Testing

`npm test` runs the Vitest unit tests in `src/enrich.test.ts` (performance impact
and its heat and wind tiers). CI runs them before every deploy. Add tests with
any change to the formatting or tiers.

To simulate a live webhook end to end with a real activity ID (this writes to
that Strava activity, so ask first):

```bash
curl -X POST https://strava.gallagher.team/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":0,"object_id":ACTIVITY_ID,"object_type":"activity","owner_id":ATHLETE_ID,"subscription_id":0}'
```

## Deploying

**Every push to `main` deploys the Worker** (`.github/workflows/deploy.yml`: `npm
ci`, `npm test`, `wrangler deploy`). Work on `main`, and ask before each push.

## Changes, versions and releases

- Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`).
- Add each user-visible change under `## [Unreleased]` in `CHANGELOG.md` in the
  same commit.
- To release: move the Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, set
  the same version in `package.json`, update the compare links at the bottom of
  the changelog, commit as `chore(release): vX.Y.Z`, and tag `vX.Y.Z`.
