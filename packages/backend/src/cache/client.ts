import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token)
  throw new Error(
    'Missing Upstash Redis env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required',
  );

export const redis = new Redis({ url, token });

// All data the frontend requests is historical (T-1 to T-30) and immutable after ingestion.
export const HISTORICAL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
