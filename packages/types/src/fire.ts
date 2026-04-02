export interface FirePoint {
  id: number;
  detectedAt: string; // ISO 8601
  lat: number;
  lng: number;
  frp: number | null; // fire radiative power MW
  brightness: number | null;
  countryId: string; // ISO 3166-1 alpha-3
}
