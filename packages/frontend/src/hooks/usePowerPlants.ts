import { useQuery } from '@tanstack/react-query';
import type { PowerPlantCollection } from '@thailand-aq/types';

const API = import.meta.env.VITE_API_BASE_URL;

export function usePowerPlants() {
  return useQuery({
    queryKey: ['power-plants'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/power-plants`);
      if (!res.ok) throw new Error(`power-plants fetch failed: ${res.status}`);
      return (await res.json()) as PowerPlantCollection;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h — matches backend TTL
  });
}
