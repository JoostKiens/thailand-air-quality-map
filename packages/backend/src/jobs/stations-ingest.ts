import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { fetchLocations, PARAMETERS, extractPm25SensorIds } from '../lib/openaq.js';

export interface CachedSensor {
  sensorId: number;
  locationId: string;
  parameter: string;
  unit: string;
}

// 8 days — longer than the weekly run cadence so there is always a cached list
export const SENSOR_CACHE_TTL = 8 * 24 * 60 * 60;
export const SENSOR_CACHE_KEY = 'openaq:sensors';

export async function runStationsIngest(): Promise<{
  stationsUpserted: number;
  sensorsCached: number;
}> {
  console.log('[stations-ingest] Fetching OpenAQ locations...');
  const locations = await fetchLocations();
  console.log(`[stations-ingest] Fetched ${locations.length} locations`);

  const STALE_THRESHOLD_DAYS = 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);

  const fresh = locations.filter(
    (loc) => !loc.datetimeLast || new Date(loc.datetimeLast.utc) >= cutoff,
  );
  console.log(
    `[stations-ingest] skipped ${locations.length - fresh.length} stale stations (datetimeLast > 30d)`,
  );

  const stationRows = fresh
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
      pm25_sensor_ids: extractPm25SensorIds(loc),
      datetime_last: loc.datetimeLast?.utc ?? null,
      updated_at: new Date().toISOString(),
    }));

  const { error } = await supabase.from('stations').upsert(stationRows, { onConflict: 'id' });
  if (error) throw new Error(`Stations upsert failed: ${error.message}`);
  console.log(`[stations-ingest] Upserted ${stationRows.length} stations`);

  // Cache the full sensor list so aqi-ingest can query all sensors without
  // calling the locations API on every hourly run.
  const sensors: CachedSensor[] = locations.flatMap((loc) =>
    loc.sensors
      .filter((s) => (PARAMETERS as readonly string[]).includes(s.parameter.name))
      .map((s) => ({
        sensorId: s.id,
        locationId: String(loc.id),
        parameter: s.parameter.name,
        unit: s.parameter.units,
      })),
  );
  await redis.set(SENSOR_CACHE_KEY, sensors, { ex: SENSOR_CACHE_TTL });
  console.log(`[stations-ingest] Cached ${sensors.length} sensors in Redis (TTL 8 days)`);

  return { stationsUpserted: stationRows.length, sensorsCached: sensors.length };
}
