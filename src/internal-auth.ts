// ─── ECG Second Opinion — Internal Bearer Auth ─────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AppConfig } from './config';
import { compareSecrets, getBearerToken } from './auth-common';

export function createInternalAuthMiddleware(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(req.header('authorization'));
      compareSecrets(
        config.internalApiToken,
        token,
        'AUTH_INVALID_INTERNAL_TOKEN',
        'Invalid internal bearer token',
      );

      next();
    } catch (error) {
      next(error);
    }
  };
}