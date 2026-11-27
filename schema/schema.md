# Giti RSS Registry — Public Schema (v1.1.0)

This document defines the public data contract for `giti-rss-registry`.
The machine-readable schema lives in [`schema/feeds.schema.json`](feeds.schema.json) (JSON Schema draft-07) and mirrors [`src/types.ts`](../src/types.ts). Both are kept in sync by `scripts/validate-schema.ts` on every CI run.

## Versioning policy

- **Major (`X.0.0`)**: breaking changes (removing fields, changing field types, or altering `dist/feeds.json` shape).
- **Minor (`1.X.0`)**: backwards-compatible additive fields or enum values (current: `1.1.0`).
- **ID stability**: feed `id` values are opaque and immutable once minted.

## TypeScript interface

```ts
export interface FeedEntry {
  id: string;
  name: string;
  publisher: string;
  url: string;
  homepage?: string;
  language: string;                 // ISO 639-1 2-letter lowercase code (src/languages.ts)
  countries: string[];              // ISO 3166-1 alpha-2 uppercase (+ XK)
  region?: string;
  category: FeedCategory;
  tags?: string[];
  mediaType?: MediaType;
  format?: FeedFormat;
  official?: boolean;
  notes?: string;
  description?: string;
  coverageType?: CoverageType;
  publisherCountries?: string[];    // ISO 3166-1 alpha-2 uppercase (+ XK)
  governance?: EditorialGovernance;
  operatingCircumstance?: OperatingCircumstance;
  sourceRole?: SourceRole;
  publisherDomain?: string;
  alwaysSchedule?: boolean;
  sourceAttribution?: string;
  license?: string;

  /** @deprecated Prefer governance + operatingCircumstance + sourceRole. */
  perspective?: Perspective;
  /** @deprecated Live health metadata is served via dist/feeds-health.json. */
  active?: boolean;
  /** @deprecated Live health metadata is served via dist/feeds-health.json. */
  lastCheckedAt?: string;
  /** @deprecated Live health metadata is served via dist/feeds-health.json. */
  lastItemPublishedAt?: string;
  /** @deprecated Live health metadata is served via dist/feeds-health.json. */
  healthScore?: number;
}
```

## Field requirements

- **Required:** `id`, `name`, `publisher`, `url`, `language`, `countries`, `category`.
- **Recommended editorial metadata:** `homepage`, `description`, `format`, `mediaType`, `coverageType`, `publisherCountries`, `governance`, `operatingCircumstance`, `sourceRole`, `publisherDomain`, `sourceAttribution`, `license`.
- **Deprecated on canonical entries:**
  - `perspective` — superseded by the orthogonal `governance`, `operatingCircumstance`, and `sourceRole` fields.
  - `active`, `lastCheckedAt`, `lastItemPublishedAt`, `healthScore` — authoritative live values live in the weekly health overlay (`dist/feeds-health.json`), keyed by `id`.

## Validation rules

1. **`id`**: opaque, immutable, unique across dataset. New IDs are minted via `src/id.ts`: `toFileSafeSegment(publisher) + '-' + sha1(normalizeUrl(url)).slice(0, 8)`.
2. **`url` / `homepage`**: public HTTP(S) URLs without credentials; validated against reserved/private IPv4 and IPv6 ranges (`src/net.ts`). Unique under URL normalization (trim, lowercase host, strip trailing slash and fragment).
3. **`countries` / `publisherCountries`**: valid ISO 3166-1 alpha-2 uppercase codes (249 official codes + `XK` in `src/countries.ts`).
4. **`language`**: 2-letter lowercase ISO 639-1 code (`src/languages.ts`).
5. **Enums**: `category`, `format`, `mediaType`, `perspective`, `coverageType`, `governance`, `operatingCircumstance`, and `sourceRole` are validated by both `scripts/validate.ts` and `scripts/validate-schema.ts`.

## Health overlay (`dist/feeds-health.json`)

Automated health checks (`scripts/health-check.ts`) run weekly via `.github/workflows/health-check.yml` (Mondays 06:00 UTC) and emit an ID-keyed overlay without mutating canonical `data/feeds.json`. Each entry carries `healthStatus`, `healthScore` (0–100), `lastCheckedAt`, `lastItemPublishedAt`, `active`, `consecutiveFailures`, `quarantineStatus`, `failureReason`, `capabilities`, and `diagnosticCategory`.

## Population snapshot (2026-11)

- **Total feeds:** 456 across all 15 categories
- **Tracked countries/territories:** 206 (`dist/coverage-matrix.json`)
- **Unique publishers:** 410 · **Languages:** 39
- **Artifact size tradeoff:** `dist/by-country.json` (~730 KB) and `dist/coverage-matrix.json` (~819 KB) embed full `FeedEntry` objects for zero-join client ergonomics; switching to ID-reference indexes is deferred to a future major schema version (`2.0.0`).

## Non-goals

- No Giti production backend/serverless execution rules
- No auth, quota, or billing models
- No Giti personalization or ranking behavior
