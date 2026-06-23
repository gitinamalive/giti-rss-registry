# Changelog

All notable changes to the giti-rss-registry dataset will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-22

### Added
- 217 curated RSS/Atom feeds across 9 categories (world, europe, us, technology, science, finance, investigative, climate, sports)
- TypeScript schema with `FeedEntry` type and enums (`FeedFormat`, `MediaType`, `Perspective`, `FeedCategory`)
- Validation script (`scripts/validate.ts`) with SSRF protection, duplicate detection, and schema enforcement
- Build pipeline (`scripts/build-artifacts.ts`) generating JSON, CSV, OPML, and browsable HTML artifacts
- Automated feed health-checker (`scripts/health-check.ts`) with 0-100 scoring, last-item-date extraction, and HTTP→HTTPS upgrade discovery
- Batch feed addition script (`scripts/add-feeds-batch.ts`) with duplicate URL/ID/name detection
- Category enrichment heuristic engine (`scripts/enrich-categories.ts`)
- Language fix pipeline (`scripts/fix-languages.ts`) with country-to-language derivation
- Perspective labeling (`scripts/label-perspective.ts`) with cited rationale support
- Browsable HTML directory (`dist/index.html`) with search, filtering, sorting, and CSV export
- Contribution guide (`CONTRIBUTING.md`), issue template, PR template, and Code of Conduct
- MIT License

### Infrastructure
- GitHub Actions: CI validation on PR, auto-build on push, weekly health checks
- YAML issue form for structured feed addition requests

[1.0.0]: https://github.com/gitinamalive/giti/tree/develop/public-rss-registry