# ECG Second Opinion

Clinician-in-the-loop ECG second-opinion workflow system.

A standalone TypeScript API that orchestrates the full lifecycle of an ECG
second-opinion case — from intake and quality checks through AI-assisted draft
generation to mandatory clinician review, finalization, and delivery.

> ⚠️ **Research Use Only.** This system is not a medical device. It must not be
> used for clinical decision-making without proper regulatory clearance. Every
> output requires review by a qualified clinician.

This repository is not an autonomous diagnostic system. It is a
**clinician-in-the-loop workflow layer** that enforces human review before
finalization or delivery.

## Table of Contents

- [What This Project Does](#what-this-project-does)
- [How It Works](#how-it-works)
- [Current Baseline](#current-baseline)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [API Surface](#api-surface)
- [Security](#security)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Diagnostic Categories](#diagnostic-categories)
- [Safety Policy](#safety-policy)
- [Scientific Foundation](#scientific-foundation)
- [Regulatory Positioning](#regulatory-positioning)
- [Roadmap](#roadmap)
- [Community](#community)
- [License](#license)
- [Русская версия](#ecg-second-opinion--система-второго-мнения-по-экг)

## What This Project Does

ECG Second Opinion is not an "AI that reads ECGs." It is the **workflow system
around the AI** — the control plane that ensures every ECG case follows a
strict, auditable path from submission to delivery.

Think of it as a transparent orchestrator:

1. A clinician or integration system submits a 12-lead ECG recording with
   patient alias and recording metadata
2. The system queues the recording for AI analysis (1D-CNN classifier)
3. An inference worker processes the recording — runs classification, measures
   confidence, computes uncertainty metrics
4. The system captures the AI output as a **structured draft report** — never
   as a final diagnosis
5. A **clinical safety policy** evaluates the result and raises flags for
   low-confidence, high-risk, or disagreement scenarios
6. A human clinician (cardiologist, electrophysiologist) **must** review the
   draft, add their impression, and explicitly approve or modify it
7. Only after clinician approval does the case move to finalization and delivery
8. Every step is logged, timestamped, and traceable via an append-only audit
   trail

**The key idea:** The AI generates a draft. A human makes the decision. The
system enforces this boundary in code.

## How It Works

### The 6-State Machine

```
Submitted → InferencePending → AwaitingReview → Reviewed → Finalized
                 ↓
           InferenceFailed
```

Every arrow is a guarded transition. The aggregate rejects invalid state
changes with typed domain errors.

| Transition | Guard |
|-----------|-------|
| Submitted → InferencePending | Case just created, queued for async inference |
| InferencePending → AwaitingReview | Inference completed, safety policy evaluated |
| InferencePending → InferenceFailed | Worker error captured, case not stuck |
| AwaitingReview → Reviewed | Clinician submitted review decision |
| Reviewed → Finalized | Clinician approved; no unresolved blocking safety flags |

### The Inference Pipeline

```
ECG Recording ──→ Metadata Validation
                       │
                       ▼
               Inference Worker (async)
              ┌────────┴─────────┐
              │  1D-CNN (planned) │
              │  Metadata fallback│ ← current
              └────────┬─────────┘
                       │
                       ▼
              Safety Policy Evaluation
              (8 clinical rules, AHA/ACC aligned)
                       │
                       ▼
              AwaitingReview + Safety Flags
```

### Interoperability Exports

- **FHIR R4 DiagnosticReport** — structured export with contained Observations,
  performer references, and Research-Use-Only extension
- **Structured ECG Report** — internal JSON format with findings,
  recommendations, limitations, and safety flags

## Current Baseline

What is **implemented** (backed by tests and running code):

| Component | Status | Evidence |
|-----------|--------|----------|
| 6-state case aggregate | ✅ Complete | 25 unit tests |
| 3-tier auth (operator API key, reviewer JWT HS256, internal bearer) | ✅ Complete | API integration tests incl. malformed, issuer, audience, role, signature, claims, timing, and token rejection cases |
| Zod input validation (all endpoints) | ✅ Complete | 12 validation tests |
| Clinical safety policy (8 rules) | ✅ Complete | 13 safety policy tests |
| Metadata-fallback inference service | ✅ Stub | `@sota-stub` tagged |
| FHIR R4 DiagnosticReport export | ✅ Complete | API integration tests |
| Structured ECG report builder | ✅ Complete | API integration tests |
| Prometheus metrics (7 instruments) | ✅ Complete | Wired in routes |
| Health probes (`/healthz`, `/readyz`) | ✅ Complete | API integration tests |
| Correlation ID propagation | ✅ Complete | Header tests |
| Fail-fast config validation | ✅ Complete | Config test suite incl. reviewer audience guard |
| Append-only audit trail | ✅ Complete | Audit trail test |
| Async inference with failure recovery | ✅ Complete | InferenceFailed state tests |
| Safety flag resolution by reviewer | ✅ Complete | API + unit tests incl. duplicate unresolved-flag protection |
| Operations summary dashboard endpoint | ✅ Complete | API integration test |
| Docker multi-stage build (non-root) | ✅ Complete | Dockerfile |

What is **target architecture** (planned, seams exist):

| Component | Status |
|-----------|--------|
| 1D-CNN inference worker (Python, PTB-XL trained) | Planned — Wave 2 |
| SQLite persistence layer | Planned — seam via `IEcgCaseRepository` |
| PostgreSQL adapter | Planned |
| Lead-specific abnormality detection | Planned |
| SCP-ECG structured report mapping | Planned |
| Feedback loop (clinician corrections → training data) | Planned |

## Architecture

```
┌──────────────────────────────────────────────────┐
│                   Clinician                       │
│          (Review via API / future UI)             │
└──────────────────┬───────────────────────────────┘
                   │ review / finalize (JWT auth)
┌──────────────────▼───────────────────────────────┐
│            TypeScript API (Express)               │
│                                                   │
│  ┌──────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ Routing  │ │  State    │ │  Validation     │  │
│  │ & Auth   │ │  Machine  │ │  (Zod)          │  │
│  └──────────┘ └───────────┘ └─────────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ Safety   │ │ Inference │ │ Health &        │  │
│  │ Policy   │ │ Service   │ │ Metrics         │  │
│  └──────────┘ └───────────┘ └─────────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ FHIR R4  │ │ Report    │ │ Audit           │  │
│  │ Export   │ │ Builder   │ │ Trail           │  │
│  └──────────┘ └───────────┘ └─────────────────┘  │
└──────────────────┬───────────────────────────────┘
                   │ dispatch / callback
┌──────────────────▼───────────────────────────────┐
│        Inference Worker (planned: Python)          │
│                                                   │
│  ┌─────────────────┐ ┌────────────────────────┐  │
│  │ 1D-CNN Classifier│ │ Uncertainty            │  │
│  │ (PTB-XL trained) │ │ (MC-Dropout/Ensembles) │  │
│  └─────────────────┘ └────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

Key design decisions:

- **Separation of control and compute**: The TypeScript API handles workflow
  logic only. Heavy neural network inference lives in a separate worker process.
- **Async inference with callback**: Case creation returns `202 Accepted`
  immediately. The inference worker calls back via an internal authenticated
  endpoint when done (or a failure is captured as `InferenceFailed`).
- **Claim discipline**: The project distinguishes between what is **implemented**
  (backed by running code and tests), what is **target architecture** (planned),
  and what is **research-informed** (supported by literature but not built).

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 22, TypeScript 5.8, ES2022 |
| Framework | Express 4 with Helmet, express-rate-limit |
| Validation | Zod 3.24 (strict schemas for all inputs) |
| Auth | API key (operators), HS256 JWT with issuer/audience validation (reviewers), Bearer token (internal) |
| Metrics | prom-client 15 (Prometheus-compatible) |
| Testing | Jest 29, ts-jest, supertest |
| Container | Docker multi-stage build, non-root `ecg` user |
| Identifiers | UUIDv4 (uuid 11) |

## API Surface

### Public Endpoints (Operator Auth: `x-api-key`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/cases` | Submit ECG recording for second opinion (returns `202`) |
| GET | `/api/v1/cases` | List all cases |
| GET | `/api/v1/cases/:id` | Get case detail with full assessment |
| GET | `/api/v1/cases/:id/report` | Structured ECG report |
| GET | `/api/v1/cases/:id/exports/fhir-diagnostic-report` | FHIR R4 DiagnosticReport |
| GET | `/api/v1/operations/summary` | Operations dashboard summary |

### Reviewer Endpoints (JWT Auth: `Authorization: Bearer <jwt>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/cases/:id/review` | Submit clinician review |
| POST | `/api/v1/cases/:id/safety-flags/:flagCode/resolve` | Resolve a safety flag |
| POST | `/api/v1/cases/:id/finalize` | Finalize case |

### Internal Endpoints (Bearer Auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/internal/inference-callback` | Inference worker callback |

### Operational Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API identity and route map |
| GET | `/healthz` | Liveness probe |
| GET | `/readyz` | Readiness probe |
| GET | `/metrics` | Prometheus metrics |

## Security

- **Three-tier authentication**: Operator API key for case management, HS256 JWT
  for clinician review (with role-based access), internal bearer token for
  inference worker callbacks.
- **Timing-safe comparison**: All secret comparison uses `crypto.timingSafeEqual`.
- **JWT claim validation**: Reviewer tokens validate `alg`, `iss`, `aud`, `exp`,
  `nbf`, `sub`, and `role` before access is granted.
- **Input validation**: Every endpoint validates input via Zod schemas with
  strict mode — no extra fields accepted, and classifier probabilities must sum
  to `1.0 ± 0.001`.
- **Rate limiting**: Applied to all API endpoints.
- **Helmet**: Security headers enabled by default (CSP, HSTS, etc.).
- **CORS**: Not enabled — add per deployment requirements.
- **Non-root container**: Docker runs as unprivileged `ecg` user.
- **No PHI in logs**: Patient aliases only, never real identifiers.
- **Clock skew tolerance**: JWT validation includes configurable clock skew
  window for distributed deployments.

## Getting Started

```bash
# Install
npm install

# Copy environment config
cp .env.example .env

# Development mode (hot reload)
npm run dev

# Build & run
npm run build
npm start

# Docker
docker compose up --build
```

### Example: Full Workflow

```bash
# 1. Submit case
curl -X POST http://localhost:3100/api/v1/cases \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: ecg-operator-dev-token-change-me-0001' \
  -d '{
    "recording": {
      "recordingId": "ptbxl-00001",
      "patientAlias": "Patient-001",
      "recordingDate": "2024-01-15T10:00:00.000Z",
      "samplingFrequencyHz": 500,
      "leadCount": 12,
      "durationSeconds": 10,
      "samplesPerLead": 5000,
      "sourceDataset": "PTB-XL"
    },
    "clinicalQuestion": {
      "questionText": "Rule out myocardial infarction",
      "urgency": "routine"
    }
  }'

# Response: { "caseId": "...", "status": "InferencePending", "message": "..." }

# 2. Wait for async inference, then review (requires reviewer JWT)
curl -X POST http://localhost:3100/api/v1/cases/{caseId}/review \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <reviewer-jwt>' \
  -d '{
    "decision": "accepted",
    "clinicalNotes": "NSR confirmed. No acute ST changes."
  }'

# 3. Finalize
curl -X POST http://localhost:3100/api/v1/cases/{caseId}/finalize \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <reviewer-jwt>' \
  -d '{
    "outcome": "delivered",
    "finalSummary": "Normal sinus rhythm confirmed by cardiologist."
  }'
```

## Testing

```
Tests:       94 passed, 94 total
Test Suites: 5 passed, 5 total

  tests/config.test.ts          — Config validation and production safety guards (9 tests)
  tests/cases.test.ts           — Aggregate state machine and safety-flag invariants (25 tests)
  tests/safety-policy.test.ts   — Clinical safety rules (13 tests)
  tests/validation.test.ts      — Zod schema validation and probability invariants (12 tests)
  tests/api.test.ts             — API integration and auth boundary coverage (35 tests)
```

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run lint            # ESLint over src/ and tests/
npm run typecheck       # TypeScript type-check without emit
```

## Project Structure

```
ecg-second-opinion/
├── src/
│   ├── index.ts                # Entry point, graceful shutdown
│   ├── app.ts                  # Express application (11 routes)
│   ├── cases.ts                # Root aggregate — 6-state machine
│   ├── case-contracts.ts       # All TypeScript interfaces and types
│   ├── case-presentation.ts    # Report builders, DTO mappers
│   ├── case-exports.ts         # FHIR R4 DiagnosticReport export
│   ├── case-repository.ts      # In-memory repository + audit trail
│   ├── validation.ts           # Zod schemas for all API inputs
│   ├── safety-policy.ts        # 8-rule clinical safety evaluation
│   ├── inference-service.ts    # Metadata-fallback stub (@sota-stub)
│   ├── config.ts               # Environment-based configuration
│   ├── metrics.ts              # Prometheus metrics (7 instruments)
│   ├── health.ts               # /healthz and /readyz probes
│   ├── correlation.ts          # X-Correlation-Id middleware
│   ├── express-request.d.ts    # Express Request augmentation declarations
│   ├── auth-common.ts          # Shared auth utilities
│   ├── operator-auth.ts        # API key middleware
│   ├── reviewer-auth.ts        # JWT HS256 middleware
│   └── internal-auth.ts        # Bearer token middleware
├── tests/
│   ├── config.test.ts          # Config guards and production-safe defaults
│   ├── cases.test.ts           # 25 state machine and flag-invariant tests
│   ├── safety-policy.test.ts   # 13 safety policy tests
│   ├── validation.test.ts      # 12 schema and probability tests
│   └── api.test.ts             # 35 integration tests
├── Dockerfile                  # Multi-stage, non-root
├── docker-compose.yml
├── .env.example                # All environment variables documented
├── tsconfig.json
├── eslint.config.mjs           # ESLint flat config
├── jest.config.js
├── package.json
├── LICENSE                     # MIT
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
└── README.md
```

## Diagnostic Categories

Following the PTB-XL labeling scheme and SCP-ECG standard:

| Code | Category | Description |
|------|----------|-------------|
| NORM | Normal sinus rhythm | No significant abnormalities |
| MI | Myocardial infarction | ST-elevation/depression, Q-wave patterns |
| STTC | ST/T change | Non-specific ST segment or T-wave changes |
| CD | Conduction disturbance | Bundle branch blocks, AV blocks |
| HYP | Hypertrophy | Left/right ventricular hypertrophy |

## Safety Policy

The `DefaultEcgClinicalSafetyPolicy` evaluates every inference result against
8 clinical rules aligned with AHA/ACC/HRS guidelines:

| # | Rule | Trigger | Severity | Blocks |
|---|------|---------|----------|--------|
| 1 | LOW_CONFIDENCE | Confidence band `low` | Warning | No |
| 2 | INSUFFICIENT_DATA | Confidence band `insufficient_data` | Critical | Yes |
| 3 | SIGNIFICANT_DISAGREEMENT | AI disagrees with original interpretation | Warning | No |
| 4 | STAT_MI_DETECTED | MI detected on stat-priority recording | Critical | Yes |
| 5 | SHORT_RECORDING | Duration < 10s | Warning | No |
| 6 | LOW_SAMPLING_RATE | Frequency < 100 Hz | Warning | No |
| 7 | HIGH_EPISTEMIC_UNCERTAINTY | Epistemic entropy > 0.7 (MC-Dropout) | Critical | Yes |
| 8 | NO_XAI_EXPLANATION | No interpretability artifacts available | Info | No |

**Blocking flags** prevent delivery even after clinician review. They must be
explicitly resolved by a reviewer before the case can be finalized as
`delivered`.

## Scientific Foundation

Based on: **Mosin S.G.** (2024) "Neural network diagnosis of the
cardiovascular diseases based on data-driven method", *Software & Systems*,
37(1), pp. 122–130. doi: 10.15827/0236-235X.142.122-130.

Key findings from the paper:

- **Architecture**: 1D multi-layer convolutional neural network for ECG time
  series classification
- **Method**: Data-driven approach — no manual PQRST feature extraction needed
- **Dataset**: PTB-XL — 21,837 12-lead ECG recordings, 10s at 100 Hz
  (1000 samples/lead)
- **Best result**: 3-layer CNN with smaller pooling window achieves 85.66% MI
  detection accuracy
- **Activation**: ELU (supports negative values inherent in ECG signals)
- **Optimizer**: Mini-batch Adam with batch normalization
- **Classification**: Softmax output layer for category probability distribution

The current codebase implements the **metadata-fallback** mode. Full 1D-CNN
inference is planned for Wave 2.

## Regulatory Positioning

This project operates in the **Clinical Decision Support (CDS)** space under
FDA guidance on CDS software (21 CFR Part 11, 2023 final rule).

The system is designed as a **non-device CDS function** under Criterion 4: it
is intended for review by a qualified clinician who independently evaluates the
basis for the recommendation. The architectural enforcement — mandatory
`Reviewed` state before `Finalized` — exists to satisfy this criterion in code,
not just in policy.

**Current status**: Research-use-only prototype. Not submitted for any
regulatory clearance. Not a medical device.

## Roadmap

- [ ] 1D-CNN inference worker (Python, PTB-XL trained)
- [ ] SQLite persistence layer
- [ ] PostgreSQL adapter for production
- [ ] Lead-specific abnormality detection (per-lead findings)
- [ ] SCP-ECG structured report mapping
- [ ] Feedback loop (clinician corrections → model training data)
- [ ] Real-time ECG stream processing
- [ ] Clinician review workbench UI
- [ ] Multi-model ensemble with Deep Ensembles uncertainty
- [ ] Conformal prediction for calibrated prediction sets

## Community

- **Issues**: [GitHub Issues](https://github.com/KonkovaElena/ecg-second-opinion/issues)
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security**: See [SECURITY.md](SECURITY.md)
- **Code of Conduct**: See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Support**: See [SUPPORT.md](SUPPORT.md)
- **Citation**: See [CITATION.cff](CITATION.cff)

## License

MIT — see [LICENSE](LICENSE).

---

# ECG Second Opinion — Система Второго Мнения по ЭКГ

Система второго мнения по ЭКГ с обязательным контролем врача-кардиолога.

Автономный TypeScript API, который управляет полным жизненным циклом
ЭКГ-консультации — от приёма записи и проверки качества через AI-анализ
до обязательного врачебного заключения, финализации и выдачи.

> ⚠️ **Только для исследовательских целей.** Это не медицинское устройство.
> Система не может использоваться для принятия клинических решений без
> соответствующей регуляторной сертификации. Каждый результат требует
> проверки квалифицированным врачом.

## Что делает проект

ECG Second Opinion — это не «ИИ, который читает ЭКГ». Это **система
управления рабочим процессом вокруг ИИ** — контрольная плоскость, которая
гарантирует, что каждый случай ЭКГ следует строгому, проверяемому пути
от подачи до выдачи.

1. Клиницист или интеграционная система подаёт 12-канальную ЭКГ-запись
   с псевдонимом пациента и метаданными записи
2. Система ставит запись в очередь на ИИ-анализ (1D-CNN классификатор)
3. Инференс-воркер обрабатывает запись — классификация, оценка уверенности,
   метрики неопределённости
4. Система фиксирует результат ИИ как **черновой структурированный отчёт** —
   не как финальный диагноз
5. **Политика клинической безопасности** оценивает результат и выставляет
   флаги для случаев с низкой уверенностью, высоким риском или расхождением
6. Врач-кардиолог **обязан** проверить черновик, добавить своё заключение
   и явно подтвердить или изменить его
7. Только после врачебного одобрения случай переходит к финализации и выдаче
8. Каждый шаг логируется, помечается временем и отслеживается через
   неизменяемый журнал аудита

**Ключевая идея:** ИИ генерирует черновик. Решение принимает человек. Система
обеспечивает эту границу в коде.

## Машина состояний

```
Submitted → InferencePending → AwaitingReview → Reviewed → Finalized
                  ↓
            InferenceFailed
```

Каждый переход защищён инвариантами. Агрегат отклоняет недопустимые
изменения состояния с типизированными доменными ошибками.

## Текущий baseline

| Компонент | Статус | Доказательство |
|-----------|--------|----------------|
| Агрегат с 6 состояниями | ✅ Реализован | 25 юнит-тестов |
| 3-уровневая аутентификация | ✅ Реализована | Интеграционные тесты |
| Zod-валидация (все эндпоинты) | ✅ Реализована | 12 тестов валидации |
| Политика безопасности (8 правил) | ✅ Реализована | 13 тестов |
| Метаданные-фолбэк инференс | ✅ Стаб | `@sota-stub` |
| FHIR R4 DiagnosticReport экспорт | ✅ Реализован | Интеграционные тесты |
| Prometheus-метрики (7 инструментов) | ✅ Реализованы | Подключены в роутах |
| Неизменяемый журнал аудита | ✅ Реализован | Тест аудита |

## Технологический стек

| Слой | Технология |
|------|-----------|
| Среда выполнения | Node.js ≥ 22, TypeScript 5.8, ES2022 |
| Фреймворк | Express 4 + Helmet + express-rate-limit |
| Валидация | Zod 3.24 |
| Аутентификация | API-ключ, HS256 JWT с проверкой issuer/audience, Bearer-токен |
| Метрики | prom-client 15 |
| Тестирование | Jest 29, ts-jest, supertest |
| Контейнер | Docker multi-stage, непривилегированный пользователь |

## API

### Публичные маршруты (авторизация: `x-api-key`)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/cases` | Подать ЭКГ-запись для второго мнения |
| GET | `/api/v1/cases` | Список случаев |
| GET | `/api/v1/cases/:id` | Детали случая |
| GET | `/api/v1/cases/:id/report` | Структурированный отчёт |
| GET | `/api/v1/cases/:id/exports/fhir-diagnostic-report` | FHIR R4 экспорт |

### Маршруты рецензента (JWT: `Authorization: Bearer <jwt>`)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/cases/:id/review` | Врачебное заключение |
| POST | `/api/v1/cases/:id/finalize` | Финализация случая |

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run dev
```

## Тестирование

```
Тесты:    69 пройдено, 69 всего (4 набора)
```

```bash
npm test
```

## Научная основа

**Мосин С.Г.** (2024) «Нейросетевая диагностика заболеваний
сердечно-сосудистой системы на основе метода, управляемого данными»,
*Программные продукты и системы*, 37(1), с. 122–130.
doi: 10.15827/0236-235X.142.122-130.

## Регуляторное позиционирование

Проект работает в области **систем поддержки клинических решений (CDS)**
по руководству FDA по CDS-ПО (21 CFR Part 11, финальное правило 2023).
Спроектирован как **не-устройственная CDS-функция** по Критерию 4.

**Текущий статус**: Исследовательский прототип. Не является медицинским
устройством.

## Дорожная карта

- [ ] 1D-CNN инференс-воркер (Python, PTB-XL)
- [ ] SQLite / PostgreSQL персистентность
- [ ] Поканальное обнаружение аномалий
- [ ] SCP-ECG структурированные отчёты
- [ ] Обратная связь (коррекции врача → данные для обучения)
- [ ] Multi-model ансамбль с Deep Ensembles
- [ ] Conformal prediction для калиброванных предсказаний

## Лицензия

MIT — см. [LICENSE](LICENSE).
