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
  datetimeLast: { utc: string } | null | undefined;
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

interface OpenAQHourResult {
  value: number;
  period: {
    datetimeFrom: { utc: string; local?: string };
    datetimeTo: { utc: string; local?: string };
  } | null;
}

interface OpenAQHoursResponse {
  meta: OpenAQMeta;
  results: OpenAQHourResult[];
}

export interface SensorDailyAverage {
  value: number;
  // Canonical UTC timestamp for the daily average — always targetDate T00:00:00Z.
  // Falls at the start of the queried UTC day, within the window used by /api/measurements/latest.
  dateUtc: string;
}

export interface SensorFetchResult {
  readings: SensorDailyAverage[];
  rateLimitRemaining: number | null; // x-ratelimit-remaining
  rateLimitResetMs: number | null; // x-ratelimit-reset × 1000 (Unix ms)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function extractPm25SensorIds(location: OpenAQLocation): number[] {
  return location.sensors.filter((s) => s.parameter.name === 'pm25').map((s) => s.id);
}

function parseRateLimitHeaders(
  headers: Headers,
): Pick<SensorFetchResult, 'rateLimitRemaining' | 'rateLimitResetMs'> {
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));

  let rateLimitResetMs: number | null = null;
  if (Number.isFinite(reset) && reset > 0) {
    // x-ratelimit-reset is either a Unix timestamp (seconds, ~1.7 billion)
    // or a duration (seconds until reset, typically 0–60).
    // Distinguish by magnitude: Unix timestamps are > 1e9.
    const isTimestamp = reset > 1e9;
    rateLimitResetMs = isTimestamp
      ? reset * 1000 // Unix timestamp → convert to ms
      : Date.now() + reset * 1000; // duration → absolute ms from now
    const secsUntilReset = Math.round((rateLimitResetMs - Date.now()) / 1000);
    console.debug(
      `[openaq] rate limit: remaining=${Number.isFinite(remaining) ? remaining : 'n/a'}` +
        ` reset=${reset} (${isTimestamp ? 'unix-ts' : 'duration'}) → resets in ${secsUntilReset}s`,
    );
  }

  return {
    rateLimitRemaining: Number.isFinite(remaining) ? remaining : null,
    rateLimitResetMs,
  };
}

export async function fetchSensorDailyAverage(
  apiKey: string,
  sensorId: number,
  targetDate: string, // YYYY-MM-DD in local time
  timezoneOffsetHours = 7,
): Promise<SensorFetchResult> {
  // Uses /hours/daily rather than /days or /hours because:
  // - /days is confirmed broken: ignores datetime_from/datetime_to entirely,
  //   always returns the most recent available data (tested 2025-05-12).
  // - /hours/daily is the working equivalent per OpenAQ docs and respects date filters.
  // - /hours/daily requires timezone-aware datetime params (e.g. +07:00) — bare UTC
  //   does not correctly bound the local calendar day.
  // - Returns a single pre-computed daily mean, eliminating manual averaging over
  //   up to 100 hourly records.
  const sign = timezoneOffsetHours >= 0 ? '+' : '-';
  const absHours = Math.abs(timezoneOffsetHours);
  const tzOffset = `${sign}${String(absHours).padStart(2, '0')}:00`;

  const url =
    `${BASE_URL}/sensors/${sensorId}/hours/daily` +
    `?datetime_from=${encodeURIComponent(`${targetDate}T00:00:00${tzOffset}`)}` +
    `&datetime_to=${encodeURIComponent(`${targetDate}T23:59:59${tzOffset}`)}` +
    `&limit=1`;

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

    const data = (await res.json()) as OpenAQHoursResponse;
    if (data.results.length === 0) return { readings: [], ...rateLimit };

    const result = data.results[0];
    if (result.period === null || result.value === null) return { readings: [], ...rateLimit };

    // Guard against stale-data responses (same failure mode as /days)
    if (
      result.period.datetimeFrom.local !== undefined &&
      !result.period.datetimeFrom.local.startsWith(targetDate)
    ) {
      console.warn(
        `[openaq] sensor ${sensorId}: date mismatch (expected ${targetDate}, got ${result.period.datetimeFrom.local}), skipping`,
      );
      return { readings: [], ...rateLimit };
    }

    const dateUtc = `${targetDate}T00:00:00Z`;
    return { readings: [{ value: result.value, dateUtc }], ...rateLimit };
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
