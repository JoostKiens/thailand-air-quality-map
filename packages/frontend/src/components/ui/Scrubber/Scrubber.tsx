import { useEffect, useRef } from 'react';
import { useUIStore, dayToDate } from '../../../store/uiStore';
import { useTimeStore } from '../../../store/timeStore';
import { PlayButton } from './PlayButton';

const DAYS = 30;
const PLAY_INTERVAL_MS = 800;
const DEBOUNCE_MS = 300;

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatTickDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function Scrubber() {
  const scrubberDay = useUIStore((s) => s.scrubberDay);
  const setScrubberDay = useUIStore((s) => s.setScrubberDay);
  const playing = useUIStore((s) => s.playing);
  const setPlaying = useUIStore((s) => s.setPlaying);
  const setDate = useTimeStore((s) => s.setDate);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);

  const dateStr = dayToDate(scrubberDay);

  // Debounced timeStore sync
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDate(dateStr);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scrubberDay, dateStr, setDate]);

  // Play interval
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        const current = useUIStore.getState().scrubberDay;
        setScrubberDay(current >= DAYS - 1 ? 0 : current + 1);
      }, PLAY_INTERVAL_MS);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, setScrubberDay]);

  // Space key toggles play
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== ' ') return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      e.preventDefault();
      setPlaying(!playing);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [playing, setPlaying]);

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScrubberDay(Number(e.target.value));
  }

  function handlePointerDown() {
    isDraggingRef.current = true;
    if (playing) setPlaying(false);
  }

  function handlePointerUp() {
    isDraggingRef.current = false;
  }

  return (
    <div className="h-[52px] bg-white border-t border-gray-200 pointer-events-auto flex items-center gap-3 px-4">
      <PlayButton playing={playing} onToggle={() => setPlaying(!playing)} />

      <span className="hidden md:block text-xs font-mono font-medium text-gray-700 tabular-nums w-[100px] shrink-0">
        {formatDate(dateStr)}
      </span>

      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={DAYS - 1}
          step={1}
          value={scrubberDay}
          onChange={handleSliderChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          aria-label="Select date"
          aria-valuetext={formatDate(dateStr)}
          className="w-full"
        />
        <div className="hidden md:flex justify-between mt-0.5">
          <span className="text-[10px] text-gray-400">{formatTickDate(dayToDate(0))}</span>
          <span className="text-[10px] text-gray-400">
            {formatTickDate(dayToDate(Math.floor((DAYS - 1) / 2)))}
          </span>
          <span className="text-[10px] text-gray-400">Yesterday</span>
        </div>
      </div>
    </div>
  );
}
