// ─── ECG Second Opinion — Correlation ID Middleware ──────────────────
// Extracts or generates X-Correlation-Id for request tracing.

import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers[CORRELATION_HEADER];
  const correlationId = typeof existing === 'string' && existing.length > 0
    ? existing
    : uuidv4();

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}
