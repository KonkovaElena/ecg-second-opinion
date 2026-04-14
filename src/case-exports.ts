// ─── ECG Second Opinion — FHIR DiagnosticReport Export ─────────────

import type { StructuredEcgReport } from './case-contracts';
import type { EcgSecondOpinionCase } from './cases';
import { buildStructuredEcgReport } from './case-presentation';

function diagnosticStatus(ecgCase: EcgSecondOpinionCase): 'registered' | 'preliminary' | 'final' {
  if (!ecgCase.assessment) {
    return 'registered';
  }

  return ecgCase.status === 'Finalized' ? 'final' : 'preliminary';
}

function buildNarrative(report: StructuredEcgReport): string {
  const lines = [
    `ECG Second Opinion Report for ${report.patientAlias}`,
    `Status: ${report.reportStatus}`,
    `Predicted category: ${report.predictedCategory ?? 'not available'}`,
    `Confidence: ${report.confidenceBand ?? 'not available'}`,
    '',
    `Summary: ${report.summary ?? 'Not available yet'}`,
  ];

  if (report.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const finding of report.findings) {
      lines.push(`- ${finding}`);
    }
  }

  if (report.finalConclusion) {
    lines.push('', `Final conclusion: ${report.finalConclusion}`);
  }

  return lines.join('\n');
}

export function buildFhirDiagnosticReport(ecgCase: EcgSecondOpinionCase, publicBaseUrl: string) {
  const report = buildStructuredEcgReport(ecgCase);
  const issuedAt = ecgCase.updatedAt.toISOString();
  const observationStatus = diagnosticStatus(ecgCase) === 'final' ? 'final' : 'preliminary';

  const containedObservations = ecgCase.assessment ? [
    {
      resourceType: 'Observation',
      id: 'predicted-category',
      status: observationStatus,
      code: {
        text: 'Predicted ECG diagnostic category',
      },
      effectiveDateTime: ecgCase.recording.recordingDate.toISOString(),
      valueCodeableConcept: {
        text: ecgCase.assessment.classification.predictedCategory,
      },
      interpretation: [{
        text: ecgCase.assessment.classification.confidenceBand,
      }],
      note: ecgCase.assessment.findings.map((finding) => ({ text: finding })),
    },
    {
      resourceType: 'Observation',
      id: 'confidence-band',
      status: observationStatus,
      code: {
        text: 'ECG model confidence band',
      },
      effectiveDateTime: ecgCase.recording.recordingDate.toISOString(),
      valueCodeableConcept: {
        text: ecgCase.assessment.classification.confidenceBand,
      },
      note: ecgCase.assessment.recommendations.map((recommendation) => ({ text: recommendation })),
    },
  ] : [];

  return {
    resourceType: 'DiagnosticReport',
    id: ecgCase.id,
    identifier: [{
      system: `${publicBaseUrl}/identifiers/ecg-case`,
      value: ecgCase.id,
    }],
    status: diagnosticStatus(ecgCase),
    category: [{
      text: 'Cardiology',
    }],
    code: {
      text: 'ECG second-opinion report',
    },
    subject: {
      display: ecgCase.recording.patientAlias,
    },
    effectiveDateTime: ecgCase.recording.recordingDate.toISOString(),
    issued: issuedAt,
    performer: ecgCase.humanReview ? [{ display: ecgCase.humanReview.reviewerRole }] : [],
    resultsInterpreter: ecgCase.humanReview ? [{ display: ecgCase.humanReview.reviewerRole }] : [],
    result: containedObservations.map((observation) => ({ reference: `#${observation.id}` })),
    contained: containedObservations,
    conclusion: ecgCase.finalSummary ?? ecgCase.assessment?.summary ?? null,
    presentedForm: [{
      contentType: 'text/plain',
      language: 'en',
      title: `ECG Report ${ecgCase.id}`,
      data: Buffer.from(buildNarrative(report), 'utf8').toString('base64'),
    }],
    extension: [{
      url: `${publicBaseUrl}/extensions/research-use-only`,
      valueString: 'Research Use Only. Requires qualified clinician review before clinical use.',
    }],
  };
}