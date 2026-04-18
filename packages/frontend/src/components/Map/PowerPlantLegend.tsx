import { FUEL_COLORS } from '../../layers/PowerPlantsLayer';

const FUELS: Array<{ key: string; label: string }> = [
  { key: 'Coal', label: 'Coal plant' },
  { key: 'Gas', label: 'Gas plant' },
  { key: 'Oil', label: 'Oil plant' },
];

export function PowerPlantLegend() {
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.65)',
        borderRadius: 8,
        padding: '8px 12px',
        color: '#fff',
        fontSize: 12,
        lineHeight: '1.5',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
        Power plants
      </div>
      {FUELS.map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <svg width={12} height={12} viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
            <polygon
              points="6,0 12,6 6,12 0,6"
              fill="none"
              stroke={FUEL_COLORS[key]}
              strokeWidth={1.5}
            />
          </svg>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
