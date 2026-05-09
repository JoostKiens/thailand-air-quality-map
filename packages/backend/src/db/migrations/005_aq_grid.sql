-- Run manually in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run — uses IF NOT EXISTS guards.

-- CAMS PM2.5 gridded model output from Open-Meteo (0.4° grid, one daily mean per cell).
-- Previously Redis-only; persisted here so historical dates remain browsable.
-- Pruned after 60 days by the nightly prune job.

create table if not exists aq_grid (
  date  date    not null,
  lat   float8  not null,
  lng   float8  not null,
  pm25  float8  not null,
  primary key (date, lat, lng)
);

create index if not exists aq_grid_date_idx on aq_grid (date);
