import { useQuery } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_BASE_URL;

export interface LatestMeasurement {
  stationId: string;
  stationName: string;
  lat: number;
  lng: number;
  parameter: string;
  value: number;
  unit: string;
  measuredAt: string;
}

export function useAQI() {
  return useQuery({
    queryKey: ['aqi-latest', 'pm25'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/measurements/latest?parameter=pm25`);
      if (!res.ok) throw new Error(`aqi fetch failed: ${res.status}`);
      return ((await res.json()) as { data: LatestMeasurement[] }).data;
    },
    staleTime: 60 * 60 * 1000, // 1h — matches backend Redis TTL
  });
}
