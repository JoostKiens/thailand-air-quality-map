import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createOverlay, type OverlayInstance } from '../../lib/deck-overlay';
import { useLayerStore } from '../../store/layerStore';
import { useFires } from '../../hooks/useFires';
import { useAQI } from '../../hooks/useAQI';
import { useAQGrid } from '../../hooks/useAQGrid';
import { createFiresLayer } from '../../layers/FiresLayer';
import {
  createLandMaskLayer,
  createPM25HeatmapLayer,
  createPM25StationsLayer,
} from '../../layers/PM25Layer';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CENTER: [number, number] = [101.0, 15.5];
const ZOOM = 5.5;
const MIN_ZOOM = 4.0;
// Data bbox [92,5,110,28] with 3° padding on each side
const MAX_BOUNDS: mapboxgl.LngLatBoundsLike = [89, 1, 114, 30];

// Find the first Mapbox layer that represents admin boundaries or labels.
// Deck.gl layers are inserted BEFORE this layer, so all borders and labels
// remain legible on top of the data layers.
function detectBeforeId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle().layers ?? [];
  return layers.find((l) => l.id.startsWith('admin') || l.type === 'symbol')?.id;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const beforeIdRef = useRef<string | undefined>(undefined);
  const [overlay, setOverlay] = useState<OverlayInstance | null>(null);

  const { data: fires } = useFires();
  const { data: aqi } = useAQI();
  const { data: aqGrid } = useAQGrid();
  const firesConfig = useLayerStore((s) => s.layers.fires);
  const pm25Config = useLayerStore((s) => s.layers.pm25);

  // Rebuild and push Deck.gl layers whenever data, visibility, or overlay changes.
  useEffect(() => {
    if (!overlay) return;
    const beforeId = beforeIdRef.current;
    const layers = [];
    if (pm25Config.visible) {
      layers.push(createLandMaskLayer(beforeId)); // mask layer must precede the masked layer
      if (aqGrid) layers.push(createPM25HeatmapLayer(aqGrid, beforeId));
      if (aqi) layers.push(createPM25StationsLayer(aqi, beforeId));
    }
    if (firesConfig.visible && fires) {
      layers.push(createFiresLayer(fires, firesConfig.opacity, beforeId));
    }
    overlay.setProps({ layers });
  }, [overlay, fires, firesConfig.visible, firesConfig.opacity, aqi, aqGrid, pm25Config.visible]);

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

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

    // Create the overlay only after the style has loaded so we can detect the
    // first admin/symbol layer ID. This ensures admin boundaries, country
    // borders, and all place labels render on top of the Deck.gl data layers.
    map.on('load', () => {
      if (!mounted) return;
      beforeIdRef.current = detectBeforeId(map);
      const ov = createOverlay({ layers: [] });
      map.addControl(ov);
      setOverlay(ov);
    });

    mapRef.current = map;

    return () => {
      mounted = false;
      map.remove();
      setOverlay(null);
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
