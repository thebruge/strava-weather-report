# Architecture

## Overview

Strava Weather Enricher is a single Cloudflare Worker with four TypeScript modules. It has no database, no server, and no ongoing compute cost — it only runs when Strava fires a webhook.

```
Strava ──webhook──▶ Worker ──▶ Strava API (read activity)
                       │
                       ├──▶ Open-Meteo API (fetch weather)
                       │
                       └──▶ Strava API (write description)

Workers KV ◀──▶ Worker  (OAuth token storage)
```

## Request lifecycle

1. **Strava fires a POST** to `/webhook` when an activity is created.
2. The Worker immediately returns `200 OK` (Strava requires a response within ~2s).
3. The enrichment work runs asynchronously via `ctx.waitUntil()` so the response isn't blocked.
4. The Worker fetches the activity from Strava to get `start_latlng`, `start_date`, and `elapsed_time`.
5. If the activity has no GPS, or is already enriched (checked via sport-aware marker fragments), processing stops.
6. Open-Meteo is queried for hourly weather data spanning the activity's start and end dates.
7. Three snapshots are computed: start, end, and average across the activity window.
8. A formatted weather block is prepended to the activity description and PUT back to Strava.

## Modules

### `src/index.ts` — Entry point

Handles the two HTTP interactions Strava requires:

- **GET /webhook** — Webhook verification handshake. Strava sends `hub.mode`, `hub.verify_token`, and `hub.challenge`; the Worker echoes back the challenge if the verify token matches.
- **POST /webhook** — Live event delivery. Parses the event and dispatches async enrichment via `ctx.waitUntil()`.

All other paths return 404.

### `src/strava.ts` — Strava API client

- `getAccessToken(env)` — Reads tokens from KV. If the access token expires within 60 seconds, automatically refreshes via the Strava OAuth token endpoint and writes the new tokens back to KV.
- `getActivity(id, token)` — Fetches a single activity by ID.
- `resolveStartLatLng(activity)` — Returns GPS coordinates from `start_latlng` if populated, otherwise decodes the first point from the activity's encoded polyline. Handles the case where Strava populates the polyline but leaves `start_latlng` empty (common on short walks).
- `updateActivityDescription(id, description, token)` — PUTs an updated description back to Strava.

### `src/weather.ts` — Open-Meteo client

- `getWeatherForActivity(lat, lon, startISO, elapsedSeconds)` — Queries Open-Meteo's hourly forecast API using explicit `start_date`/`end_date` parameters. Returns `{ start, end, avg }` snapshots.
- `findClosestHour()` — Finds the nearest hourly data point to a given timestamp.
- `averageSnapshots()` — Computes mean values across the activity window. Wind direction uses **vector averaging** (sin/cos decomposition) to correctly handle the 0°/360° wraparound. Precipitation is **summed** rather than averaged. Weather code uses the **mode** (most frequent code) across the window.

### `src/enrich.ts` — Orchestration + formatting

- `handleStravaActivity(event, env)` — Top-level handler. Guards for non-activity events, no-GPS activities, and already-enriched activities. Retries GPS fetch up to twice (3s, 7s) to handle the race condition where Strava fires the webhook before GPS processing completes.
- `formatWeatherBlock()` — Builds the compact 2-line weather block with sport-aware header, optional performance impact line, and attribution footer. Shows temp delta if ≥0.5°C change, gusts only if >1.5× mean wind speed, precipitation only if >0.1mm.
- `performanceImpact()` — Rule-based assessment for runs, trail runs, and rides. Uses dew point as the primary heat stress indicator, then wind and rain. Only shown for performance sport types.
- `degreesToCompass()` — Converts wind bearing to a 16-point compass label (N, NNE, NE, …).
- `weatherCodeDescription()` — Maps WMO weather codes to human-readable strings.

## Token rotation

Strava access tokens expire every 6 hours. The Worker handles this transparently:

```
KV["strava"] = { access_token, refresh_token, expires_at }
```

On each invocation, `getAccessToken()` checks `expires_at`. If the token is valid for more than 60 seconds, it's returned as-is. Otherwise a refresh request is made to Strava, and the new token set is written back to KV before returning.

## Idempotency

Before enriching, the Worker checks whether the description already contains any known header fragment (`🏃 Run Report`, `🏔️ Trail Report`, `🚴 Ride Report`, `🚵 Ride Report`, `🌤 Weather Report`, or the legacy `🌤 Weather conditions`). If a match is found, the Worker exits early. This prevents double-writing if Strava retries a webhook delivery.

## Infrastructure

| Resource | Details |
|---|---|
| Worker | `strava-weather-enricher`, deployed to `strava.gallagher.team` |
| KV Namespace | `TOKENS` — stores one key: `strava` |
| Secrets | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN` |
| Custom domain | `strava.gallagher.team` — Cloudflare manages DNS + TLS |
| CI/CD | GitHub Actions → `wrangler deploy` on push to `main` |

## Data flow diagram

```
Activity saved on Strava app/watch
         │
         ▼
Strava backend
  POST /webhook  ──────────────────────────────────────────▶ Worker
                                                               │
                                                    200 OK ◀──┘ (immediate)
                                                               │
                                                    ctx.waitUntil(enrich())
                                                               │
                                            ┌──────────────────┤
                                            ▼                  │
                                      KV: get token            │
                                            │                  │
                                   expired? │                  │
                                    yes ────┼──▶ Strava /oauth/token
                                            │        │
                                            │   KV: put new token
                                            │
                                            ▼
                                  Strava GET /activities/:id
                                            │
                                   no GPS? ─┼──▶ exit
                                  enriched? ─┼──▶ exit
                                            │
                                            ▼
                                  Open-Meteo GET /forecast
                                            │
                                            ▼
                                  compute snapshots
                                            │
                                            ▼
                                  Strava PUT /activities/:id
```
