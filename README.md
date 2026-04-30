# giti-rss-registry

A curated, community-maintained RSS/news-feed registry extracted from Giti and published as a reusable public dataset.

## Scope

This repository contains:

- curated feed metadata
- schema + validation rules
- generated outputs (JSON, CSV, OPML)
- contribution workflow for adding and maintaining feeds

This repository does **not** contain:

- Giti backend/serverless enforcement logic
- auth/quota/billing logic
- SSRF/network hardening internals
- Giti ranking/personalization behavior

## Data model

Primary schema:

- `id` (stable unique ID)
- `name`
- `publisher`
- `url`
- `language`
- `countries` (ISO alpha-2)
- `category`
- optional: `perspective`, `format`, `mediaType`, `official`, health metadata

See `schema/` and `src/types.ts` for canonical definitions.

## Repository structure

```text
giti-rss-registry/
  data/
    sources/
    approved-categories.json
  schema/
  src/
    index.ts
    types.ts
    opml.ts
  scripts/
    build.ts
    validate.ts
    health-check.ts
  dist/
    feeds.json
    feeds.csv
    by-country.json
    by-category.json
    by-publisher.json
    by-language.json
    opml/
```

## Outputs

- `dist/feeds.json`
- `dist/feeds.csv`
- `dist/by-country.json`
- `dist/by-category.json`
- `dist/by-publisher.json`
- `dist/by-language.json`
- `dist/opml/all.opml`
- `dist/opml/countries/*.opml`
- `dist/opml/categories/*.opml`

## Quick start

```bash
npm install
npm run validate
npm run build
```

## Contribution

Please read `CONTRIBUTING.md` before opening PRs.

For feed additions/changes, include:

- publisher
- homepage
- feed URL
- language
- country/countries
- category
- official/non-official signal
- evidence that feed is active

## Editorial principles

- prefer canonical/official feeds when available
- avoid comment/tag/reply feeds
- avoid duplicate section feeds unless clearly distinct
- apply perspective labels only with defensible rationale

## License

Choose one before launch (recommended: `MIT` for broad reuse or `ODbL-1.0` for data-share reciprocity, depending on your policy preference).
