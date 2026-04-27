// ─── ECG Second Opinion — Domain Aggregate ──────────────────────────
// Root aggregate implementing the 6-state clinician-in-the-loop workflow.
// Invariants enforced at the domain level — no case can bypass human review.

import { randomUUID } from 'node:crypto';
import type {
  EcgCaseStatus,
  EcgRecordingRef,
  ClinicalQuestion,
  EcgAssessment,
  HumanReviewDisposition,
  SafetyFlag,
  EcgSecondOpinionCaseProps,
} from './case-contracts';
import { isSafetyFlagResolved } from './case-contracts';

// ─── Domain Error ───────────────────────────────────────────────────

export class DomainInvariantViolationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainInvariantViolationError';
    this.code = code;
  }
}

// ─── Aggregate ──────────────────────────────────────────────────────

export class EcgSecondOpinionCase {
  public readonly id: string;
  private props: EcgSecondOpinionCaseProps;

  private constructor(id: string, props: EcgSecondOpinionCaseProps) {
    this.id = id;
    this.props = { ...props };
  }

  // ── Factory ─────────────────────────────────────────────────────

  static submit(
    recording: EcgRecordingRef,
    clinicalQuestion: ClinicalQuestion,
    originalInterpretation?: string,
  ): EcgSecondOpinionCase {
    const now = new Date();
    return new EcgSecondOpinionCase(randomUUID(), {
      recording,
      clinicalQuestion,
      originalInterpretation: originalInterpretation ?? null,
      assessment: null,
      humanReview: null,
      status: 'Submitted',
      safetyFlags: [],
      inferenceFailureReason: null,
      finalOutcome: null,
      finalSummary: null,
      modelId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ── Reconstitution (from storage) ─────────────────────────────

  static reconstitute(id: string, props: EcgSecondOpinionCaseProps): EcgSecondOpinionCase {
    return new EcgSecondOpinionCase(id, props);
  }

  // ── Commands (State Transitions) ──────────────────────────────

  /**
   * Submitted → InferencePending
   * Called when the case is queued for async AI analysis.
   */
  startInference(): void {
    if (this.props.status !== 'Submitted') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_INVALID_STATE_FOR_START_INFERENCE',
        `Cannot start inference in state '${this.props.status}'. Expected 'Submitted'.`,
      );
    }

    this.props = {
      ...this.props,
      status: 'InferencePending',
      updatedAt: new Date(),
    };
  }

  /**
   * Submitted | InferencePending → AwaitingReview
   * Called after the 1D-CNN inference service produces an ECG assessment.
   * Accepts from both Submitted (sync path) and InferencePending (async path).
   */
  completeInference(
    assessment: EcgAssessment,
    modelId: string,
  ): void {
    if (this.props.status !== 'Submitted' && this.props.status !== 'InferencePending') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_INVALID_STATE_FOR_INFERENCE',
        `Cannot complete inference in state '${this.props.status}'. Expected 'Submitted' or 'InferencePending'.`,
      );
    }

