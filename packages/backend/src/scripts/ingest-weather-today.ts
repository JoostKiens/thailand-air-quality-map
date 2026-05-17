import 'dotenv/config';
import { runWeatherIngest } from '../jobs/weather-ingest.js';

const today = new Date().toISOString().slice(0, 10);

try {
  const result = await runWeatherIngest(today);
  console.log('[weather-ingest] done', result);
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[weather-ingest] failed: ${msg}`);
  process.exit(1);
}
