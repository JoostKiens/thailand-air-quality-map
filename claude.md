# Thailand Air Quality Map — CLAUDE.md

## Project overview

A web-based interactive map visualizing the causes of air pollution in Thailand and
surrounding countries (Myanmar, Laos, Cambodia). The goal is civic and educational:
to make it visually undeniable that fires in neighboring countries — combined with
wind patterns — are a primary cause of Thailand's seasonal PM2.5 spikes, countering
the narrative of blame-shifting between countries and agricultural sectors.

This is a personal, non-commercial project by a single developer. Prioritize
simplicity and correctness over premature optimization.

---

## Monorepo structure

```
/
├── CLAUDE.md
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # shared tsconfig
├── packages/
│   ├── types/                # shared TypeScript interfaces (no runtime deps)
│   │   └── src/
│   │       ├── fire.ts
│   │       ├── aqi.ts
│   │       ├── wind.ts
│   │       ├── power-plant.ts
│   │       └── index.ts
│   ├── backend/              # Node + Fastify API + Railway cron scripts
│   │   └── src/
│   │       ├── server.ts     # Fastify entry point
│   │       ├── routes/       # API route handlers
│   │       ├── jobs/         # ingestion scripts (run via Railway cron)
│   │       ├── db/           # Supabase client + query helpers
│   │       ├── cache/        # Upstash Redis client + helpers
│   │       └── lib/          # shared utilities (geo transforms, etc.)
│   └── frontend/             # React + Vite SPA
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/
│           │   ├── Map/      # Mapbox + Deck.gl map shell
│           │   ├── Sidebar/  # layer toggles, opacity, legend
│           │   ├── TimeSlider/
│           │   └── StatsPanel/
│           ├── layers/       # one file per Deck.gl layer
│           │   ├── FiresLayer.ts
│           │   ├── PM25Layer.tsx
│           │   ├── WindLayer.ts
│           │   └── PowerPlantsLayer.ts
│           ├── hooks/        # TanStack Query hooks, one per data type
│           │   ├── useFires.ts
│           │   ├── useAQI.ts
│           │   ├── useWind.ts
│           │   ├── useWindParticles.ts
│           │   └── usePowerPlants.ts
│           └── store/        # Zustand stores
│               ├── layerStore.ts
│               └── timeStore.ts
```

---

## Tech stack

### Frontend

- React 18 with TypeScript
- Vite (build tool + dev server)
- Mapbox GL JS (base map, dark custom style)
- Deck.gl (data layers rendered on top of Mapbox)
- Zustand (UI state: layer visibility, opacity, time range)
- TanStack Query v5 (data fetching + caching from our own backend)
- Turf.js (geospatial utilities if needed client-side)

### Backend

- Node.js 20+ with TypeScript
- Fastify (HTTP framework)
- Upstash Redis (hot cache with TTL)
- Supabase (Postgres + PostGIS for persistent storage)

### Shared

- `packages/types` — TypeScript interfaces shared between frontend and backend
- pnpm workspaces (monorepo)
- ESLint + shared tsconfig

### Deployment

- Frontend → Vercel (Hobby plan, non-commercial)
- Backend + cron jobs → Railway (Hobby plan, ~$5/month)
- Database → Supabase (free tier)
- Redis → Upstash (free tier)

---

## Data sources and ingestion

### Architecture principle

**The frontend never calls third-party APIs directly.** All external data is fetched
by backend scheduled jobs, stored in Supabase and/or cached in Redis, and served to
the frontend through our own Fastify API. This decouples the UI from rate limits and
keeps API keys server-side.

### NASA FIRMS — active fire points (VIIRS)

