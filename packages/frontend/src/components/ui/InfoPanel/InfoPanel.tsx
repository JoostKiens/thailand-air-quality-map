import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../../../store/uiStore';
import type { ClusterStation } from '../../../store/uiStore';
import { useTimeStore } from '../../../store/timeStore';
import { AqiBadge } from './AqiBadge';
import { pm25ToRgb, pm25ToCategory } from '../../../lib/aqiColors';
import { reverseGeocode } from '../../../lib/geocode';
import { findNearestAQPoint, findNearestWind, degToCompass } from '../../../lib/ambient';
import { useAQGrid } from '../../../hooks/useAQGrid';
import { useWind } from '../../../hooks/useWind';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API = import.meta.env.VITE_API_BASE_URL;

interface DayData {
  date: string;
  maxPm25: number;
  readingCount: number;
}

type HistoryState = { status: 'idle' | 'loading' | 'success' | 'error'; data: DayData[] | null };

export function InfoPanel() {
  const selectedPoint = useUIStore((s) => s.selectedPoint);
  const setSelectedPoint = useUIStore((s) => s.setSelectedPoint);
  const selectedDate = useTimeStore((s) => s.selectedDate);
  const { data: aqGrid } = useAQGrid();
  const { data: wind } = useWind();

  const [placeName, setPlaceName] = useState<string | null>(null);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [history, setHistory] = useState<HistoryState>({ status: 'idle', data: null });

  // Reverse geocode whenever coordinates change
  const coordKey = selectedPoint ? `${selectedPoint.lngLat[0]},${selectedPoint.lngLat[1]}` : null;
  useEffect(() => {
    if (!coordKey || !selectedPoint) {
      setPlaceName(null);
      return;
    }
    setPlaceName(null);
    setGeocodeLoading(true);
    void reverseGeocode(selectedPoint.lngLat[0], selectedPoint.lngLat[1], TOKEN)
      .then(setPlaceName)
      .finally(() => setGeocodeLoading(false));
  }, [coordKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch 7-day history when a station or the selected date changes
  const stationId = selectedPoint?.station?.stationId ?? null;
  useEffect(() => {
    if (!stationId) {
      setHistory({ status: 'idle', data: null });
      return;
    }
    setHistory({ status: 'loading', data: null });
    fetch(`${API}/api/stations/${stationId}/history?days=7&date=${selectedDate}`)
      .then((r) => r.json())
      .then((body: { days: DayData[] }) => setHistory({ status: 'success', data: body.days }))
      .catch(() => setHistory({ status: 'error', data: null }));
  }, [stationId, selectedDate]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedPoint(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setSelectedPoint]);

  const panelType = selectedPoint?.fire
    ? 'fire'
    : selectedPoint?.station
      ? 'station'
      : selectedPoint?.powerPlant
        ? 'powerPlant'
        : selectedPoint?.cluster
          ? 'cluster'
          : null;

  const aqPoint =
    selectedPoint && aqGrid
      ? findNearestAQPoint(aqGrid, selectedPoint.lngLat[0], selectedPoint.lngLat[1])
      : null;
  const windVec =
    selectedPoint && wind
      ? findNearestWind(wind, selectedPoint.lngLat[0], selectedPoint.lngLat[1])
      : null;

  return (
    <div
      role="region"
      aria-label="Point details"
      className="absolute top-3 right-3 w-[200px] max-h-[80vh] overflow-y-auto bg-white border border-gray-200 rounded-xl z-20 pointer-events-auto"
    >
      <AnimatePresence mode="wait">
        {!selectedPoint ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-center justify-center h-[100px] gap-2 text-gray-400"
          >
            <CursorClickIcon />
            <span className="text-sm text-center leading-tight">
              Click a point
              <br />
              on the map
            </span>
          </motion.div>
        ) : (
          <motion.div
            key={panelType}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="p-3"
          >
            <PanelHeader
              panelType={panelType}
              lngLat={selectedPoint.lngLat}
              placeName={placeName}
              geocodeLoading={geocodeLoading}
              plantName={selectedPoint.powerPlant?.name ?? null}
              onClose={() => setSelectedPoint(null)}
            />

            {panelType !== 'cluster' && <hr className="border-gray-100 my-2" />}

            {selectedPoint.station && (
              <StationPanel
                station={selectedPoint.station}
                aqPoint={aqPoint}
                windVec={windVec}
                history={history}
              />
            )}
            {selectedPoint.fire && (
              <FirePanel fire={selectedPoint.fire} aqPoint={aqPoint} windVec={windVec} />
            )}
            {selectedPoint.powerPlant && (
              <PowerPlantPanel
                plant={selectedPoint.powerPlant}
                aqPoint={aqPoint}
                windVec={windVec}
              />
            )}
            {selectedPoint.cluster && (
              <ClusterList
                stations={selectedPoint.cluster.stations}
                lngLat={selectedPoint.lngLat}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Header ---

function PanelHeader({
  panelType,
  lngLat,
  placeName,
  geocodeLoading,
  plantName,
  onClose,
}: {
  panelType: string | null;
  lngLat: [number, number];
  placeName: string | null;
  geocodeLoading: boolean;
  plantName: string | null;
  onClose: () => void;
}) {
  const badgeLabel =
    panelType === 'station'
      ? 'AQI Station'
      : panelType === 'fire'
        ? 'Fire Detection'
        : panelType === 'powerPlant'
          ? 'Power Plant'
          : panelType === 'cluster'
            ? 'Stations Nearby'
            : '';

  return (
    <div className="flex items-start justify-between">
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400 leading-tight mb-0.5">
          {badgeLabel}
        </p>
        {panelType === 'powerPlant' && plantName && (
          <p className="text-xs font-medium text-gray-700 truncate">{plantName}</p>
        )}
        {geocodeLoading ? (
          <Shimmer className="h-3 w-24 mb-0.5 mt-0.5" />
        ) : placeName ? (
          <p
            className={`truncate ${panelType === 'powerPlant' ? 'text-[11px] text-gray-400' : 'text-xs font-medium text-gray-700'}`}
          >
            {placeName}
          </p>
        ) : null}
        <p className="text-[10px] font-mono text-gray-400 leading-tight">
          {lngLat[1].toFixed(4)}°N {lngLat[0].toFixed(4)}°E
        </p>
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="text-gray-300 hover:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded shrink-0"
      >
        <XIcon />
      </button>
    </div>
  );
}

// --- Secondary section (ambient AQ + wind) ---

function SecondarySection({
  aqPoint,
  windVec,
}: {
  aqPoint: { pm25: number } | null;
  windVec: { speedKmh: number; directionDeg: number } | null;
}) {
  if (!aqPoint && !windVec) return null;

  return (
    <>
      <hr className="border-gray-100 my-2" />
      <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Ambient</p>
      {aqPoint && (
        <div className="flex justify-between items-center text-xs py-1">
          <span className="text-gray-500">AQ grid</span>
          <AqiBadge value={aqPoint.pm25} category={pm25ToCategory(aqPoint.pm25).label} />
        </div>
      )}
      {windVec && (
        <div className="flex justify-between items-center text-xs py-1">
          <span className="text-gray-500">Wind</span>
          <span className="text-gray-800 font-medium">
            {degToCompass((windVec.directionDeg + 180) % 360)} · {windVec.speedKmh.toFixed(1)} km/h
          </span>
        </div>
      )}
    </>
  );
}

// --- Station panel ---

function StationPanel({
  station,
  aqPoint,
  windVec,
  history,
}: {
  station: { stationName: string; pm25: number; unit: string; measuredAt: string };
  aqPoint: { pm25: number } | null;
  windVec: { speedKmh: number; directionDeg: number } | null;
  history: HistoryState;
}) {
  const cat = pm25ToCategory(station.pm25);
  return (
    <>
      <Row index={0}>
        <span className="text-gray-500">PM2.5</span>
        <AqiBadge value={station.pm25} category={cat.label} />
      </Row>
      {station.measuredAt && (
        <Row index={1}>
          <span className="text-[11px] text-gray-400">
            {new Date(station.measuredAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Bangkok',
            })}
          </span>
        </Row>
      )}
      <SecondarySection aqPoint={aqPoint} windVec={windVec} />
      {history.status !== 'idle' && history.status !== 'error' && (
        <>
          <hr className="border-gray-100 my-2" />
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Last 7 days</p>
          {history.status === 'loading' || !history.data ? (
            <ShimmerBars />
          ) : (
            <HistoryChart days={history.data} />
          )}
        </>
      )}
    </>
  );
}

// --- Fire panel ---

function FirePanel({
  fire,
  aqPoint,
  windVec,
}: {
  fire: { frp: number | null; confidence: string | null; detectedAt: string };
  aqPoint: { pm25: number } | null;
  windVec: { speedKmh: number; directionDeg: number } | null;
}) {
  const intensity = frpToIntensity(fire.frp);
  const conf = mapConfidence(fire.confidence);

  return (
    <>
      <Row index={0}>
        <span className="text-gray-500">Intensity</span>
        <div className="text-right">
          <div className="text-gray-800 font-medium text-xs">{intensity.label}</div>
          {intensity.raw && <div className="text-[10px] text-gray-400">{intensity.raw}</div>}
        </div>
      </Row>
      <Row index={1}>
        <span className="text-gray-500">Confidence</span>
        <span className="flex items-center gap-1 text-gray-800 font-medium">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: conf.color }}
          />
          {conf.label}
        </span>
      </Row>
      <Row index={2}>
        <span className="text-[11px] text-gray-400">
          {new Date(fire.detectedAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Bangkok',
          })}
        </span>
      </Row>
      <SecondarySection aqPoint={aqPoint} windVec={windVec} />
    </>
  );
}

// --- Power plant panel ---

function PowerPlantPanel({
  plant,
  aqPoint,
  windVec,
}: {
  plant: {
    fuelType: string;
    capacityMw: number | null;
    owner: string | null;
    commissionedYear: number | null;
    country: string;
  };
  aqPoint: { pm25: number } | null;
  windVec: { speedKmh: number; directionDeg: number } | null;
}) {
  return (
    <>
      <Row index={0}>
        <span className="text-gray-500">Fuel</span>
        <span className="text-gray-800 font-medium">{plant.fuelType}</span>
      </Row>
      {plant.capacityMw !== null && (
        <Row index={1}>
          <span className="text-gray-500">Capacity</span>
          <span className="text-gray-800 font-medium">
            {Math.round(plant.capacityMw).toLocaleString('en-US')} MW
          </span>
        </Row>
      )}
      {plant.owner && (
        <Row index={2}>
          <span className="text-gray-500">Owner</span>
          <span className="text-gray-800 font-medium truncate max-w-[100px]">{plant.owner}</span>
        </Row>
      )}
      {plant.commissionedYear !== null && (
        <Row index={3}>
          <span className="text-gray-500">Built</span>
          <span className="text-gray-800 font-medium">{plant.commissionedYear}</span>
        </Row>
      )}
      <Row index={4}>
        <span className="text-gray-500">Country</span>
        <span className="text-gray-800 font-medium">{plant.country}</span>
      </Row>
      <SecondarySection aqPoint={aqPoint} windVec={windVec} />
    </>
  );
}

// --- History chart ---

function HistoryChart({ days }: { days: DayData[] }) {
  const MAX_BAR_H = 48;
  const DAY_LABEL_H = 16;
  const maxPm25 = Math.max(...days.map((d) => d.maxPm25), 1);

  return (
    <div className="flex items-stretch gap-1">
      {/* Y-axis: max label at top, 0 label flush with bar baseline */}
      <div
        className="flex flex-col justify-between text-[9px] text-gray-400 text-right shrink-0"
        style={{ paddingBottom: `${DAY_LABEL_H}px` }}
      >
        <span>{Math.round(maxPm25)}</span>
        <span>0</span>
      </div>

      {/* Bars */}
      <div
        className="flex items-end gap-[2px] flex-1"
        style={{ height: `${MAX_BAR_H + DAY_LABEL_H}px` }}
      >
        {days.map(({ date, maxPm25: val, readingCount }) => {
          const barH = readingCount > 0 ? Math.max(2, Math.round((val / maxPm25) * MAX_BAR_H)) : 0;
          const [r, g, b] = pm25ToRgb(val);
          const weekday = new Date(date + 'T00:00:00Z').toLocaleDateString('en', {
            weekday: 'short',
            timeZone: 'UTC',
          });
          return (
            <div key={date} className="flex flex-col items-center flex-1">
              <div
                className="w-full rounded-t-sm"
                style={{
                  height: `${barH}px`,
                  backgroundColor: readingCount > 0 ? `rgb(${r},${g},${b})` : 'transparent',
                  marginTop: `${MAX_BAR_H - barH}px`,
                }}
              />
              <span
                className={`text-[9px] mt-0.5 ${readingCount > 0 ? 'text-gray-400' : 'text-gray-200'}`}
              >
                {weekday.slice(0, 3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShimmerBars() {
  return (
    <div className="flex items-end gap-[2px] h-[64px]">
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm animate-pulse bg-gray-100"
          style={{ height: `${24 + (i % 3) * 12}px` }}
        />
      ))}
    </div>
  );
}

// --- Cluster list ---

function ClusterList({
  stations,
  lngLat,
}: {
  stations: ClusterStation[];
  lngLat: [number, number];
}) {
  const setSelectedPoint = useUIStore((s) => s.setSelectedPoint);
  const sorted = [...stations].sort((a, b) => b.pm25 - a.pm25);
  return (
    <div className="space-y-1">
      {sorted.map((s, i) => {
        const [r, g, b] = pm25ToRgb(s.pm25);
        return (
          <motion.button
            key={s.stationId}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03, duration: 0.15, ease: 'easeOut' }}
            onClick={() =>
              setSelectedPoint({
                lngLat,
                station: {
                  stationId: s.stationId,
                  stationName: s.stationName,
                  pm25: s.pm25,
                  unit: 'µg/m³',
                  measuredAt: '',
                },
              })
            }
            className="w-full flex items-center gap-1.5 text-left hover:bg-gray-50 rounded px-1 py-0.5 transition-colors"
          >
            <span
              className="shrink-0 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: `rgb(${r},${g},${b})` }}
            />
            <span className="text-[11px] font-medium text-gray-700 w-8 shrink-0">
              {Math.round(s.pm25)}
            </span>
            <span className="text-[11px] text-gray-500 truncate">{s.stationName}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// --- Shared primitives ---

function Row({ children, index }: { children: React.ReactNode; index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03, duration: 0.15, ease: 'easeOut' }}
      className="flex justify-between items-center text-xs py-1"
    >
      {children}
    </motion.div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />;
}

// --- Helpers ---

function frpToIntensity(frp: number | null): { label: string; raw: string | null } {
  if (frp === null) return { label: 'Unknown intensity', raw: null };
  if (frp < 10) return { label: 'Small fire', raw: `(${frp.toFixed(0)} MW)` };
  if (frp < 50) return { label: 'Moderate fire', raw: `(${frp.toFixed(0)} MW)` };
  if (frp < 200) return { label: 'Large fire', raw: `(${frp.toFixed(0)} MW)` };
  return { label: 'Extreme fire', raw: `(${frp.toFixed(0)} MW)` };
}

function mapConfidence(raw: string | null): { label: string; color: string } {
  if (!raw) return { label: 'Unknown', color: '#9ca3af' };
  const lower = raw.toLowerCase();
  if (lower === 'low' || lower === 'l') return { label: 'Low', color: '#f59e0b' };
  if (lower === 'nominal' || lower === 'n') return { label: 'Nominal', color: '#22c55e' };
  if (lower === 'high' || lower === 'h') return { label: 'High', color: '#22c55e' };
  return { label: 'Unknown', color: '#9ca3af' };
}

// --- Icons ---

function CursorClickIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
