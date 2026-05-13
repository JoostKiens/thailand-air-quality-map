import { BitmapLayer, SolidPolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import type { Layer, PickingInfo, Position, SolidPolygonLayerProps } from 'deck.gl';
import { MaskExtension } from '@deck.gl/extensions';
import Supercluster from 'supercluster';
import type { LatestMeasurement } from '../hooks/useAQI';
import seaCountries from '../data/sea-land-mask.json';
import { pm25ToRgba, pm25ToRgb, pm25ToBorderRgba, contrastColor } from '../lib/aqiColors';

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
const AQ_LNG_COUNT = 63; // (114 - 89) / 0.4 + 1
const AQ_LAT_COUNT = 73; // ( 30 -  1) / 0.4 + 1
const AQ_LNG_MAX = AQ_LNG_MIN + (AQ_LNG_COUNT - 1) * AQ_STEP; // 113.8
const AQ_LAT_MAX = AQ_LAT_MIN + (AQ_LAT_COUNT - 1) * AQ_STEP; //  29.8

// BitmapLayer geographic bounds: outer edges of the outermost cells.
const BITMAP_BOUNDS: [number, number, number, number] = [
  AQ_LNG_MIN - AQ_STEP / 2, // 88.8 west
  AQ_LAT_MIN - AQ_STEP / 2, //  0.8 south
  AQ_LNG_MAX + AQ_STEP / 2, // 114.0 east
  AQ_LAT_MAX + AQ_STEP / 2, //  30.0 north
];

const STATION_ALPHA = 255;

// BitmapLayer — receives a pre-painted ImageBitmap from the pm25Canvas web worker.
// MaskExtension clips to land (land-mask layer must appear before this in the stack).
export function createPM25BitmapLayer(bitmap: ImageBitmap, beforeId?: string) {
  const maskExt = new MaskExtension();
  return new BitmapLayer({
    id: 'pm25-bitmap',
    image: bitmap,
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

// Module-level Supercluster cache — index is rebuilt only when the data reference changes,
// not on every zoom change. getClusters() on an existing index is fast.
let _scIndex: Supercluster<LatestMeasurement, { maxPm25: number }> | null = null;
let _scData: LatestMeasurement[] | null = null;

function getStationIndex(data: LatestMeasurement[]) {
  if (data === _scData && _scIndex !== null) return _scIndex;
  _scData = data;
  _scIndex = new Supercluster<LatestMeasurement, { maxPm25: number }>({
    radius: CLUSTER_RADIUS,
    maxZoom: CLUSTER_MAX_ZOOM,
    map: (props) => ({ maxPm25: props.value }),
    reduce: (acc, props) => {
      acc.maxPm25 = Math.max(acc.maxPm25, props.maxPm25);
    },
  });
  _scIndex.load(
    data.map((d) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
      properties: d,
    })),
  );
  return _scIndex;
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
  const sc = getStationIndex(data);

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