- Source: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/{bbox}/1/{date}`
- Bounding box: `89,1,114,30` — matches viewport MAX_BOUNDS (covers Myanmar, Thailand, Laos, Cambodia, Vietnam, Malaysia, and partial India/China/Bangladesh)
- Schedule: every 3 hours (satellite pass cadence)
- Storage: Supabase `fire_points` table (PostGIS point geometry)
- Cache: Redis with 3h TTL for latest 24h slice
- License: NASA open data, no redistribution restrictions
- Required: free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/
- Key field: `frp` (Fire Radiative Power in MW) — use this to scale point size in the UI
- Country attribution: use `country_id` field to color-code fires by country (Myanmar, Laos, Thailand)

### OpenAQ — PM2.5 / AQI station readings

- Source: OpenAQ v3 API `https://api.openaq.org/v3/`
- Endpoints: `/v3/locations` (weekly station sync — populates `pm25_sensor_ids` and `datetime_last`) +
             `/v3/sensors/{id}/hours/daily` (daily averages per sensor; `/days` is confirmed broken
             — ignores date filters; `/hours/daily` requires local timezone offset in datetime params)
- Parameters: `pm25` only (primary pollutant for this project)
- Schedule: once daily (`0 4 * * *` UTC = 11:00 BKK) — fetches daily averages, so
  running more often than once per day adds no value
- Storage: Supabase `stations` + `measurements` tables
- Cache: Redis with 24h TTL, key `measurements:latest:{param}:{date|current}`
- License: CC BY 4.0 — attribution required in UI
- Required: free API key from https://explore.openaq.org/register
- Note: some underlying Thai monitoring station data may have its own attribution
  requirements — check the `attribution` field in API responses and surface it in tooltips

### Open-Meteo — weather grid

- Source: `https://api.open-meteo.com/v1/forecast` (today) / `https://archive-api.open-meteo.com/v1/archive` (past dates)
- Parameters:
  - Hourly snapshot at 07:00 UTC (14:00 BKK): `wind_speed_10m`, `wind_direction_10m`, `relative_humidity_2m`
  - Daily aggregates: `wind_speed_10m_max`, `precipitation_sum`
- No API key required
- Grid: 0.4° spacing over bbox `[89,1,114,30]` → 63 × 73 = 4,599 points per date;
  matches the CAMS AQ grid resolution. Fetched in 10 batches of ≤500 with 5 s between
  batches (~50 s total). Batch size capped at 500 — 1,000-location batches exceed the
  POST body limit (413) because per-location array fields inflate the payload. Free tier
  counts HTTP requests (not locations): 10 calls/day is well within the 10,000/day
  limit. 429 backoff: 65 s for minutely, 65 min for hourly, abort for daily.
- Schedule: once daily (`0 4 * * *` UTC = 11:00 BKK)
- Storage: Supabase `weather_readings` table (persistent, 40-day retention) + Redis
  cache key `weather:{date}` TTL 25h. Route checks Redis first; on miss reads from
  Supabase and repopulates Redis. Ingest writes to both.
- License: CC BY 4.0 — attribution link required in UI footer
- Note: only wind fields are currently consumed by the UI and "Explain This" feature.
  Precipitation, humidity, and temperature are stored for future use.
- Render as: wind particles (animated PathLayer) and static arrow vectors

### Open-Meteo Air Quality — PM2.5 gridded model (CAMS)

- Source: `https://air-quality-api.open-meteo.com/v1/air-quality`
- Parameters: `pm2_5` (hourly), daily mean computed per grid point
- Grid: 0.4° spacing over bbox [89,1,114,30] → 63 × 73 = **4,599 points** per date; fetched in 16 batches of 300 (sequential, with 429 retry backoff)
- No API key required
- Schedule: every 6 hours (and on-demand for historical dates)
- Storage: Supabase `aq_grid` table (date, lat, lng, pm25 — primary key on all three) **and** Redis cache key `aq:pm25:{YYYY-MM-DD}` TTL 48h. Route checks Redis first; on miss reads from Supabase and re-populates Redis. Ingest writes to both. Pruned after 40 days.
- License: CC BY 4.0 — same attribution as wind (Open-Meteo footer link covers both)
- Data source: CAMS (Copernicus Atmosphere Monitoring Service) global model, ~11km resolution
- Render as: `BitmapLayer` — grid painted onto an offscreen canvas (630×730 px, 10 px/cell) with bilinear color interpolation between cells, then passed as a texture; clipped to land via `MaskExtension` + `SolidPolygonLayer` using Natural Earth 50m land polygons clipped to viewport (`src/data/sea-land-mask.json`); land mask regenerated via `scripts/generate-land-mask.py`
- Script: `pnpm --filter backend run ingest:aq YYYY-MM-DD`

