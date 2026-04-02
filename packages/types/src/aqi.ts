export interface AQIReading {
  stationId: string;
  stationName: string;
  lat: number;
  lng: number;
  pm25: number | null;
  aqi: number | null;
  measuredAt: string;
  source: string;
}

export interface AQICategory {
  label: string;
  color: string;
  min: number;
  max: number;
}
