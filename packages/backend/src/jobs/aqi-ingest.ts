import { supabase } from '../db/client.js';
import { fetchLocations, PARAMETERS } from '../lib/openaq.js';

const BATCH_SIZE = 500;

export async function runAqiIngest(): Promise<{
  stationsUpserted: number;
  measurementsInserted: number;
}> {
  console.log('[aqi-ingest] Fetching OpenAQ locations...');
  const locations = await fetchLocations();
  console.log(`[aqi-ingest] Fetched ${locations.length} locations`);

  // --- upsert stations ---
  const stationRows = locations
    .filter((loc) => loc.coordinates !== null && loc.name != null)
    .map((loc) => ({
      id: String(loc.id),
      name: loc.name,
      location: `POINT(${loc.coordinates!.longitude} ${loc.coordinates!.latitude})`,
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

  // --- collect latest measurements ---
  const measurementRows: {
    station_id: string;
    sensor_id: number;
    parameter: string;
    value: number;
    unit: string;
    measured_at: string;
  }[] = [];

  for (const loc of locations) {
    for (const sensor of loc.sensors) {
      if (
        !(PARAMETERS as readonly string[]).includes(sensor.parameter.name) ||
        sensor.latest === null ||
        sensor.latest === undefined
      ) {
        continue;
      }
      measurementRows.push({
        station_id: String(loc.id),
        sensor_id: sensor.id,
        parameter: sensor.parameter.name,
        value: sensor.latest.value,
        unit: sensor.parameter.units,
        measured_at: sensor.latest.datetime.utc,
      });
    }
  }

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

  console.log('[aqi-ingest] Done (duplicates silently skipped)');
  return { stationsUpserted: stationRows.length, measurementsInserted: measurementRows.length };
}