### Burn scars (future layer)

- Source: Sentinel-2 via Copernicus Browser or Google Earth Engine
- Not in initial scope — add after core layers are working

---

## Database schema (Supabase / PostGIS)

```sql
-- Enable PostGIS
create extension if not exists postgis;

-- Fire detections from VIIRS
create table fire_points (
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
create index on fire_points using gist(location);
create index on fire_points (detected_at);
create index on fire_points (country_id);
create index on fire_points (fire_type);
create index on fire_points (confidence);

-- Monitoring station metadata (upserted on ingestion, rarely changes)
create table stations (
  id               text primary key,   -- OpenAQ locations_id as text
  name             text not null,
  location         geography(Point, 4326),
  country          text,               -- 'TH', 'MM', 'LA', 'KH'
  provider         text,               -- e.g. 'PCD Thailand'
  is_mobile        boolean default false,
  is_monitor       boolean,            -- true = reference grade, false = low-cost sensor
  parameters       text[],             -- array of parameters this station measures
  pm25_sensor_ids  int4[]      default '{}',  -- OpenAQ sensor IDs for pm25; populated by stations-ingest; array because a location may have multiple pm25 sensors
  datetime_last    timestamptz,               -- when this station last reported data; used to skip stale stations (> 30 days)
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index on stations using gist(location);
create index on stations (country);

-- Time-series measurements (appended on every ingestion run)
create table measurements (
  id           bigserial primary key,
  station_id   text not null references stations(id),
  sensor_id    int4 not null,      -- OpenAQ sensors_id
  parameter    text not null,      -- 'pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'bc'
  value        float8 not null,
  unit         text not null,      -- 'µg/m³', 'ppm', etc.
  measured_at  timestamptz not null,
  created_at   timestamptz default now()
);
create index on measurements (station_id, parameter, measured_at);
create index on measurements (parameter, measured_at);
create index on measurements (measured_at);
```

