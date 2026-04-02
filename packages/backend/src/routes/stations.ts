import type { FastifyInstance } from 'fastify';

export function stationsRoutes(app: FastifyInstance): void {
  app.get('/api/stations', (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' });
  });
}
