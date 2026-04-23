import 'dotenv/config';
import { runAqIngest } from '../jobs/aq-ingest.js';

try {
  const result = await runAqIngest(process.argv[2]);
  console.log('[aq-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[aq-ingest] failed', err);
  process.exit(1);
}