-- Power plants (WRI Global Power Plant Database, CC BY 4.0)
-- Populated via: pnpm --filter backend run ingest:power-plants
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
```

-- CAMS PM2.5 gridded model (migration 005_aq_grid.sql)
-- Pruned after 40 days (same as fire_points and measurements). Redis (aq:pm25:{date}, TTL 48h) is the hot cache; Supabase is the persistent store.
```sql
create table if not exists aq_grid (
  date  date    not null,
  lat   float8  not null,
  lng   float8  not null,
  pm25  float8  not null,
  primary key (date, lat, lng)
);
create index if not exists aq_grid_date_idx on aq_grid (date);
```

-- Weather grid (Open-Meteo forecast/archive, snapshot at 07:00 UTC = 14:00 BKK)
-- Pruned after 40 days. Redis (weather:{date}, TTL 25h) is the hot cache; Supabase is
-- the persistent store. Only wind fields are currently used by the UI and Explain feature;
-- precipitation, humidity, and temperature are stored for future use.
```sql
create table if not exists weather_readings (
  date                      date   not null,
  lat                       float8 not null,
  lng                       float8 not null,
  wind_speed_kmh            float8 not null,  -- daily mean
  wind_speed_max_kmh        float8,           -- daily maximum
  wind_direction_deg        float8 not null,  -- meteorological FROM-direction, snapshot at 07:00 UTC
  precipitation_sum         float8,          -- daily total mm
  relative_humidity_2m      float8,          -- % at 07:00 UTC snapshot
  temperature_2m_mean       float8,          -- daily mean °C
  temperature_2m_min        float8,          -- daily min °C
  temperature_2m_max        float8,          -- daily max °C
  primary key (date, lat, lng)
);
create index if not exists weather_readings_date_idx on weather_readings (date);
```

### OpenAQ v3 data model note

OpenAQ v3 uses a hierarchy: **Location → Sensors → Measurements**. Each location
(station) contains multiple sensors, and each sensor tracks exactly one parameter.
Station metadata and measurement ingestion are split across two separate jobs:

- `stations-ingest` (weekly): upserts location metadata into `stations`, including `pm25_sensor_ids`
  (array of OpenAQ sensor IDs) and `datetime_last`. Skips locations where `datetimeLast > 30 days`.
- `aqi-ingest` (daily, `0 4 * * *` UTC): reads `pm25_sensor_ids` directly from
  `SELECT id, pm25_sensor_ids FROM stations WHERE pm25_sensor_ids != '{}'`. No API call
  to `/locations` is made during daily ingest. A location may have multiple pm25 sensors
  (e.g. collocated reference and low-cost instruments) — each is fetched and stored as a
  separate `measurements` row. Only `pm25_sensor_ids[0]` is fetched per station — collocated
  sensors measure the same air and the map displays one value per location. All sensor IDs
  are retained in the array for future use. On fresh deployment, run `stations-ingest` before
  the first `aqi-ingest` run.

Parameters to ingest: `pm25`, `pm10`, `no2`, `o3`, `so2`, `co`, `bc`.
Skip `temperature` and `humidity` — meteorological context comes from Open-Meteo.

The `aqi_readings` table from earlier designs has been replaced by the
`stations` + `measurements` two-table design. Do not recreate `aqi_readings`.

---

## API routes (Fastify backend)

All routes return JSON. All accept a `bbox` query param where spatial filtering is
needed (format: `west,south,east,north`, default: `89,1,114,30`).

```
GET /api/fires?date=YYYY-MM-DD&bbox=...
  Returns fire points for a given date. Checks Redis first, falls back to Supabase.
  Supports optional query params: confidence=high,nominal  fire_type=0,2

GET /api/fires/range?start=YYYY-MM-DD&end=YYYY-MM-DD&bbox=...
  Returns fire points for a date range (used by time scrubber). Max 10 days.

GET /api/measurements/latest?parameter=pm25&bbox=...&date=YYYY-MM-DD
  Returns latest measurement per station for the given parameter.
  date is optional: when provided, queries that day's window; when absent, queries last 24h.
  Redis first (key: measurements:latest:{param}:{date|current}), then Supabase.

GET /api/measurements/history?station_id=...&parameter=pm25&hours=24
  Returns time series for a single station and parameter.
  Used in station tooltip chart.

GET /api/stations?bbox=...
  Returns all stations with their available parameters.

GET /api/weather?date=YYYY-MM-DD&bbox=...
  Returns weather grid for the given date. date param is required (400 if absent/invalid).
  Redis cache key: weather:{date}, TTL 25h. On miss, reads from Supabase weather_readings.
  Does not fetch from Open-Meteo on demand — data must have been ingested by weather-ingest.
  Returns 404 if no rows exist for the requested date.
  Response includes all weather_readings fields; only wind fields are currently used by the UI.

GET /api/aq/pm25?date=YYYY-MM-DD&bbox=...
  Returns Open-Meteo CAMS gridded PM2.5 for a specific date (up to 4,599 points at 0.4° grid, bbox [89,1,114,30]).
  Redis first (key: aq:pm25:{date}, TTL 48h); on miss fetches live from Open-Meteo.

GET /api/power-plants
  Returns WRI power plants (Coal/Gas/Oil) for THA/MMR/LAO/KHM as a GeoJSON FeatureCollection.
  Redis cache key: power_plants:geojson, TTL 24h. Data source: WRI Global Power Plant Database.
  Populate via: pnpm --filter backend run ingest:power-plants

GET /health
  Returns { status: 'ok', cache: 'connected', db: 'connected' }
