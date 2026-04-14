// ─── ECG Second Opinion — Express Application ──────────────────────
// Main app factory with all routes, middleware, and dependency wiring.

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from './config';
import type {
  IEcgCaseRepository,
  IEcgInferenceService,
  IEcgClinicalSafetyPolicy,
  EcgInferenceResult,
} from './case-contracts';
import { EcgSecondOpinionCase, DomainInvariantViolationError } from './cases';
import {
  createCaseSchema,
  submitReviewSchema,
  finalizeCaseSchema,
  resolveSafetyFlagSchema,
  internalInferenceCallbackSchema,
} from './validation';
import { healthRouter } from './health';
import { correlationMiddleware } from './correlation';
import { metricsRegistry, ecgCasesCreatedTotal, ecgReviewsCompletedTotal, ecgCasesAwaitingReview, ecgSafetyFlagsTotal, recordEcgInference, recordEcgInferenceError } from './metrics';
import { AuthError } from './auth-common';
import { createOperatorAuthMiddleware } from './operator-auth';
import { createReviewerAuthMiddleware } from './reviewer-auth';
import { createInternalAuthMiddleware } from './internal-auth';
import { buildStructuredEcgReport, buildOperationsSummary, toCaseDetail, toCaseListItem } from './case-presentation';
import { buildFhirDiagnosticReport } from './case-exports';

// ─── Deps Container ─────────────────────────────────────────────────

export interface AppDeps {
  readonly repository: IEcgCaseRepository;
  readonly inferenceService: IEcgInferenceService;
  readonly safetyPolicy: IEcgClinicalSafetyPolicy;
  readonly config: AppConfig;
}

// ─── App Factory ────────────────────────────────────────────────────

