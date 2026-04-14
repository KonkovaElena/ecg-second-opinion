// ─── ECG Second Opinion — Stub Inference Service ────────────────────
// Metadata-fallback inference that produces a structured assessment
// without actual neural network computation.
// In production this would connect to a Python worker running the
// 1D-CNN neuromorphic analyzer (Mosin, 2024; PTB-XL dataset).
/** @sota-stub — Inference adapter: produces metadata-derived draft assessment.
 *  Real 1D-CNN inference worker planned for Wave 2. */

import type {
  EcgRecordingRef,
  ClinicalQuestion,
  EcgInferenceResult,
  EcgAssessment,
  EcgClassificationResult,
  IEcgInferenceService,
  UncertaintyMetrics,
} from './case-contracts';

export class MetadataFallbackInferenceService implements IEcgInferenceService {
  async classify(
    recording: EcgRecordingRef,
    clinicalQuestion: ClinicalQuestion,
    originalInterpretation?: string,
  ): Promise<EcgInferenceResult> {
    const startTime = Date.now();

    // Metadata-derived fallback: no actual signal processing.
    // Returns a conservative NORM classification with low confidence.
    // UQ stub: simulates high epistemic uncertainty (no real MC-Dropout here).
    const uncertaintyMetrics: UncertaintyMetrics = {
      epistemicEntropy: 0.92,
      aleatoryEntropy: 0.15,
      mutualInformation: 0.77,
      mcSamples: 0,
      ensembleSize: 0,
    };

    const classification: EcgClassificationResult = {
      predictedCategory: 'NORM',
      categoryProbabilities: {
        NORM: 0.60,
        MI: 0.15,
        STTC: 0.10,
        CD: 0.08,
        HYP: 0.07,
      },
      confidenceBand: 'low',
      modelArchitecture: 'metadata-fallback',
      modelVersion: '0.1.0-stub',
      inferenceLatencyMs: Date.now() - startTime,
      uncertaintyMetrics,
    };

    const assessment: EcgAssessment = {
      summary: `Metadata-based preliminary assessment for ${recording.leadCount}-lead ECG recording (${recording.durationSeconds}s at ${recording.samplingFrequencyHz} Hz). No signal-level analysis performed — full 1D-CNN inference pending.`,
      classification,
      findings: [
        `Recording: ${recording.leadCount}-lead, ${recording.durationSeconds}s duration`,
        `Sampling: ${recording.samplingFrequencyHz} Hz`,
        'Assessment: Metadata-only fallback — no waveform analysis',
      ],
      agreementLevel: originalInterpretation ? 'partial_agreement' : 'cannot_determine',
      differentialDiagnoses: [],
      recommendations: [
        'Full 12-lead signal analysis recommended for definitive classification',
        'Manual cardiologist review required for clinical decision-making',
      ],
      limitations: [
        'This assessment is based on recording metadata only',
        'No PQRST waveform analysis was performed',
        'Classification probabilities are placeholder values',
        'Uncertainty metrics are stub values (no MC-Dropout performed)',
      ],
      interpretability: {
        explanationMethod: 'none',
      },
    };

    return {
      assessment,
      modelId: 'metadata-fallback-v0.1.0',
      latencyMs: classification.inferenceLatencyMs,
    };
  }
}