```

---

## Shared TypeScript types (packages/types)

```typescript
// fire.ts
export interface FirePoint {
  id: number;
  detectedAt: string; // ISO 8601
  lat: number;
  lng: number;
  frp: number | null; // fire radiative power MW
  brightTi4: number | null; // brightness temperature band I-4
  brightTi5: number | null; // brightness temperature band I-5
  countryId: string; // ISO 3166-1 alpha-3
  satellite: string | null; // 'N' = Suomi-NPP, '1' = NOAA-20
  confidence: string | null; // 'low' | 'nominal' | 'high'
  daynight: string | null; // 'D' | 'N'
  fireType: number | null; // 0=vegetation, 1=volcano, 2=static land, 3=offshore
}

// station.ts
export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  provider: string | null;
  isMobile: boolean;
  isMonitor: boolean | null;
  parameters: string[];
}

// measurement.ts
export interface Measurement {
  stationId: string;
  sensorId: number;
  parameter: string; // 'pm25' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co' | 'bc'
  value: number;
  unit: string;
  measuredAt: string; // ISO 8601
}

export interface AQICategory {
  label: string;
  color: string;
  min: number;
  max: number;
}

// wind.ts
export interface WindVector {
  lat: number;
  lng: number;
  speedKmh: number;
  directionDeg: number; // meteorological: 0=N, 90=E, 180=S, 270=W
}

// aq.ts
export interface PM25GridPoint {
  lat: number;
  lng: number;
  pm25: number; // daily mean µg/m³ from CAMS model via Open-Meteo
}
```

Note: `AQIReading` (earlier design) is gone. The current model is `Station` + `Measurement`.
Types live in `packages/types/src/measurement.ts` and `packages/types/src/station.ts`.

---

## Frontend state (Zustand)

```typescript
// layerStore.ts
interface LayerStore {
  layers: {
    pm25: { visible: boolean; opacity: number };
    fires: { visible: boolean; opacity: number };
    wind: { visible: boolean; opacity: number };
    burnScars: { visible: boolean; opacity: number };
    powerPlants: { visible: boolean; opacity: number }; // default off
  };
  toggleLayer: (id: LayerId) => void;
  setOpacity: (id: LayerId, opacity: number) => void;
}

// timeStore.ts
interface TimeStore {
  selectedDate: string; // YYYY-MM-DD, default: today
  rangeMode: boolean; // false = single day, true = range
  rangeStart: string;
  rangeEnd: string;
  setDate: (date: string) => void;
  setRange: (start: string, end: string) => void;
}
```

---

## Scheduled ingestion jobs (Railway cron)

Each job is a standalone script in `packages/backend/src/jobs/`, invoked directly by
Railway cron (no job queue). Schedules are configured in Railway's cron service UI.

```
firms-ingest       — daily     (0 10 * * *)     fetches VIIRS data for TODAY (UTC); last satellite pass
                                                lands ~06:12 UTC and is in the DB by ~09:00 UTC, so
                                                10:00 UTC guarantees a complete day before storing
stations-ingest    — weekly    (0 0 * * 0)      fetches OpenAQ locations by bbox, upserts stations table
                                                including pm25_sensor_ids and datetime_last;
                                                skips locations where datetimeLast > 30 days
aq-ingest          — daily     (0 1 * * *)      fetches Open-Meteo CAMS PM2.5 grid for YESTERDAY (UTC);
                                                runs before aqi/weather so the grid is ready when
                                                /api/latest-date is first queried in the morning
prune              — daily     (0 2 * * *)      deletes fire_points, measurements, aq_grid rows > 40 days
aqi-ingest         — daily     (0 4 * * *)      reads pm25_sensor_ids from stations table (no fetchLocations call),
                                                fetches daily averages for YESTERDAY via /hours/daily;
                                                OpenAQ uses BKK (+07:00) day boundaries — yesterday's full
                                                24h window closes at 16:59 UTC, giving OpenAQ 11h to process
