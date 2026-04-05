import { HeatmapLayer, ScatterplotLayer } from 'deck.gl';
import type { LatestMeasurement } from '../hooks/useAQI';

// Heatmap uses a warm amber→red gradient with no green, so it only communicates
// "pollution exists here" at varying intensity. Actual AQI category color meaning
// is carried by the station dots. A green→red gradient would be misleading because
// HeatmapLayer normalizes weights relative to the viewport, not absolute µg/m³.
const HEATMAP_COLOR_RANGE: [number, number, number][] = [
  [254, 240, 138], // pale yellow
  [253, 186, 116], // light orange
  [249, 115, 22], // orange
  [239, 68, 68], // red
  [168, 85, 247], // purple
  [190, 18, 60], // dark red
];

type RGBA = [number, number, number, number];

// Thresholds are raw PM2.5 µg/m³ concentrations, NOT AQI index values.
// Source: US EPA PM2.5 NAAQS breakpoints.
function aqiColor(pm25: number): RGBA {
  if (pm25 <= 12.0) return [34, 197, 94, 220]; // Good
  if (pm25 <= 35.4) return [234, 179, 8, 220]; // Moderate
  if (pm25 <= 55.4) return [249, 115, 22, 220]; // Unhealthy for sensitive groups
  if (pm25 <= 150.4) return [239, 68, 68, 220]; // Unhealthy
  if (pm25 <= 250.4) return [168, 85, 247, 220]; // Very unhealthy
  return [190, 18, 60, 220]; // Hazardous
}

// HeatmapLayer does not support the opacity prop (uses framebuffer compositing).
export function createPM25Layer(data: LatestMeasurement[]) {
  const heatmap = new HeatmapLayer<LatestMeasurement>({
    id: 'pm25-heatmap',
    data,
    getPosition: (d) => [d.lng, d.lat],
    getWeight: (d) => d.value,
    radiusPixels: 60,
    colorRange: HEATMAP_COLOR_RANGE,
    intensity: 1,
    threshold: 0.03,
    pickable: false,
  });

  const stations = new ScatterplotLayer<LatestMeasurement>({
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

  return [heatmap, stations];
}
