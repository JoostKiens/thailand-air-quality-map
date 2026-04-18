import { ScatterplotLayer } from 'deck.gl';
import type { FirePoint } from '@thailand-aq/types';

const ZOOM_LOW = 7; // below this: nominal+high confidence only, capped radius
const ZOOM_HIGH = 9; // above this: all confidence, fire type colors, uncapped radius

type RGBA4 = [number, number, number, number];

// Fire type colors — differentiation only shown at high zoom (>= ZOOM_HIGH)
const FIRE_TYPE_COLORS: Record<number, RGBA4> = {
  0: [249, 115, 22, 255], // vegetation: orange
  2: [6, 182, 212, 255], // industrial/static land: cyan
  3: [251, 191, 36, 255], // offshore: amber
};
const FIRE_COLOR_DEFAULT: RGBA4 = [249, 115, 22, 255];

// Progressively include lower-confidence detections as zoom increases.
// At the default view (5.5) nominal+high gives enough density for the regional texture
// impression without flooding the map with uncertain points.
function filterByConfidence(data: FirePoint[], zoom: number): FirePoint[] {
  if (zoom < ZOOM_LOW) return data.filter((d) => d.confidence !== 'low'); // nominal + high
  return data; // all confidence at mid/high zoom
}

// Use brightTi4 (brightness temp in K, background ~300 K) as primary intensity signal.
// Falls back to frp-based formula when brightTi4 is unavailable.
const RADIUS_CAP_M = 2000;

function fireRadius(d: FirePoint): number {
  if (d.brightTi4 !== null) {
    return Math.min(Math.sqrt(Math.max(0, d.brightTi4 - 300)) * 120, RADIUS_CAP_M);
  }
  return Math.min(375 + Math.sqrt(d.frp ?? 0) * 150, RADIUS_CAP_M);
}

export function createFiresLayer(
  data: FirePoint[],
  opacity: number,
  zoom: number,
  beforeId?: string,
) {
  const filtered = filterByConfidence(data, zoom);
  const isLow = zoom < ZOOM_LOW;
  const isHigh = zoom >= ZOOM_HIGH;

  // At high zoom: no pixel cap so geometric radius shows full detail.
  // At mid zoom: cap at 10px so individual points stay legible but don't flood the map.
  // At low zoom: cap at 3px — reads as a texture/heatmap rather than individual points.
  const radiusCap = isLow ? { radiusMaxPixels: 3 } : isHigh ? {} : { radiusMaxPixels: 10 };

  return new ScatterplotLayer<FirePoint>({
    id: 'fires',
    data: filtered,
    opacity: isLow ? opacity * 0.7 : opacity,
    getPosition: (d) => [d.lng, d.lat],
    radiusUnits: 'meters',
    getRadius: fireRadius,
    radiusMinPixels: 2,
    ...radiusCap,
    getFillColor: isHigh
      ? (d) => FIRE_TYPE_COLORS[d.fireType ?? 0] ?? FIRE_COLOR_DEFAULT
      : FIRE_COLOR_DEFAULT,
    pickable: true,
    parameters: { depthCompare: 'always' },
    ...({ beforeId } as object),
  });
}
