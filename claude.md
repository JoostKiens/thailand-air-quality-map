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
│   │       └── index.ts
│   ├── backend/              # Node + Fastify API + BullMQ workers
│   │   └── src/
│   │       ├── server.ts     # Fastify entry point
│   │       ├── routes/       # API route handlers
│   │       ├── jobs/         # BullMQ job definitions
│   │       ├── workers/      # BullMQ worker processes
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
│           │   ├── FiresLayer.tsx
│           │   ├── PM25Layer.tsx
│           │   ├── WindLayer.tsx
│           │   └── TrafficLayer.tsx
│           ├── hooks/        # TanStack Query hooks, one per data type
│           │   ├── useFires.ts
│           │   ├── useAQI.ts
│           │   └── useWind.ts
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
- BullMQ (job queue for scheduled data ingestion)
- Upstash Redis (BullMQ backend + hot cache with TTL)
- Supabase (Postgres + PostGIS for persistent storage)

### Shared

- `packages/types` — TypeScript interfaces shared between frontend and backend
- pnpm workspaces (monorepo)
- ESLint + shared tsconfig

### Deployment

- Frontend → Vercel (Hobby plan, non-commercial)
- Backend + BullMQ workers → Railway (Hobby plan, ~$5/month)
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
- Bounding box: `97,5,110,28` (covers Thailand, Myanmar, Laos, Cambodia)
- Schedule: every 3 hours (satellite pass cadence)
- Storage: Supabase `fire_points` table (PostGIS point geometry)
- Cache: Redis with 3h TTL for latest 24h slice
- License: NASA open data, no redistribution restrictions
- Required: free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/
- Key field: `frp` (Fire Radiative Power in MW) — use this to scale point size in the UI
- Country attribution: use `country_id` field to color-code fires by country (Myanmar, Laos, Thailand)

### OpenAQ — PM2.5 / AQI station readings

- Source: OpenAQ v3 API `https://api.openaq.org/v3/`
- Endpoints: `/locations` (station list) + `/measurements` (time series)
- Parameters: `pm25` only (primary pollutant for this project)
- Schedule: every 1 hour
- Storage: Supabase `aqi_readings` table
- Cache: Redis with 1h TTL
- License: CC BY 4.0 — attribution required in UI
- Required: free API key from https://explore.openaq.org/register
- Note: some underlying Thai monitoring station data may have its own attribution
  requirements — check the `attribution` field in API responses and surface it in tooltips

### Open-Meteo — wind vectors

- Source: `https://api.open-meteo.com/v1/forecast`
- Parameters: `windspeed_10m`, `winddirection_10m` on a grid over the bounding box
- No API key required
- Schedule: every 6 hours
- Storage: Redis only (ephemeral, no historical value)
- Cache: Redis with 6h TTL
- License: CC BY 4.0 — attribution link required in UI footer
- Render as: static arrow vectors (ScatterplotLayer or custom PathLayer in Deck.gl)

### Mapbox Traffic

- Built into Mapbox GL JS, enabled as a native layer
- No separate API calls needed
- Toggle on/off via Mapbox layer visibility, not a Deck.gl layer

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
  id          bigserial primary key,
  detected_at timestamptz not null,
  location    geography(Point, 4326) not null,
  frp         float,          -- fire radiative power (MW)
  brightness  float,
  country_id  text,           -- 'MMR', 'LAO', 'THA', 'KHM', etc.
  source      text default 'VIIRS_SNPP_NRT',
  created_at  timestamptz default now()
);
create index on fire_points using gist(location);
create index on fire_points (detected_at);

-- AQI / PM2.5 readings from monitoring stations
create table aqi_readings (
  id          bigserial primary key,
  station_id  text not null,
  station_name text,
  location    geography(Point, 4326) not null,
  pm25        float,
  aqi         int,            -- computed from pm25 using US EPA formula
  measured_at timestamptz not null,
  source      text,           -- original data provider (e.g. 'PCD Thailand')
  created_at  timestamptz default now()
);
create index on aqi_readings using gist(location);
create index on aqi_readings (measured_at);
create index on aqi_readings (station_id, measured_at);
```

Do not store wind data in Postgres — it is ephemeral and only needed for current display.

---

## API routes (Fastify backend)

All routes return JSON. All accept a `bbox` query param where spatial filtering is
needed (format: `west,south,east,north`, default: `97,5,110,28`).

```
GET /api/fires?date=YYYY-MM-DD&bbox=...
  Returns fire points for a given date. Checks Redis first, falls back to Supabase.

GET /api/fires/range?start=YYYY-MM-DD&end=YYYY-MM-DD&bbox=...
  Returns fire points for a date range (used by time scrubber). Max 10 days.

GET /api/aqi/latest?bbox=...
  Returns latest AQI reading per station. Redis first, then Supabase.

