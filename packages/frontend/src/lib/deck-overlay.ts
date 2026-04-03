import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';

export type { MapboxOverlayProps };

export type OverlayInstance = mapboxgl.IControl & {
  setProps: (props: MapboxOverlayProps) => void;
};

export function createOverlay(props: MapboxOverlayProps): OverlayInstance {
  // interleaved: true renders Deck.gl inside Mapbox's WebGL context, eliminating
  // the canvas synchronisation shift that occurs during zoom/pan animations.
  return new MapboxOverlay({ ...props, interleaved: true }) as unknown as OverlayInstance;
}
