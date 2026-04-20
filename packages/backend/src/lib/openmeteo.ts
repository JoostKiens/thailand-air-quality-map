import type { WindVector, PM25GridPoint } from '@thailand-aq/types';

// 2° grid for wind — 224 points (14 lng × 16 lat)
// Starts one step outside VIEWPORT_BBOX [89,1,114,30] so bilinear interpolation
// has full coverage at every viewport corner.
const LNG_POINTS = [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114];
const LAT_POINTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];

// 0.4° grid for PM2.5 — matches Open-Meteo CAMS native resolution
// bbox [89,1,114,30] → 63 × 73 = 4,599 points; 16 batches of 300.
// Open-Meteo free tier: 600 calls/min, 5k/hour, 10k/day — each location = 1 call.
// 4,599 calls per run = ~46% of daily budget; fine for once-daily scheduled ingest.
const AQ_STEP = 0.4;
const AQ_LNG_MIN = 89;
const AQ_LAT_MIN = 1;
const AQ_LNG_COUNT = 63; // (114 - 89) / 0.4 + 1
const AQ_LAT_COUNT = 73; // ( 30 -  1) / 0.4 + 1
const AQ_LNG_POINTS = Array.from(
  { length: AQ_LNG_COUNT },
  (_, i) => Math.round((AQ_LNG_MIN + i * AQ_STEP) * 10) / 10,
);
const AQ_LAT_POINTS = Array.from(
  { length: AQ_LAT_COUNT },
  (_, i) => Math.round((AQ_LAT_MIN + i * AQ_STEP) * 10) / 10,
);

// 300 locations per request → 16 batches total.
// Pause must be ≥30s: 300 calls/batch ÷ 600 calls/min = 30s minimum; 35s adds safety margin.
const AQ_BATCH_SIZE = 300;
const AQ_BATCH_CONCURRENCY = 1;
const AQ_BATCH_PAUSE_MS = 35_000;
// Short retries handle transient spikes; last entry (10 min) covers quota window resets
const AQ_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 600_000];

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
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryAfterSec = Number(retryAfterRaw);

    let delay: number;
    let delaySource: string;
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      delay = retryAfterSec * 1000;
      delaySource = `Retry-After header (${retryAfterSec}s)`;
    } else {
      const body = (await res.json().catch(() => null)) as { reason?: string } | null;
      const reason = body?.reason ?? '';
      if (/tomorrow|daily/i.test(reason)) {
        // Daily quota exhausted — no point retrying until UTC midnight
        console.warn(`[openmeteo] 429 daily limit: "${reason}" — skipping batch`);
        return [];
      } else if (/next hour/i.test(reason)) {
        const msUntilNextHour = 3_600_000 - (Date.now() % 3_600_000) + 5_000; // +5s buffer
        delay = msUntilNextHour;
        delaySource = `body hint "next hour" (${Math.round(delay / 1000)}s until :00)`;
      } else if (/minute|minutely/i.test(reason)) {
        delay = 65_000; // 1 minute + 5s buffer
        delaySource = `body hint "minutely" (65s)`;
      } else {
        delay = AQ_RETRY_DELAYS_MS[attempt] ?? 0;
        delaySource = reason ? `body="${reason}", fallback` : 'fallback';
      }
    }

    console.warn(
      `[openmeteo] 429 on AQ batch (attempt ${attempt + 1}/${AQ_RETRY_DELAYS_MS.length}), source=${delaySource}, waiting ${Math.round(delay / 1000)}s...`,
    );
    if (delay === 0) break;
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

  console.log(
    `[openmeteo] AQ grid: ${allLats.length} points (${AQ_LNG_COUNT}×${AQ_LAT_COUNT}), ${batches.length} batches of ≤${AQ_BATCH_SIZE}`,
  );

  // Run batches sequentially with a polite pause between each to avoid burst rate-limiting.
  // 16 batches × 3 s = ~48 s total — acceptable for a background ingest job.
  const results: PM25GridPoint[] = [];
  for (let i = 0; i < batches.length; i += AQ_BATCH_CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, AQ_BATCH_PAUSE_MS));
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
