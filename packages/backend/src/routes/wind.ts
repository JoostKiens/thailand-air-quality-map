import type { FastifyInstance } from 'fastify';
import type { WindVector } from '@thailand-aq/types';
import { redis } from '../cache/client.js';
import { parseBbox } from '../lib/bbox.js';
import { windCacheKey, runWindIngest } from '../jobs/wind-ingest.js';

export function windRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/wind', async (req, reply) => {
    const calendarDayUtc = new Date().toISOString().slice(0, 10);
    const date = req.query.date ?? calendarDayUtc;

    let vectors = await redis.get<WindVector[]>(windCacheKey(date));

    if (vectors === null) {
      try {
        await runWindIngest(date, { calendarDayUtc });
        vectors = await redis.get<WindVector[]>(windCacheKey(date));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(503).send({ error: `Wind data unavailable: ${msg}` });
      }
    }

    if (vectors === null) {
      return reply.status(503).send({ error: 'Wind data unavailable' });
    }

    const bbox = parseBbox(req.query.bbox);
    const filtered = vectors.filter(
      (v) => v.lat >= bbox.south && v.lat <= bbox.north && v.lng >= bbox.west && v.lng <= bbox.east,
    );

    return reply.send({ data: filtered });
  });
}
