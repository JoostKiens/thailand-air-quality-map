import { BitmapLayer, SolidPolygonLayer, ScatterplotLayer } from 'deck.gl';
import type { Position, SolidPolygonLayerProps } from 'deck.gl';
import { MaskExtension } from '@deck.gl/extensions';
import type { PM25GridPoint } from '@thailand-aq/types';
import type { LatestMeasurement } from '../hooks/useAQI';
import seaCountries from '../data/sea-land-mask.json';

type RGBA = [number, number, number, number];
type Ring = number[][];
type CountryFeature = {
  geometry: { type: string; coordinates: Ring[] | Ring[][] };
};

// Thresholds are raw PM2.5 µg/m³ concentrations, NOT AQI index values.
// Source: US EPA PM2.5 NAAQS breakpoints.
export const AQI_CATEGORIES = [
  { label: 'Good', range: '0–12', rgb: [34, 197, 94] as [number, number, number] },
  { label: 'Moderate', range: '12–35', rgb: [234, 179, 8] as [number, number, number] },
  {
    label: 'Unhealthy (sensitive)',
    range: '35–55',
    rgb: [249, 115, 22] as [number, number, number],
  },
  { label: 'Unhealthy', range: '55–150', rgb: [239, 68, 68] as [number, number, number] },
  { label: 'Very unhealthy', range: '150–250', rgb: [168, 85, 247] as [number, number, number] },
  { label: 'Hazardous', range: '250+', rgb: [190, 18, 60] as [number, number, number] },
] as const;

function aqiColor(pm25: number): RGBA {
  if (pm25 <= 12.0) return [34, 197, 94, 120];
  if (pm25 <= 35.4) return [234, 179, 8, 120];
  if (pm25 <= 55.4) return [249, 115, 22, 120];
  if (pm25 <= 150.4) return [239, 68, 68, 120];
  if (pm25 <= 250.4) return [168, 85, 247, 120];
  return [190, 18, 60, 120];
}

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

// SolidPolygonLayer with operation:'mask' — renders TH/MM/LA/KH/VN land areas into
// the mask buffer. Used by createPM25HeatmapLayer to clip grid cells to land.
// Must appear in the layers array before the masked layer.
export function createLandMaskLayer(beforeId?: string) {
  const props: SolidPolygonLayerProps<Ring> = {
    id: 'land-mask',
    data: LAND_RINGS,
    getPolygon: (ring) => ring as unknown as Position[],
    filled: true,
    operation: 'mask',
    ...({ beforeId } as object),
  };
  return new SolidPolygonLayer<Ring>(props);
}

// Grid geometry — must match backend openmeteo.ts AQ grid constants.
const AQ_STEP = 0.4;
const AQ_LNG_MIN = 92.0;
const AQ_LAT_MIN = 5.0;
const AQ_LNG_COUNT = 46;
const AQ_LAT_COUNT = 58;
const AQ_LNG_MAX = AQ_LNG_MIN + (AQ_LNG_COUNT - 1) * AQ_STEP; // 110.0
const AQ_LAT_MAX = AQ_LAT_MIN + (AQ_LAT_COUNT - 1) * AQ_STEP; // 27.8

// Canvas pixels per grid cell — higher = smoother gradients, more memory.
const PX_PER_CELL = 10;
const CANVAS_W = AQ_LNG_COUNT * PX_PER_CELL; // 460
const CANVAS_H = AQ_LAT_COUNT * PX_PER_CELL; // 580

// BitmapLayer geographic bounds: outer edges of the outermost cells.
const BITMAP_BOUNDS: [number, number, number, number] = [
  AQ_LNG_MIN - AQ_STEP / 2, // 91.8 west
  AQ_LAT_MIN - AQ_STEP / 2, //  4.8 south
  AQ_LNG_MAX + AQ_STEP / 2, // 110.2 east
  AQ_LAT_MAX + AQ_STEP / 2, //  28.0 north
];

// Map a PM2.5 value to an RGBA tuple for canvas pixel writing.
function pm25ToRgba(pm25: number): RGBA {
  if (pm25 <= 12.0) return [34, 197, 94, 120];
  if (pm25 <= 35.4) return [234, 179, 8, 120];
  if (pm25 <= 55.4) return [249, 115, 22, 120];
  if (pm25 <= 150.4) return [239, 68, 68, 120];
  if (pm25 <= 250.4) return [168, 85, 247, 120];
  return [190, 18, 60, 120];
}

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
// Smooth color gradients replace the blocky per-cell PolygonLayer.
// MaskExtension clips to land (same land-mask layer required before this in the stack).
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
        pm25ToRgba(v00 ?? fb),
        pm25ToRgba(v10 ?? fb),
        pm25ToRgba(v01 ?? fb),
        pm25ToRgba(v11 ?? fb),
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
    ...({ extensions: [maskExt], maskId: 'land-mask', beforeId } as object),
  });
}

// ScatterplotLayer — OpenAQ ground station measurements, date-specific.
// Each dot is colored by its actual PM2.5 AQI category.
export function createPM25StationsLayer(data: LatestMeasurement[], beforeId?: string) {
  return new ScatterplotLayer<LatestMeasurement>({
    id: 'pm25-stations',
    ...({ beforeId } as object),
    data,
    getPosition: (d) => [d.lng, d.lat],
    getFillColor: (d) => aqiColor(d.value),
    getLineColor: [255, 255, 255, 180],
    getRadius: 5,
    radiusUnits: 'pixels',
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
    stroked: true,
    radiusMinPixels: 3,
    radiusMaxPixels: 8,
    pickable: true,
  });
}
