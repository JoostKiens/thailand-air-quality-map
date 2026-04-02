export interface WindVector {
  lat: number;
  lng: number;
  speedKmh: number;
  directionDeg: number; // meteorological: 0=N, 90=E, 180=S, 270=W
}
