import { DEFAULT_BBOX } from './bbox.js';

const BASE_URL = 'https://api.openaq.org/v3';

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

interface OpenAQDayResult {
  value: number;
  period: {
    datetimeFrom: { utc: string };
    datetimeTo: { utc: string };
  } | null;
}

interface OpenAQDaysResponse {
  meta: OpenAQMeta;
  results: OpenAQDayResult[];
}

export interface SensorDailyAverage {
  value: number;
  dateUtc: string; // period.datetimeTo.utc — end of local day, falls within the same UTC calendar date
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchSensorDailyAverage(
  apiKey: string,
  sensorId: number,
  dateFrom: string,
  dateTo: string,
): Promise<SensorDailyAverage[]> {
  const url =
    `${BASE_URL}/sensors/${sensorId}/days` +
    `?datetime_from=${encodeURIComponent(dateFrom)}&datetime_to=${encodeURIComponent(dateTo)}&limit=10`;

  // Retry backoff: 10s, 20s, 40s, 60s — OpenAQ free tier enforces per-minute quotas
  const RETRY_DELAYS = [10_000, 20_000, 40_000, 60_000];
  let attempt = 0;

  while (true) {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });

    if (res.status === 429) {
      if (attempt >= RETRY_DELAYS.length) {
        console.warn(
          `[openaq] sensor ${sensorId}: rate limited after ${attempt} retries, skipping`,
        );
        return [];
      }
      const retryAfterSec = Number(res.headers.get('Retry-After'));
      const wait =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : RETRY_DELAYS[attempt++];
      console.warn(
        `[openaq] sensor ${sensorId}: 429 rate limited, waiting ${Math.round((wait ?? 0) / 1000)}s (attempt ${attempt})`,
      );
      await sleep(wait ?? 0);
      continue;
    }
    if (res.status === 404) return []; // sensor has no data for this period
    if (!res.ok)
      throw new Error(`OpenAQ sensor ${sensorId} error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as OpenAQDaysResponse;

    return (
      data.results
        .filter((r) => r.period !== null)
        // Use datetimeTo.utc (end of local day) so the timestamp falls within the same
        // UTC calendar date as the local day. datetimeFrom.utc would be ~7 h earlier
        // (local midnight in UTC+7), falling outside the UTC-day window used by the API.
        .map((r) => ({ value: r.value, dateUtc: r.period!.datetimeTo.utc }))
    );
  }
}

export async function fetchLocations(): Promise<OpenAQLocation[]> {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error('OPENAQ_API_KEY env var is required');

  const all: OpenAQLocation[] = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/locations?bbox=${DEFAULT_BBOX}&limit=1000&page=${page}`;
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
