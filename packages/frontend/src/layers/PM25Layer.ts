import { PolygonLayer, SolidPolygonLayer, ScatterplotLayer } from 'deck.gl';
import type { Position, PolygonLayerProps, SolidPolygonLayerProps } from 'deck.gl';
import { MaskExtension } from '@deck.gl/extensions';
import type { PM25GridPoint } from '@thailand-aq/types';
import type { LatestMeasurement } from '../hooks/useAQI';
import seaCountries from '../data/sea-land-mask.json';

type RGBA = [number, number, number, number];
type Ring = number[][];
type CountryFeature = {
  geometry: { type: string; coordinates: Ring[] | Ring[][] };
};

// Defined locally to avoid ESLint type-resolution issues with @deck.gl/extensions.
type MaskExtensionProps = { maskId?: string; maskByInstance?: boolean; maskInverted?: boolean };

// Thresholds are raw PM2.5 µg/m³ concentrations, NOT AQI index values.
// Source: US EPA PM2.5 NAAQS breakpoints.
function aqiColor(pm25: number): RGBA {
  if (pm25 <= 12.0) return [34, 197, 94, 160]; // Good
  if (pm25 <= 35.4) return [234, 179, 8, 160]; // Moderate
  if (pm25 <= 55.4) return [249, 115, 22, 160]; // Unhealthy for sensitive groups
  if (pm25 <= 150.4) return [239, 68, 68, 160]; // Unhealthy
  if (pm25 <= 250.4) return [168, 85, 247, 160]; // Very unhealthy
  return [190, 18, 60, 160]; // Hazardous
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
export function createLandMaskLayer() {
  const props: SolidPolygonLayerProps<Ring> = {
    id: 'land-mask',
    data: LAND_RINGS,
    getPolygon: (ring) => ring as unknown as Position[],
    filled: true,
    operation: 'mask',
  };
  return new SolidPolygonLayer<Ring>(props);
}

// PolygonLayer — Open-Meteo CAMS gridded PM2.5, date-specific.
// Each grid point is a 1°×1° rectangle colored by absolute AQI category.
// Clipped to land areas via MaskExtension (no ocean tiles, pixel-perfect coastlines).
export function createPM25HeatmapLayer(data: PM25GridPoint[]) {
  const props: PolygonLayerProps<PM25GridPoint> & MaskExtensionProps = {
    id: 'pm25-heatmap',
    data,
    getPolygon: (d) =>
      [
        [d.lng - 0.5, d.lat - 0.5],
        [d.lng + 0.5, d.lat - 0.5],
        [d.lng + 0.5, d.lat + 0.5],
        [d.lng - 0.5, d.lat + 0.5],
        [d.lng - 0.5, d.lat - 0.5],
      ] as unknown as Position[],
    getFillColor: (d) => aqiColor(d.pm25),
    filled: true,
    stroked: false,
    pickable: false,

    extensions: [new MaskExtension()],
    maskId: 'land-mask',
  };
  return new PolygonLayer<PM25GridPoint>(props as PolygonLayerProps<PM25GridPoint>);
}

// ScatterplotLayer — OpenAQ ground station measurements, date-specific.
// Each dot is colored by its actual PM2.5 AQI category.
export function createPM25StationsLayer(data: LatestMeasurement[]) {
  return new ScatterplotLayer<LatestMeasurement>({
    id: 'pm25-stations',
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
