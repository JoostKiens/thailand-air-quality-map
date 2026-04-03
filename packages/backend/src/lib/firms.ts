const BBOX = '92,1,115,28'; // west,south,east,north — covers Myanmar, Thailand, Laos, Cambodia, Malaysia

export interface FirmsRow {
  detectedAt: string; // ISO 8601 UTC
  lat: number;
  lng: number;
  brightTi4: number | null;
  brightTi5: number | null;
  frp: number | null;
  satellite: string;
  confidence: string;
  daynight: string;
  fireType: number | null; // not present in FIRMS area API response — always null
  countryId: string | null; // not present in FIRMS area API response — always null
}

export async function fetchFirms(date: string): Promise<FirmsRow[]> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) throw new Error('FIRMS_MAP_KEY env var is required');

  const url =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}` +
    `/VIIRS_SNPP_NRT/${BBOX}/1/${date}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FIRMS API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  // FIRMS sometimes returns a plain-text or HTML error body with HTTP 200.
  // Detect this before attempting CSV parse.
  const firstLine = text.split('\n')[0].trim();
  if (!firstLine.toLowerCase().startsWith('latitude')) {
    throw new Error(`FIRMS API returned unexpected response: ${firstLine.slice(0, 200)}`);
  }

  return parseFirmsCsv(text);
}

// Actual VIIRS SNPP NRT area API columns (confirmed from live response):
// latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
// instrument,confidence,version,bright_ti5,frp,daynight
// Note: 'type' (fire_type) and 'country_id' are NOT included in area API responses.
function parseFirmsCsv(csv: string): FirmsRow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return []; // header only or empty

  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => headers.indexOf(name);

  const iLat = idx('latitude');
  const iLng = idx('longitude');
  const iBrightTi4 = idx('bright_ti4');
  const iBrightTi5 = idx('bright_ti5');
  const iFrp = idx('frp');
  const iAcqDate = idx('acq_date');
  const iAcqTime = idx('acq_time');
  const iSatellite = idx('satellite');
  const iConfidence = idx('confidence');
  const iDaynight = idx('daynight');

  const rows: FirmsRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',');

    const hhmm = (cols[iAcqTime] ?? '0000').padStart(4, '0');
    const detectedAt = `${cols[iAcqDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`;

    rows.push({
      detectedAt,
      lat: parseFloat(cols[iLat]),
      lng: parseFloat(cols[iLng]),
      brightTi4: parseNullableFloat(cols[iBrightTi4]),
      brightTi5: parseNullableFloat(cols[iBrightTi5]),
      frp: parseNullableFloat(cols[iFrp]),
      satellite: cols[iSatellite]?.trim() ?? '',
      confidence: cols[iConfidence]?.trim() ?? '',
      daynight: cols[iDaynight]?.trim() ?? '',
      fireType: null,
      countryId: null,
    });
  }

  return rows;
}

function parseNullableFloat(val: string | undefined): number | null {
  if (val === undefined || val.trim() === '' || val.trim() === 'nan') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
