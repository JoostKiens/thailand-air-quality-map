import pRetry, { AbortError } from 'p-retry';
import { redis } from '../cache/client.js';
import { supabase } from '../db/client.js';
import { fetchWeatherGridForDate } from '../lib/openmeteo.js';

const CACHE_TTL_SECONDS = 25 * 60 * 60; // 25h — outlasts daily cron by 1h
const DB_BATCH_SIZE = 500;

export function weatherCacheKey(date: string): string {
  return `weather:${date}`;
}

export type RunWeatherIngestOptions = {
  /** UTC calendar day (YYYY-MM-DD) — passed from HTTP handler so it matches resolved ?date default after awaits. */
  calendarDayUtc?: string;
};

export async function runWeatherIngest(
  date?: string,
  opts?: RunWeatherIngestOptions,
): Promise<{ stored: number }> {
  // Default to yesterday: the 07:00 UTC wind snapshot hasn't been taken yet when the cron
  // runs at 04:00 UTC, so today's reading would be missing or stale.
  const yesterday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const calendarDayUtc = opts?.calendarDayUtc ?? yesterday;
  const targetDate = date ?? yesterday;

  console.log(`[weather-ingest] Fetching weather grid for ${targetDate} from Open-Meteo...`);
  const readings = await pRetry(
    async () => {
      try {
        return await fetchWeatherGridForDate(targetDate, { calendarDayUtc });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[weather-ingest] fetch error: ${msg}`);
        // Abort only on permanent client errors (400/401/403/404/422).
        // 429 is handled with retries inside fetchWeatherBatch; let it propagate
        // to pRetry's exponential backoff if the internal retries are exhausted.
        if (err instanceof Error && /\b(400|401|403|404|414|422)\b/.test(msg))
          throw new AbortError(msg);
        throw err;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (err) =>
        console.warn(
          `[weather-ingest] attempt ${err.attemptNumber} failed, ${err.retriesLeft} retries left: ${err.message}`,
        ),
    },
  );
  console.log(`[weather-ingest] Fetched ${readings.length} grid points`);

  if (readings.length === 0) {
    console.warn(
      `[weather-ingest] No grid points returned — skipping writes to preserve existing data`,
    );
    return { stored: 0 };
  }

  // Write to Redis (hot cache)
  await redis.set(weatherCacheKey(targetDate), readings, { ex: CACHE_TTL_SECONDS });
  console.log(`[weather-ingest] Stored in Redis as weather:${targetDate} (TTL 25h)`);

  // Persist to Supabase in batches so historical dates survive Redis TTL expiry
  const rows = readings.map((r) => ({
    date: targetDate,
    lat: r.lat,
    lng: r.lng,
    wind_speed_kmh: r.wind_speed_kmh,
    wind_speed_max_kmh: r.wind_speed_max_kmh,
    wind_direction_deg: r.wind_direction_deg,
    relative_humidity_2m: r.relative_humidity_2m,
    precipitation_sum: r.precipitation_sum,
  }));

  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from('weather_readings')
      .upsert(batch, { onConflict: 'date,lat,lng', ignoreDuplicates: true });
    if (error)
      throw new Error(
        `[weather-ingest] Supabase upsert failed (batch ${Math.floor(i / DB_BATCH_SIZE) + 1}): ${error.message}`,
      );
  }
  console.log(`[weather-ingest] Persisted ${readings.length} rows to weather_readings`);

  return { stored: readings.length };
}
