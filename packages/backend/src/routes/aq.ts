import type { FastifyInstance } from 'fastify';
import type { PM25GridPoint } from '@thailand-aq/types';
import { redis } from '../cache/client.js';
import { fetchAirQualityGrid } from '../lib/openmeteo.js';
import { parseBbox } from '../lib/bbox.js';

const CACHE_TTL_SECONDS = 48 * 60 * 60; // 48h
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function aqRoutes(app: FastifyInstance): void {
  // GET /api/aq/pm25?date=YYYY-MM-DD&bbox=west,south,east,north
  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/aq/pm25', async (req, reply) => {
    const { date, bbox: rawBbox } = req.query;

    if (!date || !DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'date param required (YYYY-MM-DD)' });
    }

    let points = await redis.get<PM25GridPoint[]>(`aq:pm25:${date}`);

    if (points === null) {
      // Cache miss — fetch live and populate
      points = await fetchAirQualityGrid(date);
      await redis.set(`aq:pm25:${date}`, points, { ex: CACHE_TTL_SECONDS });
    }

    const bbox = parseBbox(rawBbox);
    const filtered = points.filter(
      (p) => p.lat >= bbox.south && p.lat <= bbox.north && p.lng >= bbox.west && p.lng <= bbox.east,
    );

    return reply.send({ data: filtered });
  });
}
