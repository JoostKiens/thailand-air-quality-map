import type { PowerPlantFeature } from '@thailand-aq/types';

export interface HoverInfo {
  plant: PowerPlantFeature | null;
  x: number;
  y: number;
}

interface Props {
  info: HoverInfo;
}

export function PowerPlantTooltip({ info }: Props) {
  if (!info.plant) return null;
  const p = info.plant.properties;

  return (
    <div
      style={{
        position: 'absolute',
        left: info.x + 12,
        top: info.y - 8,
        background: 'rgba(0,0,0,0.75)',
        borderRadius: 6,
        padding: '6px 10px',
        color: '#fff',
        fontSize: 12,
        lineHeight: '1.6',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
      <div>
        {p.fuel_type}
        {p.capacity_mw !== null ? ` — ${p.capacity_mw.toLocaleString()} MW` : ''}
      </div>
      {p.owner !== null && (
        <div style={{ color: 'rgba(255,255,255,0.65)' }}>Operator: {p.owner}</div>
      )}
      {p.commissioned_year !== null && (
        <div style={{ color: 'rgba(255,255,255,0.65)' }}>Online: {p.commissioned_year}</div>
      )}
    </div>
  );
}
