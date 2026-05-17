import { useQuery } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_BASE_URL;

export function useLatestDate() {
  return useQuery({
    queryKey: ['latest-date'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/latest-date`);
      if (!res.ok) throw new Error('Failed to fetch latest date');
      const json = (await res.json()) as { date: string };
      return json.date;
    },
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });
}
