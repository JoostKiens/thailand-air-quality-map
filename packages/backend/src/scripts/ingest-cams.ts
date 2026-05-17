import 'dotenv/config';
import { runCamsIngest } from '../jobs/cams-ingest.js';

try {
  const result = await runCamsIngest(process.argv[2]);
  console.log('[cams-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[cams-ingest] failed', err);
  process.exit(1);
}
