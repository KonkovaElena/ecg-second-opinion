# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Current |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public issue.
2. If GitHub private vulnerability reporting is enabled for the repository, use it.
3. If private reporting is not enabled yet, contact the maintainer through the repository owner profile on GitHub and avoid posting exploit details publicly.
4. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

This project handles simulated ECG data in a research/development context. It does **not** process real patient data in its current form. However, all code is written with the assumption that it may eventually handle PHI (Protected Health Information), and security practices reflect that posture.

## Practices

- **No PHI in logs**: Patient aliases only, never real identifiers.
- **JWT validation**: Reviewer tokens validate algorithm, issuer, audience, expiry, not-before, subject, and role claims.
- **Input validation**: All API inputs validated via strict Zod schemas, including probability-distribution checks on classifier outputs.
- **Rate limiting**: Applied to all API endpoints.
- **Helmet**: Security headers enabled by default.
- **Non-root container**: Docker runs as non-root user.
- **Dependency review**: Pull requests that change dependencies or workflows run GitHub Dependency Review.
- **Dependabot**: npm, GitHub Actions, and Docker update checks are scheduled weekly.
- **Static analysis**: CodeQL workflow is configured for the repository security baseline.

## Disclosure Policy

- Please give maintainers a reasonable window to investigate and remediate before public disclosure.
- Public proof-of-concept code should wait until a fix or mitigation is available.
