import type { WindVector } from '@thailand-aq/types';

// 2° grid over the data bbox (92–114°E, 1–27°N) → 12 × 14 = 168 points
const LNG_POINTS = [92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114];
const LAT_POINTS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27];

interface OpenMeteoResult {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[]; // 'YYYY-MM-DDTHH:MM'
    windspeed_10m: number[];
    winddirection_10m: number[];
  };
}

export async function fetchWindGrid(): Promise<WindVector[]> {
  const lats: number[] = [];
  const lngs: number[] = [];

  for (const lat of LAT_POINTS) {
    for (const lng of LNG_POINTS) {
      lats.push(lat);
      lngs.push(lng);
    }
  }

  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lngs.join(','),
    hourly: 'windspeed_10m,winddirection_10m',
    forecast_days: '1',
    timezone: 'UTC',
    wind_speed_unit: 'kmh',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  }

  const results = (await res.json()) as OpenMeteoResult[];

  const nowUtc = Date.now();

  return results.map((loc) => {
    const idx = currentHourIndex(loc.hourly.time, nowUtc);
    return {
      lat: loc.latitude,
      lng: loc.longitude,
      speedKmh: loc.hourly.windspeed_10m[idx] ?? 0,
      directionDeg: loc.hourly.winddirection_10m[idx] ?? 0,
    };
  });
}

// Find the index of the latest past hour in the time array
function currentHourIndex(times: string[], nowMs: number): number {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i] + ':00Z').getTime();
    if (t <= nowMs) best = i;
    else break;
  }
  return best;
}
