import { ScatterplotLayer } from 'deck.gl';
import type { FirePoint } from '@thailand-aq/types';

type RGBA = [number, number, number, number];

const COUNTRY_COLORS: Record<string, RGBA> = {
  MMR: [239, 68, 68, 255], // red
  LAO: [249, 115, 22, 255], // orange
  THA: [234, 179, 8, 255], // yellow
  KHM: [168, 85, 247, 255], // purple
};
const DEFAULT_COLOR: RGBA = [107, 114, 128, 255]; // gray — used when country_id is null

export function createFiresLayer(data: FirePoint[], opacity: number) {
  return new ScatterplotLayer<FirePoint>({
    id: 'fires',
    data,
    opacity,
    getPosition: (d) => [d.lng, d.lat],
    getRadius: (d) => 500 + (d.frp ?? 0) * 200,
    getFillColor: (d) => COUNTRY_COLORS[d.countryId] ?? DEFAULT_COLOR,
    radiusMinPixels: 3,
    radiusMaxPixels: 30,
    pickable: true,
    parameters: { depthCompare: 'always' },
  });
}