export function createApp(deps: AppDeps): express.Application {
  const { repository, inferenceService, safetyPolicy, config } = deps;
  const app = express();
  const prefix = config.apiPrefix;
  const internalPrefix = config.internalApiPrefix;
  const inferenceProvider = inferenceService.constructor?.name ?? 'unknown-inference-service';
  const operatorAuth = createOperatorAuthMiddleware(config);
  const reviewerAuth = createReviewerAuthMiddleware(config);
  const internalAuth = createInternalAuthMiddleware(config);

  async function applyInferenceResult(caseId: string, inferenceResult: EcgInferenceResult) {
    const loaded = await repository.findById(caseId);
    if (!loaded) {
      return null;
    }

    loaded.completeInference(inferenceResult.assessment, inferenceResult.modelId);

    recordEcgInference(
      inferenceResult.assessment.classification.modelArchitecture,
      'success',
      inferenceResult.latencyMs,
    );

    const safetyResult = await safetyPolicy.evaluate(
      inferenceResult.assessment,
      loaded.recording,
      loaded.clinicalQuestion,
    );
    for (const flag of safetyResult.flags) {
      loaded.raiseSafetyFlag(flag.flagCode, flag.severity, flag.description, flag.blocksDelivery);
      ecgSafetyFlagsTotal.inc({ flag_code: flag.flagCode, severity: flag.severity });
    }

    await repository.save(loaded);
    ecgCasesAwaitingReview.inc({ urgency: loaded.clinicalQuestion.urgency });
    return loaded;
  }

  // ── Middleware ───────────────────────────────────────────────────

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Health Probes ───────────────────────────────────────────────

  app.use(healthRouter());

  // ── Metrics ─────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.json({
      service: 'ecg-second-opinion',
      runtime: 'express-control-plane',
      publicApiPrefix: prefix,
      internalApiPrefix: internalPrefix,
      routes: {
        public: [
          `${prefix}/cases`,
          `${prefix}/cases/:caseId`,
          `${prefix}/cases/:caseId/report`,
          `${prefix}/cases/:caseId/exports/fhir-diagnostic-report`,
          `${prefix}/cases/:caseId/review`,
          `${prefix}/cases/:caseId/safety-flags/:flagCode/resolve`,
          `${prefix}/cases/:caseId/finalize`,
          `${prefix}/operations/summary`,
        ],
        internal: [
          `${internalPrefix}/inference-callback`,
        ],
        operational: ['/healthz', '/readyz', '/metrics'],
      },
    });
  });

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } catch {
      res.status(500).end();
    }
  });

  // ── Create Case (Submit → InferencePending → async callback) ──

  app.post(`${prefix}/cases`, operatorAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createCaseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
        return;
      }

      const { recording, clinicalQuestion, originalInterpretation } = parsed.data;
      const recordingRef = {
        ...recording,
        recordingDate: new Date(recording.recordingDate),
      };

      // Step 1: Create aggregate
      const ecgCase = EcgSecondOpinionCase.submit(
        recordingRef,
        clinicalQuestion,
        originalInterpretation,
      );

      // Step 2: Mark as InferencePending (async handoff to Compute Plane)
      ecgCase.startInference();

      // Step 3: Persist with InferencePending status
      await repository.save(ecgCase);
      ecgCasesCreatedTotal.inc();

      // Step 4: Dispatch inference asynchronously (fire-and-forget)
      // In production, this publishes to a message queue (RabbitMQ/Redis).
      // For now, execute inline but respond immediately with 202.
      setImmediate(async () => {
        const inferenceStartedAt = Date.now();
        try {
          const inferenceResult = await inferenceService.classify(
            recordingRef,
            clinicalQuestion,
            originalInterpretation,
          );
          await applyInferenceResult(ecgCase.id, inferenceResult);
        } catch (inferErr) {
          const errorMessage = inferErr instanceof Error ? inferErr.message : String(inferErr);
          const failedCase = await repository.findById(ecgCase.id);
          if (failedCase) {
            try {
              failedCase.failInference(errorMessage);
              await repository.save(failedCase);
            } catch {
              // Preserve original failure logging path if state transition cannot be applied.
            }
          }

          recordEcgInference(
            inferenceProvider,
            'failure',
            Date.now() - inferenceStartedAt,
          );
          recordEcgInferenceError(
            inferenceProvider,
            inferErr instanceof Error ? inferErr.name : 'UnknownInferenceError',
          );

          const log = {
            level: 'error',
            message: 'Async inference failed',
            caseId: ecgCase.id,
            correlationId: req.correlationId,
            error: errorMessage,
            timestamp: new Date().toISOString(),
          };
          console.error(JSON.stringify(log));
        }
      });

      // Respond immediately with 202 Accepted
      res.status(202).json({
        caseId: ecgCase.id,
        status: ecgCase.status,
        message: 'Case accepted. AI analysis is pending.',
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Internal Inference Callback ─────────────────────────────────

  app.post(`${internalPrefix}/inference-callback`, internalAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = internalInferenceCallbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
        return;
      }

      const updatedCase = await applyInferenceResult(parsed.data.caseId, {
        assessment: parsed.data.assessment,
        modelId: parsed.data.modelId,
        latencyMs: parsed.data.latencyMs ?? parsed.data.assessment.classification.inferenceLatencyMs,
      });

      if (!updatedCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      res.json({
        caseId: updatedCase.id,
        status: updatedCase.status,
        safetyFlagCount: updatedCase.safetyFlags.length,
        hasBlockingFlags: updatedCase.hasBlockingSafetyFlags,
      });
    } catch (err) {
      if (err instanceof DomainInvariantViolationError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  // ── List Cases ──────────────────────────────────────────────────

  app.get(`${prefix}/cases`, operatorAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await repository.list();
      res.json(cases.map(toCaseListItem));
    } catch (err) {
      next(err);
    }
  });

  // ── Get Case Detail ─────────────────────────────────────────────

  app.get(`${prefix}/cases/:caseId`, operatorAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      res.json(toCaseDetail(ecgCase));
    } catch (err) {
      next(err);
    }
  });

  // ── Structured Report ───────────────────────────────────────────

  app.get(`${prefix}/cases/:caseId/report`, operatorAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      if (!ecgCase.assessment) {
        res.status(409).json({ error: 'Report not ready' });
        return;
      }

      res.json(buildStructuredEcgReport(ecgCase));
    } catch (err) {
      next(err);
    }
  });

  // ── FHIR DiagnosticReport Export ────────────────────────────────

  app.get(`${prefix}/cases/:caseId/exports/fhir-diagnostic-report`, operatorAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      if (!ecgCase.assessment) {
        res.status(409).json({ error: 'Report not ready' });
        return;
      }

      res.json(buildFhirDiagnosticReport(ecgCase, config.publicBaseUrl));
    } catch (err) {
      next(err);
    }
  });

  // ── Operations Summary ──────────────────────────────────────────

  app.get(`${prefix}/operations/summary`, operatorAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await repository.list();
      res.json(buildOperationsSummary(cases));
    } catch (err) {
      next(err);
    }
  });

  // ── Submit Review ───────────────────────────────────────────────

  app.post(`${prefix}/cases/:caseId/review`, reviewerAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const parsed = submitReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
        return;
      }

      ecgCase.completeHumanReview({
        ...parsed.data,
        reviewerId: req.reviewer?.reviewerId,
        reviewerRole: req.reviewer?.reviewerRole ?? parsed.data.reviewerRole ?? 'Reviewer',
        reviewedAt: new Date(),
      });

      await repository.save(ecgCase);
      ecgReviewsCompletedTotal.inc({ decision: parsed.data.decision });
      ecgCasesAwaitingReview.dec({ urgency: ecgCase.clinicalQuestion.urgency });

      res.json({
        caseId: ecgCase.id,
        status: ecgCase.status,
        reviewDecision: parsed.data.decision,
      });
    } catch (err) {
      if (err instanceof DomainInvariantViolationError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  // ── Resolve Safety Flag ─────────────────────────────────────────

  app.post(`${prefix}/cases/:caseId/safety-flags/:flagCode/resolve`, reviewerAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const parsed = resolveSafetyFlagSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
        return;
      }

      ecgCase.resolveSafetyFlag(
        req.params.flagCode as string,
        req.reviewer?.reviewerId ?? 'unknown',
        parsed.data.resolution,
      );
      await repository.save(ecgCase);

      res.json({
        caseId: ecgCase.id,
        flagCode: req.params.flagCode,
        resolved: true,
        hasBlockingFlags: ecgCase.hasBlockingSafetyFlags,
      });
    } catch (err) {
      if (err instanceof DomainInvariantViolationError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  // ── Finalize Case ───────────────────────────────────────────────

  app.post(`${prefix}/cases/:caseId/finalize`, reviewerAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecgCase = await repository.findById(req.params.caseId as string);
      if (!ecgCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const parsed = finalizeCaseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
        return;
      }

      ecgCase.finalize(parsed.data.outcome, parsed.data.finalSummary);
      await repository.save(ecgCase);

      res.json({
        caseId: ecgCase.id,
        status: ecgCase.status,
        outcome: ecgCase.finalOutcome,
      });
    } catch (err) {
      if (err instanceof DomainInvariantViolationError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  // ── Error Handler ───────────────────────────────────────────────

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        correlationId: req.correlationId,
      });
      return;
    }

    const log = {
      level: 'error',
      message: err.message,
      correlationId: req.correlationId,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    };
    console.error(JSON.stringify(log));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
