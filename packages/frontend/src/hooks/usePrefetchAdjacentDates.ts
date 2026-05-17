import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FirePoint, WindReading, PM25GridPoint } from '@thailand-aq/types';
import { useTimeStore } from '../store/timeStore';
import type { LatestMeasurement } from './useAQI';

const API = import.meta.env.VITE_API_BASE_URL;

function shiftDate(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function usePrefetchAdjacentDates(latestDate?: string) {
  const queryClient = useQueryClient();
  const selectedDate = useTimeStore((s) => s.selectedDate);

  useEffect(() => {
    if (latestDate === undefined) return;
    for (const offset of [-1, 1]) {
      const date = shiftDate(selectedDate, offset);
      if (date > latestDate) continue;

      void queryClient.prefetchQuery({
        queryKey: ['fires', date],
        queryFn: async () => {
          const res = await fetch(`${API}/api/fires?date=${date}`);
          if (!res.ok) throw new Error(`fires fetch failed: ${res.status}`);
          return ((await res.json()) as { data: FirePoint[] }).data;
        },
        staleTime: Infinity,
      });

      void queryClient.prefetchQuery({
        queryKey: ['aqi-latest', 'pm25', date],
        queryFn: async () => {
          const res = await fetch(`${API}/api/station-readings/latest?parameter=pm25&date=${date}`);
          if (!res.ok) throw new Error(`aqi fetch failed: ${res.status}`);
          return ((await res.json()) as { data: LatestMeasurement[] }).data;
        },
        staleTime: Infinity,
      });

      void queryClient.prefetchQuery({
        queryKey: ['cams-grid', date],
        queryFn: async () => {
          const res = await fetch(`${API}/api/cams?date=${date}`);
          if (!res.ok) throw new Error(`cams grid fetch failed: ${res.status}`);
          return ((await res.json()) as { data: PM25GridPoint[] }).data;
        },
        staleTime: Infinity,
      });

      void queryClient.prefetchQuery({
        queryKey: ['weather-wind', date],
        queryFn: async () => {
          const res = await fetch(`${API}/api/weather/wind?date=${date}`);
          if (!res.ok) throw new Error(`wind fetch failed: ${res.status}`);
          return ((await res.json()) as { data: WindReading[] }).data;
        },
        staleTime: Infinity,
      });
    }
  }, [queryClient, selectedDate, latestDate]);
}
