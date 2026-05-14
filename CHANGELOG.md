# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-05-14

### Added
- Axiom structured logging — key events (enriched, skipped, errors) sent to Axiom with weather fields for querying and alerting

## [1.3.2] - 2026-05-14

### Changed
- Wind speed displayed in mph instead of km/h

## [1.3.1] - 2026-05-12

### Security
- Reject webhook events where `owner_id` doesn't match `STRAVA_ATHLETE_ID` secret, preventing abuse of the public endpoint burning Strava API quota

## [1.3.0] - 2026-05-12

### Added
- Sport-aware headers: `🏃 Run Report`, `🏔️ Trail Report`, `🚴 Ride Report`, `🚵 Ride Report`
- Performance impact line for runs, trail runs, and rides — rule-based assessment using dew point, temperature, wind, and rain
- Attribution footer: `Powered by Open-Meteo · github.com/thebruge/strava-weather-report`
- Polyline fallback: decodes start coordinates from encoded polyline when `start_latlng` is empty

### Changed
- Compact 2-line weather format (down from 5 lines)
- Idempotency check now covers all sport-aware header variants and legacy marker

## [1.2.0] - 2026-05-12

### Changed
- GitHub Actions workflow updated to Node.js 24
- Wrangler now runs directly in CI for clearer error output
- Added GitHub Environments integration for deployment tracking in repo sidebar

## [1.1.0] - 2026-05-12

### Fixed
- Retry fetching activity up to 3 times (after 5s, 15s, 30s) when `start_latlng` is missing, to handle the race condition where Strava fires the webhook before GPS processing is complete

## [1.0.0] - 2026-05-12

### Added
- Cloudflare Worker that receives Strava webhook events for new activities
- Open-Meteo integration for free, no-key hourly weather data
- Start, end, and average weather snapshots across the activity window
- Vector-averaged wind direction to correctly handle 0°/360° wraparound
- Summed precipitation and modal weather code across the activity window
- Formatted weather block prepended to activity description
- Temperature delta shown when it changes by ≥0.5°C across the activity
- Gust info shown only when gusts exceed 1.5× mean wind speed
- Idempotency guard via `🌤 Weather conditions` marker to prevent double-writing
- Automatic Strava OAuth token rotation via Workers KV
- Strava webhook verification handshake (GET /webhook)
- GitHub Actions workflow for auto-deploy on push to `main`
- Custom domain support (`strava.gallagher.team`)
