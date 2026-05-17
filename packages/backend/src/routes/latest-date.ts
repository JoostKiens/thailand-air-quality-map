import type { FastifyInstance } from 'fastify';
import { redis } from '../cache/client.js';
import { supabase } from '../db/client.js';

const CACHE_KEY = 'latest-complete-date';
const CACHE_TTL_SECONDS = 30 * 60; // 30 min — refreshes well within the daily ingest window
const AQ_GRID_MIN_ROWS = 4000; // full run = 4,599; anything less means the ingest crashed mid-batch
const LOOKBACK_DAYS = 7;

export function latestDateRoutes(app: FastifyInstance): void {
  app.get('/api/latest-date', async (_req, reply) => {
    const cached = await redis.get<string>(CACHE_KEY);
    if (cached) return reply.send({ date: cached });

    const now = Date.now();

    for (let offset = 1; offset <= LOOKBACK_DAYS; offset++) {
      const date = new Date(now - offset * 86_400_000).toISOString().slice(0, 10);
      const nextDate = new Date(now - (offset - 1) * 86_400_000).toISOString().slice(0, 10);

      const [aqResult, fireResult, measResult] = await Promise.all([
        supabase.from('cams_grid').select('*', { count: 'exact', head: true }).eq('date', date),
        supabase
          .from('fire_points')
          .select('*', { count: 'exact', head: true })
          .gte('detected_at', `${date}T00:00:00Z`)
          .lt('detected_at', `${nextDate}T00:00:00Z`),
        supabase
          .from('station_readings')
          .select('*', { count: 'exact', head: true })
          .gte('measured_at', `${date}T00:00:00Z`)
          .lt('measured_at', `${nextDate}T00:00:00Z`),
      ]);

      if (
        (aqResult.count ?? 0) >= AQ_GRID_MIN_ROWS &&
        (fireResult.count ?? 0) >= 1 &&
        (measResult.count ?? 0) >= 1
      ) {
        await redis.set(CACHE_KEY, date, { ex: CACHE_TTL_SECONDS });
        return reply.send({ date });
      }
    }

    return reply
      .status(404)
      .send({ error: `No complete date found in the last ${LOOKBACK_DAYS} days` });
  });
}
