export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  provider: string | null;
  isMobile: boolean;
  isMonitor: boolean | null;
  parameters: string[];
}
