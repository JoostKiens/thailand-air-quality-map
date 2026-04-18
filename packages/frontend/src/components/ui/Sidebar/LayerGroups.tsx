import { useLayerStore } from '../../../store/layerStore';
import { useUIStore } from '../../../store/uiStore';
import { AQI_CATEGORIES } from '../../../lib/aqiColors';
import { FUEL_COLORS } from '../../../layers/PowerPlantsLayer';
import { baseRadiusForZoom } from '../../../layers/FiresLayer';
import { Toggle } from './Toggle';

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const AQI_GRADIENT = AQI_CATEGORIES.map((c) => rgbToHex(c.rgb)).join(', ');
const AQI_SHORT_LABELS = ['Good', 'Mod.', 'USG', 'Unhealthy', 'V.Bad', 'Hazard'];

function GroupHeader({
  label,
  checked,
  onToggle,
  toggleLabel,
}: {
  label: string;
  checked?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm uppercase tracking-wide text-gray-700 mb-2">{label}</p>
      {onToggle && toggleLabel && checked !== undefined && (
        <Toggle checked={checked} onChange={onToggle} label={toggleLabel} />
      )}
    </div>
  );
}

function SubRow({
  label,
  checked,
  onToggle,
  toggleLabel,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  toggleLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="flex-1 text-sm text-gray-400">{label}</span>
      <Toggle checked={checked} onChange={onToggle} label={toggleLabel} />
    </div>
  );
}

function AirQualityGroup() {
  const aqGrid = useLayerStore((s) => s.layers.aqGrid.visible);
  const aqStations = useLayerStore((s) => s.layers.aqStations.visible);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  return (
    <article className="px-4 py-3">
      <GroupHeader label="Air Quality (PM2.5)" />
      <SubRow
        label="Open-Meteo background"
        checked={aqGrid}
        onToggle={() => toggleLayer('aqGrid')}
        toggleLabel="Toggle AQ grid"
      />
      <SubRow
        label="OpenAQ stations"
        checked={aqStations}
        onToggle={() => toggleLayer('aqStations')}
        toggleLabel="Toggle OpenAQ stations"
      />
      {(aqGrid || aqStations) && (
        <div className="mt-2.5">
          <p className="text-[9px] text-gray-400 mb-0.5">µg/m³ PM2.5</p>
          <div
            className="h-2 rounded-full mb-1"
            style={{ background: `linear-gradient(to right, ${AQI_GRADIENT})` }}
          />
          <div className="flex justify-between">
            {AQI_SHORT_LABELS.map((l) => (
              <span key={l} className="text-[9px] text-gray-400 leading-tight">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

// Display radii per zoom tier × intensity extreme.
// Layer uses pixel radii 1/3/6; these are scaled for legibility, not pixel-accurate.
function fireLegendRadii(baseR: number): [lowR: number, highR: number] {
  if (baseR === 1) return [3, 6];
  if (baseR === 3) return [5, 9];
  return [7, 12]; // baseR === 6
}

function FireSwatch({ r, dim }: { r: number; dim?: boolean }) {
  const size = r * 2;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={r} cy={r} r={r - 0.5} fill="#f97316" fillOpacity={dim ? 0.35 : 0.9} />
    </svg>
  );
}

function FiresGroup() {
  const visible = useLayerStore((s) => s.layers.fires.visible);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);
  const zoom = useUIStore((s) => s.mapZoom);
  const [lowR, highR] = fireLegendRadii(baseRadiusForZoom(zoom));

  return (
    <article className="px-4 py-3">
      <GroupHeader
        label="Fires"
        checked={visible}
        onToggle={() => toggleLayer('fires')}
        toggleLabel="Toggle fires"
      />
      {visible && (
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="w-6 flex items-center justify-center shrink-0">
              <FireSwatch r={lowR} dim />
            </span>
            <span className="text-[10px] text-gray-400">Low FRP</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-6 flex items-center justify-center shrink-0">
              <FireSwatch r={highR} />
            </span>
            <span className="text-[10px] text-gray-400">High FRP</span>
          </div>
          <p className="text-[9px] text-gray-400 mt-1">
            Size scales with zoom &amp; fire radiative power
          </p>
        </div>
      )}
    </article>
  );
}

function WindGroup() {
  const visible = useLayerStore((s) => s.layers.wind.visible);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  return (
    <article className="px-4 py-3">
      <GroupHeader
        label="Wind"
        checked={visible}
        onToggle={() => toggleLayer('wind')}
        toggleLabel="Toggle wind"
      />
    </article>
  );
}

function PowerPlantsGroup() {
  const visible = useLayerStore((s) => s.layers.powerPlants.visible);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  return (
    <article className="px-4 py-3">
      <GroupHeader
        label="Power Plants"
        checked={visible}
        onToggle={() => toggleLayer('powerPlants')}
        toggleLabel="Toggle power plants"
      />
      {visible && (
        <div className="mt-2.5 space-y-1.5">
          {Object.entries(FUEL_COLORS).map(([fuel, color]) => (
            <div key={fuel} className="flex items-center gap-2">
              <DiamondSwatch color={color} />
              <span className="text-[10px] text-gray-400">{fuel}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function DiamondSwatch({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
      <polygon points="5,0 10,5 5,10 0,5" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function LayerGroups() {
  return (
    <>
      <AirQualityGroup />
      <div className="mx-4 border-t border-gray-100" />
      <FiresGroup />
      <div className="mx-4 border-t border-gray-100" />
      <WindGroup />
      <div className="mx-4 border-t border-gray-100" />
      <PowerPlantsGroup />
    </>
  );
}
