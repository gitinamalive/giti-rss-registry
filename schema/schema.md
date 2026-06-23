# Giti RSS Registry — Public Schema v2 (Draft)

This document defines the recommended public data contract for the standalone RSS registry project.

It is designed to be:
- useful to external consumers,
- compatible with current Giti data,
- safe to publish without exposing backend/product internals.

## TypeScript interface

```ts
export interface FeedEntry {
  id: string;
  name: string;
  publisher: string;
  url: string;
  homepage?: string;
  language: string; // BCP-47/ISO 639 style, lowercase where possible
  countries: string[]; // ISO 3166-1 alpha-2 uppercase
  region?: string;
  category: FeedCategory;
  tags?: string[];
  perspective?: Perspective;
  mediaType?: MediaType;
  format?: FeedFormat;
  official?: boolean;
  active?: boolean;
  lastCheckedAt?: string; // ISO timestamp
  lastItemPublishedAt?: string; // ISO timestamp
  healthScore?: number; // 0..100
  notes?: string;
}

export type FeedFormat = 'rss' | 'atom' | 'jsonfeed' | 'rdf';

export type MediaType =
  | 'print'
  | 'tv'
  | 'radio'
  | 'digital'
  | 'wire'
  | 'aggregator';

export type Perspective =
  | 'independent'
  | 'state-affiliated'
  | 'independent-exile'
  | 'regional'
  | 'state-monitor'
  | 'aggregator';

export type FeedCategory =
  | 'world'
  | 'us'
  | 'europe'
  | 'technology'
  | 'ai'
  | 'space'
  | 'finance'
  | 'science'
  | 'climate'
  | 'politics'
  | 'investigative';
```

## Field requirements

Required for each feed in v1 public release:
- `id`, `name`, `publisher`, `url`, `language`, `countries`, `category`

Optional (recommended over time):
- `homepage`, `tags`, `perspective`, `mediaType`, `format`, `official`, `active`, `lastCheckedAt`, `lastItemPublishedAt`, `healthScore`, `notes`

## Validation rules (minimum)

1. `id`
   - unique across dataset
   - stable across releases
2. `url`
   - valid URL
   - unique across dataset
3. `countries`
   - ISO alpha-2 uppercase codes
4. `language`
   - normalized lowercase language code where possible
5. `category`
   - must be one of approved `FeedCategory` enum values
6. enum fields (`format`, `mediaType`, `perspective`)
   - must match known values if provided

## Mapping from current Giti data

Current source shape (`RSSSuggestion`):
- `url`
- `name`
- `language`
- `countries`
- `category`
- optional `perspective` (`Independent`, `State-Affiliated`, ...)

Recommended bootstrap mapping:

- `id`: deterministic slug/hash from `name + url`
- `publisher`: inferred from `name` (or explicit overrides later)
- `category`: normalize from title case to lowercase enum
  - `World -> world`
  - `Technology -> technology`
  - `Finance -> finance`
  - `Investigative -> investigative`
  - `US -> us`
  - `Europe -> europe`
- `perspective` map:
  - `Independent -> independent`
  - `State-Affiliated -> state-affiliated`
  - `Independent/Exile -> independent-exile`
  - `Regional -> regional`
  - `State-Monitor -> state-monitor`
  - `Aggregator -> aggregator`
- `format`: infer heuristically from URL (`atom`, `jsonfeed`, `rdf`, else `rss`)
- `mediaType`: default `digital`; set `aggregator` when perspective/category indicates aggregator behavior

## Current population status (2026-06-22)

The following optional fields are not yet populated in `data/feeds.json`:

- `perspective` — reserved for future human-reviewed labeling
- `homepage` — partially populated (13 feeds from 2026-06-22 addition)
- `description` — partially populated (13 feeds from 2026-06-22 addition)
- `official` — reserved
- `active` — populated by automated health-check (`scripts/health-check.ts`)
- `lastCheckedAt` — populated by automated health-check
- `lastItemPublishedAt` — populated by automated health-check
- `healthScore` — populated by automated health-check
- `tags` — reserved
- `region` — reserved
- `notes` — reserved

Fields currently populated:
- `mediaType` — predominantly `digital` (1 `broadcast`: France 24)
- `format` — predominantly `rss` with a few `rdf` entries

Category distribution (post-2026-06-22 batch addition):
- `world`: 127, `europe`: 52, `us`: 17, `technology`: 8,
  `science`: 7, `finance`: 4, `investigative`: 3, `climate`: 1, `sports`: 1
- `ai`, `space`, `politics`, `entertainment`, `health`, `culture` — 0 feeds each (no feeds yet assigned)
- **Total feeds**: 217 (up from 206 after 11-feed batch addition)

### June 22, 2026 — 11 new feeds added

| Feed | Category | Publisher | Country |
|---|---|---|---|
| BBC Science & Environment | science | BBC | GB |
| ScienceDaily Top News | science | ScienceDaily | US |
| Carbon Brief | climate | Carbon Brief | GB |
| BBC Sport | sports | BBC | GB |
| Africanews | world | Africanews | CG |
| Latin America Reports | world | Latin America Reports | PE |
| NSF News | science | NSF | US |
| NASA Breaking News | science | NASA | US |
| Phys.org | science | Phys.org | GB |
| New Scientist | science | New Scientist | GB |
| ANSA English | europe | ANSA | IT |

These reflect the honest current state of the dataset and will change as the
registry matures.

## Non-goals for schema v2

- No backend execution rules
- No auth/quota/usage model
- No SSRF or network hardening implementation details
- No Giti personalization/ranking behavior
