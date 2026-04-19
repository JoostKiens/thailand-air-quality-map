import type { WindVector, PM25GridPoint } from '@thailand-aq/types';

// 2° grid for wind — 224 points (14 lng × 16 lat)
// Starts one step outside VIEWPORT_BBOX [89,1,114,30] so bilinear interpolation
// has full coverage at every viewport corner.
const LNG_POINTS = [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114];
const LAT_POINTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];

// 0.4° grid for PM2.5 — matches Open-Meteo CAMS native resolution
// bbox [89,1,114,30] → 63 × 73 = 4,599 points; cell edges align to viewport corners
const AQ_STEP = 0.4;
const AQ_LNG_POINTS = Array.from(
  { length: 63 },
  (_, i) => Math.round((89 + i * AQ_STEP) * 10) / 10,
);
const AQ_LAT_POINTS = Array.from({ length: 73 }, (_, i) => Math.round((1 + i * AQ_STEP) * 10) / 10);

// 300 locations per request keeps URL under ~3.5KB and reduces total requests to 16
const AQ_BATCH_SIZE = 300;
const AQ_BATCH_CONCURRENCY = 1; // sequential — minimises request count against rate limits
const AQ_RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // backoff on 429

interface OpenMeteoResult {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[]; // 'YYYY-MM-DDTHH:MM'
    windspeed_10m: number[];
    winddirection_10m: number[];
  };
}

// 07:00 UTC = 14:00 BKK — peak daytime convective mixing, best for smoke transport
const HISTORICAL_HOUR_UTC = 7;

export type FetchWindGridOptions = {
  /** UTC calendar day (YYYY-MM-DD) used to decide forecast vs archive; must be one snapshot for the whole request. */
  calendarDayUtc: string;
};

export async function fetchWindGridForDate(
  date: string,
  options: FetchWindGridOptions,
): Promise<WindVector[]> {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (const lat of LAT_POINTS) {
    for (const lng of LNG_POINTS) {
      lats.push(lat);
      lngs.push(lng);
    }
  }

  const isToday = date === options.calendarDayUtc;

  const baseUrl = isToday
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';

  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lngs.join(','),
    hourly: 'windspeed_10m,winddirection_10m',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
    wind_speed_unit: 'kmh',
  });

  const res = await fetch(`${baseUrl}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  }

  const results = (await res.json()) as OpenMeteoResult[];
  const nowUtc = Date.now();

  return results.map((loc) => {
    const idx = isToday
      ? currentHourIndex(loc.hourly.time, nowUtc)
      : targetHourIndex(loc.hourly.time, date, HISTORICAL_HOUR_UTC);
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

async function fetchAQBatch(
  lats: number[],
  lngs: number[],
  date: string,
): Promise<PM25GridPoint[]> {
  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lngs.join(','),
    hourly: 'pm2_5',
    start_date: date,
    end_date: date,
    timezone: 'UTC',
  });

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;

  let res: Response | undefined;
  for (let attempt = 0; attempt <= AQ_RETRY_DELAYS_MS.length; attempt++) {
    res = await fetch(url);
    if (res.status !== 429) break;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const delay =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : (AQ_RETRY_DELAYS_MS[attempt] ?? 0);
    if (delay === 0) break;
    console.warn(`[openmeteo] 429 on AQ batch, retrying in ${Math.round(delay / 1000)}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }

  if (!res?.ok) {
    throw new Error(`Open-Meteo Air Quality API error: ${res?.status} ${res?.statusText}`);
  }

  // API returns a single object when one location is requested, array for multiple.
  const raw = (await res.json()) as OpenMeteoAQResult | OpenMeteoAQResult[];
  const results = Array.isArray(raw) ? raw : [raw];

  return results
    .map((loc) => {
      const values = loc.hourly.pm2_5.filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return { lat: loc.latitude, lng: loc.longitude, pm25: Math.round(mean * 10) / 10 };
    })
    .filter((p): p is PM25GridPoint => p !== null);
}

export async function fetchAirQualityGrid(date: string): Promise<PM25GridPoint[]> {
  // Build flat list of all grid points
  const allLats: number[] = [];
  const allLngs: number[] = [];
  for (const lat of AQ_LAT_POINTS) {
    for (const lng of AQ_LNG_POINTS) {
      allLats.push(lat);
      allLngs.push(lng);
    }
  }

  // Split into batches
  const batches: Array<{ lats: number[]; lngs: number[] }> = [];
  for (let i = 0; i < allLats.length; i += AQ_BATCH_SIZE) {
    batches.push({
      lats: allLats.slice(i, i + AQ_BATCH_SIZE),
      lngs: allLngs.slice(i, i + AQ_BATCH_SIZE),
    });
  }

  // Run batches with limited concurrency
  const results: PM25GridPoint[] = [];
  for (let i = 0; i < batches.length; i += AQ_BATCH_CONCURRENCY) {
    const chunk = batches.slice(i, i + AQ_BATCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((b) => fetchAQBatch(b.lats, b.lngs, date)));
    for (const points of chunkResults) {
      results.push(...points);
    }
  }

  return results;
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

function parseOpenMeteoUtcMs(time: string): number {
  if (/[Zz]|[+-]\d{2}(?::?\d{2})?$/.test(time)) {
    return Date.parse(time);
  }
  return Date.parse(`${time}Z`);
}

// Pick the hourly slot closest to the target UTC instant (handles :00 vs :00:00, ms, Z).
function targetHourIndex(times: string[], date: string, hourUtc: number): number {
  if (times.length === 0) return 0;
  const parts = date.split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return 0;
  }
  const targetMs = Date.UTC(y, mo - 1, d, hourUtc, 0, 0);
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const tMs = parseOpenMeteoUtcMs(times[i]);
    if (Number.isNaN(tMs)) continue;
    const diff = Math.abs(tMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}
