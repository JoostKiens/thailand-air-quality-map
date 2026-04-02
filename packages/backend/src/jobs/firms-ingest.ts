import { supabase } from '../db/client.js';
import { fetchFirms } from '../lib/firms.js';

export async function runFirmsIngest(date?: string): Promise<{ inserted: number }> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  console.log(`[firms-ingest] Fetching FIRMS data for ${targetDate}...`);
  const rows = await fetchFirms(targetDate);
  console.log(`[firms-ingest] Fetched ${rows.length} rows`);

  if (rows.length === 0) {
    return { inserted: 0 };
  }

  const records = rows.map((row) => ({
    detected_at: row.detectedAt,
    location: `POINT(${row.lng} ${row.lat})`,
    lat: row.lat,
    lng: row.lng,
    frp: row.frp,
    bright_ti4: row.brightTi4,
    bright_ti5: row.brightTi5,
    country_id: row.countryId,
    satellite: row.satellite,
    confidence: row.confidence,
    daynight: row.daynight,
    fire_type: row.fireType,
    source: 'VIIRS_SNPP_NRT',
  }));

  const { error } = await supabase
    .from('fire_points')
    .upsert(records, { onConflict: 'detected_at,lat,lng', ignoreDuplicates: true });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log(`[firms-ingest] Upserted ${records.length} rows (duplicates silently skipped)`);
  return { inserted: records.length };
}
