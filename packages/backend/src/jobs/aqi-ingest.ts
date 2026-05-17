import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import { fetchSensorDailyAverage, PARAMETERS } from '../lib/openaq.js';

const BATCH_SIZE = 500;
const DEFAULT_DELAY_MS = 1_100; // ~54 req/min — safely under the 60/min free-tier limit
// Abort the entire run if this many sensors are skipped due to 429s in a row.
// Repeated 429s after waiting for reset means the hourly quota is exhausted.
// Continuing would risk a temporary or permanent ban from OpenAQ.
const CONSECUTIVE_429_ABORT = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAqiIngest(date?: string): Promise<{
  sensorsQueried: number;
  measurementsInserted: number;
}> {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error('OPENAQ_API_KEY env var is required');

  // Default to yesterday: the OpenAQ endpoint uses BKK (+07:00) day boundaries, so a complete
  // 24-hour average for "day D" isn't available until 17:00 UTC on day D. Running at 04:00 UTC
  // means today's BKK day is only ~11 hours old — fetch yesterday instead.
  const targetDate =
    date ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

  const { data: stationRows, error: stationsError } = await supabase
    .from('stations')
    .select('id, pm25_sensor_ids')
    .filter('pm25_sensor_ids', 'not.eq', '{}');

  if (stationsError) throw new Error(`Failed to fetch stations: ${stationsError.message}`);

  if (!stationRows?.length) {
    console.warn('[aqi-ingest] no stations with pm25_sensor_ids found — run stations-ingest first');
    return { sensorsQueried: 0, measurementsInserted: 0 };
  }

  console.log(
    `[aqi-ingest] Fetching measurements for ${targetDate} across ${stationRows.length} sensors...`,
  );

  // --- fetch daily average per sensor with header-driven adaptive delay ---
  const measurementRows: {
    station_id: string;
    sensor_id: number;
    parameter: string;
    value: number;
    unit: string;
    measured_at: string;
  }[] = [];

  let sensorsQueried = 0;
  let nextDelayMs = DEFAULT_DELAY_MS;
  let consecutive429s = 0;

  for (const station of stationRows) {
    // Only fetch the first sensor per station — collocated sensors measure the same air
    // and we display one value per location on the map.
    const sensorId = (station.pm25_sensor_ids as number[])[0];

    // Consume the computed delay, then immediately reset to the safe default.
    // Header-based logic below will override it for the next iteration.
    await sleep(nextDelayMs);
    nextDelayMs = DEFAULT_DELAY_MS;
    sensorsQueried++;

    const { readings, rateLimitRemaining, rateLimitResetMs } = await fetchSensorDailyAverage(
      apiKey,
      sensorId,
      targetDate,
    );

    // Adjust next delay based on rate-limit headers
    if (rateLimitRemaining !== null && rateLimitResetMs !== null) {
      const timeUntilResetMs = Math.max(0, rateLimitResetMs - Date.now());
      if (rateLimitRemaining <= 2) {
        // Window nearly exhausted — schedule a long pause before the next request
        nextDelayMs = timeUntilResetMs + 1_000;
        console.warn(
          `[aqi-ingest] rate limit nearly exhausted, pausing ${Math.round(nextDelayMs / 1000)}s until reset`,
        );
      } else {
        // Spread remaining quota evenly over the remaining window,
        // never faster than the safe default rate.
        nextDelayMs = Math.max(DEFAULT_DELAY_MS, Math.ceil(timeUntilResetMs / rateLimitRemaining));
      }
    }

    if (readings.length === 0 && rateLimitRemaining === 0) {
      // Sensor was skipped due to exhausted retries on 429
      consecutive429s++;
      if (consecutive429s >= CONSECUTIVE_429_ABORT) {
        throw new Error(
          `[aqi-ingest] Aborting: ${consecutive429s} consecutive sensors skipped due to 429. ` +
            `Hourly quota likely exhausted. Stopping to avoid an OpenAQ ban.`,
        );
      }
    } else {
      consecutive429s = 0;
    }

    for (const r of readings) {
      if (r.value === null || r.value === undefined) continue;
      measurementRows.push({
        station_id: station.id as string,
        sensor_id: sensorId,
        parameter: 'pm25',
        value: r.value,
        unit: 'µg/m³',
        measured_at: r.dateUtc,
      });
    }
  }

  console.log(`[aqi-ingest] Collected ${measurementRows.length} measurements for ${targetDate}`);

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

  // Invalidate Redis cache
  await Promise.all(
    PARAMETERS.flatMap((p) => [
      redis.del(`measurements:latest:${p}:current`),
      redis.del(`measurements:latest:${p}:${targetDate}`),
    ]),
  );

  console.log('[aqi-ingest] Done');
  return { sensorsQueried, measurementsInserted: measurementRows.length };
}
