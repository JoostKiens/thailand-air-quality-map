import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../../../store/uiStore';
import { AqiBadge } from './AqiBadge';

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
                {selectedPoint.locationName ? (
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {selectedPoint.locationName}
                  </p>
                ) : null}
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
              {selectedPoint.aqi && (
                <Row index={0}>
                  <span className="text-[11px] text-gray-500 mr-1.5">PM2.5</span>
                  <AqiBadge
                    value={selectedPoint.aqi.value}
                    category={selectedPoint.aqi.category}
                    color={selectedPoint.aqi.color}
                  />
                </Row>
              )}
              {selectedPoint.nearestFire && (
                <Row index={1}>
                  <span className="text-[11px] text-gray-500">
                    🔥{' '}
                    {selectedPoint.nearestFire.distanceKm === 0
                      ? `FRP ${selectedPoint.nearestFire.frp} MW`
                      : `Fire ${selectedPoint.nearestFire.distanceKm} km ${selectedPoint.nearestFire.direction}`}
                  </span>
                </Row>
              )}
              {selectedPoint.wind && (
                <Row index={2}>
                  <span className="text-[11px] text-gray-500">
                    → {selectedPoint.wind.directionLabel} · {selectedPoint.wind.speedKmh} km/h
                  </span>
                </Row>
              )}
              {selectedPoint.powerPlant && (
                <Row index={3}>
                  <span className="text-[11px] text-gray-500">
                    ⚡ {selectedPoint.powerPlant.name} · {selectedPoint.powerPlant.fuelType}
                    {selectedPoint.powerPlant.capacityMw
                      ? ` ${selectedPoint.powerPlant.capacityMw} MW`
                      : ''}
                  </span>
                </Row>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
