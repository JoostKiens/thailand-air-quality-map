import { Sidebar, SidebarReopenButton } from './Sidebar/Sidebar';
import { SidebarToggleFAB } from './SidebarToggleFAB/SidebarToggleFAB';
import { InfoPanel } from './InfoPanel/InfoPanel';
import { AttributionBar } from './AttributionBar';

export function UIOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10 font-sans">
      <Sidebar />
      <SidebarReopenButton />
      <SidebarToggleFAB />
      <InfoPanel />
      <AttributionBar />
    </div>
  );
}