GET /api/aqi/history?station_id=...&hours=24
  Returns time series for a single station (used in station tooltip chart).

GET /api/wind/current?bbox=...
  Returns current wind grid from Redis only (no DB fallback — refetch if missing).

GET /health
  Returns { status: 'ok', queues: {...}, cache: 'connected', db: 'connected' }
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
  brightness: number | null;
  countryId: string; // ISO 3166-1 alpha-3
}

// aqi.ts
export interface AQIReading {
  stationId: string;
  stationName: string;
  lat: number;
  lng: number;
  pm25: number | null;
  aqi: number | null;
  measuredAt: string;
  source: string;
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
```

---

## Frontend state (Zustand)

```typescript
// layerStore.ts
interface LayerStore {
  layers: {
    pm25: { visible: boolean; opacity: number };
    fires: { visible: boolean; opacity: number };
    wind: { visible: boolean; opacity: number };
    traffic: { visible: boolean; opacity: number };
    burnScars: { visible: boolean; opacity: number };
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

## BullMQ jobs

Each job lives in `packages/backend/src/jobs/`. Define job and worker separately.

```
firms-ingest       — runs every 3h, fetches VIIRS data, upserts to Supabase, updates Redis
aqi-ingest         — runs every 1h, fetches OpenAQ data, upserts to Supabase, updates Redis
wind-ingest        — runs every 6h, fetches Open-Meteo grid, writes to Redis (no DB)
```

Job retry policy: 3 attempts with exponential backoff. Log failures but do not crash
the worker process. Use BullMQ's built-in job deduplication to prevent overlapping runs.

---

## Deck.gl layers

| Layer         | Deck.gl type                     | Key props                                             |
| ------------- | -------------------------------- | ----------------------------------------------------- |
| PM2.5 heatmap | `HeatmapLayer`                   | `getWeight: d => d.pm25`, radius 50km                 |
| Fire points   | `ScatterplotLayer`               | `getRadius: d => 500 + d.frp * 200`, color by country |
| Wind vectors  | `ScatterplotLayer` + `PathLayer` | arrow glyphs, direction from `directionDeg`           |
| Traffic       | Native Mapbox layer              | toggle via `map.setLayoutProperty()`                  |

Fire point color by country:

- Myanmar `#ef4444` (red)
- Laos `#f97316` (orange)
- Thailand `#eab308` (yellow)
- Cambodia `#a855f7` (purple)
- Other `#6b7280` (gray)

AQI color scale (US EPA):

- 0–50 Good `#22c55e`
- 51–100 Moderate `#eab308`
- 101–150 Unhealthy for sensitive groups `#f97316`
- 151–200 Unhealthy `#ef4444`
- 201–300 Very unhealthy `#a855f7`
- 301+ Hazardous `#be123c`

---

## Map configuration

- Default center: `[101.0, 15.5]` (Thailand center)
- Default zoom: `5.5`
- Mapbox style: dark custom style (use `mapbox://styles/mapbox/dark-v11` as base)
- Bounding box for data: `[97, 5, 110, 28]` (west, south, east, north)
- Countries to label: Thailand, Myanmar, Laos, Cambodia, Vietnam (contextual only)

---

## License and attribution requirements

The following attributions must appear in the UI footer or an "About" panel:

- Fire data: "Fire data courtesy NASA FIRMS (firms.modaps.eosdis.nasa.gov)"
- AQI data: "Air quality data from OpenAQ (openaq.org)"
- Weather data: `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` (required by CC BY 4.0)
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

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint
```

---

## Key constraints and gotchas

- BullMQ workers must run as persistent Node processes — do not deploy them to
  Vercel serverless functions. They run on Railway alongside the Fastify server.

- Supabase free tier pauses projects after 1 week of inactivity. During development,
  make sure the ingestion jobs keep the project active, or manually unpause via the
  Supabase dashboard.

- Supabase free tier has 500MB storage. Monitor usage as historical fire data
  accumulates. Consider a nightly job to prune `fire_points` older than 30 days.

- FIRMS rate limit is 5,000 transactions per 10-minute window. A single bounding box
  request for 1 day counts as 1 transaction. With a 3h schedule this is well within
  limits, but do not trigger ingestion from the frontend or run it manually in rapid
  succession.

- OpenAQ v1 and v2 are retired (January 2025). Use v3 only. Check the `attribution`
  field in API responses — some Thai monitoring stations may require their own attribution.

- Mapbox GL JS requires the attribution control to remain visible. Do not hide it.

- Wind direction convention: Open-Meteo returns `winddirection_10m` as the direction
  the wind is coming FROM (meteorological convention). To draw an arrow showing where
  wind is going, add 180 degrees before computing dx/dy.

- The Deck.gl `HeatmapLayer` does not support time filtering client-side — filter
  data server-side before sending to the frontend. Only send the data for the
  currently selected date/range.

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
