/// <reference lib="webworker" />
import type { PM25GridPoint } from '@thailand-aq/types';
import { pm25ToRgba } from '../lib/aqiColors';

type RGBA = [number, number, number, number];

const AQ_STEP = 0.4;
const AQ_LNG_MIN = 89.0;
const AQ_LAT_MIN = 1.0;
const AQ_LNG_COUNT = 63;
const AQ_LAT_COUNT = 73;
const AQ_LNG_MAX = AQ_LNG_MIN + (AQ_LNG_COUNT - 1) * AQ_STEP;
const AQ_LAT_MAX = AQ_LAT_MIN + (AQ_LAT_COUNT - 1) * AQ_STEP;
const CANVAS_W = AQ_LNG_COUNT * 10; // 630
const CANVAS_H = AQ_LAT_COUNT * 10; // 730
const HEATMAP_ALPHA = 80;

const BITMAP_WEST = AQ_LNG_MIN - AQ_STEP / 2;
const BITMAP_NORTH = AQ_LAT_MAX + AQ_STEP / 2;
const GEO_W = AQ_LNG_MAX + AQ_STEP / 2 - BITMAP_WEST;
const GEO_H = BITMAP_NORTH - (AQ_LAT_MIN - AQ_STEP / 2);

function lerpColor(c00: RGBA, c10: RGBA, c01: RGBA, c11: RGBA, tx: number, ty: number): RGBA {
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return [
    Math.round(l(l(c00[0], c10[0], tx), l(c01[0], c11[0], tx), ty)),
    Math.round(l(l(c00[1], c10[1], tx), l(c01[1], c11[1], tx), ty)),
    Math.round(l(l(c00[2], c10[2], tx), l(c01[2], c11[2], tx), ty)),
    Math.round(l(l(c00[3], c10[3], tx), l(c01[3], c11[3], tx), ty)),
  ];
}

self.onmessage = async (e: MessageEvent<{ data: PM25GridPoint[] }>) => {
  const { data } = e.data;

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

  const canvas = new OffscreenCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
  const pix = imageData.data;

  for (let py = 0; py < CANVAS_H; py++) {
    for (let px = 0; px < CANVAS_W; px++) {
      const lng = BITMAP_WEST + ((px + 0.5) * GEO_W) / CANVAS_W;
      const lat = BITMAP_NORTH - ((py + 0.5) * GEO_H) / CANVAS_H;

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
  // transferToImageBitmap() premultiplies alpha, which causes double-application when
  // BitmapLayer's GPU blending stage applies alpha a second time. createImageBitmap with
  // premultiplyAlpha:'none' keeps the pixel data as-is.
  const bitmap = await createImageBitmap(canvas, { premultiplyAlpha: 'none' });
  self.postMessage({ bitmap }, [bitmap]);
};
