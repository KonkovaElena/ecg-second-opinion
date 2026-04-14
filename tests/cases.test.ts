// ─── ECG Case Aggregate — State Machine Tests ──────────────────────
import { describe, expect, it } from '@jest/globals';
import { EcgSecondOpinionCase, DomainInvariantViolationError } from '../src/cases';
import type {
  EcgRecordingRef,
  ClinicalQuestion,
  EcgAssessment,
  EcgClassificationResult,
  HumanReviewDisposition,
} from '../src/case-contracts';

// ── Fixtures ────────────────────────────────────────────────────────

function makeRecording(overrides: Partial<EcgRecordingRef> = {}): EcgRecordingRef {
  return {
    recordingId: 'rec-001',
    patientAlias: 'Patient-A',
    recordingDate: new Date('2024-01-15'),
    samplingFrequencyHz: 500,
    leadCount: 12,
    durationSeconds: 10,
    samplesPerLead: 1000,
    sourceDataset: 'PTB-XL',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<ClinicalQuestion> = {}): ClinicalQuestion {
  return {
    questionText: 'Routine second opinion for suspected MI',
    urgency: 'routine',
    ...overrides,
  };
}

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
    summary: 'Normal sinus rhythm. No significant abnormalities detected.',
    classification: makeClassification(),
    findings: ['Normal sinus rhythm', 'Normal QRS duration'],
    agreementLevel: 'full_agreement',
    differentialDiagnoses: [],
    recommendations: ['No further action required'],
    limitations: [],
    ...overrides,
  };
}

function makeReview(overrides: Partial<HumanReviewDisposition> = {}): HumanReviewDisposition {
  return {
    reviewerRole: 'Cardiologist',
    decision: 'accepted',
    reviewedAt: new Date(),
    ...overrides,
  };
}

// ── Factory ─────────────────────────────────────────────────────────

describe('EcgSecondOpinionCase.submit', () => {
  it('should create case in Submitted state', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    expect(ecgCase.id).toBeDefined();
    expect(ecgCase.status).toBe('Submitted');
    expect(ecgCase.assessment).toBeNull();
    expect(ecgCase.humanReview).toBeNull();
    expect(ecgCase.finalOutcome).toBeNull();
    expect(ecgCase.safetyFlags).toHaveLength(0);
  });

  it('should preserve original interpretation if provided', () => {
    const ecgCase = EcgSecondOpinionCase.submit(
      makeRecording(),
      makeQuestion(),
      'Normal sinus rhythm — prior reading',
    );

    expect(ecgCase.originalInterpretation).toBe('Normal sinus rhythm — prior reading');
  });
});

// ── Inference ───────────────────────────────────────────────────────

describe('startInference', () => {
  it('should transition Submitted → InferencePending', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    ecgCase.startInference();

    expect(ecgCase.status).toBe('InferencePending');
  });

  it('should reject if not in Submitted state', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.startInference();

    expect(() => ecgCase.startInference())
      .toThrow(DomainInvariantViolationError);
  });
});

describe('completeInference', () => {
  it('should transition Submitted → AwaitingReview (sync path)', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    expect(ecgCase.status).toBe('AwaitingReview');
    expect(ecgCase.assessment).not.toBeNull();
    expect(ecgCase.modelId).toBe('model-v1.0');
  });

  it('should transition InferencePending → AwaitingReview (async path)', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.startInference();

    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    expect(ecgCase.status).toBe('AwaitingReview');
  });

  it('should reject if not in Submitted or InferencePending state', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    expect(() => ecgCase.completeInference(makeAssessment(), 'model-v1.0'))
      .toThrow(DomainInvariantViolationError);
  });

  it('should transition InferencePending -> InferenceFailed when inference crashes', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.startInference();

    ecgCase.failInference('worker timeout');

    expect(ecgCase.status).toBe('InferenceFailed');
    expect(ecgCase.inferenceFailureReason).toBe('worker timeout');
  });
});

// ── Human Review ────────────────────────────────────────────────────

describe('completeHumanReview', () => {
  it('should transition AwaitingReview → Reviewed', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    ecgCase.completeHumanReview(makeReview());

    expect(ecgCase.status).toBe('Reviewed');
    expect(ecgCase.humanReview?.decision).toBe('accepted');
  });

  it('should allow physician to modify assessment', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    const modifiedAssessment = makeAssessment({
      summary: 'Modified: Borderline ST changes noted',
      classification: makeClassification({ predictedCategory: 'STTC' }),
    });

    ecgCase.completeHumanReview(
      makeReview({ decision: 'modified', modifications: 'Changed to STTC' }),
      modifiedAssessment,
    );

    expect(ecgCase.assessment?.classification.predictedCategory).toBe('STTC');
  });

  it('should reject if not in AwaitingReview state', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    expect(() => ecgCase.completeHumanReview(makeReview()))
      .toThrow(DomainInvariantViolationError);
  });
});

// ── Finalization ────────────────────────────────────────────────────

