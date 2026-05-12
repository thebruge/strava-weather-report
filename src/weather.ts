export interface WeatherSnapshot {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  dewPoint: number;
  windSpeed: number;
  windGusts: number;
  windDirection: number;
  precipitation: number;
  cloudCover: number;
  weatherCode: number;
}

interface HourlyData {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  dew_point_2m: number[];
  apparent_temperature: number[];
  precipitation: number[];
  cloud_cover: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  wind_direction_10m: number[];
  weather_code: number[];
}

export interface ActivityWeather {
  start: WeatherSnapshot;
  end: WeatherSnapshot;
  avg: WeatherSnapshot;
}

export async function getWeatherForActivity(
  lat: number,
  lon: number,
  startISO: string,
  elapsedSeconds: number
): Promise<ActivityWeather | null> {
  const startMs = Date.parse(startISO);
  const endMs = startMs + elapsedSeconds * 1000;

  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const endDate = new Date(endMs).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    hourly: [
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m',
      'apparent_temperature', 'precipitation', 'cloud_cover',
      'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'weather_code',
    ].join(','),
    timezone: 'UTC',
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    console.error(`Open-Meteo failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data = await res.json<{ hourly: HourlyData }>();
  if (!data.hourly?.time?.length) return null;

  const startIdx = findClosestHour(data.hourly.time, startMs);
  const endIdx = findClosestHour(data.hourly.time, endMs);
  if (startIdx === -1 || endIdx === -1) return null;

  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);

  return {
    start: extractSnapshot(data.hourly, startIdx),
    end: extractSnapshot(data.hourly, endIdx),
    avg: averageSnapshots(data.hourly, lo, hi),
  };
}

function findClosestHour(times: string[], targetMs: number): number {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] + 'Z');
    const diff = Math.abs(t - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function extractSnapshot(h: HourlyData, i: number): WeatherSnapshot {
  return {
    temperature: h.temperature_2m[i],
    apparentTemperature: h.apparent_temperature[i],
    humidity: h.relative_humidity_2m[i],
    dewPoint: h.dew_point_2m[i],
    windSpeed: h.wind_speed_10m[i],
    windGusts: h.wind_gusts_10m[i],
    windDirection: h.wind_direction_10m[i],
    precipitation: h.precipitation[i],
    cloudCover: h.cloud_cover[i],
    weatherCode: h.weather_code[i],
  };
}

function averageSnapshots(h: HourlyData, start: number, end: number): WeatherSnapshot {
  const n = end - start + 1;
  let temp = 0, app = 0, hum = 0, dew = 0, wind = 0, gusts = 0, precip = 0, cloud = 0;
  let windSinSum = 0, windCosSum = 0;
  const codeCounts: Record<number, number> = {};

  for (let i = start; i <= end; i++) {
    temp += h.temperature_2m[i];
    app += h.apparent_temperature[i];
    hum += h.relative_humidity_2m[i];
    dew += h.dew_point_2m[i];
    wind += h.wind_speed_10m[i];
    gusts += h.wind_gusts_10m[i];
    precip += h.precipitation[i];
    cloud += h.cloud_cover[i];

    const rad = (h.wind_direction_10m[i] * Math.PI) / 180;
    windSinSum += Math.sin(rad);
    windCosSum += Math.cos(rad);

    const code = h.weather_code[i];
    codeCounts[code] = (codeCounts[code] ?? 0) + 1;
  }

  let dir = (Math.atan2(windSinSum / n, windCosSum / n) * 180) / Math.PI;
  if (dir < 0) dir += 360;

  const dominantCode = Number(
    Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0]
  );

  return {
    temperature: temp / n,
    apparentTemperature: app / n,
    humidity: hum / n,
    dewPoint: dew / n,
    windSpeed: wind / n,
    windGusts: gusts / n,
    windDirection: dir,
    precipitation: precip,
    cloudCover: cloud / n,
    weatherCode: dominantCode,
  };
}
