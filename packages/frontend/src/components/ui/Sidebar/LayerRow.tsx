import { useLayerStore, type LayerId } from '../../../store/layerStore';
import { Toggle } from './Toggle';

interface LayerMeta {
  label: string;
  color: string;
  shape: 'circle' | 'square' | 'arrow';
}

const LAYER_META: Record<LayerId, LayerMeta> = {
  aqGrid: { label: 'AQ grid', color: '#1D9E75', shape: 'square' },
  aqStations: { label: 'AQI stations', color: '#1D9E75', shape: 'circle' },
  wind: { label: 'Wind', color: '#93C5FD', shape: 'arrow' },
  powerPlants: { label: 'Power plants', color: '#A78BFA', shape: 'circle' },
  fires: { label: 'Fires', color: '#F97316', shape: 'circle' },
};

interface Props {
  id: LayerId;
}

export function LayerRow({ id }: Props) {
  const visible = useLayerStore((s) => s.layers[id].visible);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);
  const meta = LAYER_META[id];

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Swatch color={meta.color} shape={meta.shape} />
      <span className="flex-1 text-sm text-gray-700">{meta.label}</span>
      <Toggle checked={visible} onChange={() => toggleLayer(id)} label={`Toggle ${meta.label}`} />
    </div>
  );
}

function Swatch({ color, shape }: { color: string; shape: LayerMeta['shape'] }) {
  if (shape === 'arrow') {
    return (
      <span className="w-4 text-center text-sm font-bold leading-none" style={{ color }}>
        →
      </span>
    );
  }
  const base = 'w-2 h-2 flex-shrink-0';
  return (
    <span
      className={`${base} ${shape === 'circle' ? 'rounded-full' : 'rounded-sm'}`}
      style={{ backgroundColor: color }}
    />
  );
}
