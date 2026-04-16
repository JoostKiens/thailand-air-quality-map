import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';

export type { MapboxOverlayProps };

export type OverlayInstance = mapboxgl.IControl & {
  setProps: (props: MapboxOverlayProps) => void;
};

// interleaved: true renders Deck.gl inside Mapbox's WebGL context, eliminating
// the canvas synchronization shift that occurs during zoom/pan animations.
// In interleaved mode, beforeId must be set on each individual deck.gl layer
// (not on the overlay) to control its position in the Mapbox layer stack.
export function createOverlay(props: MapboxOverlayProps): OverlayInstance {
  return new MapboxOverlay({ ...props, interleaved: true }) as unknown as OverlayInstance;
}
