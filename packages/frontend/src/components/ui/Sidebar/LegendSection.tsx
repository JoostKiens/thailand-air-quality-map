import { AQI_CATEGORIES } from '../../../lib/aqiColors';

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const SHORT_LABELS = ['Good', 'Mod.', 'USG', 'Bad', 'V.Bad', 'Hazard'];

const gradient = AQI_CATEGORIES.map((c) => rgbToHex(c.rgb)).join(', ');

export function LegendSection() {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-3">Legend</p>

      <p className="text-[11px] text-gray-500 mb-1">PM2.5 (µg/m³)</p>
      <div
        className="h-2 rounded-full mb-1"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <div className="flex justify-between mb-4">
        {SHORT_LABELS.map((label) => (
          <span key={label} className="text-[9px] text-gray-400 leading-tight">
            {label}
          </span>
        ))}
      </div>

      <p className="text-[11px] text-gray-500 mb-2">Fire intensity</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0 opacity-50"
            style={{ backgroundColor: '#F97316' }}
          />
          <span className="text-[11px] text-gray-500">Low–medium (FRP &lt; 50 MW)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#F97316' }} />
          <span className="text-[11px] text-gray-500">High (FRP ≥ 50 MW)</span>
        </div>
      </div>
    </div>
  );
}
