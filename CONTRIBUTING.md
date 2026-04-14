# Contributing

Thank you for your interest in contributing to ECG Second Opinion.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to uphold its standards.

## Development Setup

```bash
git clone https://github.com/KonkovaElena/ecg-second-opinion.git
cd ecg-second-opinion
npm install
cp .env.example .env
npm test
```

## Guidelines

1. **Tests first** — write a failing test before implementing.
2. **Keep the state machine invariants** — never bypass the clinician review boundary.
3. **Zod validation** — all API inputs must be validated via Zod schemas.
4. **No PHI** — use patient aliases, never real identifiers.
5. **TypeScript strict mode** — the codebase uses `strict: true`.
6. **Claim discipline** — distinguish implemented (backed by tests) from planned
   (seams exist) from research-informed (literature basis).

## Pull Requests

- One concern per PR.
- All tests must pass (`npm test`).
- Include test coverage for new features.
- Describe what changed and why.
- Run `npm run lint` and `npm run typecheck` before submitting.

## Reporting Issues

Use GitHub Issues. For security vulnerabilities, see [SECURITY.md](SECURITY.md).
