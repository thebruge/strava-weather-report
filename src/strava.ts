import type { Env } from './index';

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  start_latlng: [number, number] | [] | null;
  end_latlng: [number, number] | [] | null;
  timezone: string;
  type: string;
  sport_type: string;
  map?: { polyline: string; summary_polyline: string };
}

export function resolveStartLatLng(
  activity: StravaActivity
): [number, number] | null {
  if (activity.start_latlng?.length === 2) {
    return activity.start_latlng as [number, number];
  }
  const polyline = activity.map?.polyline || activity.map?.summary_polyline;
  if (polyline) {
    return decodeFirstPoint(polyline);
  }
  return null;
}

function decodeFirstPoint(encoded: string): [number, number] | null {
  let index = 0;
  let lat = 0;
  let lng = 0;

  const decodeNext = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  if (!encoded || index >= encoded.length) return null;
  lat += decodeNext();
  lng += decodeNext();
  return [lat / 1e5, lng / 1e5];
}

export async function getAccessToken(env: Env): Promise<string> {
  const stored = await env.TOKENS.get<StoredTokens>('strava', 'json');
  if (!stored) {
    throw new Error('No stored Strava tokens. Run the one-time OAuth bootstrap.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (stored.expires_at > now + 60) {
    return stored.access_token;
  }

  const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }

  const fresh = await res.json<StravaTokenResponse>();
  const updated: StoredTokens = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: fresh.expires_at,
  };
  await env.TOKENS.put('strava', JSON.stringify(updated));

  return fresh.access_token;
}

export async function getActivity(id: number, token: string): Promise<StravaActivity> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`getActivity ${id} failed: ${res.status} ${await res.text()}`);
  }
  return res.json<StravaActivity>();
}

export async function updateActivityDescription(
  id: number,
  description: string,
  token: string
): Promise<void> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) {
    throw new Error(`updateActivity ${id} failed: ${res.status} ${await res.text()}`);
  }
}
