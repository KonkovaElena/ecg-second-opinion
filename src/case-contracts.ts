// ─── ECG Second Opinion — Domain Contracts ─────────────────────────
// All TypeScript interfaces and types for the ECG workflow system.

// ─── ECG Case States ────────────────────────────────────────────────

export type EcgCaseStatus =
  | 'Submitted'
  | 'InferencePending'
  | 'InferenceFailed'
  | 'AwaitingReview'
  | 'Reviewed'
  | 'Finalized';

// ─── ECG Lead System ────────────────────────────────────────────────

/** Standard 12-lead ECG lead identifiers */
export type EcgLead =
  | 'I' | 'II' | 'III'
  | 'aVR' | 'aVL' | 'aVF'
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

export const ALL_ECG_LEADS: readonly EcgLead[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF',
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6',
] as const;

// ─── Value Objects ──────────────────────────────────────────────────

export interface EcgRecordingRef {
  /** Unique recording identifier */
  readonly recordingId: string;
  /** Patient pseudonym (never real name in research context) */
  readonly patientAlias: string;
  /** Recording date */
  readonly recordingDate: Date;
  /** Sampling frequency in Hz (e.g. 100, 500) */
  readonly samplingFrequencyHz: number;
  /** Number of leads (typically 12 for standard ECG) */
  readonly leadCount: number;
  /** Duration in seconds */
  readonly durationSeconds: number;
  /** Number of samples per lead */
  readonly samplesPerLead: number;
  /** Source dataset (e.g. 'PTB-XL', 'MIT-BIH') */
  readonly sourceDataset?: string;
  /** Device manufacturer */
  readonly deviceManufacturer?: string;
  /** Referring physician */
  readonly referringPhysician?: string;
}

export interface ClinicalQuestion {
  /** The physician's diagnostic question */
  readonly questionText: string;
  /** Additional clinical context */
  readonly clinicalContext?: string;
  /** Urgency level */
  readonly urgency: 'routine' | 'urgent' | 'stat';
  /** Known prior conditions */
  readonly knownConditions?: readonly string[];
}

/** Diagnostic category per SCP-ECG standard and PTB-XL labeling */
export type EcgDiagnosticCategory =
  | 'NORM'   // Normal sinus rhythm
  | 'MI'     // Myocardial infarction
  | 'STTC'   // ST/T change
  | 'CD'     // Conduction disturbance
  | 'HYP';   // Hypertrophy

export type ConfidenceBand = 'high' | 'moderate' | 'low' | 'insufficient_data';
export type AgreementLevel =
  | 'full_agreement'
  | 'partial_agreement'
  | 'significant_disagreement'
  | 'cannot_determine';

export type XaiExplanationMethod = 'grad-cam' | 'shap' | 'lime' | 'attention' | 'none';

/** Quantitative uncertainty metrics from MC-Dropout or Deep Ensembles */
export interface UncertaintyMetrics {
  /** Shannon entropy of the MC-Dropout predictive distribution */
  readonly epistemicEntropy: number;
  /** Expected entropy under data noise (aleatory component) */
  readonly aleatoryEntropy: number;
  /** Mutual information: epistemic − aleatory */
  readonly mutualInformation: number;
  /** Number of MC forward passes performed */
  readonly mcSamples: number;
  /** Number of independent models in ensemble (if Deep Ensembles) */
  readonly ensembleSize?: number;
  /** Prediction set cardinality from Conformal Prediction */
  readonly conformalSetSize?: number;
}

/** XAI artifacts for clinician interpretability */
export interface InterpretabilityArtifacts {
  /** Per-lead Grad-CAM heatmap (normalized 0–1 per sample) */
  readonly gradCamHeatmap?: Partial<Record<EcgLead, readonly number[]>>;
  /** Per-lead Transformer attention weights */
  readonly attentionWeights?: Partial<Record<EcgLead, readonly number[]>>;
  /** Top SHAP features: which lead/time contributed most to the prediction */
  readonly shapTopFeatures?: readonly { lead: EcgLead; timestampMs: number; contribution: number }[];
  /** Which XAI method produced these artifacts */
  readonly explanationMethod: XaiExplanationMethod;
}

export interface EcgClassificationResult {
  /** Predicted diagnostic category */
  readonly predictedCategory: EcgDiagnosticCategory;
  /** Probability scores for each category (sums to ~1.0) */
  readonly categoryProbabilities: Record<EcgDiagnosticCategory, number>;
  /** Overall confidence band */
  readonly confidenceBand: ConfidenceBand;
  /** Model architecture used (e.g. '1D-CNN-3Layer', 'ResNet-1D', 'CardioPatternFormer') */
  readonly modelArchitecture: string;
  /** Model version identifier */
  readonly modelVersion: string;
  /** Inference latency in ms */
  readonly inferenceLatencyMs: number;
  /** Quantitative uncertainty from MC-Dropout / Deep Ensembles (optional until real model) */
  readonly uncertaintyMetrics?: UncertaintyMetrics;
}

export interface EcgAssessment {
  /** Clinical summary */
  readonly summary: string;
  /** Classification result from the neural network */
  readonly classification: EcgClassificationResult;
  /** Key ECG findings (rhythm, morphology, intervals) */
  readonly findings: readonly string[];
  /** Agreement with original interpretation (if available) */
  readonly agreementLevel: AgreementLevel;
  /** Differential diagnoses */
  readonly differentialDiagnoses: readonly string[];
  /** Clinical recommendations */
  readonly recommendations: readonly string[];
  /** Known limitations of this assessment */
  readonly limitations: readonly string[];
  /** Lead-specific abnormalities detected */
  readonly leadFindings?: Partial<Record<EcgLead, string>>;
  /** XAI interpretability artifacts (Grad-CAM, SHAP, Attention) */
  readonly interpretability?: InterpretabilityArtifacts;
}

