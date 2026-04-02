-- Run in Supabase SQL editor.
-- Adds explicit lat/lng columns to stations so bbox filtering works the same
-- way as fire_points (btree index range scan instead of PostGIS ST_Within).
alter table stations add column if not exists lat float8;
alter table stations add column if not exists lng float8;

-- Backfill from existing geography column
update stations
set
  lat = ST_Y(location::geometry),
  lng = ST_X(location::geometry)
where location is not null;

create index if not exists stations_lat_idx on stations (lat);
create index if not exists stations_lng_idx on stations (lng);
