import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import { healthRoutes } from './routes/health';
import { firesRoutes } from './routes/fires';
import { stationReadingsRoutes } from './routes/station-readings';
import { weatherRoutes } from './routes/weather';
import { stationsRoutes } from './routes/stations';
import { camsRoutes } from './routes/cams';
import { powerPlantsRoutes } from './routes/power-plants';
import { explainRoutes } from './routes/explain';
import { latestDateRoutes } from './routes/latest-date';

const app = Fastify({ logger: true });

await app.register(compress);
await app.register(cors);
await app.register(healthRoutes);
await app.register(firesRoutes);
await app.register(stationReadingsRoutes);
await app.register(weatherRoutes);
await app.register(stationsRoutes);
await app.register(camsRoutes);
await app.register(powerPlantsRoutes);
await app.register(explainRoutes);
await app.register(latestDateRoutes);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
