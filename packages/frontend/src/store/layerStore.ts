import { create } from 'zustand';

export type LayerId = 'aqGrid' | 'aqStations' | 'fires' | 'wind' | 'powerPlants';

interface LayerState {
  visible: boolean;
  opacity: number;
}

interface LayerStore {
  layers: Record<LayerId, LayerState>;
  toggleLayer: (id: LayerId) => void;
  setOpacity: (id: LayerId, opacity: number) => void;
}

const ON: LayerState = { visible: true, opacity: 1.0 };

export const useLayerStore = create<LayerStore>((set) => ({
  layers: {
    aqGrid: { ...ON },
    aqStations: { ...ON },
    fires: { ...ON },
    wind: { ...ON },
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
