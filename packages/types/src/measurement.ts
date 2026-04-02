export interface Measurement {
  stationId: string;
  sensorId: number;
  parameter: string; // 'pm25' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co' | 'bc'
  value: number;
  unit: string;
  measuredAt: string; // ISO 8601
}

export interface AQICategory {
  label: string;
  color: string;
  min: number;
  max: number;
}
