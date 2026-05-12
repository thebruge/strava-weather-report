import type { Env, StravaWebhookEvent } from './index';
import { getAccessToken, getActivity, updateActivityDescription, resolveStartLatLng } from './strava';
import { getWeatherForActivity, type WeatherSnapshot } from './weather';

const MARKER = '🌤 Weather conditions';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleStravaActivity(
  event: StravaWebhookEvent,
  env: Env
): Promise<void> {
  if (event.object_type !== 'activity') return;
  if (event.aspect_type !== 'create') return;

  const token = await getAccessToken(env);

  // Strava fires the webhook before GPS processing completes. Retry a few
  // times with backoff to give the activity time to be fully populated.
  // Delays are kept short to stay within the Workers free tier waitUntil limit.
  let activity = await getActivity(event.object_id, token);
  if (!resolveStartLatLng(activity)) {
    const delays = [3000, 7000];
    for (const delay of delays) {
      await sleep(delay);
      activity = await getActivity(event.object_id, token);
      if (resolveStartLatLng(activity)) break;
    }
  }

  const startLatLng = resolveStartLatLng(activity);
  if (!startLatLng) {
    console.log(`Activity ${activity.id} has no GPS — skipping`);
    return;
  }

  if (activity.description?.includes(MARKER)) {
    console.log(`Activity ${activity.id} already enriched — skipping`);
    return;
  }

  const [lat, lon] = startLatLng;
  const weather = await getWeatherForActivity(
    lat, lon, activity.start_date, activity.elapsed_time
  );

  if (!weather) {
    console.log(`No weather data for ${activity.id}`);
    return;
  }

  const block = formatWeatherBlock(weather.avg, weather.start, weather.end);
  const newDescription = activity.description?.trim()
    ? `${block}\n\n${activity.description}`
    : block;

  await updateActivityDescription(activity.id, newDescription, token);
  console.log(`Enriched activity ${activity.id}`);
}

function formatWeatherBlock(
  avg: WeatherSnapshot,
  start: WeatherSnapshot,
  end: WeatherSnapshot
): string {
  const tempDelta = end.temperature - start.temperature;
  const deltaStr =
    Math.abs(tempDelta) >= 0.5
      ? ` (${tempDelta > 0 ? '+' : ''}${tempDelta.toFixed(1)}°C over the run)`
      : '';

  const lines: string[] = [
    MARKER,
    `Temp: ${avg.temperature.toFixed(1)}°C, felt like ${avg.apparentTemperature.toFixed(1)}°C${deltaStr}`,
    `Humidity: ${avg.humidity.toFixed(0)}% · Dew point: ${avg.dewPoint.toFixed(1)}°C`,
    `Wind: ${avg.windSpeed.toFixed(1)} km/h ${degreesToCompass(avg.windDirection)}` +
      (avg.windGusts > avg.windSpeed * 1.5
        ? ` (gusts ${avg.windGusts.toFixed(0)} km/h)`
        : ''),
  ];

  if (avg.precipitation > 0.1) {
    lines.push(`Precipitation: ${avg.precipitation.toFixed(1)} mm total`);
  }

  lines.push(`Conditions: ${weatherCodeDescription(avg.weatherCode)} · Cloud ${avg.cloudCover.toFixed(0)}%`);
  return lines.join('\n');
}

function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function weatherCodeDescription(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return `Code ${code}`;
}
