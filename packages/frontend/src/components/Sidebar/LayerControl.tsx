import { useLayerStore, type LayerId } from '../../store/layerStore';

const LAYERS: Array<{ id: LayerId; label: string }> = [
  { id: 'pm25', label: 'PM2.5 / AQI' },
  { id: 'fires', label: 'Fires' },
  { id: 'wind', label: 'Wind' },
  { id: 'powerPlants', label: 'Power plants' },
];

export function LayerControl() {
  const layers = useLayerStore((s) => s.layers);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        background: 'rgba(0,0,0,0.65)',
        borderRadius: 8,
        padding: '8px 12px',
        color: '#fff',
        fontSize: 12,
        lineHeight: '1.5',
        pointerEvents: 'auto',
        userSelect: 'none',
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Layers</div>
      {LAYERS.map(({ id, label }) => {
        const on = layers[id].visible;
        return (
          <div
            key={id}
            onClick={() => toggleLayer(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              cursor: 'pointer',
              opacity: on ? 1 : 0.5,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '1.5px solid rgba(255,255,255,0.8)',
                background: on ? 'rgba(255,255,255,0.8)' : 'transparent',
                flexShrink: 0,
              }}
            />
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
