import type { Env, StravaWebhookEvent } from './index';
import { getAccessToken, getActivity, updateActivityDescription, resolveStartLatLng } from './strava';
import { getWeatherForActivity, type WeatherSnapshot } from './weather';

const SPORT_HEADERS: Record<string, string> = {
  Run: '🏃 Run Report',
  TrailRun: '🏔️ Trail Report',
  Ride: '🚴 Ride Report',
  GravelRide: '🚵 Ride Report',
  MountainBikeRide: '🚵 Ride Report',
  VirtualRide: '🚴 Ride Report',
  Velomobile: '🚴 Ride Report',
  Handcycle: '🚴 Ride Report',
};

const PERFORMANCE_SPORT_TYPES = new Set(Object.keys(SPORT_HEADERS));

// Covers both new sport-aware headers and the legacy marker
const MARKER_FRAGMENTS = [...Object.values(SPORT_HEADERS), '🌤 Weather conditions', '🌤 Weather Report'];

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

  if (MARKER_FRAGMENTS.some((m) => activity.description?.includes(m))) {
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

  const header = SPORT_HEADERS[activity.sport_type] ?? '🌤 Weather Report';
  const showPerformance = PERFORMANCE_SPORT_TYPES.has(activity.sport_type);
  const block = formatWeatherBlock(weather.avg, weather.start, weather.end, header, showPerformance);
  const newDescription = activity.description?.trim()
    ? `${block}\n\n${activity.description}`
    : block;

  await updateActivityDescription(activity.id, newDescription, token);
  console.log(`Enriched activity ${activity.id}`);
}

function formatWeatherBlock(
  avg: WeatherSnapshot,
  start: WeatherSnapshot,
  end: WeatherSnapshot,
  header: string,
  showPerformance: boolean
): string {
  const tempDelta = end.temperature - start.temperature;
  const deltaStr = Math.abs(tempDelta) >= 0.5
    ? `, ${tempDelta > 0 ? '+' : ''}${tempDelta.toFixed(1)}° over run`
    : '';

  const precipStr = avg.precipitation > 0.1
    ? ` · ${avg.precipitation.toFixed(1)}mm precip`
    : '';

  const gustStr = avg.windGusts > avg.windSpeed * 1.5
    ? ` (gusts ${avg.windGusts.toFixed(0)} km/h)`
    : '';

  const lines: string[] = [
    header,
    `${avg.temperature.toFixed(1)}°C (feels ${avg.apparentTemperature.toFixed(1)}°C${deltaStr}) · Humidity ${avg.humidity.toFixed(0)}% · Dew ${avg.dewPoint.toFixed(1)}°C`,
    `Wind ${avg.windSpeed.toFixed(1)} km/h ${degreesToCompass(avg.windDirection)}${gustStr} · ${weatherCodeDescription(avg.weatherCode)} · Cloud ${avg.cloudCover.toFixed(0)}%${precipStr}`,
  ];

  if (showPerformance) {
    lines.push('');
    lines.push(performanceImpact(avg));
  }

  lines.push('');
  lines.push('Powered by Open-Meteo · github.com/thebruge/strava-weather-report');

  return lines.join('\n');
}

function performanceImpact(w: WeatherSnapshot): string {
  const dew = w.dewPoint;
  const temp = w.temperature;
  const wind = w.windSpeed;
  const rain = w.precipitation > 0.1;

  // Dew point is the best indicator of heat stress
  if (dew >= 21 || temp >= 28) {
    return '⚡ Tough. Heat and humidity add significant effort — expect 5–8% slower pace.';
  }
  if (dew >= 18 || temp >= 24) {
    return '⚡ Hard work. Warm and humid — pace will feel harder than the numbers suggest.';
  }
  if (temp <= 0) {
    return '⚡ Freezing conditions. Icy risk, reduced muscle efficiency — take it steady.';
  }
  if (wind >= 35) {
    return rain
      ? '⚡ Brutal. Heavy wind and rain — just finishing is a win.'
      : '⚡ Tough. Severe wind adds major resistance — expect 6–10% effort penalty.';
  }
  if (wind >= 20) {
    return rain
      ? '⚡ Wet and windy. Grip and drag affected — factor in 4–6% effort penalty.'
      : '⚡ Challenging. Strong wind adds meaningful resistance — factor in 3–5% effort penalty.';
  }
  if (rain) {
    return '⚡ Wet but manageable. Rain affects grip — mentally tough.';
  }
  if (temp >= 8 && temp <= 14 && dew < 12 && wind < 15) {
    return '⚡ Near-ideal. Cool, dry, light wind — classic fast conditions. 🏆';
  }
  if (temp >= 5 && temp <= 18 && dew < 15 && wind < 20) {
    return '⚡ Good conditions. Solid day for a strong effort.';
  }
  if (temp < 5) {
    return '⚡ Cold but manageable. Layer up and allow extra warm-up time.';
  }
  return '⚡ Decent conditions. Nothing to hold you back.';
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
