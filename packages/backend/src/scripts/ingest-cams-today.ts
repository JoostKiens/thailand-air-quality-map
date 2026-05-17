import 'dotenv/config';
import { runCamsIngest } from '../jobs/cams-ingest.js';

const today = new Date().toISOString().slice(0, 10);

try {
  const result = await runCamsIngest(today);
  console.log('[cams-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[cams-ingest] failed', err);
  process.exit(1);
}
