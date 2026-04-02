import type { FastifyInstance } from 'fastify';
import type { WindVector } from '@thailand-aq/types';
import { redis } from '../cache/client.js';
import { parseBbox } from '../lib/bbox.js';

export function windRoutes(app: FastifyInstance): void {
  // GET /api/wind/current?bbox=west,south,east,north
  app.get<{ Querystring: { bbox?: string } }>('/api/wind/current', async (req, reply) => {
    const vectors = await redis.get<WindVector[]>('wind:current');

    if (vectors === null) {
      return reply.status(503).send({
        error: 'Wind data not available — run ingest:wind to populate the cache',
      });
    }

    const bbox = parseBbox(req.query.bbox);

    const filtered = vectors.filter(
      (v) => v.lat >= bbox.south && v.lat <= bbox.north && v.lng >= bbox.west && v.lng <= bbox.east,
    );

    return reply.send({ data: filtered });
  });
}
