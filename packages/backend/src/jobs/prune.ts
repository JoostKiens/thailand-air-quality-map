import { supabase } from '../db/client.js';

// 30 days of scrubber window + 1 for today's ingested data (not yet visible on scrubber)
// + 1 to cover the UTC+7 offset (BKK midnight = UTC prev-day 17:00, so "30 days ago BKK"
// can be 30d 7h ago UTC and would be pruned too early with exactly 30 days).
const RETENTION_DAYS = 32;

export async function runPrune(): Promise<{
  firePointsDeleted: number;
  measurementsDeleted: number;
  aqGridDeleted: number;
}> {
  console.log(`[prune] Deleting records older than ${RETENTION_DAYS} days...`);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoff.toISOString().slice(0, 10); // aq_grid.date is type `date`

  const { count: firePointsDeleted, error: fireError } = await supabase
    .from('fire_points')
    .delete({ count: 'exact' })
    .lt('detected_at', cutoffIso);

  if (fireError) {
    throw new Error(`Failed to prune fire_points: ${fireError.message}`);
  }

  const { count: measurementsDeleted, error: measurementsError } = await supabase
    .from('measurements')
    .delete({ count: 'exact' })
    .lt('measured_at', cutoffIso);

  if (measurementsError) {
    throw new Error(`Failed to prune measurements: ${measurementsError.message}`);
  }

  const { count: aqGridDeleted, error: aqGridError } = await supabase
    .from('aq_grid')
    .delete({ count: 'exact' })
    .lt('date', cutoffDate);

  if (aqGridError) {
    throw new Error(`Failed to prune aq_grid: ${aqGridError.message}`);
  }

  console.log(
    `[prune] Deleted ${firePointsDeleted ?? 0} fire_points, ${measurementsDeleted ?? 0} measurements, ${aqGridDeleted ?? 0} aq_grid rows`,
  );
  return {
    firePointsDeleted: firePointsDeleted ?? 0,
    measurementsDeleted: measurementsDeleted ?? 0,
    aqGridDeleted: aqGridDeleted ?? 0,
  };
}
