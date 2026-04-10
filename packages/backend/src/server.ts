import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { firesRoutes } from './routes/fires';
import { measurementsRoutes } from './routes/measurements';
import { windRoutes } from './routes/wind';
import { stationsRoutes } from './routes/stations';
import { aqRoutes } from './routes/aq';

const app = Fastify({ logger: true });

await app.register(cors);
await app.register(healthRoutes);
await app.register(firesRoutes);
await app.register(measurementsRoutes);
await app.register(windRoutes);
await app.register(stationsRoutes);
await app.register(aqRoutes);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
