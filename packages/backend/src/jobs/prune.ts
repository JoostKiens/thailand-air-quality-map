import { supabase } from '../db/client.js';

// Retention policy (all dates in BKK / ICT, UTC+7):
//
//   31 days — scrubber shows T-1 (yesterday) through T-30 (30 days back),
//             plus T+0 (today) which is ingested by cron but not yet visible
//   +7 days — Explain fetches a 7-day measurement history anchored to the
//             selected date; on scrubber day 0 (T-30) that reaches back to T-37
//   +2 days — buffer for UTC+7 timezone boundary and prune job timing
//   = 40 days
const RETENTION_DAYS = 40;

export async function runPrune(): Promise<{
  firePointsDeleted: number;
  measurementsDeleted: number;
  aqGridDeleted: number;
  weatherReadingsDeleted: number;
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
    .from('station_readings')
    .delete({ count: 'exact' })
    .lt('measured_at', cutoffIso);

  if (measurementsError) {
    throw new Error(`Failed to prune measurements: ${measurementsError.message}`);
  }

  const { count: aqGridDeleted, error: aqGridError } = await supabase
    .from('cams_grid')
    .delete({ count: 'exact' })
    .lt('date', cutoffDate);

  if (aqGridError) {
    throw new Error(`Failed to prune cams_grid: ${aqGridError.message}`);
  }

  const { count: weatherReadingsDeleted, error: weatherError } = await supabase
    .from('weather_readings')
    .delete({ count: 'exact' })
    .lt('date', cutoffDate);

  if (weatherError) {
    throw new Error(`Failed to prune weather_readings: ${weatherError.message}`);
  }

  console.log(
    `[prune] Deleted ${firePointsDeleted ?? 0} fire_points, ${measurementsDeleted ?? 0} measurements, ${aqGridDeleted ?? 0} aq_grid rows, ${weatherReadingsDeleted ?? 0} weather_readings rows`,
  );
  return {
    firePointsDeleted: firePointsDeleted ?? 0,
    measurementsDeleted: measurementsDeleted ?? 0,
    aqGridDeleted: aqGridDeleted ?? 0,
    weatherReadingsDeleted: weatherReadingsDeleted ?? 0,
  };
}
