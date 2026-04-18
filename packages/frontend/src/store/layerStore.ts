import { create } from 'zustand';

export type LayerId = 'pm25' | 'fires' | 'wind' | 'traffic' | 'burnScars' | 'powerPlants';

interface LayerState {
  visible: boolean;
  opacity: number;
}

interface LayerStore {
  layers: Record<LayerId, LayerState>;
  toggleLayer: (id: LayerId) => void;
  setOpacity: (id: LayerId, opacity: number) => void;
}

const DEFAULT_LAYER: LayerState = { visible: true, opacity: 1.0 };

export const useLayerStore = create<LayerStore>((set) => ({
  layers: {
    pm25: { ...DEFAULT_LAYER },
    fires: { ...DEFAULT_LAYER },
    wind: { ...DEFAULT_LAYER },
    traffic: { ...DEFAULT_LAYER },
    burnScars: { ...DEFAULT_LAYER },
    powerPlants: { visible: false, opacity: 1.0 },
  },
  toggleLayer: (id) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], visible: !state.layers[id].visible },
      },
    })),
  setOpacity: (id, opacity) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], opacity },
      },
    })),
}));
