# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