export type ReviewDecision = 'accepted' | 'modified' | 'rejected' | 'escalated';

export interface HumanReviewDisposition {
  /** Authenticated reviewer identifier (JWT sub) */
  readonly reviewerId?: string;
  /** Reviewer role (e.g. 'Cardiologist', 'Electrophysiologist') */
  readonly reviewerRole: string;
  /** Reviewer's decision */
  readonly decision: ReviewDecision;
  /** Modifications made (if decision is 'modified') */
  readonly modifications?: string;
  /** Clinical notes */
  readonly clinicalNotes?: string;
  /** When the review was performed */
  readonly reviewedAt: Date;
}

export interface SafetyFlag {
  readonly flagCode: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly description: string;
  readonly blocksDelivery: boolean;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
  readonly resolution?: string;
}

export function isSafetyFlagResolved(flag: SafetyFlag): boolean {
  return flag.resolvedAt != null;
}

// ─── Aggregate Props ────────────────────────────────────────────────

export interface EcgSecondOpinionCaseProps {
  readonly recording: EcgRecordingRef;
  readonly clinicalQuestion: ClinicalQuestion;
  readonly originalInterpretation: string | null;
  readonly assessment: EcgAssessment | null;
  readonly humanReview: HumanReviewDisposition | null;
  readonly status: EcgCaseStatus;
  readonly safetyFlags: readonly SafetyFlag[];
  readonly inferenceFailureReason: string | null;
  readonly finalOutcome: string | null;
  readonly finalSummary: string | null;
  readonly modelId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Use Case I/O ───────────────────────────────────────────────────

export interface GenerateEcgSecondOpinionInput {
  readonly recording: EcgRecordingRef;
  readonly clinicalQuestion: ClinicalQuestion;
  readonly originalInterpretation?: string;
  readonly correlationId?: string;
}

export interface GenerateEcgSecondOpinionOutput {
  readonly caseId: string;
  readonly status: string;
  readonly predictedCategory: EcgDiagnosticCategory;
  readonly confidenceBand: ConfidenceBand;
  readonly safetyFlagCount: number;
  readonly hasBlockingFlags: boolean;
  readonly modelId: string;
  readonly inferenceLatencyMs: number;
}

export interface CompleteEcgReviewInput {
  readonly caseId: string;
  readonly disposition: HumanReviewDisposition;
  readonly updatedAssessment?: EcgAssessment;
  readonly correlationId?: string;
}

export interface CompleteEcgReviewOutput {
  readonly caseId: string;
  readonly status: string;
  readonly reviewDecision: ReviewDecision;
}

export interface FinalizeEcgCaseInput {
  readonly caseId: string;
  readonly outcome: 'delivered' | 'withdrawn' | 'expired';
  readonly finalSummary: string;
  readonly correlationId?: string;
}

export interface FinalizeEcgCaseOutput {
  readonly caseId: string;
  readonly status: string;
  readonly outcome: string;
}

// ─── Domain Ports ───────────────────────────────────────────────────

export interface EcgInferenceResult {
  readonly assessment: EcgAssessment;
  readonly modelId: string;
  readonly latencyMs: number;
}

export interface IEcgInferenceService {
  classify(
    recording: EcgRecordingRef,
    clinicalQuestion: ClinicalQuestion,
    originalInterpretation?: string,
  ): Promise<EcgInferenceResult>;
}

export interface SafetyCheckResult {
  readonly passed: boolean;
  readonly flags: readonly SafetyFlag[];
}

export interface IEcgClinicalSafetyPolicy {
  evaluate(
    assessment: EcgAssessment,
    recording: EcgRecordingRef,
    clinicalQuestion: ClinicalQuestion,
  ): Promise<SafetyCheckResult>;
}

export interface IEcgCaseRepository {
  save(ecgCase: import('./cases').EcgSecondOpinionCase): Promise<void>;
  findById(id: string): Promise<import('./cases').EcgSecondOpinionCase | null>;
  findByRecordingId(recordingId: string): Promise<import('./cases').EcgSecondOpinionCase[]>;
  list(): Promise<import('./cases').EcgSecondOpinionCase[]>;
}

// ─── API Response Shapes ────────────────────────────────────────────

export interface CaseListItem {
  readonly caseId: string;
  readonly patientAlias: string;
  readonly status: EcgCaseStatus;
  readonly predictedCategory: EcgDiagnosticCategory | null;
  readonly confidenceBand: ConfidenceBand | null;
  readonly urgency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CaseDetail extends CaseListItem {
  readonly recording: EcgRecordingRef;
  readonly clinicalQuestion: ClinicalQuestion;
  readonly originalInterpretation: string | null;
  readonly assessment: EcgAssessment | null;
  readonly humanReview: HumanReviewDisposition | null;
  readonly safetyFlags: readonly SafetyFlag[];
  readonly inferenceFailureReason: string | null;
  readonly finalOutcome: string | null;
  readonly finalSummary: string | null;
  readonly modelId: string | null;
}

export interface StructuredEcgReport {
  readonly caseId: string;
  readonly reportStatus: 'not_ready' | 'preliminary' | 'final';
  readonly patientAlias: string;
  readonly predictedCategory: EcgDiagnosticCategory | null;
  readonly confidenceBand: ConfidenceBand | null;
  readonly summary: string | null;
  readonly findings: readonly string[];
  readonly recommendations: readonly string[];
  readonly limitations: readonly string[];
  readonly safetyFlags: readonly SafetyFlag[];
  readonly clinicianReview: HumanReviewDisposition | null;
  readonly finalConclusion: string | null;
  readonly recordedAt: string;
  readonly issuedAt: string;
}
