import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { env } from '../config/env';

let sdk: NodeSDK | undefined;

export function initializeTelemetry(): void {
  if (!env.OTEL_ENABLED) {
    return;
  }

  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
