import { create } from 'zustand';

export interface SelectedPoint {
  lngLat: [number, number];
  fire?: { frp: number | null; confidence: string | null; countryId: string; detectedAt: string };
  station?: { stationName: string; pm25: number; unit: string; measuredAt: string };
  powerPlant?: { name: string; fuelType: string; capacityMw: number | null };
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
  mapZoom: number;
  setMapZoom: (zoom: number) => void;
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
  mapZoom: 5.5,
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
}));

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 — Bangkok / ICT

// day 0 = 30 days ago (ICT), day 29 = yesterday (ICT)
export function dayToDate(day: number): string {
  const todayIctMs = Date.now() + ICT_OFFSET_MS;
  const d = new Date(todayIctMs - (30 - day) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
