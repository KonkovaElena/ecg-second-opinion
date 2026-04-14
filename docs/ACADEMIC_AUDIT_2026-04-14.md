# ECG Second Opinion — Academic Audit 2026-04-14

Project: `ecg-second-opinion`

Scope: code, tests, auth boundary, validation boundary, packaging surface, Docker/public GitHub surfaces present in the workspace.

Audit method: direct file read, targeted code inspection, Jest JSON result parsing, narrow auth coverage run, and broad verification (`lint`, `typecheck`, `test`, `build`).

## Synopsis

ECG Second Opinion is a clinician-in-the-loop control plane for ECG second-opinion cases. The system is explicit about the boundary between AI output and clinical judgment: inference produces a draft assessment, a clinician review is mandatory before delivery, and unresolved blocking safety flags prevent finalization.

The current implementation is best described as a workflow orchestrator with a transparent inference seam rather than a full diagnostic platform. The metadata-fallback inference adapter is openly tagged as a stub, while the domain contracts are already shaped for a later 1D-CNN worker with uncertainty and interpretability outputs.

## Verified Metrics

| Metric | Verified value | Evidence source |
|---|---:|---|
| Source files | 19 `.ts` files in `src/` | PowerShell file inventory |
| Source LOC | 1,978 | PowerShell line count |
| Test files | 5 | PowerShell file inventory |
| Test LOC | 1,442 | PowerShell line count |
| Passing tests | 94 | `.jest-results.json` |
| Test suites | 5 | `.jest-results.json` |
| App routes in `app.ts` | 12 | direct route scan |
| Health routes in `health.ts` | 2 | direct route scan |
| Total Express routes | 14 | app routes + health routes |
| Prometheus instruments | 7 | `src/metrics.ts` |
| GitHub workflows | 3 | `.github/workflows/` |
| Production dependencies | 6 | `package.json` |
| Development dependencies | 12 | `package.json` |

Per-suite verified tests:

| Suite | Passing tests |
|---|---:|
| `tests/api.test.ts` | 35 |
| `tests/validation.test.ts` | 12 |
| `tests/safety-policy.test.ts` | 13 |
| `tests/cases.test.ts` | 25 |
| `tests/config.test.ts` | 9 |

## Architecture Assessment

### State Machine

Verified state flow:

```text
Submitted -> InferencePending -> AwaitingReview -> Reviewed -> Finalized
                 |
                 -> InferenceFailed
```

Assessment: sound.

Strengths:

- Rich aggregate with guarded transitions in `src/cases.ts`.
- Final delivery is blocked by unresolved blocking safety flags.
- Duplicate unresolved flag codes are now rejected at the aggregate level.
- Re-raising a flag after prior resolution is explicitly supported and tested.

Residual note:

- `completeInference()` accepts both `Submitted` and `InferencePending`. That is coherent for sync and async paths, but the dual-entry design should remain documented as intentional.

### Layering

The project remains structurally flat, but the responsibilities are clean enough for its size:

- Domain: `cases.ts`, `case-contracts.ts`
- Application/API: `app.ts`, `case-presentation.ts`, `case-exports.ts`
- Infrastructure adapters: `case-repository.ts`, `inference-service.ts`, `safety-policy.ts`
- Cross-cutting: `config.ts`, `metrics.ts`, `health.ts`, `correlation.ts`, `validation.ts`
- Auth boundary: `auth-common.ts`, `operator-auth.ts`, `reviewer-auth.ts`, `internal-auth.ts`

Assessment: appropriate for current scale. A folderized split becomes worth it only when the project materially exceeds its current size or introduces a real persistence and worker subsystem.

## Security Assessment

### Auth Boundary

Implemented model:

- operator requests: API key via `x-api-key`
- reviewer requests: HS256 JWT
- internal worker requests: bearer token

Verified reviewer JWT checks:

- algorithm
- signature
- issuer
- audience
- expiry
- not-before
- subject
- role allow-list

Verified internal bearer checks:

