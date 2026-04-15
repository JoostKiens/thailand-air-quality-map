import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';

export type { MapboxOverlayProps };

export type OverlayInstance = mapboxgl.IControl & {
  setProps: (props: MapboxOverlayProps) => void;
};

// MapboxOverlay accepts `beforeId` at runtime but it is not in the published type
// definition. Cast through `any` to pass it without a TS error.
// interleaved: true renders Deck.gl inside Mapbox's WebGL context, eliminating
// the canvas synchronization shift that occurs during zoom/pan animations.
// beforeId inserts all deck.gl layers below this Mapbox layer ID, so country
// borders, admin boundaries, and place labels remain legible on top.
export function createOverlay(props: MapboxOverlayProps, beforeId?: string): OverlayInstance {
  // `beforeId` is a valid runtime prop of MapboxOverlay but is absent from the
  // published type definition. Cast through an untyped constructor to pass it.
  const Ctor = MapboxOverlay as unknown as new (props: Record<string, unknown>) => OverlayInstance;
  return new Ctor({ ...props, interleaved: true, beforeId });
}
