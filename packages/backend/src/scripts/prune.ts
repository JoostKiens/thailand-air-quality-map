import 'dotenv/config';
import { runPrune } from '../jobs/prune.js';

try {
  const result = await runPrune();
  console.log('[prune] done', result);
  process.exit(0);
} catch (err) {
  console.error('[prune] failed', err);
  process.exit(1);
}
