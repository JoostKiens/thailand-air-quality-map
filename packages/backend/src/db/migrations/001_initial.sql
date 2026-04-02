-- Run this manually in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is safe to run multiple times — all statements use IF NOT EXISTS / IF NOT EXISTS guards.

-- Enable PostGIS
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- fire_points: VIIRS fire detections from NASA FIRMS
-- ---------------------------------------------------------------------------
create table if not exists fire_points (
  id           bigserial primary key,
  detected_at  timestamptz not null,
  location     geography(Point, 4326) not null,
  lat          float8 not null,
  lng          float8 not null,
  frp          float8,           -- fire radiative power (MW)
  bright_ti4   float8,           -- brightness temperature band I-4 (~4µm, fire detection)
  bright_ti5   float8,           -- brightness temperature band I-5 (~11µm, background)
  country_id   text,             -- 'MMR', 'LAO', 'THA', 'KHM', etc.
  satellite    text,             -- 'N' = Suomi-NPP, '1' = NOAA-20
  confidence   text,             -- 'low', 'nominal', 'high'
  daynight     text,             -- 'D' or 'N'
  fire_type    int2,             -- 0=vegetation, 1=volcano, 2=static land, 3=offshore
  source       text default 'VIIRS_SNPP_NRT',
  created_at   timestamptz default now()
);

-- Unique constraint enables ON CONFLICT DO NOTHING for idempotent upserts
create unique index if not exists fire_points_detected_at_lat_lng_idx
  on fire_points (detected_at, lat, lng);

create index if not exists fire_points_location_idx  on fire_points using gist(location);
create index if not exists fire_points_detected_at_idx on fire_points (detected_at);
create index if not exists fire_points_country_id_idx  on fire_points (country_id);
create index if not exists fire_points_fire_type_idx   on fire_points (fire_type);
create index if not exists fire_points_confidence_idx  on fire_points (confidence);

-- ---------------------------------------------------------------------------
-- stations: OpenAQ monitoring station metadata
-- ---------------------------------------------------------------------------
create table if not exists stations (
  id           text primary key,   -- OpenAQ locations_id as text
  name         text not null,
  location     geography(Point, 4326),
  country      text,               -- 'TH', 'MM', 'LA', 'KH'
  provider     text,               -- e.g. 'PCD Thailand'
  is_mobile    boolean default false,
  is_monitor   boolean,            -- true = reference grade, false = low-cost sensor
  parameters   text[],             -- array of parameters this station measures
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists stations_location_idx on stations using gist(location);
create index if not exists stations_country_idx  on stations (country);

-- ---------------------------------------------------------------------------
-- measurements: time-series AQI readings per station/sensor
-- ---------------------------------------------------------------------------
create table if not exists measurements (
  id           bigserial primary key,
  station_id   text not null references stations(id),
  sensor_id    int4 not null,      -- OpenAQ sensors_id
  parameter    text not null,      -- 'pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'bc'
  value        float8 not null,
  unit         text not null,      -- 'µg/m³', 'ppm', etc.
  measured_at  timestamptz not null,
  created_at   timestamptz default now()
);

create index if not exists measurements_station_param_time_idx
  on measurements (station_id, parameter, measured_at);
create index if not exists measurements_param_time_idx
  on measurements (parameter, measured_at);
create index if not exists measurements_measured_at_idx
  on measurements (measured_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Disabled on all tables: data is never accessed directly from the client.
-- All reads and writes go through the backend API using the service role key.
alter table fire_points  disable row level security;
alter table stations     disable row level security;
alter table measurements disable row level security;
