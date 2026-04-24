import type { FastifyInstance } from 'fastify';
import type { Measurement } from '@thailand-aq/types';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { parseBbox, DEFAULT_BBOX } from '../lib/bbox.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const VALID_PARAMETERS = ['pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'bc'] as const;
const MAX_HISTORY_HOURS = 168; // 7 days
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7

interface DayData {
  date: string;
  maxPm25: number;
  readingCount: number;
}

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
  // GET /api/measurements/latest?parameter=pm25&bbox=...&date=YYYY-MM-DD
  app.get<{ Querystring: { parameter?: string; bbox?: string; date?: string } }>(
    '/api/measurements/latest',
    async (req, reply) => {
      const parameter = req.query.parameter ?? 'pm25';
      const rawBbox = req.query.bbox;
      const date = req.query.date; // optional; when absent, returns last 24h

      if (!(VALID_PARAMETERS as readonly string[]).includes(parameter)) {
        return reply.status(400).send({
          error: `Unknown parameter "${parameter}". Valid: ${VALID_PARAMETERS.join(', ')}`,
        });
      }

      const bbox = parseBbox(rawBbox);
      const isDefaultBbox = !rawBbox || rawBbox === DEFAULT_BBOX;
      const cacheKey = `measurements:latest:${parameter}:${date ?? 'current'}`;

      if (isDefaultBbox) {
        const cached = await redis.get<LatestMeasurement[]>(cacheKey);
        if (cached !== null) return reply.send({ data: cached });
      }

      // Date-specific window or rolling 24h
      const since = date
        ? `${date}T00:00:00Z`
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const until = date ? `${date}T23:59:59Z` : undefined;

      let query = supabase
        .from('measurements')
        .select(
          'station_id, sensor_id, parameter, value, unit, measured_at, stations(id, name, lat, lng)',
        )
        .eq('parameter', parameter)
        .gte('measured_at', since);

      if (until !== undefined) {
        query = query.lte('measured_at', until);
      }

      const { data: rows, error } = await query.order('measured_at', { ascending: false });

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
        await redis.set(cacheKey, latest, { ex: CACHE_TTL_SECONDS });
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
        return reply.status(400).send({
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

  // GET /api/stations/:stationId/history?days=7&date=YYYY-MM-DD
  // date = selected end date in BKK timezone (defaults to today BKK).
  // Returns `days` rows ending on that date (inclusive), oldest-first.
  app.get<{ Params: { stationId: string }; Querystring: { days?: string; date?: string } }>(
    '/api/stations/:stationId/history',
    async (req, reply) => {
      const { stationId } = req.params;
      const rawDays = req.query.days;
      const days = rawDays !== undefined ? Number(rawDays) : 7;

      if (isNaN(days) || days <= 0) {
        return reply.status(400).send({ error: 'days must be a positive number' });
      }
      if (days > 30) {
        return reply.status(400).send({ error: 'days cannot exceed 30' });
      }

      // Anchor the window to the requested end date (BKK); default to today BKK.
      const endDateStr =
        req.query.date ?? new Date(Date.now() + BKK_OFFSET_MS).toISOString().slice(0, 10);
      const [yr, mo, dy] = endDateStr.split('-').map(Number);
      // UTC ms of BKK midnight for the end date (BKK midnight = UTC date - 7h)
      const endMidnightUtcMs = Date.UTC(yr, mo - 1, dy) - BKK_OFFSET_MS;
      const startMidnightUtcMs = endMidnightUtcMs - (days - 1) * 86_400_000;

      const since = new Date(startMidnightUtcMs).toISOString();
      const until = new Date(endMidnightUtcMs + 86_400_000).toISOString(); // exclusive

      const { data, error } = await supabase
        .from('measurements')
        .select('value, measured_at')
        .eq('station_id', stationId)
        .eq('parameter', 'pm25')
        .gte('measured_at', since)
        .lt('measured_at', until);

      if (error) throw new Error(`Supabase query failed: ${error.message}`);

      // Group by Bangkok calendar day (UTC+7) in JS to avoid Postgres timezone dependency
      const byDay = new Map<string, { max: number; count: number }>();
      for (const row of data ?? []) {
        const bkkMs = new Date(row.measured_at as string).getTime() + BKK_OFFSET_MS;
        const date = new Date(bkkMs).toISOString().slice(0, 10);
        const entry = byDay.get(date);
        const val = row.value as number;
        if (!entry) {
          byDay.set(date, { max: val, count: 1 });
        } else {
          if (val > entry.max) entry.max = val;
          entry.count++;
        }
      }

      // Build result: oldest-first, from (endDate - days + 1) to endDate
      const result: DayData[] = [];
      for (let i = 0; i < days; i++) {
        const dayUtcMs = startMidnightUtcMs + i * 86_400_000;
        const date = new Date(dayUtcMs + BKK_OFFSET_MS).toISOString().slice(0, 10);
        const entry = byDay.get(date);
        result.push({
          date,
          maxPm25: entry?.max ?? 0,
          readingCount: entry?.count ?? 0,
        });
      }

      return reply.send({ stationId, days: result });
    },
  );
}
