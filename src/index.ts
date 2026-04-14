// ─── ECG Second Opinion — Entry Point ───────────────────────────────
// Wires dependencies and starts the Express server with graceful shutdown.

import { createApp } from './app';
import { loadConfig } from './config';
import { InMemoryEcgCaseRepository } from './case-repository';
import { MetadataFallbackInferenceService } from './inference-service';
import { DefaultEcgClinicalSafetyPolicy } from './safety-policy';

const config = loadConfig();

const app = createApp({
  repository: new InMemoryEcgCaseRepository(),
  inferenceService: new MetadataFallbackInferenceService(),
  safetyPolicy: new DefaultEcgClinicalSafetyPolicy(),
  config,
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `[ECG-Second-Opinion] Listening on ${config.host}:${config.port} (${config.nodeEnv})`,
  );
});

// ── Graceful Shutdown ───────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[ECG-Second-Opinion] ${signal} received. Shutting down…`);
  server.close(() => {
    console.log('[ECG-Second-Opinion] Server closed.');
    process.exitCode = 0;
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
