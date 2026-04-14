// ─── ECG Safety Policy — Unit Tests ─────────────────────────────────
import { DefaultEcgClinicalSafetyPolicy } from '../src/safety-policy';
import type {
  EcgAssessment,
  EcgRecordingRef,
  ClinicalQuestion,
  EcgClassificationResult,
} from '../src/case-contracts';

// ── Fixtures ────────────────────────────────────────────────────────

function makeClassification(overrides: Partial<EcgClassificationResult> = {}): EcgClassificationResult {
  return {
    predictedCategory: 'NORM',
    categoryProbabilities: { NORM: 0.85, MI: 0.08, STTC: 0.03, CD: 0.02, HYP: 0.02 },
    confidenceBand: 'high',
    modelArchitecture: '1D-CNN-3Layer',
    modelVersion: '1.0.0',
    inferenceLatencyMs: 42,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<EcgAssessment> = {}): EcgAssessment {
  return {
    summary: 'Normal sinus rhythm',
    classification: makeClassification(),
    findings: [],
    agreementLevel: 'full_agreement',
    differentialDiagnoses: [],
    recommendations: [],
    limitations: [],
    interpretability: { explanationMethod: 'grad-cam', gradCamHeatmap: { I: [0.1, 0.5] } },
    ...overrides,
  };
}

function makeRecording(overrides: Partial<EcgRecordingRef> = {}): EcgRecordingRef {
  return {
    recordingId: 'rec-001',
    patientAlias: 'Patient-A',
    recordingDate: new Date('2024-01-15'),
    samplingFrequencyHz: 500,
    leadCount: 12,
    durationSeconds: 10,
    samplesPerLead: 1000,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<ClinicalQuestion> = {}): ClinicalQuestion {
  return {
    questionText: 'Routine second opinion',
    urgency: 'routine',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DefaultEcgClinicalSafetyPolicy', () => {
  const policy = new DefaultEcgClinicalSafetyPolicy();

  it('should pass with no flags for normal high-confidence recording', async () => {
    const result = await policy.evaluate(
      makeAssessment(),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.passed).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('should flag low confidence', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({ confidenceBand: 'low' }),
      }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.passed).toBe(false);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'LOW_CONFIDENCE', blocksDelivery: false }),
    );
  });

  it('should flag insufficient data and block delivery', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({ confidenceBand: 'insufficient_data' }),
      }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'INSUFFICIENT_DATA', blocksDelivery: true }),
    );
  });

  it('should flag significant disagreement', async () => {
    const result = await policy.evaluate(
      makeAssessment({ agreementLevel: 'significant_disagreement' }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'SIGNIFICANT_DISAGREEMENT' }),
    );
  });

  it('should flag stat MI as critical and blocking', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({ predictedCategory: 'MI' }),
      }),
      makeRecording(),
      makeQuestion({ urgency: 'stat' }),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'STAT_MI_DETECTED', blocksDelivery: true }),
    );
  });

  it('should flag short recording', async () => {
    const result = await policy.evaluate(
      makeAssessment(),
      makeRecording({ durationSeconds: 9 }),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'SHORT_RECORDING' }),
    );
  });

  it('should not flag a 10-second recording as short', async () => {
    const result = await policy.evaluate(
      makeAssessment(),
      makeRecording({ durationSeconds: 10 }),
      makeQuestion(),
    );

    expect(result.flags.find((flag) => flag.flagCode === 'SHORT_RECORDING')).toBeUndefined();
  });

  it('should flag low sampling frequency', async () => {
    const result = await policy.evaluate(
      makeAssessment(),
      makeRecording({ samplingFrequencyHz: 50 }),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({ flagCode: 'LOW_SAMPLING_RATE' }),
    );
  });

  it('should flag high epistemic uncertainty as critical and blocking', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({
          uncertaintyMetrics: {
            epistemicEntropy: 0.85,
            aleatoryEntropy: 0.10,
            mutualInformation: 0.75,
            mcSamples: 50,
          },
        }),
      }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({
        flagCode: 'HIGH_EPISTEMIC_UNCERTAINTY',
        blocksDelivery: true,
      }),
    );
  });

  it('should not flag epistemic uncertainty below threshold', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({
          uncertaintyMetrics: {
            epistemicEntropy: 0.3,
            aleatoryEntropy: 0.1,
            mutualInformation: 0.2,
            mcSamples: 50,
          },
        }),
      }),
      makeRecording(),
      makeQuestion(),
    );

    const uqFlag = result.flags.find((f) => f.flagCode === 'HIGH_EPISTEMIC_UNCERTAINTY');
    expect(uqFlag).toBeUndefined();
  });

  it('should not flag epistemic uncertainty exactly at threshold', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        classification: makeClassification({
          uncertaintyMetrics: {
            epistemicEntropy: 0.7,
            aleatoryEntropy: 0.1,
            mutualInformation: 0.6,
            mcSamples: 50,
          },
        }),
      }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.flags.find((flag) => flag.flagCode === 'HIGH_EPISTEMIC_UNCERTAINTY')).toBeUndefined();
  });

  it('should flag missing XAI explanation as info', async () => {
    const result = await policy.evaluate(
      makeAssessment({ interpretability: { explanationMethod: 'none' } }),
      makeRecording(),
      makeQuestion(),
    );

    expect(result.flags).toContainEqual(
      expect.objectContaining({
        flagCode: 'NO_XAI_EXPLANATION',
        severity: 'info',
        blocksDelivery: false,
      }),
    );
  });

  it('should not flag when XAI explanation is present', async () => {
    const result = await policy.evaluate(
      makeAssessment({
        interpretability: {
          explanationMethod: 'grad-cam',
          gradCamHeatmap: { I: [0.1, 0.5, 0.9] },
        },
      }),
      makeRecording(),
      makeQuestion(),
    );

    const xaiFlag = result.flags.find((f) => f.flagCode === 'NO_XAI_EXPLANATION');
    expect(xaiFlag).toBeUndefined();
  });
});
