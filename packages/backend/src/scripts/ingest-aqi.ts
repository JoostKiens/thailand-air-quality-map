import { runAqiIngest } from '../jobs/aqi-ingest.js';

const result = await runAqiIngest();
console.log(
  `Done: ${result.stationsUpserted} stations, ${result.measurementsInserted} measurements`,
);
process.exit(0);
