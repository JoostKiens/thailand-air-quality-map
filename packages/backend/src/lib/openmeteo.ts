import type { WindVector, PM25GridPoint } from '@thailand-aq/types';

// 2° grid for wind — 168 points
const LNG_POINTS = [92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114];
const LAT_POINTS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27];

// 1° grid for PM2.5 — extended west to 92°E to cover all of Myanmar
// bbox [92,5,110,28] → 19 × 24 = 456 points
const AQ_LNG_POINTS = Array.from({ length: 19 }, (_, i) => 92 + i); // [92..110]
const AQ_LAT_POINTS = Array.from({ length: 24 }, (_, i) => 5 + i); // [5..28]

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

interface OpenMeteoAQResult {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[];
    pm2_5: (number | null)[];
  };
}

export async function fetchAirQualityGrid(date: string): Promise<PM25GridPoint[]> {
  const lats: number[] = [];
  const lngs: number[] = [];

  for (const lat of AQ_LAT_POINTS) {
    for (const lng of AQ_LNG_POINTS) {
      lats.push(lat);
      lngs.push(lng);
    }
  }

  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lngs.join(','),
    hourly: 'pm2_5',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });

  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`,
  );
  if (!res.ok) {
    throw new Error(`Open-Meteo Air Quality API error: ${res.status} ${res.statusText}`);
  }

  const results = (await res.json()) as OpenMeteoAQResult[];

  return results
    .map((loc) => {
      const values = loc.hourly.pm2_5.filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return { lat: loc.latitude, lng: loc.longitude, pm25: Math.round(mean * 10) / 10 };
    })
    .filter((p): p is PM25GridPoint => p !== null);
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
