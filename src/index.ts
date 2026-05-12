import { handleStravaActivity } from './enrich';

export interface Env {
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_VERIFY_TOKEN: string;
  STRAVA_ATHLETE_ID: string;
  TOKENS: KVNamespace;
}

export interface StravaWebhookEvent {
  aspect_type: 'create' | 'update' | 'delete';
  event_time: number;
  object_id: number;
  object_type: 'activity' | 'athlete';
  owner_id: number;
  subscription_id: number;
  updates?: Record<string, string>;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== '/webhook') {
      return new Response('Not found', { status: 404 });
    }

    // Strava webhook verification handshake.
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === env.STRAVA_VERIFY_TOKEN && challenge) {
        return Response.json({ 'hub.challenge': challenge });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // Webhook event delivery — Strava expects 200 within ~2s; do work async.
    if (request.method === 'POST') {
      let event: StravaWebhookEvent;
      try {
        event = await request.json<StravaWebhookEvent>();
      } catch {
        return new Response('Bad request', { status: 400 });
      }

      if (String(event.owner_id) !== env.STRAVA_ATHLETE_ID) {
        return new Response('OK', { status: 200 });
      }

      ctx.waitUntil(
        handleStravaActivity(event, env).catch((err) => {
          console.error('Enrichment failed:', err);
        })
      );

      return new Response('OK', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  },
};
