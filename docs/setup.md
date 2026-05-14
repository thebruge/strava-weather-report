# Setup Guide

## Prerequisites

- Cloudflare account with an active zone (domain)
- Strava account
- Node.js 20+
- Wrangler CLI (`npm install -g wrangler` or use `npx wrangler`)

## Step 1 — Create a Strava API application

1. Go to https://www.strava.com/settings/api
2. Fill in the form (name, website, etc. — these can be anything)
3. Set **Authorization Callback Domain** to `localhost`
4. Note your **Client ID** and **Client Secret**

## Step 2 — Clone and install

```bash
git clone https://github.com/thebruge/strava-weather-report.git
cd strava-weather-report
npm install
```

## Step 3 — Create KV namespace

```bash
npx wrangler login
npx wrangler kv namespace create TOKENS
```

Copy the `id` from the output and edit `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TOKENS"
id = "YOUR_KV_NAMESPACE_ID"   # ← replace this
```

Also update the `routes` entry if you're using a different domain than `strava.gallagher.team`.

## Step 4 — Set Worker secrets

```bash
npx wrangler secret put STRAVA_CLIENT_ID      # your numeric client ID
npx wrangler secret put STRAVA_CLIENT_SECRET  # your client secret
npx wrangler secret put STRAVA_VERIFY_TOKEN   # any random string you choose
npx wrangler secret put STRAVA_ATHLETE_ID     # your Strava athlete ID
```

Your **athlete ID** is the number in the URL when you view your Strava profile: `https://www.strava.com/athletes/YOUR_ID`. It's also returned in the OAuth token exchange response as `athlete.id`.

This is used to reject webhook events from other athletes, protecting your Strava API quota.

Keep note of the verify token — you'll need it again in step 7.

## Step 5 — Deploy

```bash
npx wrangler deploy
```

The Worker will be live at your custom domain (e.g. `https://strava.gallagher.team/webhook`).

## Step 6 — One-time Strava OAuth

This seeds your KV store with OAuth tokens so the Worker can act on your behalf.

**6a.** Visit this URL in your browser (replace `CLIENT_ID`):

```
https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all,activity:write
```

**6b.** Authorize the app. Your browser will redirect to a `localhost` URL that fails to load — that's expected. Copy the `code` value from the URL bar:

```
http://localhost/?state=&code=COPY_THIS_VALUE&scope=...
```

**6c.** Exchange the code for tokens:

```bash
curl -X POST https://www.strava.com/api/v3/oauth/token \
  -d client_id=CLIENT_ID \
  -d client_secret=CLIENT_SECRET \
  -d code=THE_CODE \
  -d grant_type=authorization_code
```

**6d.** Seed KV with the returned tokens:

```bash
npx wrangler kv key put --binding=TOKENS strava \
  '{"access_token":"...","refresh_token":"...","expires_at":1234567890}' \
  --remote
```

The Worker will automatically refresh these tokens as they expire.

## Step 7 — Register the Strava webhook

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=CLIENT_ID \
  -F client_secret=CLIENT_SECRET \
  -F callback_url=https://YOUR_DOMAIN/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

Should return `{"id": 123456}`. You're done.

> **Note:** Strava allows only one active webhook subscription per app. If you get a duplicate error:
> ```bash
> # List existing subscriptions
> curl -G https://www.strava.com/api/v3/push_subscriptions \
>   -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET
>
> # Delete by ID
> curl -X DELETE "https://www.strava.com/api/v3/push_subscriptions/SUB_ID?client_id=CLIENT_ID&client_secret=CLIENT_SECRET"
> ```

## Step 8 — GitHub Actions auto-deploy (optional)

Add three secrets to your GitHub repository (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — create at https://dash.cloudflare.com/profile/api-tokens using the **Edit Cloudflare Workers** template
- `CLOUDFLARE_ACCOUNT_ID` — visible in the Cloudflare dashboard sidebar
- `STRAVA_ATHLETE_ID` — same value as the Worker secret above

Pushes to `main` will now auto-deploy the Worker.

## Step 9 — Axiom logging (optional)

Axiom provides persistent, queryable logs for the Worker — useful for debugging enrichment failures without needing `wrangler tail` open.

1. Create a free account at https://axiom.co
2. Create a dataset (e.g. `strava-weather`)
3. Create an API token with ingest permissions for that dataset
4. Add the secrets to your Worker:

```bash
npx wrangler secret put AXIOM_TOKEN    # your Axiom API token
npx wrangler secret put AXIOM_DATASET  # your dataset name, e.g. strava-weather
```

The Worker will now send structured log entries to Axiom for every enrichment, skip, and error. If these secrets are not set, logging falls back to `console.log` only (visible via `wrangler tail`).

## Verification

Test the webhook handshake:

```bash
curl "https://YOUR_DOMAIN/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test"
# Expected: {"hub.challenge":"test"}
```

Watch live logs while testing:

```bash
npx wrangler tail
```

Simulate a webhook with a real activity ID:

```bash
curl -X POST https://YOUR_DOMAIN/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":0,"object_id":YOUR_ACTIVITY_ID,"object_type":"activity","owner_id":YOUR_ATHLETE_ID,"subscription_id":0}'
```
