// ─── ECG Second Opinion — Operator API Key Auth ────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AppConfig } from './config';
import { AuthError, compareSecrets } from './auth-common';

const OPERATOR_HEADER = 'x-api-key';

export function createOperatorAuthMiddleware(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const apiKey = req.header(OPERATOR_HEADER);
      if (!apiKey) {
        throw new AuthError('AUTH_MISSING_OPERATOR_TOKEN', 'Missing operator API key');
      }

      compareSecrets(
        config.operatorApiToken,
        apiKey,
        'AUTH_INVALID_OPERATOR_TOKEN',
        'Invalid operator API key',
      );

      next();
    } catch (error) {
      next(error);
    }
  };
}