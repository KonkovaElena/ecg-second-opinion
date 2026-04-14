// ─── ECG Second Opinion — Reviewer JWT Auth ────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AppConfig } from './config';
import { AuthError, decodeBase64Url, encodeBase64Url, getBearerToken } from './auth-common';

export interface ReviewerIdentity {
  readonly reviewerId: string;
  readonly reviewerRole: string;
}

interface JwtHeader {
  readonly alg?: string;
  readonly typ?: string;
}

interface JwtPayload {
  readonly sub?: string;
  readonly role?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number;
  readonly nbf?: number;
}

function parseJson<T>(value: Buffer, code: string, message: string): T {
  try {
    return JSON.parse(value.toString('utf8')) as T;
  } catch {
    throw new AuthError(code, message);
  }
}

function verifySignature(signingInput: string, signature: string, secret: string): void {
  const expected = encodeBase64Url(
    createHmac('sha256', secret).update(signingInput).digest(),
  );

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new AuthError('AUTH_INVALID_REVIEWER_SIGNATURE', 'Invalid reviewer JWT signature');
  }
}

function verifyJwt(token: string, config: AppConfig): ReviewerIdentity {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError('AUTH_INVALID_REVIEWER_TOKEN', 'Malformed reviewer JWT');
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = parseJson<JwtHeader>(
    decodeBase64Url(headerSegment),
    'AUTH_INVALID_REVIEWER_HEADER',
    'Invalid reviewer JWT header',
  );
  if (header.alg !== 'HS256') {
    throw new AuthError('AUTH_INVALID_REVIEWER_ALG', 'Reviewer JWT must use HS256');
  }

  verifySignature(`${headerSegment}.${payloadSegment}`, signatureSegment, config.reviewerJwtSecret);

  const payload = parseJson<JwtPayload>(
    decodeBase64Url(payloadSegment),
    'AUTH_INVALID_REVIEWER_PAYLOAD',
    'Invalid reviewer JWT payload',
  );

  const now = Math.floor(Date.now() / 1000);
  const skew = config.authClockSkewSeconds;

  if (typeof payload.exp !== 'number' || payload.exp < now - skew) {
    throw new AuthError('AUTH_REVIEWER_TOKEN_EXPIRED', 'Reviewer JWT has expired');
  }

  if (typeof payload.nbf === 'number' && payload.nbf > now + skew) {
    throw new AuthError('AUTH_REVIEWER_TOKEN_NOT_YET_VALID', 'Reviewer JWT is not yet valid');
  }

  if (payload.iss !== config.reviewerJwtIssuer) {
    throw new AuthError('AUTH_INVALID_REVIEWER_ISSUER', 'Invalid reviewer JWT issuer');
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(config.reviewerJwtAudience)) {
    throw new AuthError('AUTH_INVALID_REVIEWER_AUDIENCE', 'Invalid reviewer JWT audience');
  }

  if (!payload.sub || !payload.role) {
    throw new AuthError('AUTH_INVALID_REVIEWER_CLAIMS', 'Reviewer JWT must include sub and role claims');
  }

  if (!config.reviewerAllowedRoles.includes(payload.role)) {
    throw new AuthError('AUTH_REVIEWER_ROLE_DENIED', 'Reviewer role is not allowed', 403);
  }

  return {
    reviewerId: payload.sub,
    reviewerRole: payload.role,
  };
}

export function createReviewerAuthMiddleware(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(req.header('authorization'));
      req.reviewer = verifyJwt(token, config);
      next();
    } catch (error) {
      next(error);
    }
  };
}