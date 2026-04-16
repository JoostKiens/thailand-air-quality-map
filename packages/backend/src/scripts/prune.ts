import { runPrune } from '../jobs/prune.js';

const result = await runPrune();
console.log(
  `Done: ${result.firePointsDeleted} fire_points deleted, ${result.measurementsDeleted} measurements deleted`,
);
process.exit(0);
