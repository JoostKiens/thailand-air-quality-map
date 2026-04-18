-- Run manually in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run — uses IF NOT EXISTS guards.

create table if not exists power_plants (
  id                serial primary key,
  name              text not null,
  country           char(3) not null,
  fuel_type         text not null check (fuel_type in ('Coal', 'Gas', 'Oil')),
  capacity_mw       numeric(8, 2),
  owner             text,
  commissioned_year integer,
  lat               float8 not null,
  lng               float8 not null,
  location          geography(Point, 4326) not null
);

create index if not exists power_plants_location_idx on power_plants using gist(location);
create index if not exists power_plants_fuel_type_idx on power_plants (fuel_type);
create unique index if not exists power_plants_name_country_idx on power_plants (name, country);
