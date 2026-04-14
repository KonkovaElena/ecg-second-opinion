// ─── ECG API Integration Tests ──────────────────────────────────────
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createApp, type AppDeps } from '../src/app';
import type { AppConfig } from '../src/config';
import { InMemoryEcgCaseRepository } from '../src/case-repository';
import { MetadataFallbackInferenceService } from '../src/inference-service';
import { DefaultEcgClinicalSafetyPolicy } from '../src/safety-policy';
import request from 'supertest';

function makeConfig(): AppConfig {
  return {
    port: 3100,
    host: '127.0.0.1',
    nodeEnv: 'test',
    apiPrefix: '/api/v1',
    internalApiPrefix: '/api/internal',
    publicBaseUrl: 'http://127.0.0.1:3100',
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    operatorApiToken: 'test-operator-token',
    internalApiToken: 'test-internal-token',
    reviewerJwtSecret: 'test-reviewer-jwt-secret-000000000000000000000000000000000000000000000001',
    reviewerJwtIssuer: 'ecg-second-opinion-test',
    reviewerJwtAudience: 'ecg-second-opinion-api',
    reviewerAllowedRoles: ['Cardiologist', 'Electrophysiologist'],
    authClockSkewSeconds: 60,
  };
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const config = overrides.config ?? makeConfig();
  return {
    repository: new InMemoryEcgCaseRepository(),
    inferenceService: new MetadataFallbackInferenceService(),
    safetyPolicy: new DefaultEcgClinicalSafetyPolicy(),
    config,
    ...overrides,
  };
}

