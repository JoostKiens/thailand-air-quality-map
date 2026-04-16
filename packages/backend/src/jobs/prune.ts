import { supabase } from '../db/client.js';

const RETENTION_DAYS = 30;

export async function runPrune(): Promise<{
  firePointsDeleted: number;
  measurementsDeleted: number;
}> {
  console.log(`[prune] Deleting records older than ${RETENTION_DAYS} days...`);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

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

  console.log(
    `[prune] Deleted ${firePointsDeleted ?? 0} fire_points, ${measurementsDeleted ?? 0} measurements`,
  );
  return {
    firePointsDeleted: firePointsDeleted ?? 0,
    measurementsDeleted: measurementsDeleted ?? 0,
  };
}
