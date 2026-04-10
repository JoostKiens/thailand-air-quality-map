import { redis } from '../cache/client.js';
import { fetchAirQualityGrid } from '../lib/openmeteo.js';

const CACHE_TTL_SECONDS = 48 * 60 * 60; // 48h — historical dates don't change

export async function runAqIngest(date?: string): Promise<{ stored: number }> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  console.log(`[aq-ingest] Fetching PM2.5 grid from Open-Meteo for ${targetDate}...`);
  const points = await fetchAirQualityGrid(targetDate);
  console.log(`[aq-ingest] Fetched ${points.length} grid points`);

  await redis.set(`aq:pm25:${targetDate}`, points, { ex: CACHE_TTL_SECONDS });
  console.log(`[aq-ingest] Stored in Redis as aq:pm25:${targetDate} (TTL 48h)`);

  return { stored: points.length };
}
