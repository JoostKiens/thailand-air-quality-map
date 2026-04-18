import { useQuery } from '@tanstack/react-query';
import type { WindVector } from '@thailand-aq/types';

const API = import.meta.env.VITE_API_BASE_URL;

export function useWind() {
  return useQuery({
    queryKey: ['wind'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/wind/current`);
      if (!res.ok) throw new Error(`wind fetch failed: ${res.status}`);
      return ((await res.json()) as { data: WindVector[] }).data;
    },
    staleTime: 6 * 60 * 60 * 1000, // 6h — matches backend Redis TTL
  });
}
