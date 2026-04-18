export interface PowerPlantProperties {
  id: number;
  name: string;
  country: string;
  fuel_type: 'Coal' | 'Gas' | 'Oil';
  capacity_mw: number | null;
  owner: string | null;
  commissioned_year: number | null;
}

export interface PowerPlantFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  properties: PowerPlantProperties;
}

export interface PowerPlantCollection {
  type: 'FeatureCollection';
  features: PowerPlantFeature[];
}
