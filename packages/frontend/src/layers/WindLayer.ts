import { PathLayer } from 'deck.gl';
import type { Layer } from 'deck.gl';
import type { WindVector } from '@thailand-aq/types';

const ARROW_COLOR: [number, number, number, number] = [180, 215, 255, 180];
const ARROW_WIDTH = 1.5; // pixels
const CALM_THRESHOLD = 0.5; // km/h — skip effectively-zero winds

// directionDeg is meteorological FROM-direction; add 180° to get travel direction.
function travelRad(d: WindVector): number {
  return (((d.directionDeg + 180) % 360) * Math.PI) / 180;
}

function arrowTip(d: WindVector): [number, number] {
  const rad = travelRad(d);
  const len = Math.min((d.speedKmh / 50) * 1.0, 1.2);
  return [d.lng + Math.sin(rad) * len, d.lat + Math.cos(rad) * len];
}

export function createWindLayer(data: WindVector[], opacity: number, beforeId?: string): Layer[] {
  const active = data.filter((d) => d.speedKmh >= CALM_THRESHOLD);

  const shared = {
    opacity,
    getColor: ARROW_COLOR,
    widthUnits: 'pixels' as const,
    getWidth: ARROW_WIDTH,
    parameters: { depthCompare: 'always' as const },
    pickable: false,
    ...({ beforeId } as object),
  };

  const shafts = new PathLayer<WindVector>({
    id: 'wind-shafts',
    data: active,
    getPath: (d) => [[d.lng, d.lat], arrowTip(d)],
    ...shared,
  });

  const heads = new PathLayer<WindVector>({
    id: 'wind-heads',
    data: active,
    getPath: (d) => {
      const rad = travelRad(d);
      const tip = arrowTip(d);
      const headLen = Math.min((d.speedKmh / 50) * 1.0, 1.2) * 0.35;
      const leftAngle = rad + Math.PI - Math.PI / 6;
      const rightAngle = rad + Math.PI + Math.PI / 6;
      const left: [number, number] = [
        tip[0] + Math.sin(leftAngle) * headLen,
        tip[1] + Math.cos(leftAngle) * headLen,
      ];
      const right: [number, number] = [
        tip[0] + Math.sin(rightAngle) * headLen,
        tip[1] + Math.cos(rightAngle) * headLen,
      ];
      return [left, tip, right];
    },
    ...shared,
  });

  return [shafts, heads];
}
