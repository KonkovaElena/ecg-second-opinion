// ─── ECG Second Opinion — Configuration ─────────────────────────────

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: string;
  readonly apiPrefix: string;
  readonly internalApiPrefix: string;
  readonly publicBaseUrl: string;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly operatorApiToken: string;
  readonly internalApiToken: string;
  readonly reviewerJwtSecret: string;
  readonly reviewerJwtIssuer: string;
  readonly reviewerJwtAudience: string;
  readonly reviewerAllowedRoles: readonly string[];
  readonly authClockSkewSeconds: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_OPERATOR_API_TOKEN = 'ecg-operator-dev-token-change-me-0001';
const DEFAULT_INTERNAL_API_TOKEN = 'ecg-internal-dev-token-change-me-0001';
const DEFAULT_REVIEWER_JWT_SECRET = 'ecg-reviewer-jwt-secret-change-me-00000000000000000000000000000000';
const DEFAULT_REVIEWER_JWT_AUDIENCE = 'ecg-second-opinion-api';

function parsePositiveInteger(rawValue: string, envName: string): number {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${envName} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInteger(rawValue: string, envName: string): number {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigError(`${envName} must be a non-negative integer`);
  }
  return value;
}

function parseAbsoluteUrl(rawValue: string, envName: string): string {
  try {
    return new URL(rawValue).toString().replace(/\/$/, '');
  } catch {
    throw new ConfigError(`${envName} must be a valid absolute URL`);
  }
}

function parseAllowedRoles(rawValue: string): readonly string[] {
  const roles = rawValue
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);

  if (roles.length === 0) {
    throw new ConfigError('ECG_REVIEWER_ALLOWED_ROLES must include at least one role');
  }

  return roles;
}

function ensureTokenConfigured(value: string, envName: string): string {
  if (value.trim().length === 0) {
    throw new ConfigError(`${envName} must not be empty`);
  }
  return value;
}

function ensureProductionSecret(
  nodeEnv: string,
  value: string,
  envName: string,
  placeholder: string,
  minLength?: number,
): string {
  if (nodeEnv !== 'production') {
    return value;
  }

  if (value === placeholder) {
    throw new ConfigError(`${envName} must be overridden in production`);
  }

  if (minLength != null && value.length < minLength) {
    throw new ConfigError(`${envName} must be at least ${minLength} characters in production`);
  }

  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const operatorApiToken = ensureTokenConfigured(
    process.env.ECG_OPERATOR_API_TOKEN ?? DEFAULT_OPERATOR_API_TOKEN,
    'ECG_OPERATOR_API_TOKEN',
  );
  const internalApiToken = ensureTokenConfigured(
    process.env.ECG_INTERNAL_API_TOKEN ?? DEFAULT_INTERNAL_API_TOKEN,
    'ECG_INTERNAL_API_TOKEN',
  );
  const reviewerJwtSecret = ensureTokenConfigured(
    process.env.ECG_REVIEWER_JWT_SECRET ?? DEFAULT_REVIEWER_JWT_SECRET,
    'ECG_REVIEWER_JWT_SECRET',
  );
  const reviewerJwtAudience = ensureTokenConfigured(
    process.env.ECG_REVIEWER_JWT_AUDIENCE ?? DEFAULT_REVIEWER_JWT_AUDIENCE,
    'ECG_REVIEWER_JWT_AUDIENCE',
  );

  return {
    port: parsePositiveInteger(process.env.PORT ?? '3100', 'PORT'),
    host: process.env.HOST ?? '0.0.0.0',
    nodeEnv,
    apiPrefix: process.env.API_PREFIX ?? '/api/v1',
    internalApiPrefix: process.env.INTERNAL_API_PREFIX ?? '/api/internal',
    publicBaseUrl: parseAbsoluteUrl(process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3100', 'PUBLIC_BASE_URL'),
    rateLimitWindowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 'RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: parsePositiveInteger(process.env.RATE_LIMIT_MAX ?? '100', 'RATE_LIMIT_MAX'),
    operatorApiToken: ensureProductionSecret(
      nodeEnv,
      operatorApiToken,
      'ECG_OPERATOR_API_TOKEN',
      DEFAULT_OPERATOR_API_TOKEN,
      32,
    ),
    internalApiToken: ensureProductionSecret(
      nodeEnv,
      internalApiToken,
      'ECG_INTERNAL_API_TOKEN',
      DEFAULT_INTERNAL_API_TOKEN,
      32,
    ),
    reviewerJwtSecret: ensureProductionSecret(
      nodeEnv,
      reviewerJwtSecret,
      'ECG_REVIEWER_JWT_SECRET',
      DEFAULT_REVIEWER_JWT_SECRET,
      32,
    ),
    reviewerJwtIssuer: process.env.ECG_REVIEWER_JWT_ISSUER ?? 'ecg-second-opinion',
    reviewerJwtAudience,
    reviewerAllowedRoles: parseAllowedRoles(
      process.env.ECG_REVIEWER_ALLOWED_ROLES ?? 'Cardiologist,Electrophysiologist',
    ),
    authClockSkewSeconds: parseNonNegativeInteger(
      process.env.ECG_AUTH_CLOCK_SKEW_SECONDS ?? '60',
      'ECG_AUTH_CLOCK_SKEW_SECONDS',
    ),
  };
}
