import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { PathLayer } from 'deck.gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { WindVector } from '@thailand-aq/types';

// ─── constants ────────────────────────────────────────────────────────────────

const N_PARTICLES = 1500;
const TRAIL_LENGTH = 10;
// Degrees of movement per frame per km/h of wind speed (at 60 fps).
// Tuned so a 15 km/h breeze visually crosses the region in ~15 s.
const ANIM_SCALE = 0.003;
const MIN_AGE = 80;
const MAX_AGE = 220;
const COLOR: [number, number, number] = [180, 215, 255];

// Grid bounds — extend one step beyond the viewport so interpolation has full
// coverage at every corner. Must match LNG_POINTS/LAT_POINTS in openmeteo.ts.
const GRID_LNG_MIN = 88;
const GRID_LNG_MAX = 114;
const GRID_LAT_MIN = 0;
const GRID_LAT_MAX = 30;
const GRID_STEP = 2;
const GRID_LNG_COUNT = (GRID_LNG_MAX - GRID_LNG_MIN) / GRID_STEP + 1; // 14
const GRID_LAT_COUNT = (GRID_LAT_MAX - GRID_LAT_MIN) / GRID_STEP + 1; // 16

// Spawn/OOB bounds — the actual visible viewport (VIEWPORT_BBOX).
const SPAWN_LNG_MIN = 89;
const SPAWN_LNG_MAX = 114;
const SPAWN_LAT_MIN = 1;
const SPAWN_LAT_MAX = 30;

// ─── types ────────────────────────────────────────────────────────────────────

interface Particle {
  lng: number;
  lat: number;
  age: number;
  maxAge: number;
  trail: [number, number][];
}

// Flat grid: index = latIdx * GRID_LNG_COUNT + lngIdx
// Each cell stores precomputed travel-direction velocity components (km/h).
type WindGrid = Float32Array; // [dx0, dy0, dx1, dy1, ...]

// ─── grid helpers ─────────────────────────────────────────────────────────────

function buildGrid(data: WindVector[]): WindGrid {
  const grid = new Float32Array(GRID_LNG_COUNT * GRID_LAT_COUNT * 2);
  for (const v of data) {
    const lngIdx = Math.round((v.lng - GRID_LNG_MIN) / GRID_STEP);
    const latIdx = Math.round((v.lat - GRID_LAT_MIN) / GRID_STEP);
    if (lngIdx < 0 || lngIdx >= GRID_LNG_COUNT || latIdx < 0 || latIdx >= GRID_LAT_COUNT) continue;
    const travelRad = (((v.directionDeg + 180) % 360) * Math.PI) / 180;
    const base = (latIdx * GRID_LNG_COUNT + lngIdx) * 2;
    grid[base] = Math.sin(travelRad) * v.speedKmh; // dx (east positive)
    grid[base + 1] = Math.cos(travelRad) * v.speedKmh; // dy (north positive)
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

// ─── particle helpers ─────────────────────────────────────────────────────────

function spawnParticle(scatterAge = false): Particle {
  const maxAge = MIN_AGE + Math.floor(Math.random() * (MAX_AGE - MIN_AGE));
  return {
    lng: SPAWN_LNG_MIN + Math.random() * (SPAWN_LNG_MAX - SPAWN_LNG_MIN),
    lat: SPAWN_LAT_MIN + Math.random() * (SPAWN_LAT_MAX - SPAWN_LAT_MIN),
    age: scatterAge ? Math.floor(Math.random() * maxAge) : 0,
    maxAge,
    trail: [],
  };
}

function initParticles(): Particle[] {
  // scatterAge=true distributes initial ages so they don't all fade out simultaneously
  return Array.from({ length: N_PARTICLES }, () => spawnParticle(true));
}

function stepParticles(particles: Particle[], grid: WindGrid, dtScale: number): void {
  for (const p of particles) {
    const [dx, dy] = sampleWind(p.lng, p.lat, grid);
    const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.1);

    p.lng += (dx * ANIM_SCALE * dtScale) / cosLat;
    p.lat += dy * ANIM_SCALE * dtScale;

    p.trail.unshift([p.lng, p.lat]);
    if (p.trail.length > TRAIL_LENGTH) p.trail.length = TRAIL_LENGTH;
    p.age++;

    const oob =
      p.lng < SPAWN_LNG_MIN ||
      p.lng > SPAWN_LNG_MAX ||
      p.lat < SPAWN_LAT_MIN ||
      p.lat > SPAWN_LAT_MAX;

    if (p.age >= p.maxAge || oob) {
      const fresh = spawnParticle(false);
      p.lng = fresh.lng;
      p.lat = fresh.lat;
      p.age = 0;
      p.maxAge = fresh.maxAge;
      p.trail = [];
    }
  }
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useWindParticles(
  map: mapboxgl.Map | null,
  wind: WindVector[] | undefined,
  config: { visible: boolean; opacity: number },
): void {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // Use a single mutable ref object to avoid stale closure issues in the rAF loop.
  const stateRef = useRef({
    particles: [] as Particle[],
    grid: null as WindGrid | null,
    visible: config.visible,
    opacity: config.opacity,
  });

  // Keep config in sync without restarting the animation loop.
  stateRef.current.visible = config.visible;
  stateRef.current.opacity = config.opacity;

  // Non-interleaved overlay: renders on its own canvas above the map, fully
  // independent of the main interleaved overlay. Two interleaved overlays on
  // the same map conflict in Mapbox's render loop — this avoids that entirely.
  useEffect(() => {
    if (!map) return;
    const ov = new MapboxOverlay({ layers: [] });
    map.addControl(ov);
    overlayRef.current = ov;
    return () => {
      map.removeControl(ov);
      overlayRef.current = null;
    };
  }, [map]);

  // Rebuild grid and reset particles whenever wind data changes.
  useEffect(() => {
    if (!wind?.length) return;
    stateRef.current.grid = buildGrid(wind);
    stateRef.current.particles = initParticles();
  }, [wind]);

  // Animation loop — runs as long as the map and wind data are present.
  // Visibility changes are handled inside the tick to avoid restarting the loop.
  useEffect(() => {
    if (!map || !wind?.length) return;

    let animId: number;
    let lastTime = 0;

    function tick(time: number) {
      const dt = lastTime ? Math.min(time - lastTime, 50) : 16.67;
      lastTime = time;

      const { grid, particles, visible, opacity } = stateRef.current;
      const ov = overlayRef.current;

      if (ov) {
        if (!visible || !grid) {
          ov.setProps({ layers: [] });
        } else {
          const dtScale = dt / 16.67;
          stepParticles(particles, grid, dtScale);

          const layer = new PathLayer<Particle>({
            id: 'wind-particles',
            data: particles.filter((p) => p.trail.length >= 2),
            getPath: (p) => p.trail,
            getColor: (p) =>
              [...COLOR, Math.round(opacity * 180 * (1 - p.age / p.maxAge))] as [
                number,
                number,
                number,
                number,
              ],
            widthUnits: 'pixels',
            getWidth: 1.5,
            parameters: { depthCompare: 'always' as const },
            pickable: false,
          });

          ov.setProps({ layers: [layer] });
        }
      }

      animId = requestAnimationFrame(tick);
    }

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [map, wind]);
}
