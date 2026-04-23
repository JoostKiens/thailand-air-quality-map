import 'dotenv/config';
import { runWindIngest } from '../jobs/wind-ingest.js';

try {
  const result = await runWindIngest(process.argv[2]);
  console.log('[wind-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[wind-ingest] failed', err);
  process.exit(1);
}
