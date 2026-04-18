import { create } from 'zustand';

export interface SelectedPoint {
  lngLat: [number, number];
  locationName?: string;
  aqi?: { value: number; category: string; color: string };
  nearestFire?: { distanceKm: number; direction: string; frp: number };
  wind?: { speedKmh: number; directionLabel: string };
  powerPlant?: { name: string; fuelType: string; capacityMw: number };
}

interface UIStore {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  selectedPoint: SelectedPoint | null;
  setSelectedPoint: (point: SelectedPoint | null) => void;
  scrubberDay: number; // 0 = 30 days ago, 29 = yesterday
  setScrubberDay: (day: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  selectedPoint: null,
  setSelectedPoint: (point) => set({ selectedPoint: point }),
  scrubberDay: 29,
  setScrubberDay: (day) => set({ scrubberDay: day }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
}));

// day 0 = 30 days ago, day 29 = yesterday
export function dayToDate(day: number): string {
  const d = new Date(Date.now() - (30 - day) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
