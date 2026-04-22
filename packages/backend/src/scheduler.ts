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
console.log(`[scheduler] Connecting to Redis (${redisUrl.split('@').pop()})...`);

const connectionOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
} as const;

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
    cron: '0 4 * * *', // once daily at 04:00 UTC (11:00 BKK) — CAMS updates ~twice daily
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

// Verify connection before registering jobs
const testConn = new IORedis(redisUrl, connectionOptions);
await new Promise<void>((resolve, reject) => {
  testConn.once('ready', () => {
    console.log('[scheduler] Redis connected');
    resolve();
  });
  testConn.once('error', (err) => reject(new Error(`Redis connection failed: ${err.message}`)));
  setTimeout(() => reject(new Error('Redis connection timed out after 10s')), 10_000);
});
await testConn.quit();

// Single queue connection used only for scheduler registration, then closed.
const queueConnection = new IORedis(redisUrl, connectionOptions);
const queue = new Queue('ingest', { connection: queueConnection });

for (const job of JOBS) {
  await queue.upsertJobScheduler(job.name, { pattern: job.cron });
  console.log(`[scheduler] ${job.name} registered (${job.cron})`);
}

await queue.close();
await queueConnection.quit();

// Single persistent worker connection — blocking commands require their own connection.
const workerConnection = new IORedis(redisUrl, connectionOptions);
const worker = new Worker(
  'ingest',
  async (bullJob) => {
    const job = JOBS.find((j) => j.name === bullJob.name);
    if (!job) {
      throw new Error(`Unknown job name: ${bullJob.name}`);
    }
    console.log(`[${job.name}] starting job ${bullJob.id}`);
    const result = await job.run();
    console.log(`[${job.name}] done`, result);
  },
  {
    connection: workerConnection,
    concurrency: 1,
    // 5-minute polling interval — drastically reduces idle Redis commands vs default 30s.
    stalledInterval: 300_000,
  },
);

worker.on('failed', (bullJob, err) => {
  console.error(`[${bullJob?.name ?? 'unknown'}] job ${bullJob?.id} failed:`, err);
});

console.log('[scheduler] All jobs registered. Waiting for triggers...');
