import { runFirmsIngest } from '../jobs/firms-ingest.js';

const date = process.argv[2]; // optional YYYY-MM-DD; defaults to today inside the job
const result = await runFirmsIngest(date);
console.log(`Done: ${result.inserted} rows upserted`);
process.exit(0);
