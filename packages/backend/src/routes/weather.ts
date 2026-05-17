import type { FastifyInstance } from 'fastify';
import type { WeatherReading, WindReading } from '@thailand-aq/types';
import { redis, HISTORICAL_TTL_SECONDS, CACHE_CONTROL_IMMUTABLE } from '../cache/client.js';
import { supabase } from '../db/client.js';
import { parseBbox } from '../lib/bbox.js';
import { weatherCacheKey } from '../jobs/weather-ingest.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;

async function fetchWeatherFromDb(date: string): Promise<WeatherReading[]> {
  const all: WeatherReading[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('weather_readings')
      .select(
        'lat, lng, wind_speed_kmh, wind_speed_max_kmh, wind_direction_deg, relative_humidity_2m, precipitation_sum',
      )
      .eq('date', date)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase weather_readings query failed: ${error.message}`);
    if (!data?.length) break;
    all.push(...(data as WeatherReading[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchWindFromDb(date: string): Promise<WindReading[]> {
  const all: WindReading[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('weather_readings')
      .select('lat, lng, wind_speed_kmh, wind_direction_deg')
      .eq('date', date)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase weather_readings query failed: ${error.message}`);
    if (!data?.length) break;
    all.push(...(data as WindReading[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export function weatherRoutes(app: FastifyInstance): void {
  // GET /api/weather/wind?date=YYYY-MM-DD&bbox=west,south,east,north
  app.get<{ Querystring: { date?: string; bbox?: string } }>(
    '/api/weather/wind',
    async (req, reply) => {
      const { date, bbox: rawBbox } = req.query;

      if (!date || !DATE_RE.test(date)) {
        return reply.status(400).send({ error: 'date param required (YYYY-MM-DD)' });
      }

      const cacheKey = `weather:wind:${date}`;
      let readings = await redis.get<WindReading[]>(cacheKey);

      if (!readings?.length || readings.length < 4000) {
        readings = await fetchWindFromDb(date);

        if (!readings.length) {
          return reply
            .status(404)
            .send({ error: 'No wind data for this date. Run the ingest job.' });
        }

        await redis.set(cacheKey, readings, { ex: HISTORICAL_TTL_SECONDS });
      }

      const bbox = parseBbox(rawBbox);
      const filtered = readings.filter(
        (r) =>
          r.lat >= bbox.south && r.lat <= bbox.north && r.lng >= bbox.west && r.lng <= bbox.east,
      );

      return reply.header('Cache-Control', CACHE_CONTROL_IMMUTABLE).send({ data: filtered });
    },
  );

  app.get<{ Querystring: { date?: string; bbox?: string } }>('/api/weather', async (req, reply) => {
    const { date, bbox: rawBbox } = req.query;

    if (!date || !DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'date param required (YYYY-MM-DD)' });
    }

    let readings = await redis.get<WeatherReading[]>(weatherCacheKey(date));

    if (!readings?.length || readings.length < 4000) {
      readings = await fetchWeatherFromDb(date);

      if (!readings.length) {
        return reply
          .status(404)
          .send({ error: 'No weather data for this date. Run the ingest job.' });
      }

      // Re-populate Redis so subsequent requests within the TTL window skip Supabase
      await redis.set(weatherCacheKey(date), readings, { ex: HISTORICAL_TTL_SECONDS });
    }

    const bbox = parseBbox(rawBbox);
    const filtered = readings.filter(
      (r) => r.lat >= bbox.south && r.lat <= bbox.north && r.lng >= bbox.west && r.lng <= bbox.east,
    );

    return reply.header('Cache-Control', CACHE_CONTROL_IMMUTABLE).send({ data: filtered });
  });
}