weather-ingest     — daily     (0 4 * * *)      fetches Open-Meteo weather grid for YESTERDAY (07:00 UTC
                                                snapshot); upserts to Supabase weather_readings and Redis
                                                (weather:{date}, TTL 25h)
```

All times are UTC (Railway runs in UTC). The UI shows the most recent date where all three
gating sources have complete data (AQ grid ≥ 4,000 rows, fires ≥ 1, measurements ≥ 1),
served by GET /api/latest-date. This date becomes available at ~04:30 UTC each day (11:30 BKK)
after aqi-ingest and weather-ingest complete.

Each script exits with code 0 on success and non-zero on failure. Retry logic is
implemented within the script (3 attempts with exponential backoff where applicable).

---

## Deck.gl layers

| Layer         | Deck.gl type                     | Key props                                             |
| ------------- | -------------------------------- | ----------------------------------------------------- |
| PM2.5 heatmap | `BitmapLayer` + `MaskExtension` | Open-Meteo CAMS grid, 0.4° cells, bilinearly interpolated onto 630×730 px canvas, clipped to land via `SolidPolygonLayer` mask (`sea-land-mask.json`) |
| PM2.5 stations| `ScatterplotLayer`               | OpenAQ ground stations, colored by `aqiColor(d.value)`, 5px radius |
| Fire points   | 3× `ScatterplotLayer` (additive blend) | Outer glow / mid halo / inner core rings; pixel radius scales with zoom (1–3 px base); intensity from `brightTi4`; low-confidence at 50% opacity |
| Wind particles | Animated `PathLayer` (non-interleaved overlay) | 1500 particles, bilinear interpolation, TRAIL_LENGTH=10, rAF loop |
| Power plants  | `IconLayer`                      | Canvas atlas (96×32 diamond icons), Coal/Gas/Oil fuel types, 24px fixed size, hover tooltip |

Fire point color: `#f97316` (orange) — uniform for all detections. The FIRMS area API does
not return `country_id`, so per-country coloring is not available.

AQI color scale (US EPA official) — thresholds are raw **PM2.5 µg/m³**, not AQI index values.
Colors are defined once in `packages/frontend/src/lib/aqiColors.ts` and shared by both
the heatmap (`BitmapLayer`) and station dots (`ScatterplotLayer`).

| Category | PM2.5 µg/m³ | Hex | RGB |
|---|---|---|---|
| Good | 0–12.0 | `#00e400` | `[0, 228, 0]` |
| Moderate | 12.1–35.4 | `#ffff00` | `[255, 255, 0]` |
| Unhealthy (sensitive) | 35.5–55.4 | `#ff7e00` | `[255, 126, 0]` |
| Unhealthy | 55.5–150.4 | `#ff0000` | `[255, 0, 0]` |
| Very unhealthy | 150.5–250.4 | `#8f3f97` | `[143, 63, 151]` |
| Hazardous | 250.5+ | `#7e0023` | `[126, 0, 35]` |

---

## Map configuration

- Default center: `[101.0, 15.5]` (Thailand center)
- Default zoom: `5.5`
- Mapbox style: dark custom style (use `mapbox://styles/mapbox/dark-v11` as base)
- Bounding box for data: `[89, 1, 114, 30]` (west, south, east, north) — all layers and DEFAULT_BBOX align to this
- Countries to label: Thailand, Myanmar, Laos, Cambodia, Vietnam (contextual only)

---

## License and attribution requirements

The following attributions must appear in the UI footer or an "About" panel:

- Fire data: "Fire data courtesy NASA FIRMS (firms.modaps.eosdis.nasa.gov)"
- AQI data: "Air quality data from OpenAQ (openaq.org)"
- Weather data: `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` (required by CC BY 4.0)
- Power plant data: "Power plant data from WRI Global Power Plant Database (resourcewatch.org)" (CC BY 4.0)
- Map tiles: Mapbox attribution (rendered automatically by Mapbox GL JS)

---

## Environment variables

### Backend (`packages/backend/.env`)

