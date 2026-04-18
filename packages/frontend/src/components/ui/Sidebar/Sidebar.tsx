import { motion } from 'motion/react';
import { useUIStore } from '../../../store/uiStore';
import { LayerGroups } from './LayerGroups';

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <motion.aside
      role="complementary"
      aria-label="Map layers"
      initial={false}
      animate={{ x: sidebarOpen ? 0 : -240 }}
      transition={SPRING}
      className="absolute left-0 top-0 bottom-0 w-[240px] bg-white border-r border-gray-200 flex-col z-20 pointer-events-auto hidden md:flex"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Layers</span>
        <button
          onClick={() => setSidebarOpen(false)}
          aria-label="Collapse sidebar"
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <ChevronLeftIcon />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <LayerGroups />
      </div>
    </motion.aside>
  );
}

export function SidebarReopenButton() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <motion.button
      initial={false}
      animate={{ x: sidebarOpen ? -40 : 0 }}
      transition={SPRING}
      onClick={() => setSidebarOpen(true)}
      aria-label="Open sidebar"
      className="absolute left-0 top-1/2 -translate-y-1/2 hidden md:flex items-center justify-center w-6 h-12 bg-white border border-l-0 border-gray-200 rounded-r-lg z-20 pointer-events-auto text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <ChevronRightIcon />
    </motion.button>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 12L6 8l4-4" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 12l4-4-4-4" />
    </svg>
  );
}
