import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { PathLayer } from 'deck.gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { WindReading, PM25GridPoint } from '@thailand-aq/types';

// ─── constants ────────────────────────────────────────────────────────────────

const N_PARTICLES = 1500;
const TRAIL_LENGTH = 14;
// Degrees of movement per frame per km/h of wind speed (at 60 fps).
// Tuned so a 15 km/h breeze visually crosses the region in ~15 s.
const ANIM_SCALE = 0.003;
// Below this speed the trail is always at full TRAIL_LENGTH.
// Above it, trail point count shrinks as √(TRAIL_SPEED_REF / speed) so total
// geographic trail length grows as √speed rather than linearly — preventing
// fast-wind trails from dominating the visual at the expense of animation speed.
const TRAIL_SPEED_REF = 13; // km/h
const BASE_ZOOM = 5.5;
const MIN_AGE = 80;
const MAX_AGE = 220;

// Grid bounds — must match the weather grid constants in openmeteo.ts.
// 0.4° step, lng 89→114 (63 pts), lat 1→30 (73 pts) = 4,599 points.
const GRID_LNG_MIN = 89;
const GRID_LNG_MAX = 114;
const GRID_LAT_MIN = 1;
const GRID_LAT_MAX = 30;
const GRID_STEP = 0.4;
const GRID_LNG_COUNT = Math.floor((GRID_LNG_MAX - GRID_LNG_MIN) / GRID_STEP) + 1; // 63
const GRID_LAT_COUNT = Math.floor((GRID_LAT_MAX - GRID_LAT_MIN) / GRID_STEP) + 1; // 73

// Hard limits — wind grid coverage. Particles are clamped to these.
const SPAWN_LNG_MIN = 89;
const SPAWN_LNG_MAX = 114;
const SPAWN_LAT_MIN = 1;
const SPAWN_LAT_MAX = 30;

// Buffer around the visible viewport used as the spawn/OOB area.
// Gives particles time to enter the screen before being counted, and avoids
// hard pop-in at the edges when panning.
const VIEWPORT_BUFFER = 1.5; // degrees

// ─── types ────────────────────────────────────────────────────────────────────

interface Particle {
  lng: number;
  lat: number;
  age: number;
  maxAge: number;
  trail: [number, number][];
  color: [number, number, number]; // lightened AQI RGB sampled at spawn
}

// Flat grid: index = latIdx * GRID_LNG_COUNT + lngIdx
// Each cell stores precomputed travel-direction velocity components (km/h).
type WindGrid = Float32Array; // [dx0, dy0, dx1, dy1, ...]

// ─── grid helpers ─────────────────────────────────────────────────────────────

function buildGrid(data: WindReading[]): WindGrid {
  const grid = new Float32Array(GRID_LNG_COUNT * GRID_LAT_COUNT * 2);
  for (const v of data) {
    const lngIdx = Math.round((v.lng - GRID_LNG_MIN) / GRID_STEP);
    const latIdx = Math.round((v.lat - GRID_LAT_MIN) / GRID_STEP);
    if (lngIdx < 0 || lngIdx >= GRID_LNG_COUNT || latIdx < 0 || latIdx >= GRID_LAT_COUNT) continue;
    const travelRad = (((v.wind_direction_deg + 180) % 360) * Math.PI) / 180;
    const base = (latIdx * GRID_LNG_COUNT + lngIdx) * 2;
    grid[base] = Math.sin(travelRad) * v.wind_speed_kmh; // dx (east positive)
    grid[base + 1] = Math.cos(travelRad) * v.wind_speed_kmh; // dy (north positive)
  }
  return grid;
}

function sampleWind(lng: number, lat: number, grid: WindGrid): [number, number] {
  const li = (lng - GRID_LNG_MIN) / GRID_STEP;
  const lati = (lat - GRID_LAT_MIN) / GRID_STEP;
  const l0 = Math.max(0, Math.min(GRID_LNG_COUNT - 2, Math.floor(li)));
  const la0 = Math.max(0, Math.min(GRID_LAT_COUNT - 2, Math.floor(lati)));
  const lf = li - l0;
  const laf = lati - la0;

  const i00 = (la0 * GRID_LNG_COUNT + l0) * 2;
  const i10 = (la0 * GRID_LNG_COUNT + l0 + 1) * 2;
  const i01 = ((la0 + 1) * GRID_LNG_COUNT + l0) * 2;
  const i11 = ((la0 + 1) * GRID_LNG_COUNT + l0 + 1) * 2;

  const w00 = (1 - lf) * (1 - laf);
  const w10 = lf * (1 - laf);
  const w01 = (1 - lf) * laf;
  const w11 = lf * laf;

  return [
    grid[i00] * w00 + grid[i10] * w10 + grid[i01] * w01 + grid[i11] * w11,
    grid[i00 + 1] * w00 + grid[i10 + 1] * w10 + grid[i01 + 1] * w01 + grid[i11 + 1] * w11,
  ];
}

