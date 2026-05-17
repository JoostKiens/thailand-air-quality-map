import { useQuery } from '@tanstack/react-query';
import type { WindReading } from '@thailand-aq/types';
import { useTimeStore } from '../store/timeStore';

const API = import.meta.env.VITE_API_BASE_URL;

export function useWind() {
  const selectedDate = useTimeStore((s) => s.selectedDate);
  return useQuery({
    queryKey: ['weather-wind', selectedDate],
    queryFn: async () => {
      const res = await fetch(`${API}/api/weather/wind?date=${selectedDate}`);
      if (!res.ok) throw new Error(`wind fetch failed: ${res.status}`);
      return ((await res.json()) as { data: WindReading[] }).data;
    },
    staleTime: Infinity,
  });
}
