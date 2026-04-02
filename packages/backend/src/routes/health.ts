import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    const [cacheStatus, dbStatus] = await Promise.all([checkCache(), checkDb()]);

    const ok = cacheStatus === 'connected' && dbStatus === 'connected';

    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      cache: cacheStatus,
      db: dbStatus,
      queues: {},
    });
  });
}

async function checkCache(): Promise<'connected' | 'error'> {
  try {
    await redis.ping();
    return 'connected';
  } catch {
    return 'error';
  }
}

async function checkDb(): Promise<'connected' | 'error'> {
  try {
    const { error } = await supabase.from('fire_points').select('id').limit(1);
    // "relation does not exist" means the DB is reachable but the table isn't created yet — still connected
    if (error && !error.message.includes('relation') && !error.message.includes('does not exist')) {
      console.error('[health] Supabase error:', error);
      return 'error';
    }
    return 'connected';
  } catch (e) {
    console.error('[health] Supabase exception:', e);
    return 'error';
  }
}
