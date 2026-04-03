export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const DEFAULT_BBOX = '92,1,115,28';

export function parseBbox(raw: string | undefined): Bbox {
  const str = raw ?? DEFAULT_BBOX;
  const parts = str.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(`Invalid bbox: "${str}" — expected "west,south,east,north"`);
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  return { west, south, east, north };
}
