import { MapView } from './components/Map/MapView';
import { UIOverlay } from './components/ui/UIOverlay';
import { Scrubber } from './components/ui/Scrubber/Scrubber';

function App() {
  return (
    <div className="flex flex-col h-screen">
      <div className="relative flex-1 overflow-hidden">
        <MapView />
        <UIOverlay />
      </div>
      <Scrubber />
    </div>
  );
}

export default App;
