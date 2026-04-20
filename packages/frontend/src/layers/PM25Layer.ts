import { BitmapLayer, SolidPolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import type { Layer, PickingInfo, Position, SolidPolygonLayerProps } from 'deck.gl';
import { MaskExtension } from '@deck.gl/extensions';
import Supercluster from 'supercluster';
import type { PM25GridPoint } from '@thailand-aq/types';
import type { LatestMeasurement } from '../hooks/useAQI';
import seaCountries from '../data/sea-land-mask.json';
import {
  pm25ToRgba,
  pm25ToRgb,
  pm25ToBorderRgba,
  contrastColor,
  type RGBA,
} from '../lib/aqiColors';

export { AQI_CATEGORIES } from '../lib/aqiColors';

type Ring = number[][];
type CountryFeature = {
  geometry: { type: string; coordinates: Ring[] | Ring[][] };
};

// Flatten Polygon and MultiPolygon features into individual outer rings.
// SolidPolygonLayer needs one ring per data item.
function extractRings(features: CountryFeature[]): Ring[] {
  const rings: Ring[] = [];
  for (const f of features) {
    if (f.geometry.type === 'Polygon') {
      rings.push((f.geometry.coordinates as Ring[])[0]);
    } else {
      // MultiPolygon: coordinates is Ring[][]
      for (const polygon of f.geometry.coordinates as Ring[][]) {
        rings.push(polygon[0]);
      }
    }
  }
  return rings;
}

// Pre-extract rings once at module load time.
const LAND_RINGS = extractRings((seaCountries as { features: CountryFeature[] }).features);

// SolidPolygonLayer with operation:'mask' — renders land areas into the mask buffer.
// Used by createPM25BitmapLayer to clip the heatmap to land. Must appear in the
// layers array before the masked layer.
export function createLandMaskLayer(beforeId?: string) {
  const props: SolidPolygonLayerProps<Ring> = {
    id: 'land-mask',
    data: LAND_RINGS,
    getPolygon: (ring) => ring as unknown as Position[],
    filled: true,
    operation: 'mask',
    parameters: { depthCompare: 'always' as const, depthWriteEnabled: false },
    ...({ beforeId } as object),
  };
  return new SolidPolygonLayer<Ring>(props);
}

// Grid geometry — must match backend openmeteo.ts AQ grid constants.
const AQ_STEP = 0.4;
const AQ_LNG_MIN = 89.0;
const AQ_LAT_MIN = 1.0;
const AQ_LNG_COUNT = 63;
const AQ_LAT_COUNT = 73;
const AQ_LNG_MAX = AQ_LNG_MIN + (AQ_LNG_COUNT - 1) * AQ_STEP; // 113.8
const AQ_LAT_MAX = AQ_LAT_MIN + (AQ_LAT_COUNT - 1) * AQ_STEP; //  29.8

// Canvas pixels per grid cell — higher = smoother gradients, more memory.
const PX_PER_CELL = 10;
const CANVAS_W = AQ_LNG_COUNT * PX_PER_CELL; // 630
const CANVAS_H = AQ_LAT_COUNT * PX_PER_CELL; // 730

// BitmapLayer geographic bounds: outer edges of the outermost cells.
const BITMAP_BOUNDS: [number, number, number, number] = [
  AQ_LNG_MIN - AQ_STEP / 2, // 88.8 west
  AQ_LAT_MIN - AQ_STEP / 2, //  0.8 south
  AQ_LNG_MAX + AQ_STEP / 2, // 114.0 east
  AQ_LAT_MAX + AQ_STEP / 2, //  30.0 north
];

// Alpha values — heatmap is more translucent so the basemap shows through;
// stations are more opaque so individual dots remain legible.
const HEATMAP_ALPHA = 80;
const STATION_ALPHA = 255;

// Bilinearly interpolate between four RGBA corner colors.
function lerpColor(c00: RGBA, c10: RGBA, c01: RGBA, c11: RGBA, tx: number, ty: number): RGBA {
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return [
    Math.round(l(l(c00[0], c10[0], tx), l(c01[0], c11[0], tx), ty)),
    Math.round(l(l(c00[1], c10[1], tx), l(c01[1], c11[1], tx), ty)),
    Math.round(l(l(c00[2], c10[2], tx), l(c01[2], c11[2], tx), ty)),
    Math.round(l(l(c00[3], c10[3], tx), l(c01[3], c11[3], tx), ty)),
  ];
}

// BitmapLayer — bilinearly-interpolated PM2.5 grid rendered onto an offscreen canvas.
// MaskExtension clips to land (land-mask layer must appear before this in the stack).
export function createPM25BitmapLayer(data: PM25GridPoint[], beforeId?: string) {
  // Build a 2-D grid lookup: grid[latIdx][lngIdx] = pm25 | null
  const grid: (number | null)[][] = Array.from({ length: AQ_LAT_COUNT }, () =>
    Array<number | null>(AQ_LNG_COUNT).fill(null),
  );
  for (const pt of data) {
    const latIdx = Math.round((pt.lat - AQ_LAT_MIN) / AQ_STEP);
    const lngIdx = Math.round((pt.lng - AQ_LNG_MIN) / AQ_STEP);
    if (latIdx >= 0 && latIdx < AQ_LAT_COUNT && lngIdx >= 0 && lngIdx < AQ_LNG_COUNT) {
      grid[latIdx][lngIdx] = pt.pm25;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
  const pix = imageData.data;

  const [west, south, east, north] = BITMAP_BOUNDS;
  const geoW = east - west;
  const geoH = north - south;

  for (let py = 0; py < CANVAS_H; py++) {
    for (let px = 0; px < CANVAS_W; px++) {
      // Geographic coordinate of this pixel center (y-axis flipped: py=0 is north).
      const lng = west + ((px + 0.5) * geoW) / CANVAS_W;
      const lat = north - ((py + 0.5) * geoH) / CANVAS_H;

      // Fractional grid indices for bilinear interpolation.
      const lngF = (lng - AQ_LNG_MIN) / AQ_STEP;
      const latF = (lat - AQ_LAT_MIN) / AQ_STEP;
      const lngLo = Math.floor(lngF);
      const latLo = Math.floor(latF);
      const lngHi = Math.min(lngLo + 1, AQ_LNG_COUNT - 1);
      const latHi = Math.min(latLo + 1, AQ_LAT_COUNT - 1);
      const tx = lngF - lngLo;
      const ty = latF - latLo;

      const v00 = grid[latLo]?.[lngLo] ?? null;
      const v10 = grid[latLo]?.[lngHi] ?? null;
      const v01 = grid[latHi]?.[lngLo] ?? null;
      const v11 = grid[latHi]?.[lngHi] ?? null;

      const idx = (py * CANVAS_W + px) * 4;
      const available = [v00, v10, v01, v11].filter((v): v is number => v !== null);
      if (available.length === 0) {
        pix[idx + 3] = 0;
        continue;
      }

      // Fall back missing corners to any available neighbour so edges stay coloured.
      const fb = available[0];
      const [r, g, b, a] = lerpColor(
        pm25ToRgba(v00 ?? fb, HEATMAP_ALPHA),
        pm25ToRgba(v10 ?? fb, HEATMAP_ALPHA),
        pm25ToRgba(v01 ?? fb, HEATMAP_ALPHA),
        pm25ToRgba(v11 ?? fb, HEATMAP_ALPHA),
        tx,
        ty,
      );
      pix[idx] = r;
      pix[idx + 1] = g;
      pix[idx + 2] = b;
      pix[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const maskExt = new MaskExtension();
  return new BitmapLayer({
    id: 'pm25-bitmap',
    image: canvas,
    bounds: BITMAP_BOUNDS,
    parameters: { depthCompare: 'always' as const, depthWriteEnabled: false },
    ...({ extensions: [maskExt], maskId: 'land-mask', beforeId } as object),
  });
}

// --- Station clustering ---

const CLUSTER_RADIUS = 60;
export const CLUSTER_MAX_ZOOM = 14;

const SINGLE_RADIUS_PX = 15; // diameter 30px
const CLUSTER_RADIUS_PX = 18; // diameter 36px

// Minimal structural type for Supercluster output — discriminated on `cluster`.
interface StationClusterFeature {
  geometry: { coordinates: number[] };
  properties: { cluster: true; cluster_id: number; point_count: number; maxPm25: number };
}
interface StationPointFeature {
  geometry: { coordinates: number[] };
  properties: LatestMeasurement & { cluster?: false };
}
type AnyStationFeature = StationClusterFeature | StationPointFeature;

function pm25OfFeature(d: AnyStationFeature): number {
  return d.properties.cluster ? d.properties.maxPm25 : d.properties.value;
}

// ScatterplotLayer + TextLayer stack — OpenAQ ground stations with Supercluster grouping.
// Clusters: larger circle with border ring and two-line label (value + ×count).
// Singles: smaller circle with single-line AQI value.
export function createPM25StationsLayers(
  data: LatestMeasurement[],
  zoom: number,
  onStationClick: (info: PickingInfo) => void,
  onClusterClick: (
    clusterId: number,
    lngLat: [number, number],
    expansionZoom: number,
    leaves: LatestMeasurement[],
  ) => void,
): Layer[] {
  const sc = new Supercluster<LatestMeasurement, { maxPm25: number }>({
    radius: CLUSTER_RADIUS,
    maxZoom: CLUSTER_MAX_ZOOM,
    map: (props) => ({ maxPm25: props.value }),
    reduce: (acc, props) => {
      acc.maxPm25 = Math.max(acc.maxPm25, props.maxPm25);
    },
  });

  sc.load(
    data.map((d) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
      properties: d,
    })),
  );

  const clusters = sc.getClusters([-180, -90, 180, 90], Math.floor(zoom)) as AnyStationFeature[];
  const clusterFeatures = clusters.filter(
    (d): d is StationClusterFeature => !!d.properties.cluster,
  );

  const getPosition = (d: AnyStationFeature) => d.geometry.coordinates as [number, number];
  const layerParams = { depthCompare: 'always' as const, depthWriteEnabled: false };

  // 1. Border ring — clusters only, rendered below the fill circle
  const clusterBorder = new ScatterplotLayer<StationClusterFeature>({
    id: 'pm25-cluster-border',
    data: clusterFeatures,
    getPosition: (d) => d.geometry.coordinates as [number, number],
    getRadius: CLUSTER_RADIUS_PX,
    radiusUnits: 'pixels',
    stroked: true,
    filled: false,
    getLineColor: (d) => pm25ToBorderRgba(d.properties.maxPm25, 255),
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    parameters: layerParams,
  });

  // 2. Fill circles — all features
  const onClick = (info: PickingInfo) => {
    if (!info.object) return;
    const feat = info.object as AnyStationFeature;
    if (feat.properties.cluster) {
      const id = feat.properties.cluster_id;
      const expansionZoom = sc.getClusterExpansionZoom(id);
      const leaves = sc.getLeaves(id, Infinity).map((f) => f.properties);
      onClusterClick(id, info.coordinate as [number, number], expansionZoom, leaves);
    } else {
      onStationClick(info);
    }
  };

  const scatterplot = new ScatterplotLayer<AnyStationFeature>({
    id: 'pm25-stations',
    data: clusters,
    getPosition,
    getFillColor: (d) => pm25ToRgba(pm25OfFeature(d), STATION_ALPHA),
    getLineColor: (d) => contrastColor(pm25ToRgb(pm25OfFeature(d))),
    getRadius: (d) => (d.properties.cluster ? CLUSTER_RADIUS_PX : SINGLE_RADIUS_PX),
    radiusUnits: 'pixels',
    lineWidthUnits: 'pixels',
    getLineWidth: (d) => (d.properties.cluster ? 0 : 2),
    stroked: true,
    pickable: true,
    onHover: (info) => !!info.picked,
    onClick,
    parameters: layerParams,
  });

  // 3. Value label — shifted up for clusters to make room for count line
  const valueText = new TextLayer<AnyStationFeature>({
    id: 'pm25-stations-labels',
    data: clusters,
    getPosition,
    getText: (d) =>
      d.properties.cluster
        ? String(Math.round(d.properties.maxPm25))
        : String(Math.round(d.properties.value)),
    getColor: (d) => contrastColor(pm25ToRgb(pm25OfFeature(d))),
    getPixelOffset: (d) => (d.properties.cluster ? [0, -4] : [0, 1]),
    getSize: 12,
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    parameters: layerParams,
  });

  // 4. Count label — clusters only, below value label
  const countText = new TextLayer<StationClusterFeature>({
    id: 'pm25-cluster-count',
    data: clusterFeatures,
    getPosition: (d) => d.geometry.coordinates as [number, number],
    getText: (d) => `x${d.properties.point_count}`,
    getColor: (d) => {
      const [r, g, b] = contrastColor(pm25ToRgb(d.properties.maxPm25));
      return [r, g, b, 191] as [number, number, number, number]; // 75% alpha
    },
    getPixelOffset: [0, 7],
    getSize: 10,
    fontWeight: 'normal',
    fontFamily: 'sans-serif',
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    parameters: layerParams,
  });

  return [clusterBorder, scatterplot, valueText, countText];
}
