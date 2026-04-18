import { redis } from '../cache/client.js';
import { fetchWindGridForDate } from '../lib/openmeteo.js';

const CACHE_TTL_TODAY = 6 * 60 * 60; // 6h — refreshed by scheduler
const CACHE_TTL_HISTORICAL = 30 * 24 * 60 * 60; // 30 days — historical data is immutable

export function windCacheKey(date: string): string {
  return `wind:${date}`;
}

export type RunWindIngestOptions = {
  /** UTC calendar day for this request — pass from HTTP handler so it matches resolved ?date default after awaits. */
  calendarDayUtc?: string;
};

export async function runWindIngest(
  date?: string,
  opts?: RunWindIngestOptions,
): Promise<{ points: number }> {
  const calendarDayUtc = opts?.calendarDayUtc ?? new Date().toISOString().slice(0, 10);
  const targetDate = date ?? calendarDayUtc;
  const isToday = targetDate === calendarDayUtc;
  const ttl = isToday ? CACHE_TTL_TODAY : CACHE_TTL_HISTORICAL;

  console.log(`[wind-ingest] Fetching wind grid for ${targetDate} from Open-Meteo...`);
  const vectors = await fetchWindGridForDate(targetDate, { calendarDayUtc });
  console.log(`[wind-ingest] Fetched ${vectors.length} wind vectors`);

  await redis.set(windCacheKey(targetDate), vectors, { ex: ttl });
  console.log(
    `[wind-ingest] Stored in Redis (key: wind:${targetDate}, TTL: ${isToday ? '6h' : '30d'})`,
  );

  return { points: vectors.length };
}
