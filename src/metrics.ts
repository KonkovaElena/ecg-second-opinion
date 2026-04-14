// ─── ECG Second Opinion — Prometheus Metrics ────────────────────────

import { Counter, Histogram, Gauge, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

// ── Counters ────────────────────────────────────────────────────────

export const ecgInferenceRequestsTotal = new Counter({
  name: 'ecg_second_opinion_inference_requests_total',
  help: 'Total ECG inference requests by provider and result',
  labelNames: ['provider', 'result'] as const,
  registers: [metricsRegistry],
});

export const ecgCasesCreatedTotal = new Counter({
  name: 'ecg_second_opinion_cases_created_total',
  help: 'Total ECG cases created',
  registers: [metricsRegistry],
});

export const ecgReviewsCompletedTotal = new Counter({
  name: 'ecg_second_opinion_reviews_completed_total',
  help: 'Total ECG reviews completed by decision type',
  labelNames: ['decision'] as const,
  registers: [metricsRegistry],
});

// ── Histograms ──────────────────────────────────────────────────────

export const ecgInferenceLatencySeconds = new Histogram({
  name: 'ecg_second_opinion_inference_latency_seconds',
  help: 'ECG inference latency distribution',
  labelNames: ['provider'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ── Gauges ──────────────────────────────────────────────────────────

export const ecgCasesAwaitingReview = new Gauge({
  name: 'ecg_second_opinion_cases_awaiting_review',
  help: 'Number of ECG cases awaiting clinician review by urgency',
  labelNames: ['urgency'] as const,
  registers: [metricsRegistry],
});

export const ecgInferenceErrorsTotal = new Counter({
  name: 'ecg_second_opinion_inference_errors_total',
  help: 'Total ECG inference errors by provider and error type',
  labelNames: ['provider', 'error_type'] as const,
  registers: [metricsRegistry],
});

export const ecgSafetyFlagsTotal = new Counter({
  name: 'ecg_second_opinion_safety_flags_total',
  help: 'Total safety flags raised by flag code',
  labelNames: ['flag_code', 'severity'] as const,
  registers: [metricsRegistry],
});

// ── Recording Functions ─────────────────────────────────────────────

export function recordEcgInference(
  provider: string,
  result: 'success' | 'failure',
  latencyMs: number,
): void {
  ecgInferenceRequestsTotal.inc({ provider, result });
  ecgInferenceLatencySeconds.observe({ provider }, latencyMs / 1000);
}

export function recordEcgInferenceError(
  provider: string,
  errorType: string,
): void {
  ecgInferenceErrorsTotal.inc({ provider, error_type: errorType });
}
