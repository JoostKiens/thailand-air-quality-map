import { useQuery } from '@tanstack/react-query';
import { useTimeStore } from '../store/timeStore';
import type { PM25GridPoint } from '@thailand-aq/types';

const API = import.meta.env.VITE_API_BASE_URL;

export function useAQGrid() {
  const selectedDate = useTimeStore((s) => s.selectedDate);
  return useQuery({
    queryKey: ['aq-grid', selectedDate],
    queryFn: async () => {
      const res = await fetch(`${API}/api/aq/pm25?date=${selectedDate}`);
      if (!res.ok) throw new Error(`aq grid fetch failed: ${res.status}`);
      return ((await res.json()) as { data: PM25GridPoint[] }).data;
    },
    staleTime: 6 * 60 * 60 * 1000, // 6h — CAMS model data for past dates doesn't change
  });
}
