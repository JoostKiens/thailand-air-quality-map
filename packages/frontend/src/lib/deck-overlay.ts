 
import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';

export type { MapboxOverlayProps };

export type OverlayInstance = mapboxgl.IControl & {
  setProps: (props: MapboxOverlayProps) => void;
};

export function createOverlay(props: MapboxOverlayProps): OverlayInstance {
  return new MapboxOverlay(props) as unknown as OverlayInstance;
}
