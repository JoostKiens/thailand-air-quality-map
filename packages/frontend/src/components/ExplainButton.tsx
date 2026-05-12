import { useEffect } from 'react';
import { useExplain } from '../hooks/useExplain';
import { useTimeStore } from '../store/timeStore';
import { sanitizeExplanation, parseBoldSegments } from '../utils/sanitize';

interface Props {
  stationId: string;
  lat: number;
  lng: number;
  globalQuotaExceeded: boolean;
  onQuotaExceeded: () => void;
}

export function ExplainButton({
  stationId,
  lat,
  lng,
  globalQuotaExceeded,
  onQuotaExceeded,
}: Props) {
  const { text, loading, error, quotaExceeded, explain, reset } = useExplain();
  const selectedDate = useTimeStore((s) => s.selectedDate);

  useEffect(() => {
    if (quotaExceeded) onQuotaExceeded();
  }, [quotaExceeded, onQuotaExceeded]);

  const isDisabled = globalQuotaExceeded || loading;
  const label = globalQuotaExceeded
    ? 'Explain this (unavailable)'
    : loading
      ? 'Thinking…'
      : text
        ? 'Refresh'
        : 'Explain this';

  function handleClick() {
    if (text && !loading) {
      reset();
      return;
    }
    if (!loading) void explain({ stationId, lat, lng, date: selectedDate });
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={[
          'w-full text-[11px] font-medium py-1 px-2 rounded border transition-colors',
          isDisabled
            ? 'border-gray-200 text-gray-300 bg-white cursor-not-allowed'
            : 'border-teal-200 text-teal-600 bg-teal-50 hover:bg-teal-100',
        ].join(' ')}
      >
        {label}
      </button>

      {text && (
        <div className="mt-2 text-[11px] text-gray-600 leading-relaxed whitespace-pre-line">
          {parseBoldSegments(sanitizeExplanation(text)).map((seg, i) =>
            seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>,
          )}
        </div>
      )}

      {error === 'quota_exceeded' && !globalQuotaExceeded && (
        <p className="mt-1 text-[10px] text-amber-600">Daily limit reached — try again tomorrow.</p>
      )}
      {error === 'unavailable' && (
        <p className="mt-1 text-[10px] text-red-400">Explanation unavailable. Try again later.</p>
      )}
    </div>
  );
}
