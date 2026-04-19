import { useRef, useEffect, useState } from 'react';
import type { PickingInfo } from 'deck.gl';
import type { FirePoint, PowerPlantFeature } from '@thailand-aq/types';
import type { LatestMeasurement } from '../../hooks/useAQI';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createOverlay, type OverlayInstance } from '../../lib/deck-overlay';
import { useLayerStore } from '../../store/layerStore';
import { useUIStore } from '../../store/uiStore';
import { useFires } from '../../hooks/useFires';
import { useAQI } from '../../hooks/useAQI';
import { useAQGrid } from '../../hooks/useAQGrid';
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

  const { data: fires } = useFires();
  const { data: aqi } = useAQI();
  const { data: aqGrid } = useAQGrid();
  const { data: wind } = useWind();
  const { data: powerPlants } = usePowerPlants();

  const aqGridConfig = useLayerStore((s) => s.layers.aqGrid);
  const aqStationsConfig = useLayerStore((s) => s.layers.aqStations);
  const firesConfig = useLayerStore((s) => s.layers.fires);
  const windConfig = useLayerStore((s) => s.layers.wind);
  const powerPlantsConfig = useLayerStore((s) => s.layers.powerPlants);

  const deckPickedRef = useRef(false);

  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSelectedPoint = useUIStore((s) => s.setSelectedPoint);
  const zoom = useUIStore((s) => s.mapZoom);
  const setMapZoom = useUIStore((s) => s.setMapZoom);

  useWindParticles(map, wind, windConfig);

  // Sync map padding with sidebar state
  useEffect(() => {
    if (!map) return;
    map.easeTo({ padding: { left: sidebarOpen ? 240 : 0 }, duration: 300 });
  }, [map, sidebarOpen]);

  // Rebuild Deck.gl layers on data/visibility/zoom changes
  useEffect(() => {
    if (!overlay) return;
    const beforeId = beforeIdRef.current;
    const layers = [];

    const onFireClick = (info: PickingInfo) => {
      if (!info.object) return;
      const d = info.object as FirePoint;
      deckPickedRef.current = true;
      setSelectedPoint({
        lngLat: [d.lng, d.lat],
        fire: {
          frp: d.frp,
          confidence: d.confidence,
          countryId: d.countryId,
          detectedAt: d.detectedAt,
        },
      });
    };

    const onStationClick = (info: PickingInfo) => {
      if (!info.object) return;
      const feat = info.object as { properties: { cluster?: boolean } & LatestMeasurement };
      if (feat.properties.cluster) return;
      const d = feat.properties;
      deckPickedRef.current = true;
      setSelectedPoint({
        lngLat: [d.lng, d.lat],
        station: {
          stationName: d.stationName,
          pm25: d.value,
          unit: d.unit,
          measuredAt: d.measuredAt,
        },
      });
    };

    const onPowerPlantClick = (info: PickingInfo) => {
      if (!info.object) return;
      const feat = info.object as PowerPlantFeature;
      const p = feat.properties;
      deckPickedRef.current = true;
      setSelectedPoint({
        lngLat: [feat.geometry.coordinates[0], feat.geometry.coordinates[1]],
        powerPlant: { name: p.name, fuelType: p.fuel_type, capacityMw: p.capacity_mw },
      });
    };

    if (aqGridConfig.visible) {
      layers.push(createLandMaskLayer(beforeId));
      if (aqGrid) layers.push(createPM25BitmapLayer(aqGrid, beforeId));
    }

    if (powerPlantsConfig.visible && powerPlants) {
      layers.push(
        createPowerPlantsLayer(powerPlants, powerPlantsConfig.opacity, onPowerPlantClick, beforeId),
      );
    }

    if (firesConfig.visible && fires) {
      layers.push(...createFiresLayer(fires, firesConfig.opacity, zoom, onFireClick, beforeId));
    }

    if (aqStationsConfig.visible && aqi) {
      layers.push(...createPM25StationsLayers(aqi, zoom, onStationClick, beforeId));
    }

    // getCursor overrides MapboxOverlay's default (which ignores isHovering entirely).
    // isHovering is true when a pickable layer's onHover returned true — so each
    // layer's onHover must return !!info.picked for this to work correctly.
    overlay.setProps({
      layers,
      getCursor: ({ isHovering }: { isDragging: boolean; isHovering: boolean }) =>
        isHovering ? 'pointer' : 'grab',
    });
  }, [
    overlay,
    fires,
    firesConfig.visible,
    firesConfig.opacity,
    aqi,
    aqGrid,
    aqGridConfig.visible,
    aqStationsConfig.visible,
    zoom,
    powerPlants,
    powerPlantsConfig.visible,
    powerPlantsConfig.opacity,
    setSelectedPoint,
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
      mapInstance.setPadding({ left: 240 });
      beforeIdRef.current = detectBeforeId(mapInstance);
      const ov = createOverlay({ layers: [] });
      mapInstance.addControl(ov);
      setMapZoom(mapInstance.getZoom());
      setOverlay(ov);
      setMap(mapInstance);
    });

    mapInstance.on('zoomend', () => {
      if (mounted) setMapZoom(mapInstance.getZoom());
    });

    mapInstance.on('click', () => {
      if (!mounted) return;
      if (deckPickedRef.current) {
        deckPickedRef.current = false;
        return;
      }
      setSelectedPoint(null);
    });

    mapRef.current = mapInstance;

    return () => {
      mounted = false;
      setMap(null);
      setOverlay(null);
      mapInstance.remove();
    };
  }, [setSelectedPoint, setMapZoom]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
