import pRetry, { AbortError } from 'p-retry';
import { redis } from '../cache/client.js';
import { fetchAirQualityGrid } from '../lib/openmeteo.js';

const CACHE_TTL_SECONDS = 48 * 60 * 60; // 48h — historical dates don't change

export async function runAqIngest(date?: string): Promise<{ stored: number }> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  console.log(`[aq-ingest] Fetching PM2.5 grid from Open-Meteo for ${targetDate}...`);
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
          `[aq-ingest] attempt ${err.attemptNumber} failed, ${err.retriesLeft} retries left: ${err.message}`,
        ),
    },
  );
  console.log(`[aq-ingest] Fetched ${points.length} grid points`);

  if (points.length === 0) {
    console.warn(
      `[aq-ingest] No grid points returned — skipping Redis write to preserve existing data`,
    );
    return { stored: 0 };
  }

  await redis.set(`aq:pm25:${targetDate}`, points, { ex: CACHE_TTL_SECONDS });
  console.log(`[aq-ingest] Stored in Redis as aq:pm25:${targetDate} (TTL 48h)`);

  return { stored: points.length };
}
