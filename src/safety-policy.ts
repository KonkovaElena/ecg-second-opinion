// ─── ECG Second Opinion — Clinical Safety Policy ────────────────────
// Rule-based safety evaluation aligned with AHA/ACC/HRS clinical guidelines.
// Flags low-confidence, high-risk, and disagreement scenarios.

import type {
  EcgAssessment,
  EcgRecordingRef,
  ClinicalQuestion,
  IEcgClinicalSafetyPolicy,
  SafetyCheckResult,
  SafetyFlag,
} from './case-contracts';

export class DefaultEcgClinicalSafetyPolicy implements IEcgClinicalSafetyPolicy {
  async evaluate(
    assessment: EcgAssessment,
    recording: EcgRecordingRef,
    clinicalQuestion: ClinicalQuestion,
  ): Promise<SafetyCheckResult> {
    const flags: SafetyFlag[] = [];

    // Rule 1: Low confidence → warning
    if (assessment.classification.confidenceBand === 'low') {
      flags.push({
        flagCode: 'LOW_CONFIDENCE',
        severity: 'warning',
        description: 'Model confidence is low; clinician review required before any action.',
        blocksDelivery: false,
      });
    }

    // Rule 2: Insufficient data → critical (blocks delivery)
    if (assessment.classification.confidenceBand === 'insufficient_data') {
      flags.push({
        flagCode: 'INSUFFICIENT_DATA',
        severity: 'critical',
        description: 'Insufficient data for a clinically meaningful classification.',
        blocksDelivery: true,
      });
    }

    // Rule 3: Significant disagreement with original → warning
    if (assessment.agreementLevel === 'significant_disagreement') {
      flags.push({
        flagCode: 'SIGNIFICANT_DISAGREEMENT',
        severity: 'warning',
        description: 'AI assessment significantly disagrees with the original interpretation.',
        blocksDelivery: false,
      });
    }

    // Rule 4: MI detected with stat urgency → critical flag for immediate attention
    if (
      assessment.classification.predictedCategory === 'MI' &&
      clinicalQuestion.urgency === 'stat'
    ) {
      flags.push({
        flagCode: 'STAT_MI_DETECTED',
        severity: 'critical',
        description: 'Myocardial infarction detected on stat-priority recording. Immediate cardiologist review required.',
        blocksDelivery: true,
      });
    }

    // Rule 5: Short recording may lack diagnostic quality
    if (recording.durationSeconds < 10) {
      flags.push({
        flagCode: 'SHORT_RECORDING',
        severity: 'warning',
        description: `Recording duration (${recording.durationSeconds}s) is below the recommended minimum of 10s.`,
        blocksDelivery: false,
      });
    }

    // Rule 6: Low sampling frequency
    if (recording.samplingFrequencyHz < 100) {
      flags.push({
        flagCode: 'LOW_SAMPLING_RATE',
        severity: 'warning',
        description: `Sampling frequency (${recording.samplingFrequencyHz} Hz) is below the recommended 100 Hz minimum.`,
        blocksDelivery: false,
      });
    }

    // Rule 7: High epistemic uncertainty from MC-Dropout / Deep Ensembles
    const uq = assessment.classification.uncertaintyMetrics;
    if (uq && uq.epistemicEntropy > 0.7) {
      flags.push({
        flagCode: 'HIGH_EPISTEMIC_UNCERTAINTY',
        severity: 'critical',
        description: `Model epistemic entropy (${uq.epistemicEntropy.toFixed(3)}) exceeds clinical threshold (0.7). Mandatory expert review.`,
        blocksDelivery: true,
      });
    }

    // Rule 8: No XAI explanation available — warning for clinician awareness
    if (!assessment.interpretability || assessment.interpretability.explanationMethod === 'none') {
      flags.push({
        flagCode: 'NO_XAI_EXPLANATION',
        severity: 'info',
        description: 'No interpretability artifacts available. Clinician cannot verify model reasoning visually.',
        blocksDelivery: false,
      });
    }

    return {
      passed: flags.length === 0,
      flags,
    };
  }
}
