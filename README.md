# Strava Weather Enricher

A Cloudflare Worker that automatically enriches your Strava activities with weather data. When you complete a GPS activity, it fetches conditions from Open-Meteo and prepends a formatted weather block to the activity description.

## Example output

**Run / Trail Run / Ride** (with performance impact):
```
🏃 Run Report
12.1°C (feels 11.0°C) · Humidity 55% · Dew 3.2°C
Wind 8.5 km/h NNW · Mainly clear · Cloud 20%

⚡ Near-ideal. Cool, dry, light wind — classic fast conditions. 🏆

Powered by Open-Meteo · github.com/thebruge/strava-weather-report
```

**Other GPS activities** (weather only):
```
🌤 Weather Report
28.4°C (feels 31.2°C, +2.1° over run) · Humidity 82% · Dew 24.8°C
Wind 6.0 km/h S · Partly cloudy · Cloud 45% · 3.2mm precip

Powered by Open-Meteo · github.com/thebruge/strava-weather-report
```

Sport-aware headers: `🏃 Run Report`, `🏔️ Trail Report`, `🚴 Ride Report`, `🚵 Ride Report`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full walkthrough.

## Tech stack

| Component | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers | Free tier, globally distributed, no cold starts |
| Token storage | Workers KV | Persistent key/value for OAuth token rotation |
| Weather data | Open-Meteo | Free, no API key, `start_date`/`end_date` for precise queries |
| Language | TypeScript | Type safety for Strava + Open-Meteo API shapes |
| Deploy | GitHub Actions + Wrangler | Auto-deploy on push to `main` |

## Setup

### Prerequisites

- Cloudflare account with a zone (domain) active
- Strava account + API application
- Node.js 20+

### 1. Clone and install

```bash
git clone https://github.com/thebruge/strava-weather-report.git
cd strava-weather-report
npm install
```

### 2. Create KV namespace

```bash
npx wrangler kv namespace create TOKENS
```

Copy the `id` from the output and replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml`.

### 3. Set Worker secrets

```bash
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_VERIFY_TOKEN   # any random string
npx wrangler secret put STRAVA_ATHLETE_ID     # your numeric Strava athlete ID
```

Your athlete ID is the number in your Strava profile URL: `https://www.strava.com/athletes/YOUR_ID`.

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. One-time Strava OAuth

Authorize the app and seed KV with your tokens — see [docs/setup.md](docs/setup.md) for step-by-step instructions.

### 6. Register the Strava webhook

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=CLIENT_ID \
  -F client_secret=CLIENT_SECRET \
  -F callback_url=https://YOUR_DOMAIN/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

## Development

```bash
npm run dev      # local dev server via wrangler
npm run tail     # stream live logs from the deployed Worker
npm run deploy   # deploy to Cloudflare
```

## GitHub Actions

Auto-deploy on push to `main` requires three repository secrets:

- `CLOUDFLARE_API_TOKEN` — from https://dash.cloudflare.com/profile/api-tokens (Edit Cloudflare Workers template)
- `CLOUDFLARE_ACCOUNT_ID` — visible in the Cloudflare dashboard sidebar
- `STRAVA_ATHLETE_ID` — same value as the Worker secret above

## Privacy

This Worker only reads and writes your own Strava activities. No data is sent anywhere except Strava and Open-Meteo. Open-Meteo receives only coordinates and a date range — no personal information.

## License

MIT
