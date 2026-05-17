import 'dotenv/config';
import { runAqiIngest } from '../jobs/aqi-ingest.js';

const today = new Date().toISOString().slice(0, 10);

try {
  const result = await runAqiIngest(today);
  console.log('[aqi-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[aqi-ingest] failed', err);
  process.exit(1);
}
