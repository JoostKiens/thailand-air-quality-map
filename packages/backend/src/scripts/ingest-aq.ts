import { runAqIngest } from '../jobs/aq-ingest.js';

const date = process.argv[2]; // optional YYYY-MM-DD; defaults to today inside the job
const result = await runAqIngest(date);
console.log(`Done: ${result.stored} grid points stored`);
process.exit(0);