```
NODE_ENV=development
PORT=3001

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # use service role for backend writes

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# NASA FIRMS
FIRMS_MAP_KEY=

# OpenAQ
OPENAQ_API_KEY=
```

### Frontend (`packages/frontend/.env`)

```
VITE_API_BASE_URL=http://localhost:3001    # backend URL
VITE_MAPBOX_TOKEN=                         # public token, pk.* prefix
```

Never commit `.env` files. Provide `.env.example` files with all keys listed but
no values. Never expose `SUPABASE_SERVICE_ROLE_KEY` or `FIRMS_MAP_KEY` to the frontend.

**Claude must never read any `.env` file in this project, except `.env.example` files.**

---

## Development workflow

```bash
# Install all dependencies from repo root
pnpm install

# Start all packages in dev mode (runs frontend + backend concurrently)
pnpm dev

# Start only backend
pnpm --filter backend dev

# Start only frontend
pnpm --filter frontend dev

# Run a one-off ingestion job manually (useful for testing)
pnpm --filter backend run ingest:firms
pnpm --filter backend run ingest:aqi
pnpm --filter backend run ingest:wind
pnpm --filter backend run ingest:aq YYYY-MM-DD   # Open-Meteo CAMS PM2.5 grid
pnpm --filter backend run ingest:power-plants    # WRI power plants (one-off; pass local CSV path as optional arg)

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint
```

---

## Key constraints and gotchas

- Ingestion scripts run as Railway cron jobs — each invocation is a short-lived
  Node process that exits when done. Do not deploy ingestion scripts to Vercel.

- Supabase free tier pauses projects after 1 week of inactivity. During development,
  make sure the ingestion jobs keep the project active, or manually unpause via the
  Supabase dashboard.

- Supabase free tier has 500MB storage. Monitor usage as historical fire data
  accumulates. A nightly prune job (`src/jobs/prune.ts`) deletes `fire_points`,
  `measurements`, `aq_grid`, and `weather_readings` rows older than **40 days**. Derivation: 31 days
  (30 scrubber days T-1→T-30, plus today T which is ingested but not yet visible)
  + 7 days (Explain fetches a 7-day measurement history, so scrubber day 0 reaches
  back to T-37) + 2 days buffer (UTC+7 timezone boundary + prune timing) = 40.

- FIRMS rate limit is 5,000 transactions per 10-minute window. A single bounding box
  request for 1 day counts as 1 transaction. With a 3h schedule this is well within
  limits, but do not trigger ingestion from the frontend or run it manually in rapid
  succession.

- OpenAQ v1 and v2 are retired (January 2025). Use v3 only. Check the `attribution`
  field in API responses — some Thai monitoring stations may require their own attribution.

- Mapbox GL JS requires the attribution control to remain visible. Do not hide it.

