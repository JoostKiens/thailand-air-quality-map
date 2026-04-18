import { runWindIngest } from '../jobs/wind-ingest.js';

const date = process.argv[2]; // optional YYYY-MM-DD; defaults to today
const result = await runWindIngest(date);
console.log(`Done: ${result.points} wind vectors stored`);
process.exit(0);
