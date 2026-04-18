import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { PickingInfo } from 'deck.gl';
import { createOverlay, type OverlayInstance } from '../../lib/deck-overlay';
import { useLayerStore } from '../../store/layerStore';
import { useFires } from '../../hooks/useFires';
import { useAQI } from '../../hooks/useAQI';
import { useAQGrid } from '../../hooks/useAQGrid';
import { AQILegend } from './AQILegend';
import { VIEWPORT_BBOX } from '../../lib/bbox';
import { createFiresLayer } from '../../layers/FiresLayer';
import { useWind } from '../../hooks/useWind';
import { useWindParticles } from '../../hooks/useWindParticles';
import {
  createLandMaskLayer,
  createPM25BitmapLayer,
  createPM25StationsLayers,
} from '../../layers/PM25Layer';
import { usePowerPlants } from '../../hooks/usePowerPlants';
import { createPowerPlantsLayer } from '../../layers/PowerPlantsLayer';
import { LayerControl } from '../Sidebar/LayerControl';
import { PowerPlantTooltip, type HoverInfo } from './PowerPlantTooltip';
import { PowerPlantLegend } from './PowerPlantLegend';
import type { PowerPlantFeature } from '@thailand-aq/types';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CENTER: [number, number] = [101.0, 15.5];
const ZOOM = 5.5;
const MIN_ZOOM = 4.0;
const MAX_BOUNDS: mapboxgl.LngLatBoundsLike = [...VIEWPORT_BBOX];

function detectBeforeId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle().layers ?? [];
  return layers.find((l) => l.id.startsWith('admin') || l.type === 'symbol')?.id;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const beforeIdRef = useRef<string | undefined>(undefined);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [overlay, setOverlay] = useState<OverlayInstance | null>(null);
  const [zoom, setZoom] = useState(ZOOM);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo>({ plant: null, x: 0, y: 0 });

  const { data: fires } = useFires();
  const { data: aqi } = useAQI();
  const { data: aqGrid } = useAQGrid();
  const { data: wind } = useWind();
  const { data: powerPlants } = usePowerPlants();

  const firesConfig = useLayerStore((s) => s.layers.fires);
  const pm25Config = useLayerStore((s) => s.layers.pm25);
  const windConfig = useLayerStore((s) => s.layers.wind);
  const powerPlantsConfig = useLayerStore((s) => s.layers.powerPlants);

  useWindParticles(map, wind, windConfig);

  useEffect(() => {
    if (!overlay) return;
    const beforeId = beforeIdRef.current;
    const layers = [];

    if (pm25Config.visible) {
      layers.push(createLandMaskLayer(beforeId));
      if (aqGrid) layers.push(createPM25BitmapLayer(aqGrid, beforeId));
    }

    if (powerPlantsConfig.visible && powerPlants) {
      layers.push(
        createPowerPlantsLayer(
          powerPlants,
          powerPlantsConfig.opacity,
          (info: PickingInfo) => {
            setHoverInfo({
              plant: info.object as PowerPlantFeature | null,
              x: info.x,
              y: info.y,
            });
          },
          beforeId,
        ),
      );
    }

    if (firesConfig.visible && fires) {
      layers.push(...createFiresLayer(fires, firesConfig.opacity, zoom, beforeId));
    }

    if (pm25Config.visible && aqi) {
      layers.push(...createPM25StationsLayers(aqi, zoom));
    }

    overlay.setProps({ layers });
  }, [
    overlay,
    fires,
    firesConfig.visible,
    firesConfig.opacity,
    aqi,
    aqGrid,
    pm25Config.visible,
    zoom,
    powerPlants,
    powerPlantsConfig.visible,
    powerPlantsConfig.opacity,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    const mapInstance = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/joostkiens/cm30pk39v00ah01qz4n2i1ssu',
      center: CENTER,
      zoom: ZOOM,
      minZoom: MIN_ZOOM,
      maxBounds: MAX_BOUNDS,
      accessToken: TOKEN,
      projection: 'mercator',
    });

    mapInstance.on('load', () => {
      if (!mounted) return;
      beforeIdRef.current = detectBeforeId(mapInstance);
      const ov = createOverlay({ layers: [] });
      mapInstance.addControl(ov);
      setZoom(mapInstance.getZoom());
      setOverlay(ov);
      setMap(mapInstance);
    });

    mapInstance.on('zoomend', () => {
      if (mounted) setZoom(mapInstance.getZoom());
    });

    mapRef.current = mapInstance;

    return () => {
      mounted = false;
      setMap(null);
      setOverlay(null);
      mapInstance.remove();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          bottom: 32,
          left: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {pm25Config.visible && <AQILegend />}
        {powerPlantsConfig.visible && <PowerPlantLegend />}
      </div>
      <PowerPlantTooltip info={hoverInfo} />
      <LayerControl />
    </div>
  );
}
