/**
 * BullMQ scheduler — registers all repeatable ingest jobs and runs the workers.
 * Run this as a persistent process alongside the Fastify server.
 *
 * Requires UPSTASH_REDIS_URL (native Redis protocol URL from the Upstash dashboard,
 * e.g. rediss://default:{token}@{host}:{port}). This is separate from the REST URL
 * used by @upstash/redis for caching.
 */

import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runFirmsIngest } from './jobs/firms-ingest.js';
import { runAqiIngest } from './jobs/aqi-ingest.js';
import { runWindIngest } from './jobs/wind-ingest.js';
import { runAqIngest } from './jobs/aq-ingest.js';
import { runPrune } from './jobs/prune.js';

const redisUrl = process.env.UPSTASH_REDIS_URL;
if (!redisUrl) throw new Error('Missing UPSTASH_REDIS_URL env var');

// BullMQ requires maxRetriesPerRequest: null and a live ioredis connection.
// enableReadyCheck: false is required for Upstash (serverless Redis).
const makeConnection = () =>
  new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------

const JOBS = [
  {
    name: 'firms-ingest',
    cron: '0 */3 * * *', // every 3 hours
    run: async () => runFirmsIngest(),
  },
  {
    name: 'aqi-ingest',
    cron: '0 * * * *', // every hour
    run: async () => runAqiIngest(),
  },
  {
    name: 'wind-ingest',
    cron: '0 */6 * * *', // every 6 hours
    run: async () => runWindIngest(),
  },
  {
    name: 'aq-ingest',
    cron: '0 */6 * * *', // every 6 hours
    run: async () => runAqIngest(),
  },
  {
    name: 'prune',
    cron: '0 2 * * *', // 2:00 UTC daily
    run: async () => runPrune(),
  },
] as const;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

for (const job of JOBS) {
  const queue = new Queue(job.name, { connection: makeConnection() });

  // upsertJobScheduler replaces any existing schedule for this ID, making the
  // setup idempotent — safe to restart the scheduler without creating duplicates.
  await queue.upsertJobScheduler(job.name, { pattern: job.cron });
  console.log(`[scheduler] ${job.name} registered (${job.cron})`);

  const worker = new Worker(
    job.name,
    async (bullJob) => {
      console.log(`[${job.name}] starting job ${bullJob.id}`);
      const result = await job.run();
      console.log(`[${job.name}] done`, result);
    },
    {
      connection: makeConnection(),
      // Prevent overlapping runs: if a job is still running when the next
      // trigger fires, BullMQ keeps the new job queued until the worker is free.
      concurrency: 1,
    },
  );

  worker.on('failed', (bullJob, err) => {
    console.error(`[${job.name}] job ${bullJob?.id} failed:`, err);
  });
}

console.log('[scheduler] All jobs registered. Waiting for triggers...');
