import type { FastifyInstance } from 'fastify';
import type { Measurement } from '@thailand-aq/types';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { parseBbox, DEFAULT_BBOX } from '../lib/bbox.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const VALID_PARAMETERS = ['pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'bc'] as const;
const MAX_HISTORY_HOURS = 168; // 7 days

interface LatestMeasurement {
  stationId: string;
  stationName: string;
  lat: number;
  lng: number;
  parameter: string;
  value: number;
  unit: string;
  measuredAt: string;
}

export function measurementsRoutes(app: FastifyInstance): void {
  // GET /api/measurements/latest?parameter=pm25&bbox=...
  app.get<{ Querystring: { parameter?: string; bbox?: string } }>(
    '/api/measurements/latest',
    async (req, reply) => {
      const parameter = req.query.parameter ?? 'pm25';
      const rawBbox = req.query.bbox;

      if (!(VALID_PARAMETERS as readonly string[]).includes(parameter)) {
        return reply
          .status(400)
          .send({
            error: `Unknown parameter "${parameter}". Valid: ${VALID_PARAMETERS.join(', ')}`,
          });
      }

      const bbox = parseBbox(rawBbox);
      const isDefaultBbox = !rawBbox || rawBbox === DEFAULT_BBOX;

      if (isDefaultBbox) {
        const cached = await redis.get<LatestMeasurement[]>(`measurements:latest:${parameter}`);
        if (cached !== null) return reply.send({ data: cached });
      }

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: rows, error } = await supabase
        .from('measurements')
        .select(
          'station_id, sensor_id, parameter, value, unit, measured_at, stations(id, name, lat, lng)',
        )
        .eq('parameter', parameter)
        .gte('measured_at', since)
        .order('measured_at', { ascending: false });

      if (error) throw new Error(`Supabase query failed: ${error.message}`);

      // Deduplicate: first occurrence per station = most recent (sorted DESC above)
      const seen = new Set<string>();
      const latest: LatestMeasurement[] = [];

      for (const row of rows ?? []) {
        const station = row.stations as unknown as {
          id: string;
          name: string;
          lat: number;
          lng: number;
        } | null;
        if (!station || station.lat === null || station.lng === null) continue;
        if (seen.has(row.station_id as string)) continue;
        seen.add(row.station_id as string);

        // bbox filter
        if (
          station.lat < bbox.south ||
          station.lat > bbox.north ||
          station.lng < bbox.west ||
          station.lng > bbox.east
        )
          continue;

        latest.push({
          stationId: row.station_id as string,
          stationName: station.name,
          lat: station.lat,
          lng: station.lng,
          parameter: row.parameter as string,
          value: row.value as number,
          unit: row.unit as string,
          measuredAt: row.measured_at as string,
        });
      }

      if (isDefaultBbox) {
        await redis.set(`measurements:latest:${parameter}`, latest, { ex: CACHE_TTL_SECONDS });
      }

      return reply.send({ data: latest });
    },
  );

  // GET /api/measurements/history?station_id=...&parameter=pm25&hours=24
  app.get<{ Querystring: { station_id?: string; parameter?: string; hours?: string } }>(
    '/api/measurements/history',
    async (req, reply) => {
      const { station_id: stationId, hours: rawHours } = req.query;
      const parameter = req.query.parameter ?? 'pm25';

      if (!stationId)
        return reply.status(400).send({ error: 'Missing required param: station_id' });

      if (!(VALID_PARAMETERS as readonly string[]).includes(parameter)) {
        return reply
          .status(400)
          .send({
            error: `Unknown parameter "${parameter}". Valid: ${VALID_PARAMETERS.join(', ')}`,
          });
      }

      const hours = rawHours !== undefined ? Number(rawHours) : 24;
      if (isNaN(hours) || hours <= 0) {
        return reply.status(400).send({ error: 'hours must be a positive number' });
      }
      if (hours > MAX_HISTORY_HOURS) {
        return reply
          .status(400)
          .send({ error: `hours cannot exceed ${MAX_HISTORY_HOURS} (7 days)` });
      }

      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('measurements')
        .select('station_id, sensor_id, parameter, value, unit, measured_at')
        .eq('station_id', stationId)
        .eq('parameter', parameter)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true });

      if (error) throw new Error(`Supabase query failed: ${error.message}`);

      const measurements: Measurement[] = (data ?? []).map((row) => ({
        stationId: row.station_id as string,
        sensorId: row.sensor_id as number,
        parameter: row.parameter as string,
        value: row.value as number,
        unit: row.unit as string,
        measuredAt: row.measured_at as string,
      }));

      return reply.send({ data: measurements });
    },
  );
}