describe('finalize', () => {
  it('should transition Reviewed → Finalized (delivered)', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.completeHumanReview(makeReview());

    ecgCase.finalize('delivered', 'Normal ECG confirmed by cardiologist');

    expect(ecgCase.status).toBe('Finalized');
    expect(ecgCase.finalOutcome).toBe('delivered');
    expect(ecgCase.finalSummary).toBe('Normal ECG confirmed by cardiologist');
  });

  it('should allow withdrawal', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.completeHumanReview(makeReview());

    ecgCase.finalize('withdrawn', 'Withdrawn by requestor');

    expect(ecgCase.finalOutcome).toBe('withdrawn');
  });

  it('should reject finalization without review (human oversight boundary)', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');

    expect(() => ecgCase.finalize('delivered', 'Trying to skip review'))
      .toThrow(DomainInvariantViolationError);
  });

  it('should block delivery if critical safety flag exists', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.raiseSafetyFlag('STAT_MI_DETECTED', 'critical', 'MI detected', true);
    ecgCase.completeHumanReview(makeReview());

    expect(() => ecgCase.finalize('delivered', 'Attempting delivery'))
      .toThrow(DomainInvariantViolationError);

    expect(ecgCase.status).toBe('Reviewed'); // remains Reviewed
  });

  it('should allow delivery with non-blocking safety flags', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Low confidence', false);
    ecgCase.completeHumanReview(makeReview());

    ecgCase.finalize('delivered', 'Delivered with advisory flags');

    expect(ecgCase.status).toBe('Finalized');
  });
});

// ── Safety Flags ────────────────────────────────────────────────────

describe('raiseSafetyFlag', () => {
  it('should add flag on non-finalized case', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Low confidence', false);

    expect(ecgCase.safetyFlags).toHaveLength(1);
    expect(ecgCase.safetyFlags[0].flagCode).toBe('LOW_CONFIDENCE');
  });

  it('should reject flag on finalized case', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.completeHumanReview(makeReview());
    ecgCase.finalize('delivered', 'Done');

    expect(() => ecgCase.raiseSafetyFlag('LATE_FLAG', 'info', 'Too late', false))
      .toThrow(DomainInvariantViolationError);
  });

  it('should compute hasBlockingSafetyFlags correctly', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    expect(ecgCase.hasBlockingSafetyFlags).toBe(false);

    ecgCase.raiseSafetyFlag('INFO_FLAG', 'info', 'Informational', false);
    expect(ecgCase.hasBlockingSafetyFlags).toBe(false);

    ecgCase.raiseSafetyFlag('BLOCKING', 'critical', 'Blocks delivery', true);
    expect(ecgCase.hasBlockingSafetyFlags).toBe(true);
  });

  it('should reject duplicate unresolved flag codes', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Low confidence', false);

    expect(() => ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Duplicate low confidence', false))
      .toThrow(DomainInvariantViolationError);
  });
});

// ── Resolve Safety Flags ────────────────────────────────────────────

describe('resolveSafetyFlag', () => {
  it('should resolve a blocking flag and unblock delivery', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.raiseSafetyFlag('STAT_MI_DETECTED', 'critical', 'MI detected', true);

    expect(ecgCase.hasBlockingSafetyFlags).toBe(true);

    ecgCase.resolveSafetyFlag('STAT_MI_DETECTED', 'reviewer-1', 'Waveform review confirms false positive');

    expect(ecgCase.hasBlockingSafetyFlags).toBe(false);
    expect(ecgCase.safetyFlags[0].resolvedAt).toBeDefined();
    expect(ecgCase.safetyFlags[0].resolvedBy).toBe('reviewer-1');
    expect(ecgCase.safetyFlags[0].resolution).toBe('Waveform review confirms false positive');
  });

  it('should allow delivery after blocking flag is resolved', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.raiseSafetyFlag('STAT_MI_DETECTED', 'critical', 'MI detected', true);
    ecgCase.completeHumanReview(makeReview());

    // Delivery blocked before resolution
    expect(() => ecgCase.finalize('delivered', 'Attempting delivery'))
      .toThrow(DomainInvariantViolationError);

    ecgCase.resolveSafetyFlag('STAT_MI_DETECTED', 'reviewer-1', 'Manual review: false positive');

    // Delivery allowed after resolution
    ecgCase.finalize('delivered', 'Delivered after documented mitigation');
    expect(ecgCase.status).toBe('Finalized');
    expect(ecgCase.finalOutcome).toBe('delivered');
  });

  it('should reject resolving a flag that does not exist', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    expect(() => ecgCase.resolveSafetyFlag('NONEXISTENT', 'reviewer-1', 'No such flag'))
      .toThrow(DomainInvariantViolationError);
  });

  it('should reject resolving a flag on a finalized case', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());
    ecgCase.completeInference(makeAssessment(), 'model-v1.0');
    ecgCase.completeHumanReview(makeReview());
    ecgCase.finalize('withdrawn', 'Done');

    expect(() => ecgCase.resolveSafetyFlag('ANY', 'reviewer-1', 'Too late'))
      .toThrow(DomainInvariantViolationError);
  });

  it('should allow re-raising a flag code after prior resolution', () => {
    const ecgCase = EcgSecondOpinionCase.submit(makeRecording(), makeQuestion());

    ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Initial warning', false);
    ecgCase.resolveSafetyFlag('LOW_CONFIDENCE', 'reviewer-1', 'Reviewed and acknowledged');

    ecgCase.raiseSafetyFlag('LOW_CONFIDENCE', 'warning', 'Repeated after new evidence', false);

    expect(ecgCase.safetyFlags).toHaveLength(2);
    expect(ecgCase.safetyFlags[1].resolvedAt).toBeUndefined();
  });
});
