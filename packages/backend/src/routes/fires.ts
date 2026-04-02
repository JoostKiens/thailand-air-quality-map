import type { FastifyInstance } from 'fastify';
import type { FirePoint } from '@thailand-aq/types';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { parseBbox, DEFAULT_BBOX } from '../lib/bbox.js';

const CACHE_TTL_SECONDS = 3 * 60 * 60; // 3 hours
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function firesRoutes(app: FastifyInstance): void {
  // GET /api/fires?date=YYYY-MM-DD&bbox=west,south,east,north
  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/fires', async (req, reply) => {
    const { date, bbox: rawBbox } = req.query;

    if (!date) return reply.status(400).send({ error: 'Missing required param: date' });
    if (!DATE_RE.test(date))
      return reply.status(400).send({ error: 'Invalid date format, expected YYYY-MM-DD' });

    const bbox = parseBbox(rawBbox);
    const isDefaultBbox = !rawBbox || rawBbox === DEFAULT_BBOX;

    // Redis cache — only for default bbox requests
    if (isDefaultBbox) {
      const cached = await redis.get<FirePoint[]>(`fires:date:${date}`);
      if (cached !== null) return reply.send({ data: cached });
    }

    const data = await queryFires(date, date, bbox);

    if (isDefaultBbox) {
      await redis.set(`fires:date:${date}`, data, { ex: CACHE_TTL_SECONDS });
    }

    return reply.send({ data });
  });

  // GET /api/fires/range?start=YYYY-MM-DD&end=YYYY-MM-DD&bbox=...
  app.get<{ Querystring: { start?: string; end?: string; bbox?: string } }>(
    '/api/fires/range',
    async (req, reply) => {
      const { start, end, bbox: rawBbox } = req.query;

      if (!start) return reply.status(400).send({ error: 'Missing required param: start' });
      if (!end) return reply.status(400).send({ error: 'Missing required param: end' });
      if (!DATE_RE.test(start))
        return reply.status(400).send({ error: 'Invalid start date format' });
      if (!DATE_RE.test(end)) return reply.status(400).send({ error: 'Invalid end date format' });

      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);

      if (diffDays < 0) return reply.status(400).send({ error: 'start must be before end' });
      if (diffDays > 10)
        return reply.status(400).send({ error: 'Date range cannot exceed 10 days' });

      const bbox = parseBbox(rawBbox);
      const data = await queryFires(start, end, bbox);
      return reply.send({ data });
    },
  );
}

async function queryFires(
  start: string,
  end: string,
  bbox: ReturnType<typeof parseBbox>,
): Promise<FirePoint[]> {
  const dayAfterEnd = new Date(new Date(end).getTime() + 86400000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('fire_points')
    .select(
      'id, detected_at, lat, lng, frp, bright_ti4, bright_ti5, satellite, confidence, daynight, country_id, fire_type',
    )
    .gte('detected_at', `${start}T00:00:00Z`)
    .lt('detected_at', `${dayAfterEnd}T00:00:00Z`)
    .gte('lat', bbox.south)
    .lte('lat', bbox.north)
    .gte('lng', bbox.west)
    .lte('lng', bbox.east);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as number,
    detectedAt: row.detected_at as string,
    lat: row.lat as number,
    lng: row.lng as number,
    frp: row.frp as number | null,
    brightTi4: row.bright_ti4 as number | null,
    brightTi5: row.bright_ti5 as number | null,
    countryId: (row.country_id as string | null) ?? '',
    satellite: row.satellite as string | null,
    confidence: row.confidence as string | null,
    daynight: row.daynight as string | null,
    fireType: row.fire_type as number | null,
  }));
}