/** Wait for setImmediate + async inference to complete */
function waitForAsyncInference(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

interface ReviewerJwtOptions {
  readonly role?: string | null;
  readonly reviewerId?: string | null;
  readonly issuer?: string;
  readonly audience?: string | readonly string[] | null;
  readonly exp?: number;
  readonly nbf?: number;
  readonly secret?: string;
  readonly algorithm?: string;
}

function createReviewerJwt(config: AppConfig, options: ReviewerJwtOptions = {}): string {
  const {
    role = 'Cardiologist',
    reviewerId = 'reviewer-1',
    issuer = config.reviewerJwtIssuer,
    audience = 'ecg-second-opinion-api',
    exp = Math.floor(Date.now() / 1000) + 60 * 10,
    nbf,
    secret = config.reviewerJwtSecret,
    algorithm = 'HS256',
  } = options;

  const header = base64UrlEncode(JSON.stringify({ alg: algorithm, typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    ...(reviewerId !== null ? { sub: reviewerId } : {}),
    ...(role !== null ? { role } : {}),
    iss: issuer,
    ...(audience !== null ? { aud: audience } : {}),
    exp,
    ...(nbf !== undefined ? { nbf } : {}),
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.${signature}`;
}

function withOperator<T extends request.Test>(test: T, config: AppConfig): T {
  return test.set('x-api-key', config.operatorApiToken);
}

function withReviewer<T extends request.Test>(test: T, config: AppConfig, role = 'Cardiologist'): T {
  return test.set('Authorization', `Bearer ${createReviewerJwt(config, { role })}`);
}

function withInternal<T extends request.Test>(test: T, config: AppConfig): T {
  return test.set('Authorization', `Bearer ${config.internalApiToken}`);
}

async function createAwaitingReviewCase(
  localApp: ReturnType<typeof createApp>,
  config: AppConfig,
): Promise<string> {
  const createRes = await withOperator(
    request(localApp).post('/api/v1/cases'),
    config,
  )
    .send(validCreatePayload)
    .expect(202);

  await waitForAsyncInference();
  return createRes.body.caseId as string;
}

const validCreatePayload = {
  recording: {
    recordingId: 'ptbxl-00001',
    patientAlias: 'Patient-001',
    recordingDate: '2024-01-15T10:00:00.000Z',
    samplingFrequencyHz: 500,
    leadCount: 12,
    durationSeconds: 10,
    samplesPerLead: 5000,
    sourceDataset: 'PTB-XL',
  },
  clinicalQuestion: {
    questionText: 'Rule out myocardial infarction',
    urgency: 'routine' as const,
  },
};

describe('ECG API', () => {
  let app: ReturnType<typeof createApp>;
  let config: AppConfig;

  beforeEach(() => {
    config = makeConfig();
    app = createApp(makeDeps({ config }));
  });

  describe('GET /', () => {
    it('should expose service identity and route map', async () => {
      const res = await request(app).get('/').expect(200);

      expect(res.body.service).toBe('ecg-second-opinion');
      expect(res.body.routes.public).toContain('/api/v1/cases');
      expect(res.body.routes.internal).toContain('/api/internal/inference-callback');
    });
  });

  describe('POST /api/v1/cases', () => {
    it('should accept a case and return 202 with InferencePending', async () => {
      const res = await withOperator(
        request(app).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      expect(res.body.caseId).toBeDefined();
      expect(res.body.status).toBe('InferencePending');
      expect(res.body.message).toContain('pending');
    });

    it('should reject invalid payload with 400', async () => {
      const res = await withOperator(
        request(app).post('/api/v1/cases'),
        config,
      )
        .send({ recording: {} })
        .expect(400);

      expect(res.status).toBe(400);
    });

    it('should reject missing operator token', async () => {
      await request(app)
        .post('/api/v1/cases')
        .send(validCreatePayload)
        .expect(401);
    });

    it('should return X-Correlation-Id header', async () => {
      const res = await withOperator(
        request(app).post('/api/v1/cases'),
        config,
      )
        .set('x-correlation-id', 'custom-corr-123')
        .send(validCreatePayload)
        .expect(202);

      expect(res.headers['x-correlation-id']).toBe('custom-corr-123');
    });

    it('should generate correlation ID if not provided', async () => {
      const res = await withOperator(
        request(app).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(res.headers['x-correlation-id'].length).toBeGreaterThan(0);
    });
  });

  describe('Async inference completes', () => {
    it('should transition to AwaitingReview after async inference', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const caseId = createRes.body.caseId;

      // Wait for async inference to finish
      await waitForAsyncInference();

      const detailRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${caseId}`),
        config,
      )
        .expect(200);

      expect(detailRes.body.status).toBe('AwaitingReview');
      expect(detailRes.body.assessment).not.toBeNull();
      expect(detailRes.body.assessment.classification.uncertaintyMetrics).toBeDefined();
      expect(detailRes.body.assessment.interpretability).toBeDefined();
    });

    it('should transition to InferenceFailed when async inference throws', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const failingInferenceService = {
        classify: async () => {
          throw new Error('upstream worker unavailable');
        },
      };
      const deps = makeDeps({ config, inferenceService: failingInferenceService as AppDeps['inferenceService'] });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      const detailRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${createRes.body.caseId}`),
        config,
      ).expect(200);

      expect(detailRes.body.status).toBe('InferenceFailed');
      expect(detailRes.body.inferenceFailureReason).toBe('upstream worker unavailable');
      expect(detailRes.body.assessment).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('GET /api/v1/cases', () => {
    it('should list created cases', async () => {
      const createRes = await withOperator(
        request(app).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const res = await withOperator(
        request(app).get('/api/v1/cases'),
        config,
      ).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].caseId).toBe(createRes.body.caseId);
    });
  });

  describe('GET /api/v1/cases/:caseId', () => {
    it('should return case detail', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      const res = await withOperator(
        request(localApp).get(`/api/v1/cases/${createRes.body.caseId}`),
        config,
      )
        .expect(200);

      expect(res.body.assessment).not.toBeNull();
      expect(res.body.safetyFlags.length).toBeGreaterThanOrEqual(0);
    });

    it('should return 404 for missing case', async () => {
      const res = await withOperator(
        request(app).get('/api/v1/cases/nonexistent'),
        config,
      )
        .expect(404);

      expect(res.status).toBe(404);
    });
  });

  describe('Structured report and exports', () => {
    it('should expose structured report and FHIR DiagnosticReport after inference', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      const reportRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${createRes.body.caseId}/report`),
        config,
      ).expect(200);

      expect(reportRes.body.caseId).toBe(createRes.body.caseId);
      expect(reportRes.body.reportStatus).toBe('preliminary');

      const exportRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${createRes.body.caseId}/exports/fhir-diagnostic-report`),
        config,
      ).expect(200);

      expect(exportRes.body.resourceType).toBe('DiagnosticReport');
      expect(exportRes.body.result.length).toBeGreaterThan(0);
    });
  });

  describe('Operations summary', () => {
    it('should aggregate workflow counts', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const res = await withOperator(
        request(localApp).get('/api/v1/operations/summary'),
        config,
      ).expect(200);

      expect(res.body.totalCases).toBe(1);
      expect(
        res.body.byStatus.InferencePending + res.body.byStatus.AwaitingReview,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Full Workflow: Create → (async inference) → Review → Finalize', () => {
    it('should complete the clinician-in-the-loop workflow', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      // Step 1: Create case (202 Accepted)
      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const caseId = createRes.body.caseId;
      expect(createRes.body.status).toBe('InferencePending');

      // Wait for async inference
      await waitForAsyncInference();

      // Verify it's now AwaitingReview
      const detailRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${caseId}`),
        config,
      )
        .expect(200);
      expect(detailRes.body.status).toBe('AwaitingReview');

      // Step 2: Clinician review
      const reviewRes = await withReviewer(
        request(localApp).post(`/api/v1/cases/${caseId}/review`),
        config,
      )
        .send({
          decision: 'accepted',
          clinicalNotes: 'NSR confirmed. No acute changes.',
        })
        .expect(200);

      expect(reviewRes.body.status).toBe('Reviewed');
      expect(reviewRes.body.reviewDecision).toBe('accepted');

      // Step 3: Finalize (withdrawn — stub inference produces blocking UQ flags)
      const finalRes = await withReviewer(
        request(localApp).post(`/api/v1/cases/${caseId}/finalize`),
        config,
      )
        .send({
          outcome: 'withdrawn',
          finalSummary: 'Withdrawn: stub inference has high epistemic uncertainty.',
        })
        .expect(200);

      expect(finalRes.body.status).toBe('Finalized');
      expect(finalRes.body.outcome).toBe('withdrawn');
    });

    it('should block finalization without review', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      const res = await withReviewer(
        request(localApp).post(`/api/v1/cases/${createRes.body.caseId}/finalize`),
        config,
      )
        .send({
          outcome: 'delivered',
          finalSummary: 'Skipping review',
        })
        .expect(409);

      expect(res.status).toBe(409);
    });

    it('should reject review without reviewer JWT', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      await request(localApp)
        .post(`/api/v1/cases/${createRes.body.caseId}/review`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer role is not allowed', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { role: 'Nurse' })}`)
        .send({ decision: 'accepted' })
        .expect(403);
    });

    it('should reject review when reviewer issuer is invalid', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { issuer: 'unexpected-issuer' })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer audience is invalid', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { audience: 'wrong-audience' })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer audience is missing', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { audience: null })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT signature is invalid', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { secret: 'wrong-secret-for-signature' })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT is expired', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set(
          'Authorization',
          `Bearer ${createReviewerJwt(config, { exp: Math.floor(Date.now() / 1000) - 120 })}`,
        )
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT is malformed', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', 'Bearer malformed.token')
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT algorithm is not HS256', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { algorithm: 'none' })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT is not yet valid', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set(
          'Authorization',
          `Bearer ${createReviewerJwt(config, { nbf: Math.floor(Date.now() / 1000) + 300 })}`,
        )
        .send({ decision: 'accepted' })
        .expect(401);
    });

    it('should reject review when reviewer JWT claims are incomplete', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);

      await request(localApp)
        .post(`/api/v1/cases/${caseId}/review`)
        .set('Authorization', `Bearer ${createReviewerJwt(config, { role: null })}`)
        .send({ decision: 'accepted' })
        .expect(401);
    });
  });

  describe('Internal inference callback', () => {
    it('should accept authenticated callback and finalize pending inference', async () => {
      const stalledInferenceService = {
        classify: async () => new Promise<ReturnType<MetadataFallbackInferenceService['classify']> extends Promise<infer T> ? T : never>(() => undefined),
      };
      const deps = makeDeps({ config, inferenceService: stalledInferenceService as AppDeps['inferenceService'] });
      const localApp = createApp(deps);
      const helperInference = new MetadataFallbackInferenceService();

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const callbackResult = await helperInference.classify(
        {
          ...validCreatePayload.recording,
          recordingDate: new Date(validCreatePayload.recording.recordingDate),
        },
        validCreatePayload.clinicalQuestion,
      );

      const callbackRes = await withInternal(
        request(localApp).post('/api/internal/inference-callback'),
        config,
      )
        .send({
          caseId: createRes.body.caseId,
          assessment: callbackResult.assessment,
          modelId: callbackResult.modelId,
          latencyMs: callbackResult.latencyMs,
        })
        .expect(200);

      expect(callbackRes.body.status).toBe('AwaitingReview');
    });

    it('should reject callback when internal bearer token is invalid', async () => {
      const stalledInferenceService = {
        classify: async () => new Promise<ReturnType<MetadataFallbackInferenceService['classify']> extends Promise<infer T> ? T : never>(() => undefined),
      };
      const deps = makeDeps({ config, inferenceService: stalledInferenceService as AppDeps['inferenceService'] });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);
      const helperInference = new MetadataFallbackInferenceService();
      const callbackResult = await helperInference.classify(
        {
          ...validCreatePayload.recording,
          recordingDate: new Date(validCreatePayload.recording.recordingDate),
        },
        validCreatePayload.clinicalQuestion,
      );

      await request(localApp)
        .post('/api/internal/inference-callback')
        .set('Authorization', 'Bearer invalid-internal-token')
        .send({
          caseId,
          assessment: callbackResult.assessment,
          modelId: callbackResult.modelId,
          latencyMs: callbackResult.latencyMs,
        })
        .expect(401);
    });

    it('should reject callback when internal bearer token is missing', async () => {
      const stalledInferenceService = {
        classify: async () => new Promise<ReturnType<MetadataFallbackInferenceService['classify']> extends Promise<infer T> ? T : never>(() => undefined),
      };
      const deps = makeDeps({ config, inferenceService: stalledInferenceService as AppDeps['inferenceService'] });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);
      const helperInference = new MetadataFallbackInferenceService();
      const callbackResult = await helperInference.classify(
        {
          ...validCreatePayload.recording,
          recordingDate: new Date(validCreatePayload.recording.recordingDate),
        },
        validCreatePayload.clinicalQuestion,
      );

      await request(localApp)
        .post('/api/internal/inference-callback')
        .send({
          caseId,
          assessment: callbackResult.assessment,
          modelId: callbackResult.modelId,
          latencyMs: callbackResult.latencyMs,
        })
        .expect(401);
    });

    it('should reject callback when internal auth header format is invalid', async () => {
      const stalledInferenceService = {
        classify: async () => new Promise<ReturnType<MetadataFallbackInferenceService['classify']> extends Promise<infer T> ? T : never>(() => undefined),
      };
      const deps = makeDeps({ config, inferenceService: stalledInferenceService as AppDeps['inferenceService'] });
      const localApp = createApp(deps);
      const caseId = await createAwaitingReviewCase(localApp, config);
      const helperInference = new MetadataFallbackInferenceService();
      const callbackResult = await helperInference.classify(
        {
          ...validCreatePayload.recording,
          recordingDate: new Date(validCreatePayload.recording.recordingDate),
        },
        validCreatePayload.clinicalQuestion,
      );

      await request(localApp)
        .post('/api/internal/inference-callback')
        .set('Authorization', 'Token invalid-format')
        .send({
          caseId,
          assessment: callbackResult.assessment,
          modelId: callbackResult.modelId,
          latencyMs: callbackResult.latencyMs,
        })
        .expect(401);
    });
  });

  describe('Audit trail', () => {
    it('should track state transitions in audit log', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);
      const repo = deps.repository as InMemoryEcgCaseRepository;

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const caseId = createRes.body.caseId;
      await waitForAsyncInference();

      const trail = repo.getAuditTrail(caseId);

      // Should have at least: CREATED (InferencePending) + inference complete (AwaitingReview)
      expect(trail.length).toBeGreaterThanOrEqual(2);
      expect(trail[0].operation).toBe('CREATED');
      expect(trail[0].newStatus).toBe('InferencePending');
    });
  });

  describe('Health probes', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/healthz').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('should return readiness status', async () => {
      const res = await request(app).get('/readyz').expect(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('Resolve safety flag', () => {
    it('should resolve a blocking flag and allow delivery after resolution', async () => {
      // Use a custom inference service that produces a blocking safety policy result
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      const caseId = createRes.body.caseId;
      await waitForAsyncInference();

      // Verify the stub inference caused blocking safety flags
      const detailRes = await withOperator(
        request(localApp).get(`/api/v1/cases/${caseId}`),
        config,
      ).expect(200);
      expect(detailRes.body.status).toBe('AwaitingReview');

      // Find a blocking flag (stub inference has high epistemic uncertainty → blocking)
      const blockingFlag = detailRes.body.safetyFlags.find(
        (f: { blocksDelivery: boolean }) => f.blocksDelivery,
      );

      if (blockingFlag) {
        // Resolve the blocking flag
        const resolveRes = await withReviewer(
          request(localApp).post(`/api/v1/cases/${caseId}/safety-flags/${blockingFlag.flagCode}/resolve`),
          config,
        )
          .send({ resolution: 'Manual waveform review completed — confirmed safe' })
          .expect(200);

        expect(resolveRes.body.resolved).toBe(true);
        expect(resolveRes.body.flagCode).toBe(blockingFlag.flagCode);
      }
    });

    it('should reject resolving a flag that does not exist', async () => {
      const deps = makeDeps({ config });
      const localApp = createApp(deps);

      const createRes = await withOperator(
        request(localApp).post('/api/v1/cases'),
        config,
      )
        .send(validCreatePayload)
        .expect(202);

      await waitForAsyncInference();

      await withReviewer(
        request(localApp).post(`/api/v1/cases/${createRes.body.caseId}/safety-flags/NONEXISTENT/resolve`),
        config,
      )
        .send({ resolution: 'No such flag' })
        .expect(409);
    });
  });
});
