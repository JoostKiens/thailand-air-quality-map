import { ScatterplotLayer } from 'deck.gl';
import type { FirePoint } from '@thailand-aq/types';

const FIRE_COLOR: [number, number, number, number] = [249, 115, 22, 255]; // orange

export function createFiresLayer(data: FirePoint[], opacity: number, beforeId?: string) {
  return new ScatterplotLayer<FirePoint>({
    id: 'fires',
    data,
    opacity,
    getPosition: (d) => [d.lng, d.lat],
    radiusUnits: 'meters',
    getRadius: (d) => 375 + Math.sqrt(d.frp ?? 0) * 150,
    getFillColor: FIRE_COLOR,
    radiusMinPixels: 2,
    pickable: true,
    parameters: { depthCompare: 'always' },
    ...({ beforeId } as object),
  });
}
