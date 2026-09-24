import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requests HTTP procesadas',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export async function metricsPayload(): Promise<string> {
  return metricsRegistry.metrics();
}
