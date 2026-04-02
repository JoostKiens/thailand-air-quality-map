import { redis } from '../cache/client.js';
import { fetchWindGrid } from '../lib/openmeteo.js';

const CACHE_KEY = 'wind:current';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export async function runWindIngest(): Promise<{ points: number }> {
  console.log('[wind-ingest] Fetching wind grid from Open-Meteo...');
  const vectors = await fetchWindGrid();
  console.log(`[wind-ingest] Fetched ${vectors.length} wind vectors`);

  await redis.set(CACHE_KEY, vectors, { ex: CACHE_TTL_SECONDS });
  console.log('[wind-ingest] Stored in Redis (TTL 6h)');

  return { points: vectors.length };
}
