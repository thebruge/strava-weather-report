import { describe, it, expect } from 'vitest';
import { heatTier, windTier, performanceImpact } from './enrich';
import type { WeatherSnapshot } from './weather';

// Near-ideal baseline: temp 10, dew 5, wind 8 — override per test.
function snapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    temperature: 10,
    apparentTemperature: 9,
    humidity: 50,
    dewPoint: 5,
    windSpeed: 8,
    windGusts: 10,
    windDirection: 180,
    precipitation: 0,
    cloudCover: 20,
    weatherCode: 1,
    ...overrides,
  };
}

describe('heatTier', () => {
  it('returns null below the mild threshold', () => {
    expect(heatTier(12.9, 19.9)).toBeNull();
  });

  it('fires mild at dew 13', () => {
    expect(heatTier(13, 10)?.label).toBe('Mild heat load');
  });

  it('fires mild at temp 20', () => {
    expect(heatTier(5, 20)?.label).toBe('Mild heat load');
  });

  it('fires heat (warm/humid) at dew 18', () => {
    expect(heatTier(18, 10)?.label).toBe('Warm and humid conditions');
  });

  it('fires tough at dew 21', () => {
    expect(heatTier(21, 10)?.label).toBe('Tough heat and humidity');
  });

  it('fires severe at dew 24', () => {
    expect(heatTier(24, 10)?.label).toBe('Severe heat and humidity');
  });

  it('fires severe at temp 32 even with a low dew point', () => {
    expect(heatTier(5, 32)?.label).toBe('Severe heat and humidity');
  });

  it('picks the most severe tier when both dew and temp qualify', () => {
    expect(heatTier(24, 24)?.label).toBe('Severe heat and humidity');
  });
});

describe('windTier', () => {
  it('returns null below 15 kph', () => {
    expect(windTier(14.9)).toBeNull();
  });

  it('fires breezy at 15 kph', () => {
    expect(windTier(15)?.label).toBe('Breezy conditions');
  });

  it('fires strong at 25 kph', () => {
    expect(windTier(25)?.label).toBe('Strong wind');
  });

  it('fires severe at 40 kph', () => {
    expect(windTier(40)?.label).toBe('Severe wind');
  });
});

describe('performanceImpact', () => {
  it('reports near-ideal conditions for the baseline snapshot', () => {
    expect(performanceImpact(snapshot())).toContain('Near-ideal');
  });

  it('reports good conditions for a mild but non-ideal day', () => {
    const result = performanceImpact(snapshot({ temperature: 17, dewPoint: 10 }));
    expect(result).toContain('Good conditions');
  });

  it('reports decent conditions as the catch-all fallback', () => {
    const result = performanceImpact(snapshot({ temperature: 19.9, dewPoint: 10, windSpeed: 10 }));
    expect(result).toContain('Decent conditions');
  });

  it('reports a heat tier alone with a % range', () => {
    const result = performanceImpact(snapshot({ temperature: 29, dewPoint: 22.5, windSpeed: 12 }));
    expect(result).toContain('Tough heat and humidity');
    expect(result).toContain('9–12% off pace');
  });

  it('reports a wind tier alone with a % range', () => {
    const result = performanceImpact(snapshot({ temperature: 11, dewPoint: 4, windSpeed: 32 }));
    expect(result).toContain('Strong wind');
    expect(result).toContain('5–8% off pace');
  });

  it('combines heat and wind into one compounded range', () => {
    const result = performanceImpact(snapshot({ temperature: 30, dewPoint: 24, windSpeed: 28 }));
    expect(result).toContain('Severe heat and wind compounding');
    expect(result).toContain('17–23% off pace');
  });

  it('appends a rain qualifier to a heat tier', () => {
    const result = performanceImpact(snapshot({ temperature: 29, dewPoint: 22, precipitation: 2 }));
    expect(result).toContain('wet underfoot');
  });

  it('reports hazardous cold below -5°C', () => {
    const result = performanceImpact(snapshot({ temperature: -6, dewPoint: -10, windSpeed: 5 }));
    expect(result).toContain('Hazardous cold');
  });

  it('reports freezing between -5°C and 0°C', () => {
    const result = performanceImpact(snapshot({ temperature: -1, dewPoint: -5, windSpeed: 5 }));
    expect(result).toContain('Freezing');
  });

  it('reports cold but manageable between 0°C and 5°C', () => {
    const result = performanceImpact(snapshot({ temperature: 3, dewPoint: -2, windSpeed: 5 }));
    expect(result).toContain('Cold but manageable');
  });

  it('reports rain alone when nothing else qualifies', () => {
    const result = performanceImpact(snapshot({ temperature: 19.9, dewPoint: 10, windSpeed: 5, precipitation: 1 }));
    expect(result).toContain('Wet but manageable');
  });

  it('lets a cold tier take priority over rain wording', () => {
    const result = performanceImpact(snapshot({ temperature: -1, dewPoint: -5, precipitation: 1 }));
    expect(result).toContain('Freezing');
  });
});
