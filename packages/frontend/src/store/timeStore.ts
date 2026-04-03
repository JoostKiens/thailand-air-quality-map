import { create } from 'zustand';

interface TimeStore {
  selectedDate: string; // YYYY-MM-DD
  rangeMode: boolean;
  rangeStart: string;
  rangeEnd: string;
  setDate: (date: string) => void;
  setRange: (start: string, end: string) => void;
}

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

export const useTimeStore = create<TimeStore>((set) => ({
  selectedDate: yesterday,
  rangeMode: false,
  rangeStart: yesterday,
  rangeEnd: yesterday,
  setDate: (date) => set({ selectedDate: date }),
  setRange: (start, end) => set({ rangeMode: true, rangeStart: start, rangeEnd: end }),
}));
