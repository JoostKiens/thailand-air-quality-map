/**
 * Backfill script — fetches the last N days of fire, AQ grid, AQI measurement,
 * and wind data and writes it to Supabase / Redis.
 *
 * Usage:
 *   pnpm --filter backend backfill              # last 10 days (default)
 *   pnpm --filter backend backfill -- --days=3  # last 3 days
 */

import { runFirmsIngest } from '../jobs/firms-ingest.js';
import { runAqiIngest } from '../jobs/aqi-ingest.js';
import { runAqIngest } from '../jobs/aq-ingest.js';
import { runWindIngest } from '../jobs/wind-ingest.js';

const DAYS = parseDaysArg() ?? 10;
const DAY_PAUSE_MS = 2_000; // between days — gives OpenAQ rate-limit window room to breathe
const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1_000; // 5 min pause when a rate limit is detected

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDaysArg(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return undefined;
  const n = parseInt(arg.split('=')[1] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns YYYY-MM-DD for `daysAgo` days before today (UTC). */
function dateFor(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit/i.test(msg);
}

/**
 * Calls `fn`, retrying once after a long pause if a rate-limit error is detected.
 * Non-rate-limit errors are re-thrown so the caller can decide whether to skip.
 */
async function callWithRateLimit<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isRateLimitError(err)) {
      const pauseMin = Math.round(RATE_LIMIT_PAUSE_MS / 60_000);
      console.warn(
        `[backfill] ${label} — rate limit detected, pausing ${pauseMin} min then retrying`,
      );
      await sleep(RATE_LIMIT_PAUSE_MS);
      return await fn(); // second attempt; let errors propagate
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Summary tracking
// ---------------------------------------------------------------------------

type DayResult = {
  date: string;
  firms: string;
  aq: string;
  aqi: string;
  wind: string;
  ok: boolean;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Build date list: oldest first (today−N … today−1). We skip today because
  // the day is still in progress and partial data is less useful than a complete day.
  const dates: string[] = [];
  for (let i = DAYS; i >= 1; i--) {
    dates.push(dateFor(i));
  }

  console.log(`\nBackfilling ${DAYS} day(s): ${dates[0]} → ${dates[dates.length - 1]}\n`);

  const results: DayResult[] = [];

  for (const date of dates) {
    console.log(`\n── ${date} ──`);
    const result: DayResult = { date, firms: '—', aq: '—', aqi: '—', wind: '—', ok: true };

    // 1. FIRMS fire detections
    try {
      const { inserted } = await callWithRateLimit(`firms ${date}`, () => runFirmsIngest(date));
      result.firms = `${inserted} inserted`;
    } catch (err) {
      result.firms = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      result.ok = false;
    }

    // 2. Open-Meteo CAMS PM2.5 grid
    try {
      const { stored } = await callWithRateLimit(`aq ${date}`, () => runAqIngest(date));
      result.aq = `${stored} stored`;
    } catch (err) {
      result.aq = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      result.ok = false;
    }

    // 3. Wind grid (Open-Meteo archive API — fast, no rate limit concerns)
    try {
      const { points } = await runWindIngest(date);
      result.wind = `${points} vectors`;
    } catch (err) {
      result.wind = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      result.ok = false;
    }

    // 4. OpenAQ measurements (slowest — inner per-sensor retry already handles 429)
    try {
      const { stationsUpserted, measurementsInserted } = await callWithRateLimit(
        `aqi ${date}`,
        () => runAqiIngest(date),
      );
      result.aqi = `${stationsUpserted} stations, ${measurementsInserted} measurements`;
    } catch (err) {
      result.aqi = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      result.ok = false;
    }

    results.push(result);

    if (date !== dates[dates.length - 1]) {
      await sleep(DAY_PAUSE_MS);
    }
  }

  // Summary table
  console.log('\n──────────────────────────────────────────────────────────────────────────────');
  console.log(' Date         FIRMS                  AQ grid     Wind          AQI');
  console.log('──────────────────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(
      `${status} ${r.date}  firms: ${r.firms.padEnd(18)}  aq: ${r.aq.padEnd(10)}  wind: ${r.wind.padEnd(12)}  aqi: ${r.aqi}`,
    );
  }
  const succeeded = results.filter((r) => r.ok).length;
  console.log('──────────────────────────────────────────────────────────────────────────────');
  console.log(`Backfill complete. ${succeeded}/${results.length} days fully succeeded.\n`);

  process.exit(succeeded === results.length ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
