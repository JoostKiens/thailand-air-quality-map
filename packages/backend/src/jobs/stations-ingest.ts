import { supabase } from '../db/client.js';
import { fetchLocations, PARAMETERS, extractPm25SensorIds } from '../lib/openaq.js';

export async function runStationsIngest(): Promise<{
  stationsUpserted: number;
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

  return { stationsUpserted: stationRows.length };
}