- missing token rejection
- invalid token rejection
- invalid header-format rejection

Strengths:

- zero dependency on `jsonwebtoken`
- timing-safe secret comparison in auth helpers
- production fail-closed config guards for operator/internal/JWT secrets
- explicit audience validation now reduces cross-service token reuse risk

Residual concerns:

- symmetric HS256 remains acceptable for a prototype, but RS256 becomes preferable once signing and verification are split across services.
- there is still no token revocation model, which is acceptable at this stage.

### Input Validation

Assessment: strong.

Highlights:

- strict Zod schemas reject unknown fields
- ECG recording bounds are explicit
- review/finalize/internal callback payloads are bounded
- category probabilities are now refined to sum to `1.0 ± 0.001`

This closes a real correctness gap in the prior contract surface.

## Clinical Safety Assessment

The eight-rule safety policy is still the strongest architectural feature in the project because it turns clinician review from a policy statement into an execution constraint.

Verified blocking rules include:

- insufficient data
- stat MI on urgent workflow
- high epistemic uncertainty

Verified non-blocking rules include:

- low confidence
- short recording
- low sampling rate
- missing XAI explanation

Assessment: strong for a research control plane.

## Interoperability Assessment

FHIR R4 DiagnosticReport export remains structurally sound for the current stage. The export is useful and coherent, but still not profile-grade interoperability.

Current gaps that remain valid:

- free-text coding rather than SNOMED CT / LOINC
- no explicit `meta.profile`
- no stronger identifier-system strategy yet

These are not blockers for research use, but they are blockers for serious clinical integration.

## Observability and Runtime Assessment

Current observability surface:

- `/metrics`
- `/healthz`
- `/readyz`
- 7 Prometheus instruments
- correlation-id propagation

Current runtime risk that still matters:

- async inference dispatch still uses `setImmediate()` with no durable queue or retry policy
- the failure path records `InferenceFailed`, which is good, but there is no dead-letter or replay mechanism
- the awaiting-review gauge remains mutation-driven rather than query-derived, so it deserves future hardening against drift

## Publication and Supply-Chain Surface

Locally verified:

- README, LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, CITATION.cff
- CI workflow
- CodeQL workflow
- Dependency Review workflow
- Dependabot config
- issue templates
- PR template
- CODEOWNERS
- non-root Dockerfile
- `.env.example` with documented variables

Important caveat:

Inside the current workspace, `ecg-second-opinion` is still an untracked subdirectory of the parent repository, not an isolated git repository. That means local code and docs are publication-ready in substance, but remote GitHub settings, branch protections, and history-level secret hygiene have not been audited as a standalone repository artifact.

## Wave Executed In This Pass

This wave materially improved the verified boundary model:

- added reviewer JWT `aud` validation
- added config support and tests for reviewer audience
- added Zod probability-sum invariant for classifier outputs
- blocked duplicate unresolved safety flags in the aggregate
- expanded API auth-boundary negative-path coverage

## Remaining Deficiencies

| ID | Severity | Area | Finding |
|---|---|---|---|
| ECG-D01 | High | Inference runtime | `setImmediate()` dispatch has no durable queue, retry policy, or dead-letter handling |
| ECG-D02 | Medium | Persistence | repository remains in-memory only |
| ECG-D03 | Medium | Interoperability | FHIR export still lacks coded clinical vocabularies and stronger profile declarations |
| ECG-D04 | Low | Observability | awaiting-review gauge is mutation-driven rather than derived |
| ECG-D05 | Low | Operations | shutdown still does not explicitly drain in-flight inference work |
| ECG-D06 | Low | Logging | there is still no structured request logging middleware |

## Overall Assessment

Grade: `A`

Reasoning:

- architecture is disciplined for the project size
- auth and validation boundaries are stronger than typical research prototypes
- the safety policy and mandatory review boundary are not superficial; they are encoded in domain behavior
- the remaining important deficits are operational, not architectural

The project is now materially stronger than the earlier baseline because the most likely correctness and boundary gaps were addressed without inflating complexity.