import { IconLayer } from 'deck.gl';
import type { Layer, PickingInfo } from 'deck.gl';
import type { PowerPlantCollection, PowerPlantFeature } from '@thailand-aq/types';

export const FUEL_COLORS: Record<string, string> = {
  Coal: '#999999',
  Gas: '#4a9edd',
  Oil: '#d4a017',
};

const FUELS = ['Coal', 'Gas', 'Oil'];

function buildAtlas(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  FUELS.forEach((fuel, i) => {
    const cx = i * 32 + 16;
    const cy = 16;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.strokeStyle = FUEL_COLORS[fuel]!;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  return canvas.toDataURL();
}

const ATLAS = buildAtlas();

const ICON_MAPPING = {
  Coal: { x: 0, y: 0, width: 32, height: 32, anchorY: 16 },
  Gas: { x: 32, y: 0, width: 32, height: 32, anchorY: 16 },
  Oil: { x: 64, y: 0, width: 32, height: 32, anchorY: 16 },
};

export function createPowerPlantsLayer(
  data: PowerPlantCollection,
  opacity: number,
  onHover: (info: PickingInfo) => void,
  beforeId?: string,
): Layer {
  return new IconLayer<PowerPlantFeature>({
    id: 'power-plants',
    data: data.features,
    iconAtlas: ATLAS,
    iconMapping: ICON_MAPPING,
    getPosition: (d) => d.geometry.coordinates,
    getIcon: (d) => d.properties.fuel_type,
    getSize: 24,
    opacity,
    pickable: true,
    onHover,
    parameters: { depthCompare: 'always' as const },
    ...({ beforeId } as object),
  });
}
