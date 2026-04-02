const BBOX = '97,5,110,28'; // west,south,east,north — covers Thailand, Myanmar, Laos, Cambodia

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
  fireType: number | null;
  countryId: string;
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
  return parseFirmsCsv(text);
}

// VIIRS SNPP NRT column order:
// latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
// confidence,version,bright_ti5,frp,type,daynight,country_id
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
  const iType = idx('type');
  const iCountryId = idx('country_id');

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
      fireType: parseNullableInt(cols[iType]),
      countryId: cols[iCountryId]?.trim() ?? '',
    });
  }

  return rows;
}

function parseNullableFloat(val: string | undefined): number | null {
  if (val === undefined || val.trim() === '' || val.trim() === 'nan') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseNullableInt(val: string | undefined): number | null {
  if (val === undefined || val.trim() === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}