// ─── viewport ─────────────────────────────────────────────────────────────────

type Viewport = [west: number, south: number, east: number, north: number];

const FULL_VIEWPORT: Viewport = [SPAWN_LNG_MIN, SPAWN_LAT_MIN, SPAWN_LNG_MAX, SPAWN_LAT_MAX];

function mapViewport(map: mapboxgl.Map): Viewport {
  const b = map.getBounds();
  if (!b) return FULL_VIEWPORT;
  return [
    Math.max(SPAWN_LNG_MIN, b.getWest() - VIEWPORT_BUFFER),
    Math.max(SPAWN_LAT_MIN, b.getSouth() - VIEWPORT_BUFFER),
    Math.min(SPAWN_LNG_MAX, b.getEast() + VIEWPORT_BUFFER),
    Math.min(SPAWN_LAT_MAX, b.getNorth() + VIEWPORT_BUFFER),
  ];
}

// ─── particle color map ───────────────────────────────────────────────────────

// Per-category particle colors — hand-tuned to be visually distinct, light
// enough to stand out over the CAMS heatmap, and calm enough not to dominate.
// Order mirrors AQI_CATEGORIES in aqiColors.ts (Good → Hazardous).
const PARTICLE_COLORS: [number, number, number][] = [
  [168, 197, 160], // Good              — muted sage
  [240, 220, 100], // Moderate          — vivid gold
  [240, 165, 75], // Unhealthy (s)     — vivid orange
  [240, 90, 90], // Unhealthy         — vivid red
  [180, 130, 210], // Very unhealthy    — vivid purple
  [205, 80, 110], // Hazardous         — vivid rose
];

const PM25_BP = [12.0, 35.4, 55.4, 150.4, 250.4];

function pm25ToParticleColor(pm25: number): [number, number, number] {
  for (let i = 0; i < PM25_BP.length; i++) {
    if (pm25 <= PM25_BP[i]) return PARTICLE_COLORS[i];
  }
  return PARTICLE_COLORS[PARTICLE_COLORS.length - 1];
}

// ─── particle helpers ─────────────────────────────────────────────────────────

// Reuses the existing grid constants (same 0.4° step, same origin) to produce
// an integer index key — avoids floating-point string formatting issues.
function sampleSpawnColor(
  lng: number,
  lat: number,
  gridMap: Map<string, number> | null,
): [number, number, number] {
  if (!gridMap) return [255, 255, 255];
  const lngIdx = Math.round((lng - GRID_LNG_MIN) / GRID_STEP);
  const latIdx = Math.round((lat - GRID_LAT_MIN) / GRID_STEP);
  const pm25 = gridMap.get(`${lngIdx},${latIdx}`);
  if (pm25 === undefined) return [255, 255, 255];
  return pm25ToParticleColor(pm25);
}

function spawnParticle(
  viewport: Viewport,
  gridMap: Map<string, number> | null,
  scatterAge = false,
): Particle {
  const [west, south, east, north] = viewport;
  const lng = west + Math.random() * (east - west);
  const lat = south + Math.random() * (north - south);
  const maxAge = MIN_AGE + Math.floor(Math.random() * (MAX_AGE - MIN_AGE));
  return {
    lng,
    lat,
    age: scatterAge ? Math.floor(Math.random() * maxAge) : 0,
    maxAge,
    trail: [],
    color: sampleSpawnColor(lng, lat, gridMap),
  };
}

function initParticles(viewport: Viewport, gridMap: Map<string, number> | null): Particle[] {
  // scatterAge=true distributes initial ages so they don't all fade out simultaneously
  return Array.from({ length: N_PARTICLES }, () => spawnParticle(viewport, gridMap, true));
}

