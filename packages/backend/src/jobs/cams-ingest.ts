import pRetry, { AbortError } from 'p-retry';
import { redis } from '../cache/client.js';
import { supabase } from '../db/client.js';
import { fetchAirQualityGrid } from '../lib/openmeteo.js';

const CACHE_TTL_SECONDS = 48 * 60 * 60; // 48h
const DB_BATCH_SIZE = 500;

export async function runCamsIngest(date?: string): Promise<{ stored: number }> {
  const targetDate =
    date ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

  console.log(`[cams-ingest] Fetching PM2.5 grid from Open-Meteo for ${targetDate}...`);
  const points = await pRetry(
    async () => {
      try {
        return await fetchAirQualityGrid(targetDate);
      } catch (err) {
        if (err instanceof Error && /\b4\d\d\b/.test(err.message))
          throw new AbortError(err.message);
        throw err;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (err) =>
        console.warn(
          `[cams-ingest] attempt ${err.attemptNumber} failed, ${err.retriesLeft} retries left: ${err.message}`,
        ),
    },
  );
  console.log(`[cams-ingest] Fetched ${points.length} grid points`);

  if (points.length === 0) {
    console.warn(
      `[cams-ingest] No grid points returned — skipping writes to preserve existing data`,
    );
    return { stored: 0 };
  }

  // Write to Redis (hot cache)
  await redis.set(`cams:pm25:${targetDate}`, points, { ex: CACHE_TTL_SECONDS });
  console.log(`[cams-ingest] Stored in Redis as cams:pm25:${targetDate} (TTL 48h)`);

  // Persist to Supabase in batches so historical dates survive Redis TTL expiry
  const rows = points.map((p) => ({ date: targetDate, lat: p.lat, lng: p.lng, pm25: p.pm25 }));
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from('cams_grid')
      .upsert(batch, { onConflict: 'date,lat,lng', ignoreDuplicates: true });
    if (error)
      throw new Error(
        `[cams-ingest] Supabase upsert failed (batch ${Math.floor(i / DB_BATCH_SIZE) + 1}): ${error.message}`,
      );
  }
  console.log(`[cams-ingest] Persisted ${points.length} rows to cams_grid`);

  return { stored: points.length };
}
