# Changelog

All notable changes to the `giti-rss-registry` dataset and tooling are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-11-26

### Added
- Expanded curated dataset to **456 feeds across 206 countries and territories** (410 publishers, 39 languages, all 15 categories)
- Orthogonal editorial taxonomy fields on `FeedEntry`: `governance`, `operatingCircumstance`, `sourceRole`, `publisherDomain`, `coverageType`, `publisherCountries`, `sourceAttribution`, `license`
- 206-country coverage matrix (`dist/coverage-matrix.json`) and interactive Coverage Matrix tab in the GitHub Pages directory
- Weekly automated health-check overlay (`dist/feeds-health.json`) with lifecycle diagnostic categories, quarantine tracking, and redirect proposals
- Automated Feed Proposal issue form (`.github/ISSUE_TEMPLATE/feed-proposal.yml`) and triage bot (`scripts/propose-feed.ts`)
- Shared SSRF validation module (`src/net.ts`) with full IPv6 / IPv4-mapped range checks and unified country registry (`src/countries.ts`)
- Modular artifact builders (`src/artifacts/{csv,opml,indexes,manifest,html}.ts`) with static `styles.css` + `app.js`, strict Content Security Policy, and `dist/countries.json`
- `SECURITY.md`, `.nvmrc`, `.github/dependabot.yml`, and `npm run validate:fix`

### Changed
- Bumped `SCHEMA_VERSION` to `1.1.0` and `GENERATOR_VERSION` to `1.2.0`
- Made `dist/manifest.json` and `dist/duplicate-report.json` deterministic (derived from `payload.generatedAt`) and extended manifest SHA-256 hashing to `index.html`, `styles.css`, `app.js`, `countries.json`, `duplicate-report.json`, and `opml/all.opml`
- Included all 29 `FeedEntry` schema fields in `dist/feeds.csv`
- Removed redundant `HEAD` probe in `scripts/health-check.ts` and added optional jittered retry on transient 5xx/timeout errors
- Standardized CI workflows on Node 22 with `npm ci`, least-privilege permissions, timeouts, and committed-`dist/` deployment
- Rewrote `README.md`, `schema/schema.md`, and `CODE_OF_CONDUCT.md` to reflect CC0 data licensing and the public consumer contract

### Security
- Fixed redirect-hop SSRF stub resolver in `scripts/propose-feed.ts` to use `defaultHostResolver`
- Fixed bracketed IPv6 literal handling and hex IPv4-mapped IPv6 (`::ffff:7f00:1`) checks in SSRF validation
- Added `persist-credentials: false` to read-only and untrusted-input workflows

## [1.0.0] — 2026-06-22

### Added
- 217 curated RSS/Atom feeds across 9 categories (`world`, `europe`, `us`, `technology`, `science`, `finance`, `investigative`, `climate`, `sports`)
- TypeScript schema with `FeedEntry` type and enums (`FeedFormat`, `MediaType`, `Perspective`, `FeedCategory`)
- Validation script (`scripts/validate.ts`) with SSRF protection, duplicate detection, and schema enforcement
- Build pipeline (`scripts/build-artifacts.ts`) generating JSON, CSV, OPML, and browsable HTML artifacts
- Automated feed health-checker (`scripts/health-check.ts`) with 0–100 scoring and last-item-date extraction
- Contribution guide (`CONTRIBUTING.md`), PR template, Code of Conduct, MIT code license, and CC0 data license

[1.1.0]: https://github.com/gitinamalive/giti-rss-registry/releases/tag/v1.1.0
[1.0.0]: https://github.com/gitinamalive/giti-rss-registry/releases/tag/v1.0.0
