export interface WindReading {
  lat: number;
  lng: number;
  wind_speed_kmh: number;
  wind_direction_deg: number; // meteorological FROM-direction, 0=N, 90=E, 180=S, 270=W
}

export interface WeatherReading {
  lat: number;
  lng: number;
  wind_speed_kmh: number; // hourly snapshot at 07:00 UTC (14:00 BKK)
  wind_speed_max_kmh: number | null; // daily maximum
  wind_direction_deg: number; // hourly snapshot at 07:00 UTC (14:00 BKK); meteorological FROM-direction
  relative_humidity_2m: number | null; // hourly snapshot at 07:00 UTC (14:00 BKK)
  precipitation_sum: number | null; // daily total
}
