import { motion } from 'motion/react';
import { useUIStore } from '../../store/uiStore';

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function AttributionBar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <motion.div
      initial={false}
      animate={{ left: sidebarOpen ? 240 : 0 }}
      transition={SPRING}
      className="absolute bottom-0 z-20 pointer-events-auto"
    >
      <p className="text-[10px] text-white/60 bg-black/30 px-2 py-0.5 leading-none">
        NASA FIRMS ·{' '}
        <a href="https://openaq.org" target="_blank" rel="noreferrer" className="underline">
          OpenAQ
        </a>{' '}
        CC BY 4.0 ·{' '}
        <a href="https://open-meteo.com" target="_blank" rel="noreferrer" className="underline">
          Open-Meteo
        </a>{' '}
        CC BY 4.0
      </p>
    </motion.div>
  );
}
