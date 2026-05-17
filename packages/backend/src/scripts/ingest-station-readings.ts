import 'dotenv/config';
import { runStationReadingsIngest } from '../jobs/station-readings-ingest.js';

try {
  const result = await runStationReadingsIngest(process.argv[2]);
  console.log('[station-readings-ingest] done', result);
  process.exit(0);
} catch (err) {
  console.error('[station-readings-ingest] failed', err);
  process.exit(1);
}
