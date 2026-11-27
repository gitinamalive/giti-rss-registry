# giti-rss-registry

[![Validate Registry](https://github.com/gitinamalive/giti-rss-registry/actions/workflows/validate.yml/badge.svg)](https://github.com/gitinamalive/giti-rss-registry/actions/workflows/validate.yml)
[![Weekly Feed Health Check](https://github.com/gitinamalive/giti-rss-registry/actions/workflows/health-check.yml/badge.svg)](https://github.com/gitinamalive/giti-rss-registry/actions/workflows/health-check.yml)
[![Feeds](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgitinamalive%2Fgiti-rss-registry%2Fmain%2Fdist%2Fmanifest.json&query=%24.artifactCounts.feeds&label=feeds&color=blue)](https://gitinamalive.github.io/giti-rss-registry/)
[![Code: MIT](https://img.shields.io/badge/code-MIT-green.svg)](LICENSE)
[![Data: CC0](https://img.shields.io/badge/data-CC0-lightgrey.svg)](DATA-LICENSE)

A curated, community-maintained registry of **450+ global news feeds** (RSS/Atom/RDF/JSON Feed) across **206 countries and territories**, published as a reusable public dataset with automated reachability and health scoring.

**Browse the live directory:** https://gitinamalive.github.io/giti-rss-registry/
(search, filter by country/category/language/health, inspect the coverage matrix, export CSV/OPML)

- **Data license:** [CC0 1.0](DATA-LICENSE) (public domain) · **Code license:** [MIT](LICENSE)
- **Refresh cadence:** health overlay rebuilt weekly (Mondays 06:00 UTC)

## Use the data

All consumer artifacts are served from `dist/` on `main`. Note that `dist/feeds.json` is a **bare JSON array** (`FeedEntry[]`), while the canonical editorial source `data/feeds.json` wraps it in a metadata envelope (`{ generatedAt, source, stats, warnings, feeds }`).

| Artifact | Raw URL |
|---|---|
| All feeds (JSON array) | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/feeds.json |
| All feeds (CSV) | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/feeds.csv |
| Health overlay | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/feeds-health.json |
| Coverage matrix | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/coverage-matrix.json |
| Manifest (checksums, counts) | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/manifest.json |
| OPML (all feeds) | https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/opml/all.opml |

```bash
# Inspect the first feed
curl -s https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/feeds.json | jq '.[0]'
```

```js
// Join live health onto feeds and exclude quarantined endpoints
const base = 'https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist';
const [feeds, health] = await Promise.all(
  ['feeds.json', 'feeds-health.json'].map((f) => fetch(`${base}/${f}`).then((r) => r.json())),
);
const byId = new Map(health.feeds.map((h) => [h.id, h]));

// Recommended default: keep healthy/slow-cadence outlets, drop quarantined (4+ consecutive failures)
// For real-time tickers only, filter on `f.health?.healthStatus === 'fresh'` (< 7 days)
const usable = feeds
  .map((f) => ({ ...f, health: byId.get(f.id) }))
  .filter((f) => f.health?.defaultSuggestion !== false);
```

```python
# Load directly into pandas for analysis
import pandas as pd

df = pd.read_csv(
    "https://raw.githubusercontent.com/gitinamalive/giti-rss-registry/main/dist/feeds.csv"
)
print(df[["name", "publisher", "countries", "category", "governance"]].head())
```

**Import into a reader:** download `dist/opml/all.opml` (or a per-country/per-category file such as `dist/opml/countries/us.opml`) and import it into any RSS reader.

**Pin a version:** `main` moves as feeds and weekly health checks update. For reproducible builds, replace `main` with a commit SHA and verify the downloaded file's SHA-256 against `dist/manifest.json` → `artifacts["feeds.json"].sha256`.

## Data model

Canonical source: [`data/feeds.json`](data/feeds.json). TypeScript types: [`src/types.ts`](src/types.ts). JSON Schema: [`schema/feeds.schema.json`](schema/feeds.schema.json).

**Required:** `id`, `name`, `publisher`, `url`, `language` (ISO 639-1), `countries` (ISO 3166-1 alpha-2, uppercase; `XK` allowed), `category` (15-value enum).

**Optional:** `homepage`, `region`, `tags`, `description`, `notes`, `mediaType`, `format`, `official`, `coverageType`, `publisherCountries`, `governance`, `operatingCircumstance`, `sourceRole`, `publisherDomain`, `perspective` *(legacy — prefer `governance` + `operatingCircumstance` + `sourceRole`)*, `sourceAttribution`, `license`, `alwaysSchedule`.

<details>
<summary>Example <code>FeedEntry</code></summary>

```json
{
  "id": "the-initium-a45c67ad",
  "name": "The Initium",
  "publisher": "The Initium",
  "url": "https://theinitium.com/rss/",
  "homepage": "https://theinitium.com",
  "language": "zh",
  "countries": ["SG", "HK", "CN"],
  "category": "world",
  "mediaType": "digital",
  "format": "rss",
  "description": "The Initium — independent in-depth Chinese-language journalism headquartered in Singapore covering Greater China.",
  "perspective": "independent-exile",
  "governance": "independent",
  "operatingCircumstance": "exile",
  "sourceRole": "reporting",
  "publisherDomain": "theinitium.com"
}
```

</details>

- **IDs are opaque and immutable:** `publisher-slug` + `-` + 8-hex SHA-1 of the normalized URL (`src/id.ts`). Existing IDs are never regenerated after minting.
- **Health is an overlay, not editorial data:** `active`, `lastCheckedAt`, `lastItemPublishedAt`, and `healthScore` are delivered via `dist/feeds-health.json`, keyed by `id`. `data/feeds.json` is never rewritten by the health checker.

## Health & coverage

- **Health overlay (`dist/feeds-health.json`):** each feed receives a 0–100 score, a status (`fresh` / `stale` / `very-stale` / `stale-content` / `unreachable` / `invalid-content` / `unchecked`), a diagnostic category (`HEALTHY`, `STALE`, `REDIRECT_PERMANENT`, `MALFORMED_XML`, `BLOCKED_SCRAPER`, `DEAD_ENDPOINT`, `UNREACHABLE`), and a quarantine state (`active` → `degraded` → `quarantined` after 4 consecutive failures). Feeds are never auto-deleted.
- **Coverage matrix (`dist/coverage-matrix.json`):** classifies all 206 tracked countries and territories into `domestic-multi` (2+ domestic publishers), `domestic-single` (1), `regional-only` (0 domestic), or `uncovered`.

## Artifacts

Generated in `dist/` by `npm run build`:

- `feeds.json` (bare array), `feeds.csv` (all `FeedEntry` fields)
- `by-country.json`, `by-category.json`, `by-publisher.json`, `by-language.json`
- `coverage-matrix.json`, `feeds-health.json`
- `manifest.json` (schema/generator versions, source commit, per-artifact SHA-256), `duplicate-report.json`
- `index.html` (browsable directory deployed to GitHub Pages)
- `opml/all.opml`, `opml/countries/*.opml`, `opml/categories/*.opml`

## Contribute a feed

**Easiest:** [open a Feed Proposal issue](https://github.com/gitinamalive/giti-rss-registry/issues/new?template=feed-proposal.yml). An automated triage bot validates reachability, detects the feed format, checks duplicates, and drafts a candidate JSON entry.

**Via pull request:** add an entry to the `feeds` array in `data/feeds.json`, then run:

```bash
npm ci
npm run validate:fix
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for editorial standards and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.

## Develop

Requires **Node 22+**.

| Command | Purpose |
|---|---|
| `npm ci` | Install dependencies reproducibly |
| `npm run validate` | Editorial validation + JSON Schema conformance |
| `npm run build` | Regenerate `dist/` artifacts |
| `npm test` | Run Vitest suite |
| `npm run type-check` | Run `tsc --noEmit` |

## Repository layout

```text
data/      feeds.json (canonical) + language-fixes.json + perspective-proposals.json
schema/    feeds.schema.json (draft-07) + schema.md
src/       shared types + pure helpers (id, health, escape, urlFingerprint, countries, languages)
scripts/   validate, validate-schema, build-artifacts, health-check, propose-feed, importers
tests/     Vitest suites
dist/      generated artifacts (committed)
.github/   CI workflows + feed proposal issue form
```

## Versioning & stability

- **IDs** are immutable; **schema changes** are additive within a major version. Check `dist/manifest.json` (`schemaVersion`) for the current schema version and [CHANGELOG.md](CHANGELOG.md) for release history.
- `main` is a moving target updated by CI. **Pin a commit SHA** and verify checksums for reproducible builds.

## Scope

Contains: curated feed metadata, schema and validation rules, generated artifacts, and the contribution/triage workflow.

Does **not** contain: Giti's production backend/serverless logic, auth/quota/billing, Giti's production proxy/SSRF enforcement internals, or ranking/personalization behavior.

## License

- **Data** (all feed metadata): [CC0 1.0 Universal](DATA-LICENSE) — public domain.
- **Code** (scripts, schema, tooling): [MIT](LICENSE).
- Feed *content* belongs to each publisher; this registry only points to public endpoints.

Attribution is appreciated but not required:
> News source data from giti-rss-registry (https://github.com/gitinamalive/giti-rss-registry)
