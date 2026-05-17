import type { FastifyInstance } from 'fastify';
import { redis, HISTORICAL_TTL_SECONDS, CACHE_CONTROL_IMMUTABLE } from '../cache/client.js';
import { supabase } from '../db/client.js';

const CACHE_KEY = 'power_plants:geojson';

interface PlantRow {
  id: number;
  name: string;
  country: string;
  fuel_type: string;
  capacity_mw: number | null;
  owner: string | null;
  commissioned_year: number | null;
  lat: number;
  lng: number;
}

export function powerPlantsRoutes(app: FastifyInstance): void {
  app.get('/api/power-plants', async (_req, reply) => {
    const cached = await redis.get<object>(CACHE_KEY);
    if (cached !== null) return reply.header('Cache-Control', CACHE_CONTROL_IMMUTABLE).send(cached);

    const allRows: PlantRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('power_plants')
        .select('id, name, country, fuel_type, capacity_mw, owner, commissioned_year, lat, lng')
        .order('capacity_mw', { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);

      if (error) {
        return reply
          .status(503)
          .send({ error: 'Power plant data unavailable — run ingest:power-plants' });
      }
      allRows.push(...(data as PlantRow[]));
      if (data.length < PAGE) break;
    }

    if (allRows.length === 0) {
      return reply
        .status(503)
        .send({ error: 'Power plant data unavailable — run ingest:power-plants' });
    }

    const geojson = buildGeojson(allRows);
    await redis.set(CACHE_KEY, geojson, { ex: HISTORICAL_TTL_SECONDS });
    return reply.header('Cache-Control', CACHE_CONTROL_IMMUTABLE).send(geojson);
  });
}

function buildGeojson(rows: PlantRow[]): object {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        name: r.name,
        country: r.country,
        fuel_type: r.fuel_type,
        capacity_mw: r.capacity_mw,
        owner: r.owner,
        commissioned_year: r.commissioned_year,
      },
    })),
  };
}
