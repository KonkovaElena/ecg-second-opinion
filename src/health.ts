// ─── ECG Second Opinion — Health Probes ─────────────────────────────

import { Router } from 'express';

const startedAt = Date.now();

export function healthRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  router.get('/readyz', (_req, res) => {
    // In production, add DB connectivity check here
    res.json({
      status: 'ready',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  return router;
}
