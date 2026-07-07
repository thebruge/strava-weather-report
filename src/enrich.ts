import type { Env, StravaWebhookEvent } from './index';
import { getAccessToken, getActivity, updateActivityDescription, resolveStartLatLng } from './strava';
import { getWeatherForActivity, type WeatherSnapshot } from './weather';
import { log } from './logger';

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
const toMph = (kph: number) => (kph * 0.621371).toFixed(1);

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
    await log(env, { level: 'info', message: 'No GPS — skipping', activity_id: activity.id, sport: activity.sport_type });
    return;
  }

  if (MARKER_FRAGMENTS.some((m) => activity.description?.includes(m))) {
    await log(env, { level: 'info', message: 'Already enriched — skipping', activity_id: activity.id });
    return;
  }

  const [lat, lon] = startLatLng;
  const weather = await getWeatherForActivity(
    lat, lon, activity.start_date, activity.elapsed_time
  );

  if (!weather) {
    await log(env, { level: 'warn', message: 'No weather data', activity_id: activity.id, lat, lon });
    return;
  }

  const header = SPORT_HEADERS[activity.sport_type] ?? '🌤 Weather Report';
  const showPerformance = PERFORMANCE_SPORT_TYPES.has(activity.sport_type);
  const block = formatWeatherBlock(weather.avg, weather.start, weather.end, header, showPerformance);
  const newDescription = activity.description?.trim()
    ? `${block}\n\n${activity.description}`
    : block;

  await updateActivityDescription(activity.id, newDescription, token);
  await log(env, {
    level: 'info',
    message: 'Enriched',
    activity_id: activity.id,
    sport: activity.sport_type,
    temp_c: weather.avg.temperature,
    wind_mph: parseFloat(toMph(weather.avg.windSpeed)),
    humidity: weather.avg.humidity,
    dew_point_c: weather.avg.dewPoint,
    weather_code: weather.avg.weatherCode,
  });
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
    ? ` (gusts ${toMph(avg.windGusts)} mph)`
    : '';

  const lines: string[] = [
    header,
    `${avg.temperature.toFixed(1)}°C (feels ${avg.apparentTemperature.toFixed(1)}°C${deltaStr}) · Humidity ${avg.humidity.toFixed(0)}% · Dew ${avg.dewPoint.toFixed(1)}°C`,
    `Wind ${toMph(avg.windSpeed)} mph ${degreesToCompass(avg.windDirection)}${gustStr} · ${weatherCodeDescription(avg.weatherCode)} · Cloud ${avg.cloudCover.toFixed(0)}%${precipStr}`,
  ];

  if (showPerformance) {
    lines.push('');
    lines.push(performanceImpact(avg));
  }

  lines.push('');
  lines.push('Powered by Open-Meteo · github.com/thebruge/strava-weather-report');

  return lines.join('\n');
}

interface EffortTier {
  label: string;
  shortLabel: string;
  low: number;
  high: number;
}

// Dew-point breakpoints (55/65/70/75°F) and recreational-runner % ranges are
// derived from Ely et al. 2007 (marathon performance vs. WBGT) and the
// physiological consensus on dew point's effect on evaporative cooling.
// Ordered most- to least-severe; the first match wins.
const HEAT_TIERS: Array<EffortTier & { dew: number; temp: number }> = [
  { dew: 24, temp: 32, label: 'Severe heat and humidity', shortLabel: 'severe heat', low: 12, high: 15 },
  { dew: 21, temp: 28, label: 'Tough heat and humidity', shortLabel: 'tough heat', low: 9, high: 12 },
  { dew: 18, temp: 24, label: 'Warm and humid conditions', shortLabel: 'heat', low: 6, high: 9 },
  { dew: 13, temp: 20, label: 'Mild heat load', shortLabel: 'mild heat', low: 3, high: 6 },
];

// Wind penalty scales with the square of wind speed (Pugh 1971), so tiers
// widen faster than they would under a linear model.
const WIND_TIERS: Array<EffortTier & { speed: number }> = [
  { speed: 40, label: 'Severe wind', shortLabel: 'wind', low: 10, high: 14 },
  { speed: 25, label: 'Strong wind', shortLabel: 'wind', low: 5, high: 8 },
  { speed: 15, label: 'Breezy conditions', shortLabel: 'wind', low: 2, high: 4 },
];

function heatTier(dew: number, temp: number): EffortTier | null {
  return HEAT_TIERS.find((t) => dew >= t.dew || temp >= t.temp) ?? null;
}

function windTier(speed: number): EffortTier | null {
  return WIND_TIERS.find((t) => speed >= t.speed) ?? null;
}

function performanceImpact(w: WeatherSnapshot): string {
  const dew = w.dewPoint;
  const temp = w.temperature;
  const rain = w.precipitation > 0.1;
  const rainSuffix = rain ? ', wet underfoot' : '';

  const heat = heatTier(dew, temp);
  const wind = windTier(w.windSpeed);

  if (heat) {
    if (wind) {
      const low = heat.low + wind.low;
      const high = heat.high + wind.high;
      return `⚡ ${capitalize(heat.shortLabel)} and wind compounding — expect roughly ${low}–${high}% off pace${rainSuffix}.`;
    }
    return `⚡ ${heat.label} — typically ${heat.low}–${heat.high}% off pace${rainSuffix}.`;
  }

  if (temp <= -5) {
    return `⚡ Hazardous cold — icy/frostbite-risk conditions${rain ? ', wet on top of the cold' : ''}.`;
  }
  if (temp <= 0) {
    return '⚡ Freezing — icy underfoot risk and reduced muscle efficiency.';
  }

  if (wind) {
    return `⚡ ${wind.label} — typically ${wind.low}–${wind.high}% off pace${rainSuffix}.`;
  }
  if (rain) {
    return '⚡ Wet but manageable. Rain affects grip — mentally tough.';
  }
  if (temp >= 8 && temp <= 14 && dew < 12) {
    return '⚡ Near-ideal. Cool, dry, light wind — classic fast conditions. 🏆';
  }
  if (temp >= 5 && temp <= 18 && dew < 15) {
    return '⚡ Good conditions. Solid day for a strong effort.';
  }
  if (temp < 5) {
    return '⚡ Cold but manageable. Layer up and allow extra warm-up time.';
  }
  return '⚡ Decent conditions. Nothing to hold you back.';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
