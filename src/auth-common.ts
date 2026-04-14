// ─── ECG Second Opinion — Auth Common Helpers ──────────────────────

import { timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function getBearerToken(headerValue: string | undefined): string {
  if (!headerValue) {
    throw new AuthError('AUTH_MISSING_BEARER', 'Missing Authorization bearer token');
  }

  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthError('AUTH_INVALID_BEARER', 'Invalid Authorization header format');
  }

  return token;
}

export function compareSecrets(expected: string, received: string, code: string, message: string): void {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new AuthError(code, message);
  }
}

export function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

export function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}