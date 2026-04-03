const BASE_URL = 'https://api.openaq.org/v3';
const BBOX = '92,1,115,28'; // west,south,east,north — covers Myanmar, Thailand, Laos, Cambodia, Malaysia

export const PARAMETERS = ['pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'bc'] as const;

interface OpenAQSensor {
  id: number;
  parameter: { name: string; units: string };
  latest: { value: number; datetime: { utc: string } } | null | undefined;
}

export interface OpenAQLocation {
  id: number;
  name: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  country: { code: string } | null;
  providers: { name: string }[] | undefined;
  isMobile: boolean;
  isMonitor: boolean | null;
  sensors: OpenAQSensor[];
}

interface OpenAQMeta {
  found: number;
  limit: number;
  page: number;
}

interface OpenAQResponse {
  meta: OpenAQMeta;
  results: OpenAQLocation[];
}

export async function fetchLocations(): Promise<OpenAQLocation[]> {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error('OPENAQ_API_KEY env var is required');

  const all: OpenAQLocation[] = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/locations?bbox=${BBOX}&limit=1000&page=${page}`;
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });

    if (!res.ok) {
      throw new Error(`OpenAQ API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as OpenAQResponse;
    all.push(...data.results);

    if (all.length >= data.meta.found) break;
    page++;
  }

  return all;
}