    this.props = {
      ...this.props,
      assessment,
      modelId,
      inferenceFailureReason: null,
      status: 'AwaitingReview',
      updatedAt: new Date(),
    };
  }

  /**
   * InferencePending → InferenceFailed
   * Persist failure state so cases do not remain stuck in pending forever.
   */
  failInference(reason: string): void {
    if (this.props.status !== 'InferencePending') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_INVALID_STATE_FOR_INFERENCE_FAILURE',
        `Cannot fail inference in state '${this.props.status}'. Expected 'InferencePending'.`,
      );
    }

    this.props = {
      ...this.props,
      status: 'InferenceFailed',
      inferenceFailureReason: reason,
      updatedAt: new Date(),
    };
  }

  /**
   * AwaitingReview → Reviewed
   * Clinician (cardiologist, electrophysiologist) reviews the AI draft.
    * Human oversight is mandatory before any case can be finalized.
   */
  completeHumanReview(
    disposition: HumanReviewDisposition,
    updatedAssessment?: EcgAssessment,
  ): void {
    if (this.props.status !== 'AwaitingReview') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_INVALID_STATE_FOR_REVIEW',
        `Cannot complete review in state '${this.props.status}'. Expected 'AwaitingReview'.`,
      );
    }

    this.props = {
      ...this.props,
      humanReview: disposition,
      assessment: updatedAssessment ?? this.props.assessment,
      status: 'Reviewed',
      updatedAt: new Date(),
    };
  }

  /**
   * Reviewed → Finalized
   * Only after clinician review. Delivery blocked by unresolved safety flags.
   */
  finalize(
    outcome: 'delivered' | 'withdrawn' | 'expired',
    finalSummary: string,
  ): void {
    if (this.props.status !== 'Reviewed') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_INVALID_STATE_FOR_FINALIZATION',
        `Cannot finalize case in state '${this.props.status}'. Expected 'Reviewed'.`,
      );
    }

    if (
      outcome === 'delivered' &&
      this.props.safetyFlags.some((flag) => flag.blocksDelivery && !isSafetyFlagResolved(flag))
    ) {
      throw new DomainInvariantViolationError(
        'ECG_CASE_BLOCKED_BY_SAFETY_FLAG',
        'Cannot deliver case with unresolved critical safety flags',
      );
    }

    this.props = {
      ...this.props,
      finalOutcome: outcome,
      finalSummary: finalSummary,
      status: 'Finalized',
      updatedAt: new Date(),
    };
  }

  /**
   * Raise a safety flag at any non-Finalized state.
   */
  raiseSafetyFlag(
    flagCode: string,
    severity: 'info' | 'warning' | 'critical',
    description: string,
    blocksDelivery: boolean,
  ): void {
    if (this.props.status === 'Finalized') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_CANNOT_FLAG_FINALIZED',
        'Cannot raise safety flag on a finalized case',
      );
    }

    if (this.props.safetyFlags.some((flag) => flag.flagCode === flagCode && !isSafetyFlagResolved(flag))) {
      throw new DomainInvariantViolationError(
        'ECG_CASE_DUPLICATE_SAFETY_FLAG',
        `An unresolved safety flag with code '${flagCode}' already exists`,
      );
    }

    const flag: SafetyFlag = { flagCode, severity, description, blocksDelivery };
    this.props = {
      ...this.props,
      safetyFlags: [...this.props.safetyFlags, flag],
      updatedAt: new Date(),
    };
  }

  /**
   * Resolve an unresolved safety flag by flagCode.
   * Requires authenticated reviewer identity and a resolution note.
   */
  resolveSafetyFlag(
    flagCode: string,
    resolvedBy: string,
    resolution: string,
  ): void {
    if (this.props.status === 'Finalized') {
      throw new DomainInvariantViolationError(
        'ECG_CASE_CANNOT_RESOLVE_FLAG_FINALIZED',
        'Cannot resolve safety flag on a finalized case',
      );
    }

    const index = this.props.safetyFlags.findIndex(
      (f) => f.flagCode === flagCode && !isSafetyFlagResolved(f),
    );

    if (index === -1) {
      throw new DomainInvariantViolationError(
        'ECG_CASE_SAFETY_FLAG_NOT_FOUND',
        `No unresolved safety flag with code '${flagCode}'`,
      );
    }

    const updatedFlags = [...this.props.safetyFlags];
    updatedFlags[index] = {
      ...updatedFlags[index],
      resolvedAt: new Date(),
      resolvedBy,
      resolution,
    };

    this.props = {
      ...this.props,
      safetyFlags: updatedFlags,
      updatedAt: new Date(),
    };
  }

  // ── Accessors ─────────────────────────────────────────────────

  get recording(): EcgRecordingRef { return this.props.recording; }
  get clinicalQuestion(): ClinicalQuestion { return this.props.clinicalQuestion; }
  get originalInterpretation(): string | null { return this.props.originalInterpretation; }
  get assessment(): EcgAssessment | null { return this.props.assessment; }
  get humanReview(): HumanReviewDisposition | null { return this.props.humanReview; }
  get status(): EcgCaseStatus { return this.props.status; }
  get safetyFlags(): readonly SafetyFlag[] { return this.props.safetyFlags; }
  get inferenceFailureReason(): string | null { return this.props.inferenceFailureReason; }
  get finalOutcome(): string | null { return this.props.finalOutcome; }
  get finalSummary(): string | null { return this.props.finalSummary; }
  get modelId(): string | null { return this.props.modelId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  get hasBlockingSafetyFlags(): boolean {
    return this.props.safetyFlags.some((f) => f.blocksDelivery && !isSafetyFlagResolved(f));
  }

  /** Snapshot for persistence */
  toProps(): EcgSecondOpinionCaseProps {
    return { ...this.props };
  }
}
