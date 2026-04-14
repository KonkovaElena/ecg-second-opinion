// ─── ECG Validation Schemas — Unit Tests ────────────────────────────
import {
  createCaseSchema,
  submitReviewSchema,
  finalizeCaseSchema,
  internalInferenceCallbackSchema,
} from '../src/validation';

describe('createCaseSchema', () => {
  const validPayload = {
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
      urgency: 'routine',
    },
  };

  it('should accept valid input', () => {
    const result = createCaseSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should reject missing recording', () => {
    const result = createCaseSchema.safeParse({
      clinicalQuestion: validPayload.clinicalQuestion,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid urgency', () => {
    const result = createCaseSchema.safeParse({
      ...validPayload,
      clinicalQuestion: { ...validPayload.clinicalQuestion, urgency: 'immediate' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject sampling frequency below 50 Hz', () => {
    const result = createCaseSchema.safeParse({
      ...validPayload,
      recording: { ...validPayload.recording, samplingFrequencyHz: 10 },
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional originalInterpretation', () => {
    const result = createCaseSchema.safeParse({
      ...validPayload,
      originalInterpretation: 'Normal sinus rhythm',
    });
    expect(result.success).toBe(true);
  });
});

describe('submitReviewSchema', () => {
  it('should accept valid review', () => {
    const result = submitReviewSchema.safeParse({
      reviewerRole: 'Cardiologist',
      decision: 'accepted',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid decision', () => {
    const result = submitReviewSchema.safeParse({
      reviewerRole: 'Cardiologist',
      decision: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should accept missing reviewerRole because auth is authoritative', () => {
    const result = submitReviewSchema.safeParse({
      decision: 'accepted',
    });
    expect(result.success).toBe(true);
  });
});

describe('finalizeCaseSchema', () => {
  it('should accept valid finalization', () => {
    const result = finalizeCaseSchema.safeParse({
      outcome: 'delivered',
      finalSummary: 'Normal ECG confirmed',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty summary', () => {
    const result = finalizeCaseSchema.safeParse({
      outcome: 'delivered',
      finalSummary: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('internalInferenceCallbackSchema', () => {
  it('should accept a valid callback payload', () => {
    const result = internalInferenceCallbackSchema.safeParse({
      caseId: '11111111-1111-4111-8111-111111111111',
      modelId: 'model-v1',
      latencyMs: 123,
      assessment: {
        summary: 'Normal sinus rhythm',
        classification: {
          predictedCategory: 'NORM',
          categoryProbabilities: {
            NORM: 0.7,
            MI: 0.1,
            STTC: 0.1,
            CD: 0.05,
            HYP: 0.05,
          },
          confidenceBand: 'moderate',
          modelArchitecture: '1D-CNN',
          modelVersion: 'v1',
          inferenceLatencyMs: 123,
        },
        findings: ['Normal sinus rhythm'],
        agreementLevel: 'cannot_determine',
        differentialDiagnoses: [],
        recommendations: ['Clinical correlation recommended'],
        limitations: ['Metadata fallback'],
        interpretability: {
          explanationMethod: 'none',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject category probabilities that do not sum to 1', () => {
    const result = internalInferenceCallbackSchema.safeParse({
      caseId: '11111111-1111-4111-8111-111111111111',
      modelId: 'model-v1',
      latencyMs: 123,
      assessment: {
        summary: 'Normal sinus rhythm',
        classification: {
          predictedCategory: 'NORM',
          categoryProbabilities: {
            NORM: 0.6,
            MI: 0.1,
            STTC: 0.1,
            CD: 0.05,
            HYP: 0.05,
          },
          confidenceBand: 'moderate',
          modelArchitecture: '1D-CNN',
          modelVersion: 'v1',
          inferenceLatencyMs: 123,
        },
        findings: ['Normal sinus rhythm'],
        agreementLevel: 'cannot_determine',
        differentialDiagnoses: [],
        recommendations: ['Clinical correlation recommended'],
        limitations: ['Metadata fallback'],
        interpretability: {
          explanationMethod: 'none',
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
