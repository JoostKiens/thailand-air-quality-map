import { AQI_CATEGORIES } from '../../layers/PM25Layer';

export function AQILegend() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 32,
        left: 12,
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
        PM2.5 (µg/m³)
      </div>
      {AQI_CATEGORIES.map((cat) => (
        <div
          key={cat.label}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              flexShrink: 0,
              background: `rgb(${cat.rgb[0]},${cat.rgb[1]},${cat.rgb[2]})`,
            }}
          />
          <span style={{ flex: 1 }}>{cat.label}</span>
          <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>{cat.range}</span>
        </div>
      ))}
    </div>
  );
}
