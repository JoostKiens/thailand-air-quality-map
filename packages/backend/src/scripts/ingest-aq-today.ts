import 'dotenv/config';
import { runAqIngest } from '../jobs/aq-ingest.js';

const today = new Date().toISOString().slice(0, 10);

try {
  const result = await runAqIngest(today);
  console.log('[aq-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[aq-ingest] failed', err);
  process.exit(1);
}
