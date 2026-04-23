import 'dotenv/config';
import { runAqiIngest } from '../jobs/aqi-ingest.js';

try {
  const result = await runAqiIngest(process.argv[2]);
  console.log('[aqi-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[aqi-ingest] failed', err);
  process.exit(1);
}
