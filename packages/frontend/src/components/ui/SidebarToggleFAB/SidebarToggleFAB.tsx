import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayerGroups } from '../Sidebar/LayerGroups';

const DRAWER_SPRING = { type: 'spring' as const, stiffness: 400, damping: 40 };

export function SidebarToggleFAB() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="Open layer controls"
        className="absolute bottom-4 left-4 md:hidden w-11 h-11 rounded-full bg-white border border-gray-200 shadow-md z-30 pointer-events-auto flex items-center justify-center text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <LayersIcon />
      </button>

      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-black/30 z-40 pointer-events-auto md:hidden"
            />

            {/* Drawer */}
            <motion.div
              key="drawer"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={DRAWER_SPRING}
              className="fixed bottom-0 left-0 right-0 max-h-[70vh] bg-white rounded-t-2xl z-50 overflow-y-auto pointer-events-auto md:hidden"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-gray-300" />
              </div>

              {/* Close button */}
              <div className="flex justify-end px-4 pb-1">
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close layer controls"
                  className="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded"
                >
                  <XIcon />
                </button>
              </div>

              <LayerGroups />
              <div className="h-4" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function LayersIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
