import { ScatterplotLayer } from 'deck.gl';
import type { Layer, PickingInfo } from 'deck.gl';
import type { FirePoint } from '@thailand-aq/types';

type RGB = [number, number, number];
type RGBA4 = [number, number, number, number];

// Halo ring definitions — tweak these to adjust the bloom look.
const OUTER_GLOW = { mult: 4, color: [255, 68, 0] as RGB, alpha: 20 }; // #ff4400, ~8%
const MID_HALO = { mult: 2, color: [255, 170, 0] as RGB, alpha: 89 }; // #ffaa00, ~35%
const INNER_CORE = { mult: 1, color: [255, 245, 204] as RGB, alpha: 230 }; // #fff5cc, ~90%

const RINGS = [OUTER_GLOW, MID_HALO, INNER_CORE] as const;

// Additive blending: each fragment adds to the framebuffer instead of replacing it.
// Overlapping halos accumulate — dense fire clusters bloom brighter.
const ADDITIVE_BLEND = {
  depthCompare: 'always',
  depthWriteEnabled: false,
  blend: true,
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendColorOperation: 'add',
  blendAlphaSrcFactor: 'src-alpha',
  blendAlphaDstFactor: 'one',
  blendAlphaOperation: 'add',
} as const;

// Map brightTi4 (brightness temp K, ~300 background) to a radius scale factor.
// 300 K → 0.6×, 500 K → 2.0×, clamped at both ends.
function intensityMultiplier(d: FirePoint): number {
  if (d.brightTi4 === null) return 1.0;
  return Math.min(2.0, Math.max(0.6, 0.6 + ((d.brightTi4 - 300) / 200) * 1.4));
}

function ringColor(ring: (typeof RINGS)[number], d: FirePoint): RGBA4 {
  const a = d.confidence === 'low' ? ring.alpha * 0.5 : ring.alpha;
  return [...ring.color, Math.round(a)];
}

/**
 * Returns three additive-blended ScatterplotLayers (outer glow → mid halo → inner core)
 * that render each fire point as a firefly/bloom effect. Layers use GL additive blending
 * so overlapping points accumulate light — dense clusters naturally appear brighter.
 * Intensity scales with `brightTi4`; low-confidence points render at half opacity.
 */
export function baseRadiusForZoom(zoom: number): number {
  if (zoom >= 11) return 6;
  if (zoom >= 8) return 3;
  return 1;
}

export function createFiresLayer(
  data: FirePoint[],
  opacity: number,
  zoom: number,
  onClick: (info: PickingInfo) => void,
  beforeId?: string,
  radiusScale = 1,
): Layer[] {
  const baseRadius = baseRadiusForZoom(zoom);
  return RINGS.map(
    (ring, i) =>
      new ScatterplotLayer<FirePoint>({
        id: ['fire-outer-glow', 'fire-mid-halo', 'fire-inner-core'][i],
        data,
        opacity,
        getPosition: (d) => [d.lng, d.lat],
        radiusUnits: 'pixels',
        getRadius: (d) => ring.mult * baseRadius * intensityMultiplier(d),
        radiusScale,
        getFillColor: (d) => ringColor(ring, d),
        updateTriggers: { getRadius: baseRadius },
        parameters: ADDITIVE_BLEND,
        // All rings are pickable with onHover so isHovering covers the full glow area;
        // onClick is wired only on the inner core to avoid duplicate events.
        pickable: true,
        onHover: (info) => !!info.picked,
        onClick: i === 2 ? onClick : undefined,
        ...({ beforeId } as object),
      }),
  );
}
