import type { PM25GridPoint, WindVector } from '@thailand-aq/types';

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

export function degToCompass(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}

// AQ grid is 0.4° — only return a cell if the click is within 0.2° (half cell)
export function findNearestAQPoint(
  grid: PM25GridPoint[],
  lng: number,
  lat: number,
): PM25GridPoint | null {
  if (!grid.length) return null;
  let best: PM25GridPoint | null = null;
  let bestDist = Infinity;
  for (const p of grid) {
    const d = (p.lng - lng) ** 2 + (p.lat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return bestDist <= 0.04 ? best : null; // 0.2° radius
}

export function findNearestWind(
  vectors: WindVector[],
  lng: number,
  lat: number,
): WindVector | null {
  if (!vectors.length) return null;
  let best: WindVector | null = null;
  let bestDist = Infinity;
  for (const v of vectors) {
    const d = (v.lng - lng) ** 2 + (v.lat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}