function stepParticles(
  particles: Particle[],
  grid: WindGrid,
  dtScale: number,
  spawnViewport: Viewport,
  gridMap: Map<string, number> | null,
): void {
  for (const p of particles) {
    const [dx, dy] = sampleWind(p.lng, p.lat, grid);
    const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.1);

    p.lng += (dx * ANIM_SCALE * dtScale) / cosLat;
    p.lat += dy * ANIM_SCALE * dtScale;

    p.trail.unshift([p.lng, p.lat]);
    const speed = Math.sqrt(dx * dx + dy * dy); // == wind_speed_kmh at this cell
    const maxTrail =
      speed > TRAIL_SPEED_REF
        ? Math.max(2, Math.round(TRAIL_LENGTH * Math.sqrt(TRAIL_SPEED_REF / speed)))
        : TRAIL_LENGTH;
    if (p.trail.length > maxTrail) p.trail.length = maxTrail;
    p.age++;

    // OOB against the full static grid bbox — particles live freely across
    // the viewport and only die when they leave the wind-data area entirely.
    // Respawn within the current viewport so density stays high when zoomed in.
    const oob =
      p.lng < SPAWN_LNG_MIN ||
      p.lng > SPAWN_LNG_MAX ||
      p.lat < SPAWN_LAT_MIN ||
      p.lat > SPAWN_LAT_MAX;

    if (p.age >= p.maxAge || oob) {
      const fresh = spawnParticle(spawnViewport, gridMap, false);
      p.lng = fresh.lng;
      p.lat = fresh.lat;
      p.age = 0;
      p.maxAge = fresh.maxAge;
      p.trail = [];
      p.color = fresh.color;
    }
  }
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useWindParticles(
  overlay: MapboxOverlay | null,
  map: mapboxgl.Map | null,
  wind: WindReading[] | undefined,
  config: { visible: boolean; opacity: number },
  aqGrid?: PM25GridPoint[] | null,
): void {
  // Use a single mutable ref object to avoid stale closure issues in the rAF loop.
  const stateRef = useRef({
    particles: [] as Particle[],
    grid: null as WindGrid | null,
    gridMap: null as Map<string, number> | null,
    visible: config.visible,
    opacity: config.opacity,
    zoom: BASE_ZOOM,
    viewport: FULL_VIEWPORT,
  });

  // Keep config in sync without restarting the animation loop.
  stateRef.current.visible = config.visible;
  stateRef.current.opacity = config.opacity;

  // Track map zoom/viewport for particle spawning and OOB culling.
  useEffect(() => {
    if (!map) return;
    stateRef.current.zoom = map.getZoom();
    stateRef.current.viewport = mapViewport(map);
    const onMove = () => {
      stateRef.current.zoom = map.getZoom();
      stateRef.current.viewport = mapViewport(map);
    };
    map.on('zoom', onMove);
    map.on('move', onMove);
    return () => {
      map.off('zoom', onMove);
      map.off('move', onMove);
    };
  }, [map]);

  // Clear the overlay when wind data is unavailable (e.g. 404 on dates with no ingest).
  useEffect(() => {
    if (!overlay || wind?.length) return;
    overlay.setProps({ layers: [] });
  }, [wind, overlay]);

  // Rebuild PM2.5 lookup map whenever CAMS grid changes.
  // Uses integer index keys (same 0.4° grid as wind) — O(1) spawn lookup.
  useEffect(() => {
    if (!aqGrid?.length) {
      stateRef.current.gridMap = null;
      return;
    }
    const map = new Map<string, number>();
    for (const p of aqGrid) {
      const lngIdx = Math.round((p.lng - GRID_LNG_MIN) / GRID_STEP);
      const latIdx = Math.round((p.lat - GRID_LAT_MIN) / GRID_STEP);
      map.set(`${lngIdx},${latIdx}`, p.pm25);
    }
    stateRef.current.gridMap = map;
    // Recolor existing particles immediately so particles spawned before CAMS
    // loaded don't stay white until they happen to die and respawn.
    for (const p of stateRef.current.particles) {
      p.color = sampleSpawnColor(p.lng, p.lat, map);
    }
  }, [aqGrid]);

  // Rebuild grid and reset particles whenever wind data changes.
  useEffect(() => {
    if (!wind?.length) return;
    stateRef.current.grid = buildGrid(wind);
    stateRef.current.particles = initParticles(stateRef.current.viewport, stateRef.current.gridMap);
  }, [wind]);

  // Animation loop — runs as long as the overlay, map, and wind data are present.
  // Visibility changes are handled inside the tick to avoid restarting the loop.
  useEffect(() => {
    if (!overlay || !map || !wind?.length) return;
    const ov = overlay; // capture non-null reference for the rAF closure

    let animId: number;
    let lastTime = 0;

    function tick(time: number) {
      const dt = lastTime ? Math.min(time - lastTime, 50) : 16.67;
      lastTime = time;

      const { grid, gridMap, particles, visible, opacity, zoom, viewport } = stateRef.current;

      if (!visible || !grid) {
        ov.setProps({ layers: [] });
      } else {
        const zoomScale = Math.pow(2, BASE_ZOOM - zoom);
        const dtScale = (dt / 16.67) * zoomScale;
        stepParticles(particles, grid, dtScale, viewport, gridMap);

        const layer = new PathLayer<Particle>({
          id: 'wind-particles',
          data: particles.filter((p) => p.trail.length >= 2),
          getPath: (p) => p.trail,
          getColor: (p) =>
            [...p.color, Math.round(opacity * 220 * (1 - p.age / p.maxAge))] as [
              number,
              number,
              number,
              number,
            ],
          widthUnits: 'pixels',
          getWidth: 2,
          parameters: { depthCompare: 'always' as const },
          pickable: false,
        });

        ov.setProps({ layers: [layer] });
      }

      animId = requestAnimationFrame(tick);
    }

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [overlay, map, wind]);
}
