# Security Policy

## Scope

`giti-rss-registry` is a public dataset and static artifact generator. Security-sensitive surfaces include:

- **SSRF / network fetchers** (`src/net.ts`, `scripts/health-check.ts`, `scripts/propose-feed.ts`) that fetch external URLs in CI, including untrusted URLs submitted via feed proposal issues.
- **Artifact escaping & XSS prevention** (`src/escape.ts`, `scripts/build-artifacts.ts`) for generated HTML, OPML, and CSV outputs.
- **GitHub Actions workflows** (`.github/workflows/*`).

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report privately via [GitHub Security Advisories](https://github.com/gitinamalive/giti-rss-registry/security/advisories/new) with:

- A description of the vulnerability and impact
- Steps to reproduce or a minimal proof of concept
- Affected file(s) or workflow(s)

We will acknowledge reports within 72 hours and coordinate a fix before public disclosure.
