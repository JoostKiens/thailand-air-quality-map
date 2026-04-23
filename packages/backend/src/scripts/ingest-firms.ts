import 'dotenv/config';
import { runFirmsIngest } from '../jobs/firms-ingest.js';

try {
  const result = await runFirmsIngest(process.argv[2]);
  console.log('[firms-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[firms-ingest] failed', err);
  process.exit(1);
}
