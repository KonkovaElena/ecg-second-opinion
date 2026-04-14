// ─── ECG Second Opinion — Case Presentation Builders ───────────────

import type {
  CaseDetail,
  CaseListItem,
  StructuredEcgReport,
  EcgCaseStatus,
} from './case-contracts';
import type { EcgSecondOpinionCase } from './cases';

function toIsoString(value: Date): string {
  return value.toISOString();
}

export function toCaseListItem(ecgCase: EcgSecondOpinionCase): CaseListItem {
  return {
    caseId: ecgCase.id,
    patientAlias: ecgCase.recording.patientAlias,
    status: ecgCase.status,
    predictedCategory: ecgCase.assessment?.classification.predictedCategory ?? null,
    confidenceBand: ecgCase.assessment?.classification.confidenceBand ?? null,
    urgency: ecgCase.clinicalQuestion.urgency,
    createdAt: toIsoString(ecgCase.createdAt),
    updatedAt: toIsoString(ecgCase.updatedAt),
  };
}

export function toCaseDetail(ecgCase: EcgSecondOpinionCase): CaseDetail {
  return {
    ...toCaseListItem(ecgCase),
    recording: ecgCase.recording,
    clinicalQuestion: ecgCase.clinicalQuestion,
    originalInterpretation: ecgCase.originalInterpretation,
    assessment: ecgCase.assessment,
    humanReview: ecgCase.humanReview,
    safetyFlags: ecgCase.safetyFlags,
    inferenceFailureReason: ecgCase.inferenceFailureReason,
    finalOutcome: ecgCase.finalOutcome,
    finalSummary: ecgCase.finalSummary,
    modelId: ecgCase.modelId,
  };
}

function reportStatusFromCase(status: EcgCaseStatus, hasAssessment: boolean): StructuredEcgReport['reportStatus'] {
  if (!hasAssessment) {
    return 'not_ready';
  }

  return status === 'Finalized' ? 'final' : 'preliminary';
}

export function buildStructuredEcgReport(ecgCase: EcgSecondOpinionCase): StructuredEcgReport {
  return {
    caseId: ecgCase.id,
    reportStatus: reportStatusFromCase(ecgCase.status, Boolean(ecgCase.assessment)),
    patientAlias: ecgCase.recording.patientAlias,
    predictedCategory: ecgCase.assessment?.classification.predictedCategory ?? null,
    confidenceBand: ecgCase.assessment?.classification.confidenceBand ?? null,
    summary: ecgCase.assessment?.summary ?? null,
    findings: ecgCase.assessment?.findings ?? [],
    recommendations: ecgCase.assessment?.recommendations ?? [],
    limitations: ecgCase.assessment?.limitations ?? [],
    safetyFlags: ecgCase.safetyFlags,
    clinicianReview: ecgCase.humanReview,
    finalConclusion: ecgCase.finalSummary,
    recordedAt: ecgCase.recording.recordingDate.toISOString(),
    issuedAt: ecgCase.updatedAt.toISOString(),
  };
}

export function buildOperationsSummary(cases: readonly EcgSecondOpinionCase[]) {
  const byStatus = cases.reduce<Record<EcgCaseStatus, number>>((accumulator, ecgCase) => {
    accumulator[ecgCase.status] += 1;
    return accumulator;
  }, {
    Submitted: 0,
    InferencePending: 0,
    InferenceFailed: 0,
    AwaitingReview: 0,
    Reviewed: 0,
    Finalized: 0,
  });

  const awaitingReviewByUrgency = cases.reduce<Record<string, number>>((accumulator, ecgCase) => {
    if (ecgCase.status === 'AwaitingReview') {
      accumulator[ecgCase.clinicalQuestion.urgency] = (accumulator[ecgCase.clinicalQuestion.urgency] ?? 0) + 1;
    }
    return accumulator;
  }, {});

  const blockingCases = cases.filter((ecgCase) => ecgCase.hasBlockingSafetyFlags).length;
  const finalizedCases = cases.filter((ecgCase) => ecgCase.status === 'Finalized').length;

  return {
    totalCases: cases.length,
    finalizedCases,
    blockingCases,
    byStatus,
    awaitingReviewByUrgency,
    recentCases: cases
      .slice()
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, 5)
      .map(toCaseListItem),
  };
}