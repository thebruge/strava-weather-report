# Strava Weather Enricher

A Cloudflare Worker that automatically enriches your Strava activities with weather data. When you complete a GPS activity, it fetches conditions from Open-Meteo and prepends a formatted weather block to the activity description.

## Example output

```
🌤 Weather conditions
Temp: 18.2°C, felt like 17.1°C (+1.3°C over the run)
Humidity: 72% · Dew point: 13.1°C
Wind: 12.4 km/h SSW (gusts 21 km/h)
Precipitation: 0.4 mm total
Conditions: Partly cloudy · Cloud 45%
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full walkthrough.

## Tech stack

| Component | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers | Free tier, globally distributed, no cold starts |
| Token storage | Workers KV | Persistent key/value for OAuth token rotation |
| Weather data | Open-Meteo | Free, no API key, `past_days=7` covers recent activities |
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
```

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

Auto-deploy on push to `main` requires two repository secrets:

- `CLOUDFLARE_API_TOKEN` — from https://dash.cloudflare.com/profile/api-tokens (Edit Cloudflare Workers template)
- `CLOUDFLARE_ACCOUNT_ID` — visible in the Cloudflare dashboard sidebar

## Privacy

This Worker only reads and writes your own Strava activities. No data is sent anywhere except Strava and Open-Meteo. Open-Meteo receives only coordinates and a date range — no personal information.

## License

MIT
