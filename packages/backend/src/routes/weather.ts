import type { FastifyInstance } from 'fastify';
import type { WeatherReading } from '@thailand-aq/types';
import { redis, HISTORICAL_TTL_SECONDS } from '../cache/client.js';
import { supabase } from '../db/client.js';
import { parseBbox } from '../lib/bbox.js';
import { weatherCacheKey } from '../jobs/weather-ingest.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function weatherRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/weather', async (req, reply) => {
    const { date, bbox: rawBbox } = req.query;

    if (!date || !DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'date param required (YYYY-MM-DD)' });
    }

    let readings = await redis.get<WeatherReading[]>(weatherCacheKey(date));

    if (!readings?.length) {
      // Redis miss — fall back to Supabase
      const { data, error } = await supabase
        .from('weather_readings')
        .select(
          'lat, lng, wind_speed_kmh, wind_speed_max_kmh, wind_direction_deg, relative_humidity_2m, precipitation_sum',
        )
        .eq('date', date);

      if (error) throw new Error(`Supabase weather_readings query failed: ${error.message}`);

      if (!data?.length) {
        return reply
          .status(404)
          .send({ error: 'No weather data for this date. Run the ingest job.' });
      }

      readings = data as WeatherReading[];

      // Re-populate Redis so subsequent requests within the TTL window skip Supabase
      await redis.set(weatherCacheKey(date), readings, { ex: HISTORICAL_TTL_SECONDS });
    }

    const bbox = parseBbox(rawBbox);
    const filtered = readings.filter(
      (r) => r.lat >= bbox.south && r.lat <= bbox.north && r.lng >= bbox.west && r.lng <= bbox.east,
    );

    return reply.send({ data: filtered });
  });
}
