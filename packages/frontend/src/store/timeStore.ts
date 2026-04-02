import { create } from 'zustand';

interface TimeStore {
  selectedDate: string; // YYYY-MM-DD
  rangeMode: boolean;
  rangeStart: string;
  rangeEnd: string;
  setDate: (date: string) => void;
  setRange: (start: string, end: string) => void;
}

const today = new Date().toISOString().slice(0, 10);

export const useTimeStore = create<TimeStore>((set) => ({
  selectedDate: today,
  rangeMode: false,
  rangeStart: today,
  rangeEnd: today,
  setDate: (date) => set({ selectedDate: date }),
  setRange: (start, end) => set({ rangeMode: true, rangeStart: start, rangeEnd: end }),
}));
