import type { FastifyInstance } from 'fastify';
import type { PM25GridPoint } from '@thailand-aq/types';
import { redis, HISTORICAL_TTL_SECONDS, CACHE_CONTROL_IMMUTABLE } from '../cache/client.js';
import { supabase } from '../db/client.js';
import { parseBbox } from '../lib/bbox.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function camsRoutes(app: FastifyInstance): void {
  // GET /api/cams?date=YYYY-MM-DD&bbox=west,south,east,north
  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/cams', async (req, reply) => {
    const { date, bbox: rawBbox } = req.query;

    if (!date || !DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'date param required (YYYY-MM-DD)' });
    }

    let points = await redis.get<PM25GridPoint[]>(`cams:pm25:${date}`);

    if (!points?.length) {
      // Redis miss — fall back to Supabase
      const { data, error } = await supabase
        .from('cams_grid')
        .select('lat, lng, pm25')
        .eq('date', date);

      if (error) throw new Error(`Supabase cams_grid query failed: ${error.message}`);

      if (!data?.length) {
        return reply
          .status(404)
          .send({ error: 'No CAMS grid data for this date. Run the ingest job.' });
      }

      points = data as PM25GridPoint[];

      // Re-populate Redis so subsequent requests within the TTL window skip Supabase
      await redis.set(`cams:pm25:${date}`, points, { ex: HISTORICAL_TTL_SECONDS });
    }

    const bbox = parseBbox(rawBbox);
    const filtered = points.filter(
      (p) => p.lat >= bbox.south && p.lat <= bbox.north && p.lng >= bbox.west && p.lng <= bbox.east,
    );

    return reply.header('Cache-Control', CACHE_CONTROL_IMMUTABLE).send({ data: filtered });
  });
}
