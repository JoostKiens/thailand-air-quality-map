import { useQuery } from '@tanstack/react-query';
import type { PowerPlantCollection } from '@thailand-aq/types';

const API = import.meta.env.VITE_API_BASE_URL;

export function usePowerPlants(enabled: boolean) {
  return useQuery({
    queryKey: ['power-plants'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/power-plants`);
      if (!res.ok) throw new Error(`power-plants fetch failed: ${res.status}`);
      return (await res.json()) as PowerPlantCollection;
    },
    staleTime: Infinity, // static dataset, never changes
    enabled,
  });
}
