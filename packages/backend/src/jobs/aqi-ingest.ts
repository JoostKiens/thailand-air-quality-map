import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { fetchLocations, fetchSensorMeasurements, PARAMETERS } from '../lib/openaq.js';

const BATCH_SIZE = 500;
const CONCURRENCY = 1; // sequential — OpenAQ free tier is strictly rate limited
const REQUEST_DELAY_MS = 600; // ~1.5 req/s, well under the free tier limit
// Fetch measurements for all countries that fall within the viewport bbox [89,1,114,30]
const TARGET_COUNTRIES = new Set(['TH', 'MM', 'LA', 'KH', 'VN', 'CN', 'BD', 'MY', 'IN']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    const item = items[i++];
    if (item === undefined) return;
    await fn(item);
    await sleep(REQUEST_DELAY_MS);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

export async function runAqiIngest(date?: string): Promise<{
  stationsUpserted: number;
  measurementsInserted: number;
}> {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error('OPENAQ_API_KEY env var is required');

  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const dateFrom = `${targetDate}T00:00:00Z`;
  const dateTo = `${targetDate}T23:59:59Z`;

  console.log(`[aqi-ingest] Fetching OpenAQ locations for ${targetDate}...`);
  const locations = await fetchLocations();
  console.log(`[aqi-ingest] Fetched ${locations.length} locations`);

  // --- upsert stations ---
  const stationRows = locations
    .filter((loc) => loc.coordinates !== null && loc.name != null)
    .map((loc) => ({
      id: String(loc.id),
      name: loc.name,
      location: `POINT(${loc.coordinates!.longitude} ${loc.coordinates!.latitude})`,
      lat: loc.coordinates!.latitude,
      lng: loc.coordinates!.longitude,
      country: loc.country?.code ?? null,
      provider: loc.providers?.[0]?.name ?? null,
      is_mobile: loc.isMobile,
      is_monitor: loc.isMonitor ?? null,
      parameters: loc.sensors
        .map((s) => s.parameter.name)
        .filter((p): p is string => (PARAMETERS as readonly string[]).includes(p)),
      updated_at: new Date().toISOString(),
    }));

  const { error: stationsError } = await supabase
    .from('stations')
    .upsert(stationRows, { onConflict: 'id' });

  if (stationsError) {
    throw new Error(`Stations upsert failed: ${stationsError.message}`);
  }
  console.log(`[aqi-ingest] Upserted ${stationRows.length} stations`);

  // --- collect pm25 sensors in target countries only ---
  const sensorsToFetch = locations
    .filter((loc) => loc.country !== null && TARGET_COUNTRIES.has(loc.country.code))
    .flatMap((loc) =>
      loc.sensors
        .filter((s) => s.parameter.name === 'pm25')
        .map((s) => ({
          locationId: loc.id,
          sensorId: s.id,
          parameter: s.parameter.name,
          unit: s.parameter.units,
        })),
    );
  console.log(
    `[aqi-ingest] Fetching measurements for ${sensorsToFetch.length} sensors (${CONCURRENCY} concurrent)...`,
  );

  // --- fetch measurements per sensor ---
  const measurementRows: {
    station_id: string;
    sensor_id: number;
    parameter: string;
    value: number;
    unit: string;
    measured_at: string;
  }[] = [];

  await withConcurrency(sensorsToFetch, CONCURRENCY, async (s) => {
    const readings = await fetchSensorMeasurements(apiKey, s.sensorId, dateFrom, dateTo);
    for (const r of readings) {
      measurementRows.push({
        station_id: String(s.locationId),
        sensor_id: s.sensorId,
        parameter: s.parameter,
        value: r.value,
        unit: s.unit,
        measured_at: r.datetimeUtc,
      });
    }
  });

  console.log(`[aqi-ingest] Collected ${measurementRows.length} measurements`);

  // --- insert in batches ---
  for (let i = 0; i < measurementRows.length; i += BATCH_SIZE) {
    const batch = measurementRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('measurements')
      .upsert(batch, { onConflict: 'sensor_id,measured_at', ignoreDuplicates: true });

    if (error) {
      throw new Error(`Measurements upsert failed (batch ${i / BATCH_SIZE + 1}): ${error.message}`);
    }
  }

  // Invalidate Redis cache so next API request re-fetches fresh data from Supabase.
  // Keys follow the pattern measurements:latest:{param}:{date|current}.
  await Promise.all(
    PARAMETERS.flatMap((p) => [
      redis.del(`measurements:latest:${p}:current`),
      redis.del(`measurements:latest:${p}:${targetDate}`),
    ]),
  );

  console.log('[aqi-ingest] Done (duplicates silently skipped)');
  return { stationsUpserted: stationRows.length, measurementsInserted: measurementRows.length };
}
