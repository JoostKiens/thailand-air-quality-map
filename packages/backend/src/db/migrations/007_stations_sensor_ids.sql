-- Run manually in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run — ADD COLUMN IF NOT EXISTS is idempotent.
--
-- Adds pm25_sensor_ids and datetime_last to the stations table so that
-- aqi-ingest can read sensor IDs directly from the DB instead of calling
-- the OpenAQ /locations API on every daily run.
--
-- pm25_sensor_ids: array of OpenAQ sensor IDs for pm25 measurements at this
--   station. Populated by stations-ingest (weekly). A location may have multiple
--   pm25 sensors (e.g. collocated reference and low-cost instruments).
-- datetime_last: when this station last reported data. Used by stations-ingest
--   to skip stale stations (datetimeLast > 30 days old).

alter table stations
  add column if not exists pm25_sensor_ids int4[]      default '{}',
  add column if not exists datetime_last   timestamptz;