- **Wind direction convention — read this before touching any wind direction code:**

  `WindVector.directionDeg` (and Open-Meteo's `winddirection_10m`) is always the
  direction the wind is coming **FROM**, in meteorological convention (0° = from North,
  90° = from East, 180° = from South, 270° = from West).

  | Use case | Result | Example (directionDeg = 45, i.e. wind from NE) |
  |---|---|---|
  | **Display label** (InfoPanel, any UI text) | `windDir.fromLabel` | "from NE" |
  | **Particle / arrow travel direction** | `windDir.toLabel` | "toward SW" |
  | **Upwind quadrant** (which fires affect the station) | `windDir.fromQuadrant` | `'N'` |
  | **Downwind quadrant** (where smoke goes) | `windDir.toQuadrant` | `'S'` |

  **Never apply `+ 180` to a display label.** A label reading "NE" means "wind from
  the NE" — this is how every weather app and meteorologist expresses it. Applying
  `+ 180` to a label produces the TO direction (SW), which looks correct visually
  next to particles flowing SW but is non-standard and confusing.

  **Fires that affect a station are in the FROM quadrant** (upwind). A fire to the
  NE with wind from the NE will have its smoke carried toward the station. A fire to
  the SW (downwind) will have its smoke blown away from the station.

  **In `explain.ts`** use `parseWindDir(wind.directionDeg)` which returns
  `{ fromLabel, toLabel, fromQuadrant, toQuadrant }`. Never call `compassFromDeg`
  or `quadrant` with a manually computed `+ 180` at the call site — put it inside
  `parseWindDir` if a new use case arises.

  **In the frontend** (`InfoPanel.tsx`) use `degToCompass(windVec.directionDeg)`
  (no `+ 180`) and prefix the label with "from" in the UI string.

- The PM2.5 grid uses `BitmapLayer` (not `HeatmapLayer`) because `HeatmapLayer` normalizes
  weights relative to the viewport — the min value always maps to the first color regardless
  of absolute µg/m³, producing incorrect AQI colors. The BitmapLayer approach paints each
  grid cell directly with EPA-threshold colors and bilinearly interpolates between neighbors,
  giving smooth gradients while preserving absolute color accuracy. Filter data server-side;
  only send the selected date's grid.

- Use `geography(Point, 4326)` not `geometry` in PostGIS for distance calculations
  in meters without projection math.

---

## Future layers (not in initial scope)

- Burn scars — Sentinel-2 NDVI differencing via Copernicus
- Population density overlay — to show human exposure
- Land use / farmland classification — contextualizes agricultural burning
- Trajectory lines — animated paths from fire clusters to cities using wind vectors
  (the "causality" killer feature — build this after core layers are stable)
- Year-over-year comparison — requires accumulating historical data from day one

## Code style

- Prettier for formatting, ESLint for code quality
- Config in prettier.config.js at repo root
- Single quotes, semicolons, trailing commas, 100 char print width
- Run `pnpm format` before committing
- Never use loose equality (`==` / `!=`). Always use strict equality (`===` / `!==`).
  For null+undefined checks use `=== null || === undefined` or TypeScript narrowing.

## Dev tooling

- ESLint 9 flat config (eslint.config.js at root)
  - @typescript-eslint recommended-type-checked for all packages
  - eslint-plugin-react-hooks for packages/frontend only
  - eslint-config-prettier applied last
- Prettier: single quotes, semicolons, trailing commas, 100 char width
- Husky + lint-staged: formats and lints staged files on pre-commit
- Commitlint: conventional commits enforced on commit-msg hook
- Vitest: packages/backend (node env) and packages/frontend (jsdom env)
- .vscode/settings.json: formatOnSave, eslint fixOnSave, rulers at 100

## fire_type classification

The VIIRS FIRMS API returns a `fire_type` field for each detection.
Do not use this field to filter out sources — use it to categorize and
visualize sources separately. All types except volcanoes are potentially
relevant to air pollution in the region.

| Value | Label              | Relevant    | Notes                                                            |
| ----- | ------------------ | ----------- | ---------------------------------------------------------------- |
| 0     | Vegetation fire    | ✅ yes      | Agricultural burning, forest fires — primary cross-border source |
| 1     | Active volcano     | ❌ no       | No active volcanoes in Thailand/Myanmar/Laos/Cambodia region     |
| 2     | Static land source | ✅ yes      | Industrial facilities, refineries, power plants                  |
| 3     | Offshore           | ✅ possibly | Offshore gas flaring in Gulf of Thailand                         |

### Visualization implications

- Do not pre-filter by fire_type during ingestion — store all detections
- Expose fire_type as a filter in the sidebar UI so users can toggle
  categories independently
- Consider color-coding by fire_type as an alternative or addition to
  color-coding by country
- The distinction between type 0 (vegetation) and type 2 (industrial) is
  analytically important: it helps separate agricultural burning narratives
  from industrial pollution narratives, both of which are relevant to the
  blame-shifting context this project addresses

### Filtering recommendation

The `confidence` field is the more appropriate field for filtering out
noise. Filter to `confidence IN ('nominal', 'high')` by default in the
UI, with an option to include low-confidence detections. Do not use
fire_type as a quality filter.
