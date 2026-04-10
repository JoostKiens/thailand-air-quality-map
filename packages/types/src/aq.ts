export interface PM25GridPoint {
  lat: number;
  lng: number;
  pm25: number; // daily mean µg/m³ from CAMS model via Open-Meteo
}
