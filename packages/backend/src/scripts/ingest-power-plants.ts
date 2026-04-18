import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';

const WRI_URL =
  'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv';

const TARGET_COUNTRIES = new Set(['THA', 'MMR', 'LAO', 'KHM', 'MYS', 'BGD', 'IND', 'CHN']);
const TARGET_FUELS = new Set(['Coal', 'Gas', 'Oil']);
const CACHE_KEY = 'power_plants:geojson';

interface WriRow {
  country: string;
  name: string;
  capacity_mw: string;
  latitude: string;
  longitude: string;
  primary_fuel: string;
  owner: string;
  commissioning_year: string;
}

async function getCsv(): Promise<string> {
  const localPath = process.argv[2];
  if (localPath) {
    console.log(`[ingest-power-plants] Reading local file: ${localPath}`);
    return readFileSync(localPath, 'utf8');
  }
  console.log(`[ingest-power-plants] Downloading from WRI GitHub...`);
  const res = await fetch(WRI_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  return res.text();
}

const csv = await getCsv();
const rows = parse(csv, { columns: true, skip_empty_lines: true }) as WriRow[];
console.log(`[ingest-power-plants] Parsed ${rows.length} total rows`);

const filtered = rows.filter(
  (r) => TARGET_COUNTRIES.has(r.country) && TARGET_FUELS.has(r.primary_fuel),
);
console.log(`[ingest-power-plants] ${filtered.length} rows after filtering`);

const seen = new Set<string>();
const records = filtered.reduce<
  Array<{
    name: string;
    country: string;
    fuel_type: string;
    capacity_mw: number | null;
    owner: string | null;
    commissioned_year: number | null;
    lat: number;
    lng: number;
    location: string;
  }>
>((acc, r) => {
  const key = `${r.name.trim()}|${r.country.trim()}`;
  if (seen.has(key)) return acc;
  seen.add(key);
  const lat = parseFloat(r.latitude);
  const lng = parseFloat(r.longitude);
  acc.push({
    name: r.name.trim(),
    country: r.country.trim(),
    fuel_type: r.primary_fuel.trim(),
    capacity_mw: r.capacity_mw ? parseFloat(r.capacity_mw) : null,
    owner: r.owner?.trim() || null,
    commissioned_year: r.commissioning_year ? parseInt(r.commissioning_year) : null,
    lat,
    lng,
    location: `SRID=4326;POINT(${lng} ${lat})`,
  });
  return acc;
}, []);
console.log(`[ingest-power-plants] ${records.length} rows after deduplication`);

const BATCH_SIZE = 500;
let totalUpserted = 0;
for (let i = 0; i < records.length; i += BATCH_SIZE) {
  const batch = records.slice(i, i + BATCH_SIZE);
  const { error, count } = await supabase
    .from('power_plants')
    .upsert(batch, { onConflict: 'name,country', ignoreDuplicates: false, count: 'exact' });
  if (error) {
    console.error('[ingest-power-plants] Upsert error:', error.message);
    process.exit(1);
  }
  totalUpserted += count ?? batch.length;
}

await redis.del(CACHE_KEY);
console.log(`[ingest-power-plants] Done — ${totalUpserted} rows upserted, cache invalidated`);
process.exit(0);
