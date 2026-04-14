import { afterEach, describe, expect, it } from '@jest/globals';
import { loadConfig } from '../src/config';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

describe('loadConfig', () => {
  afterEach(() => {
    resetEnv();
  });

  it('should provide development-safe defaults', () => {
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.ECG_REVIEWER_JWT_AUDIENCE;

    const config = loadConfig();
    const configRecord = config as unknown as Record<string, unknown>;

    expect(config.port).toBe(3100);
    expect(config.nodeEnv).toBe('development');
    expect(config.publicBaseUrl).toBe('http://127.0.0.1:3100');
    expect(config.reviewerAllowedRoles).toEqual(['Cardiologist', 'Electrophysiologist']);
    expect(configRecord.reviewerJwtAudience).toBe('ecg-second-opinion-api');
  });

  it('should reject invalid numeric configuration values', () => {
    process.env.PORT = 'not-a-number';

    expect(() => loadConfig()).toThrow('PORT must be a positive integer');
  });

  it('should reject invalid public base url values', () => {
    process.env.PUBLIC_BASE_URL = 'not-a-url';

    expect(() => loadConfig()).toThrow('PUBLIC_BASE_URL must be a valid absolute URL');
  });

  it('should reject an empty reviewer audience', () => {
    process.env.ECG_REVIEWER_JWT_AUDIENCE = '';

    expect(() => loadConfig()).toThrow('ECG_REVIEWER_JWT_AUDIENCE must not be empty');
  });

  it('should reject production operator placeholder tokens', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ECG_OPERATOR_API_TOKEN;

    expect(() => loadConfig()).toThrow('ECG_OPERATOR_API_TOKEN must be overridden in production');
  });

  it('should reject production internal placeholder tokens', () => {
    process.env.NODE_ENV = 'production';
    process.env.ECG_OPERATOR_API_TOKEN = 'operator-production-token-1234567890';
    delete process.env.ECG_INTERNAL_API_TOKEN;

    expect(() => loadConfig()).toThrow('ECG_INTERNAL_API_TOKEN must be overridden in production');
  });

  it('should reject production operator tokens shorter than 32 characters', () => {
    process.env.NODE_ENV = 'production';
    process.env.ECG_OPERATOR_API_TOKEN = 'too-short-operator-token';
    process.env.ECG_INTERNAL_API_TOKEN = 'internal-production-token-1234567890';
    process.env.ECG_REVIEWER_JWT_SECRET = 'reviewer-secret-12345678901234567890';

    expect(() => loadConfig()).toThrow('ECG_OPERATOR_API_TOKEN must be at least 32 characters in production');
  });

  it('should reject production internal tokens shorter than 32 characters', () => {
    process.env.NODE_ENV = 'production';
    process.env.ECG_OPERATOR_API_TOKEN = 'operator-production-token-1234567890';
    process.env.ECG_INTERNAL_API_TOKEN = 'too-short-internal-token';
    process.env.ECG_REVIEWER_JWT_SECRET = 'reviewer-secret-12345678901234567890';

    expect(() => loadConfig()).toThrow('ECG_INTERNAL_API_TOKEN must be at least 32 characters in production');
  });

  it('should reject production reviewer secrets shorter than 32 characters', () => {
    process.env.NODE_ENV = 'production';
    process.env.ECG_OPERATOR_API_TOKEN = 'operator-production-token-1234567890';
    process.env.ECG_INTERNAL_API_TOKEN = 'internal-production-token-1234567890';
    process.env.ECG_REVIEWER_JWT_SECRET = 'too-short';

    expect(() => loadConfig()).toThrow('ECG_REVIEWER_JWT_SECRET must be at least 32 characters in production');
  });
});