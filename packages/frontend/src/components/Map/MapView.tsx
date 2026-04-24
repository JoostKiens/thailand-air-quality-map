import { useRef, useEffect, useState } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
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
  CLUSTER_MAX_ZOOM,
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
  // heatmapOverlay: interleaved — renders land-mask + pm25-bitmap inside Mapbox's
  // WebGL pipeline so beforeId can place them below admin boundary layers.
  const [heatmapOverlay, setHeatmapOverlay] = useState<OverlayInstance | null>(null);
  // dataOverlay: non-interleaved — renders fires, power plants, and AQI stations on
  // a separate canvas. Kept out of the interleaved pipeline so deck.gl never leaves
  // dirty WebGL blend state that would corrupt Mapbox's MSAA resolve of admin borders.
  const [dataOverlay, setDataOverlay] = useState<MapboxOverlay | null>(null);
  const [windOverlay, setWindOverlay] = useState<MapboxOverlay | null>(null);

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

  useWindParticles(windOverlay, map, wind, windConfig);

  // Sync map padding with sidebar state
  useEffect(() => {
    if (!map) return;
    map.easeTo({ padding: { left: sidebarOpen ? 240 : 0 }, duration: 300 });
  }, [map, sidebarOpen]);

  // Heatmap layers — interleaved overlay only; beforeId keeps them below admin borders.
  useEffect(() => {
    if (!heatmapOverlay) return;
    const beforeId = beforeIdRef.current;
    const layers = [];

    if (aqGridConfig.visible) {
      layers.push(createLandMaskLayer(beforeId));
      if (aqGrid) layers.push(createPM25BitmapLayer(aqGrid, beforeId));
    }

    heatmapOverlay.setProps({ layers });
  }, [heatmapOverlay, aqGrid, aqGridConfig.visible]);

  // Data layers — non-interleaved overlay; render on a separate canvas above Mapbox.
  useEffect(() => {
    if (!dataOverlay) return;
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
      const d = (info.object as { properties: LatestMeasurement }).properties;
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

    const onClusterClick = (
      _clusterId: number,
      lngLat: [number, number],
      expansionZoom: number,
      leaves: LatestMeasurement[],
    ) => {
      deckPickedRef.current = true;
      if (expansionZoom <= CLUSTER_MAX_ZOOM) {
        mapRef.current?.flyTo({ center: lngLat, zoom: expansionZoom, duration: 500 });
      } else {
        setSelectedPoint({
          lngLat,
          cluster: {
            stations: leaves.map((l) => ({
              stationId: l.stationId,
              stationName: l.stationName,
              pm25: l.value,
            })),
          },
        });
      }
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

    if (powerPlantsConfig.visible && powerPlants) {
      layers.push(
        createPowerPlantsLayer(powerPlants, powerPlantsConfig.opacity, onPowerPlantClick),
      );
    }

    if (firesConfig.visible && fires) {
      layers.push(...createFiresLayer(fires, firesConfig.opacity, zoom, onFireClick));
    }

    if (aqStationsConfig.visible && aqi) {
      layers.push(...createPM25StationsLayers(aqi, zoom, onStationClick, onClusterClick));
    }

    dataOverlay.setProps({ layers });
  }, [
    dataOverlay,
    fires,
    firesConfig.visible,
    firesConfig.opacity,
    aqi,
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

      // Non-interleaved canvases stack in addControl order (first = bottom).
      // Wind goes below data layers; heatmap is interleaved so order doesn't matter for it.
      const windOv = new MapboxOverlay({ layers: [] });
      mapInstance.addControl(windOv);
      const dataOv = new MapboxOverlay({ layers: [] });
      mapInstance.addControl(dataOv);
      const heatmapOv = createOverlay({ layers: [] });
      mapInstance.addControl(heatmapOv);

      // The deck.gl overlay *container* has pointer-events:none, but the canvas element
      // inside it inherits pointer-events:auto by default (pointer-events is not inherited
      // in CSS). That canvas sits on top of the Mapbox canvas and absorbs native mouse
      // events, so map.on('mousemove') never fires. Explicitly set pointer-events:none on
      // the deck.gl canvas so native events fall through to the Mapbox canvas, making
      // Mapbox's own event system (and our mousemove handler) work as intended.
      // deck.gl's _updateCursor() runs every animation frame and sets style.cursor = 'grab'
      // on its canvas via JavaScript. Any style.cursor assignment we make gets immediately
      // overridden. CSS !important in an author stylesheet outranks all JavaScript inline
      // style assignments (important author > normal inline per the CSS cascade), so we
      // inject one rule and toggle a class rather than fighting over style.cursor.
      const cursorOverride = document.createElement('style');
      cursorOverride.setAttribute('data-deck-cursor', '');
      cursorOverride.textContent =
        '.mapboxgl-map.deck-hovering .mapboxgl-canvas { cursor: pointer !important; }';
      document.head.appendChild(cursorOverride);

      const mapContainer = mapInstance.getContainer();
      mapInstance.on('mousemove', (e) => {
        let picked = false;
        try {
          picked = !!dataOv.pickObject({ x: e.point.x, y: e.point.y });
        } catch {
          // overlay not yet initialised
        }
        mapContainer.classList.toggle('deck-hovering', picked);
      });
      mapInstance.on('mouseout', () => {
        mapContainer.classList.remove('deck-hovering');
      });
      mapInstance.on('dragstart', () => {
        mapContainer.classList.remove('deck-hovering');
      });

      setMapZoom(mapInstance.getZoom());
      setWindOverlay(windOv);
      setDataOverlay(dataOv);
      setHeatmapOverlay(heatmapOv);
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
      document.head.querySelector('style[data-deck-cursor]')?.remove();
      setMap(null);
      setHeatmapOverlay(null);
      setDataOverlay(null);
      mapInstance.remove();
    };
  }, [setSelectedPoint, setMapZoom]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
