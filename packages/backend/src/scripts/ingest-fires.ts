import 'dotenv/config';
import { runFiresIngest } from '../jobs/fires-ingest.js';

try {
  const result = await runFiresIngest(process.argv[2]);
  console.log('[fires-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[fires-ingest] failed', err);
  process.exit(1);
}
