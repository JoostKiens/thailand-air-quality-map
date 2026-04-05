import { runAqiIngest } from '../jobs/aqi-ingest.js';

const date = process.argv[2]; // optional YYYY-MM-DD; defaults to today inside the job
const result = await runAqiIngest(date);
console.log(
  `Done: ${result.stationsUpserted} stations, ${result.measurementsInserted} measurements`,
);
process.exit(0);
