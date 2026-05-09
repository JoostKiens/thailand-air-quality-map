import 'dotenv/config';
import { runStationsIngest } from '../jobs/stations-ingest.js';

try {
  const result = await runStationsIngest();
  console.log('[stations-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[stations-ingest] failed', err);
  process.exit(1);
}
