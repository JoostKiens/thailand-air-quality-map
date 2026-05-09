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

export interface SensorFetchResult {
  readings: SensorDailyAverage[];
  rateLimitRemaining: number | null; // x-ratelimit-remaining
  rateLimitResetMs: number | null; // x-ratelimit-reset × 1000 (Unix ms)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRateLimitHeaders(
  headers: Headers,
): Pick<SensorFetchResult, 'rateLimitRemaining' | 'rateLimitResetMs'> {
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  return {
    rateLimitRemaining: Number.isFinite(remaining) ? remaining : null,
    rateLimitResetMs: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
  };
}

export async function fetchSensorDailyAverage(
  apiKey: string,
  sensorId: number,
  dateFrom: string,
  dateTo: string,
): Promise<SensorFetchResult> {
  const url =
    `${BASE_URL}/sensors/${sensorId}/days` +
    `?datetime_from=${encodeURIComponent(dateFrom)}&datetime_to=${encodeURIComponent(dateTo)}&limit=10`;

  const MAX_RETRIES = 4;
  let attempt = 0;

  while (true) {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
    const rateLimit = parseRateLimitHeaders(res.headers);

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        console.warn(
          `[openaq] sensor ${sensorId}: rate limited after ${attempt} retries, skipping`,
        );
        return { readings: [], ...rateLimit };
      }
      // Use x-ratelimit-reset for the exact window boundary; fall back to exponential backoff
      const waitMs = rateLimit.rateLimitResetMs
        ? Math.max(0, rateLimit.rateLimitResetMs - Date.now()) + 1_000
        : Math.min(60_000, 10_000 * 2 ** attempt);
      attempt++;
      console.warn(
        `[openaq] sensor ${sensorId}: 429, waiting ${Math.round(waitMs / 1000)}s until reset (attempt ${attempt})`,
      );
      await sleep(waitMs);
      continue;
    }

    if (res.status === 404) return { readings: [], ...rateLimit };
    if (!res.ok)
      throw new Error(`OpenAQ sensor ${sensorId} error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as OpenAQDaysResponse;
    const readings = data.results
      .filter((r) => r.period !== null)
      // Use datetimeTo.utc (end of local day) so the timestamp falls within the same
      // UTC calendar date as the local day. datetimeFrom.utc would be ~7 h earlier
      // (local midnight in UTC+7), falling outside the UTC-day window used by the API.
      .map((r) => ({ value: r.value, dateUtc: r.period!.datetimeTo.utc }));

    return { readings, ...rateLimit };
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
