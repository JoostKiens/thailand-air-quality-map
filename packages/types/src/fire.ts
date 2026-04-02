export interface FirePoint {
  id: number;
  detectedAt: string; // ISO 8601
  lat: number;
  lng: number;
  frp: number | null; // fire radiative power MW
  brightTi4: number | null; // brightness temperature band I-4
  brightTi5: number | null; // brightness temperature band I-5
  countryId: string; // ISO 3166-1 alpha-3
  satellite: string | null; // 'N' = Suomi-NPP, '1' = NOAA-20
  confidence: string | null; // 'low' | 'nominal' | 'high'
  daynight: string | null; // 'D' | 'N'
  fireType: number | null; // 0=vegetation, 1=volcano, 2=static land, 3=offshore
}
