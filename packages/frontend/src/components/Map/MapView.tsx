import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createOverlay, type OverlayInstance } from '../../lib/deck-overlay';
import { useLayerStore } from '../../store/layerStore';
import { useFires } from '../../hooks/useFires';
import { useAQI } from '../../hooks/useAQI';
import { createFiresLayer } from '../../layers/FiresLayer';
import { createPM25Layer } from '../../layers/PM25Layer';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CENTER: [number, number] = [101.0, 15.5];
const ZOOM = 5.5;
const MIN_ZOOM = 4.0;
// Data bbox [97,5,110,28] with 3° padding on each side
const MAX_BOUNDS: mapboxgl.LngLatBoundsLike = [90, 1, 111, 29];

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<OverlayInstance | null>(null);

  const { data: fires } = useFires();
  const { data: aqi } = useAQI();
  const firesConfig = useLayerStore((s) => s.layers.fires);
  const pm25Config = useLayerStore((s) => s.layers.pm25);

  // Rebuild and push Deck.gl layers whenever data or visibility changes
  useEffect(() => {
    if (!overlayRef.current) return;
    const layers = [];
    if (pm25Config.visible && aqi) {
      layers.push(...createPM25Layer(aqi));
    }
    if (firesConfig.visible && fires) {
      layers.push(createFiresLayer(fires, firesConfig.opacity));
    }
    overlayRef.current.setProps({ layers });
  }, [
    fires,
    firesConfig.visible,
    firesConfig.opacity,
    aqi,
    pm25Config.visible,
    pm25Config.opacity,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: CENTER,
      zoom: ZOOM,
      minZoom: MIN_ZOOM,
      maxBounds: MAX_BOUNDS,
      accessToken: TOKEN,
      projection: 'mercator',
    });

    const overlay = createOverlay({ layers: [] });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.remove();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
