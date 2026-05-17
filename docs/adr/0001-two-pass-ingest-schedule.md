# ADR 0001 — Ingest schedule: single-pass CAMS, two-pass OpenAQ

**Date:** 2026-05-17  
**Status:** Accepted

## Context

The `latest-date` gate requires three data sources to be complete for a UTC calendar date D before the UI shows it: CAMS PM2.5 grid (≥ 4,000 rows), fire points (≥ 1), and OpenAQ measurements (≥ 1).

Fire points for D are available by 10:00 UTC D. The bottleneck is OpenAQ measurements: BKK day D closes at 16:59 UTC D, after which OpenAQ needs time to finalise daily averages. The original single-pass schedule (`0 1 * * *` for AQ grid, `0 4 * * *` for measurements, both fetching yesterday) made D's data visible from 04:30 UTC D+1 = **11:30 BKK D+1** — too late for morning visitors.

The goal is to make yesterday's complete data visible by **07:00 BKK** (00:00 UTC).

## Decision

**CAMS PM2.5 grid (`aq-ingest`) — single pass at `0 23 * * *`**

Fetches today's UTC date via `ingest-aq-today.ts`. By 23:00 UTC the BKK day has closed 6 hours earlier and all CAMS model runs (00Z, 06Z, 12Z, 18Z) are complete. A second pass would be wasteful: CAMS is a deterministic model so the grid values for a given date do not change between runs, and the AQ API counts each of 4,599 grid points as one call (free-tier limit: 10,000/day). Two passes would consume 9,198/10,000 calls leaving no retry headroom.

**OpenAQ measurements (`aqi-ingest`) — two passes**

| Pass | Time (UTC) | Target date | Purpose |
|---|---|---|---|
| Pass 1 | `0 23 * * *` on D | D (today) | Optimistic early write; makes data visible by ~23:30 UTC (06:30 BKK) |
| Pass 2 | `0 4 * * *` on D+1 | D (yesterday) | Safety net; overwrites any partial averages Pass 1 wrote before slow stations had reported |

Pass 1 uses `ingest-aqi-today.ts` (explicit today date). Pass 2 uses the existing `ingest-aqi.ts` (defaults to yesterday). The upsert uses `ignoreDuplicates: false` so Pass 2 always overwrites Pass 1 values with the fully-finalised daily average.

Unlike CAMS, OpenAQ daily averages are computed from station readings that trickle in — a value written at 23:00 UTC may be based on fewer hours than the finalized value available at 04:00 UTC D+1.

## Trade-offs considered

**Two passes for CAMS (rejected):** Would consume 92% of the Open-Meteo AQ API daily quota with no data-quality benefit, since CAMS values are deterministic per date.

**Single pass for OpenAQ at 23:00 UTC (rejected):** Simpler, but slow-reporting stations would be permanently missed with no correction path.

**Single pass for both at 04:00 UTC next day (status quo):** Reliable but data visible from 11:30 BKK — too late for morning visitors.

## Consequences

- `ingest-aq-today.ts` and `ingest-aqi-today.ts` wrapper scripts added to `src/scripts/`.
- Railway: old `aq-ingest` cron (`0 1 * * *`) replaced by single `0 23 * * *` entry.
- Railway: `aqi-ingest` gets a new `0 23 * * *` pass 1 entry; existing `0 4 * * *` becomes pass 2.
- Weather-ingest moved to `0 8 * * *` fetching today — see CLAUDE.md for rationale.
- CLAUDE.md cron table must stay in sync with the actual Railway schedule.
