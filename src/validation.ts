// ─── ECG Second Opinion — Zod Validation Schemas ───────────────────
// Input validation for all API endpoints.

import { z } from 'zod';

// ─── ECG Leads ──────────────────────────────────────────────────────

export const ecgLeadSchema = z.enum([
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF',
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6',
]);

export const ecgDiagnosticCategorySchema = z.enum([
  'NORM', 'MI', 'STTC', 'CD', 'HYP',
]);

export const confidenceBandSchema = z.enum([
  'high', 'moderate', 'low', 'insufficient_data',
]);

export const agreementLevelSchema = z.enum([
  'full_agreement',
  'partial_agreement',
  'significant_disagreement',
  'cannot_determine',
]);

export const reviewDecisionSchema = z.enum([
  'accepted', 'modified', 'rejected', 'escalated',
]);

// ─── Recording Reference ────────────────────────────────────────────

export const ecgRecordingRefSchema = z.object({
  recordingId: z.string().min(1).max(256),
  patientAlias: z.string().min(1).max(256),
  recordingDate: z.string().datetime(),
  samplingFrequencyHz: z.number().int().min(50).max(10_000),
  leadCount: z.number().int().min(1).max(16),
  durationSeconds: z.number().positive().max(3600),
  samplesPerLead: z.number().int().positive(),
  sourceDataset: z.string().max(256).optional(),
  deviceManufacturer: z.string().max(256).optional(),
  referringPhysician: z.string().max(256).optional(),
}).strict();

// ─── Clinical Question ──────────────────────────────────────────────

export const clinicalQuestionSchema = z.object({
  questionText: z.string().min(1).max(2000),
  clinicalContext: z.string().max(4000).optional(),
  urgency: z.enum(['routine', 'urgent', 'stat']),
  knownConditions: z.array(z.string().max(256)).max(50).optional(),
}).strict();

// ─── Create Case ────────────────────────────────────────────────────

export const createCaseSchema = z.object({
  recording: ecgRecordingRefSchema,
  clinicalQuestion: clinicalQuestionSchema,
  originalInterpretation: z.string().max(8000).optional(),
}).strict();

export const uncertaintyMetricsSchema = z.object({
  epistemicEntropy: z.number().finite(),
  aleatoryEntropy: z.number().finite(),
  mutualInformation: z.number().finite(),
  mcSamples: z.number().int().min(0),
  ensembleSize: z.number().int().min(0).optional(),
  conformalSetSize: z.number().int().min(0).optional(),
}).strict();

export const interpretabilityArtifactsSchema = z.object({
  gradCamHeatmap: z.record(ecgLeadSchema, z.array(z.number().finite())).optional(),
  attentionWeights: z.record(ecgLeadSchema, z.array(z.number().finite())).optional(),
  shapTopFeatures: z.array(z.object({
    lead: ecgLeadSchema,
    timestampMs: z.number().finite(),
    contribution: z.number().finite(),
  }).strict()).optional(),
  explanationMethod: z.enum(['grad-cam', 'shap', 'lime', 'attention', 'none']),
}).strict();

export const ecgClassificationResultSchema = z.object({
  predictedCategory: ecgDiagnosticCategorySchema,
  categoryProbabilities: z.object({
    NORM: z.number().min(0).max(1),
    MI: z.number().min(0).max(1),
    STTC: z.number().min(0).max(1),
    CD: z.number().min(0).max(1),
    HYP: z.number().min(0).max(1),
  }).strict().refine((probabilities) => {
    const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
    return Math.abs(sum - 1) <= 0.001;
  }, {
    message: 'categoryProbabilities must sum to 1.0 ± 0.001',
  }),
  confidenceBand: confidenceBandSchema,
  modelArchitecture: z.string().min(1).max(256),
  modelVersion: z.string().min(1).max(256),
  inferenceLatencyMs: z.number().int().min(0),
  uncertaintyMetrics: uncertaintyMetricsSchema.optional(),
}).strict();

export const ecgAssessmentSchema = z.object({
  summary: z.string().min(1).max(8000),
  classification: ecgClassificationResultSchema,
  findings: z.array(z.string().max(2000)).max(100),
  agreementLevel: agreementLevelSchema,
  differentialDiagnoses: z.array(z.string().max(2000)).max(50),
  recommendations: z.array(z.string().max(2000)).max(50),
  limitations: z.array(z.string().max(2000)).max(50),
  leadFindings: z.record(ecgLeadSchema, z.string().max(2000)).optional(),
  interpretability: interpretabilityArtifactsSchema.optional(),
}).strict();

// ─── Review ─────────────────────────────────────────────────────────

export const submitReviewSchema = z.object({
  reviewerRole: z.string().min(1).max(256).optional(),
  decision: reviewDecisionSchema,
  modifications: z.string().max(4000).optional(),
  clinicalNotes: z.string().max(4000).optional(),
}).strict();

// ─── Finalize ───────────────────────────────────────────────────────

export const finalizeCaseSchema = z.object({
  outcome: z.enum(['delivered', 'withdrawn', 'expired']),
  finalSummary: z.string().min(1).max(8000),
}).strict();

// ─── Resolve Safety Flag ────────────────────────────────────────────

export const resolveSafetyFlagSchema = z.object({
  resolution: z.string().min(1).max(4000),
}).strict();

export const internalInferenceCallbackSchema = z.object({
  caseId: z.string().uuid(),
  assessment: ecgAssessmentSchema,
  modelId: z.string().min(1).max(256),
  latencyMs: z.number().int().min(0).optional(),
}).strict();
