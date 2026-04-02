import { runWindIngest } from '../jobs/wind-ingest.js';

const result = await runWindIngest();
console.log(`Done: ${result.points} wind vectors stored`);
process.exit(0);
