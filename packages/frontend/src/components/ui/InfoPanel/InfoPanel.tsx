import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../../../store/uiStore';
import type { ClusterStation } from '../../../store/uiStore';
import { AqiBadge } from './AqiBadge';
import { AQI_CATEGORIES, pm25ToRgb } from '../../../lib/aqiColors';

export function InfoPanel() {
  const selectedPoint = useUIStore((s) => s.selectedPoint);
  const setSelectedPoint = useUIStore((s) => s.setSelectedPoint);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedPoint(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setSelectedPoint]);

  return (
    <div
      role="region"
      aria-label="Point details"
      className="absolute top-3 right-3 w-[200px] bg-white border border-gray-200 rounded-xl z-20 pointer-events-auto overflow-hidden"
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
            key="populated"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="p-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 leading-tight mb-0.5">
                  {selectedPoint.fire && 'Fire detection'}
                  {selectedPoint.station && 'AQI station'}
                  {selectedPoint.powerPlant && 'Power plant'}
                  {selectedPoint.cluster &&
                    `${selectedPoint.cluster.stations.length} stations nearby`}
                </p>
                {selectedPoint.station && (
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {selectedPoint.station.stationName}
                  </p>
                )}
                {selectedPoint.powerPlant && (
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {selectedPoint.powerPlant.name}
                  </p>
                )}
                <p className="text-[10px] font-mono text-gray-400 leading-tight">
                  {selectedPoint.lngLat[1].toFixed(4)}°N {selectedPoint.lngLat[0].toFixed(4)}°E
                </p>
              </div>
              <button
                onClick={() => setSelectedPoint(null)}
                aria-label="Dismiss"
                className="text-gray-300 hover:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded shrink-0"
              >
                <XIcon />
              </button>
            </div>

            {/* Rows */}
            <div className="space-y-1.5">
              {selectedPoint.station &&
                (() => {
                  const pm25 = selectedPoint.station.pm25;
                  const bp = [12.0, 35.4, 55.4, 150.4, 250.4];
                  const cat = AQI_CATEGORIES.find((_, i) => pm25 <= (bp[i] ?? Infinity));
                  return (
                    <>
                      <Row index={0}>
                        <span className="text-[11px] text-gray-500 mr-1.5">PM2.5</span>
                        <AqiBadge value={pm25} category={cat?.label ?? ''} />
                      </Row>
                      <Row index={1}>
                        <span className="text-[11px] text-gray-400">
                          {new Date(selectedPoint.station.measuredAt).toLocaleString('en-GB', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Bangkok',
                          })}
                        </span>
                      </Row>
                    </>
                  );
                })()}
              {selectedPoint.fire && (
                <>
                  <Row index={0}>
                    <span className="text-[11px] text-gray-500">
                      {selectedPoint.fire.frp !== null
                        ? `FRP ${selectedPoint.fire.frp.toFixed(1)} MW`
                        : 'No FRP data'}
                    </span>
                  </Row>
                  {selectedPoint.fire.confidence && (
                    <Row index={1}>
                      <span className="text-[11px] text-gray-400 capitalize">
                        Confidence: {selectedPoint.fire.confidence}
                      </span>
                    </Row>
                  )}
                  <Row index={2}>
                    <span className="text-[11px] text-gray-400">
                      {new Date(selectedPoint.fire.detectedAt).toLocaleString('en-GB', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Bangkok',
                      })}
                    </span>
                  </Row>
                </>
              )}
              {selectedPoint.powerPlant && (
                <Row index={0}>
                  <span className="text-[11px] text-gray-500">
                    {selectedPoint.powerPlant.fuelType}
                    {selectedPoint.powerPlant.capacityMw !== null
                      ? ` · ${selectedPoint.powerPlant.capacityMw} MW`
                      : ''}
                  </span>
                </Row>
              )}
              {selectedPoint.cluster && (
                <ClusterList
                  stations={selectedPoint.cluster.stations}
                  lngLat={selectedPoint.lngLat}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

function Row({ children, index }: { children: React.ReactNode; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03, duration: 0.15, ease: 'easeOut' }}
      className="flex items-center flex-wrap gap-1"
    >
      {children}
    </motion.div>
  );
}

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
