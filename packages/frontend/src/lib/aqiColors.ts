// Authoritative US EPA AQI color scale for PM2.5.
// Thresholds are raw PM2.5 µg/m³ concentrations, NOT AQI index values.
// Both the heatmap (BitmapLayer) and station dots (ScatterplotLayer) use this file
// so the two layers are always visually consistent.
//
// AQI index → PM2.5 µg/m³ breakpoints (EPA):
//   Good 0–50           → 0–12.0 µg/m³
//   Moderate 51–100     → 12.1–35.4
//   USG 101–150         → 35.5–55.4
//   Unhealthy 151–200   → 55.5–150.4
//   Very Unhealthy 201–300 → 150.5–250.4
//   Hazardous 301+      → 250.5+

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

interface AqiCategory {
  label: string;
  range: string; // display string in µg/m³
  rgb: RGB;
}

export const AQI_CATEGORIES: AqiCategory[] = [
  { label: 'Good', range: '0–12', rgb: [0, 228, 0] },
  { label: 'Moderate', range: '12–35', rgb: [255, 255, 0] },
  { label: 'Unhealthy (sensitive)', range: '35–55', rgb: [255, 126, 0] },
  { label: 'Unhealthy', range: '55–150', rgb: [255, 0, 0] },
  { label: 'Very unhealthy', range: '150–250', rgb: [143, 63, 151] },
  { label: 'Hazardous', range: '250+', rgb: [126, 0, 35] },
];

// Upper PM2.5 breakpoints matching AQI_CATEGORIES order.
const PM25_BREAKPOINTS = [12.0, 35.4, 55.4, 150.4, 250.4, Infinity];

export function pm25ToRgb(pm25: number): RGB {
  for (let i = 0; i < PM25_BREAKPOINTS.length; i++) {
    if (pm25 <= PM25_BREAKPOINTS[i]) return AQI_CATEGORIES[i].rgb;
  }
  return AQI_CATEGORIES[AQI_CATEGORIES.length - 1].rgb;
}

export function pm25ToRgba(pm25: number, alpha: number): RGBA {
  const [r, g, b] = pm25ToRgb(pm25);
  return [r, g, b, alpha];
}

// Returns black text for light backgrounds, white for dark ones.
export function contrastColor(rgb: RGB): RGBA {
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum > 150 ? [0, 0, 0, 255] : [255, 255, 255, 255];
}
