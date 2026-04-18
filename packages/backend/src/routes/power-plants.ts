import type { FastifyInstance } from 'fastify';
import { redis } from '../cache/client.js';
import { supabase } from '../db/client.js';

const CACHE_KEY = 'power_plants:geojson';
const CACHE_TTL = 24 * 60 * 60; // 24h

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
    if (cached !== null) return reply.send(cached);

    const { data, error } = await supabase
      .from('power_plants')
      .select('id, name, country, fuel_type, capacity_mw, owner, commissioned_year, lat, lng')
      .order('capacity_mw', { ascending: false, nullsFirst: false });

    if (error ?? !data) {
      return reply
        .status(503)
        .send({ error: 'Power plant data unavailable — run ingest:power-plants' });
    }

    const geojson = buildGeojson(data as PlantRow[]);
    await redis.set(CACHE_KEY, geojson, { ex: CACHE_TTL });
    return reply.send(geojson);
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
