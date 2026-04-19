import { create } from 'zustand';

interface TimeStore {
  selectedDate: string; // YYYY-MM-DD
  rangeMode: boolean;
  rangeStart: string;
  rangeEnd: string;
  setDate: (date: string) => void;
  setRange: (start: string, end: string) => void;
}

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 — must match uiStore
const yesterday = new Date(Date.now() + ICT_OFFSET_MS - 86_400_000).toISOString().slice(0, 10);

export const useTimeStore = create<TimeStore>((set) => ({
  selectedDate: yesterday,
  rangeMode: false,
  rangeStart: yesterday,
  rangeEnd: yesterday,
  setDate: (date) => set({ selectedDate: date }),
  setRange: (start, end) => set({ rangeMode: true, rangeStart: start, rangeEnd: end }),
}));
