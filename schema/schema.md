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
  description?: string;
}

export type FeedFormat = 'rss' | 'atom' | 'jsonfeed' | 'rdf';

export type MediaType =
  | 'print'
  | 'tv'
  | 'radio'
  | 'digital'
  | 'wire'
  | 'aggregator'
  | 'broadcast';

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
  | 'investigative'
  | 'sports'
  | 'entertainment'
  | 'health'
  | 'culture';
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

## Current population status (2026-06-23)

`description` is now declared on `FeedEntry` in `src/types.ts` and included in
the server-side CSV output. ~33 feeds carry descriptions (the 20 added June 23
plus 13 from earlier additions).

The following optional fields are not yet populated in `data/feeds.json`:

- `perspective` — reserved for future human-reviewed labeling
- `tags` — reserved
- `region` — reserved
- `notes` — reserved
- `active`, `lastCheckedAt`, `lastItemPublishedAt`, `healthScore` — reserved
  for automated health-check (`scripts/health-check.ts`, not yet wired to CI)

Fields currently populated:
- `homepage` — ~33 feeds
- `description` — ~33 feeds
- `official` — OpenAI, DeepMind, WHO, and select public broadcasters
- `mediaType` — `broadcast` (BBC, NPR, BBC Politics, NPR Politics/Health, DW, ABC AU, France 24);
  `wire` (Reuters); `aggregator` (RealClearPolitics); rest `digital`
- `format` — predominantly `rss` with a few `rdf`/`atom` entries

Category distribution (2026-06-23):
- `world`: 143, `europe`: 41, `us`: 14, `ai`: 10, `technology`: 8,
  `science`: 7, `politics`: 5, `health`: 5, `finance`: 3,
  `investigative`: 3, `climate`: 1, `sports`: 1
- `space`, `entertainment`, `culture` — 0 feeds each
- **Total feeds**: 237 (up from 217 after 20-feed batch addition)

### June 23, 2026 — 20 new feeds added

| Feed | Category | Publisher | Country |
|---|---|---|---|
| TechCrunch AI | ai | TechCrunch | US |
| MIT Technology Review AI | ai | MIT | US |
| VentureBeat AI | ai | VentureBeat | US |
| OpenAI Blog | ai | OpenAI | US |
| Google DeepMind Blog | ai | Google DeepMind | GB |
| Hugging Face Blog | ai | Hugging Face | US |
| MarkTechPost | ai | MarkTechPost | IN |
| The Decoder | ai | The Decoder | DE |
| Berkeley AI Research | ai | UC Berkeley | US |
| The Keyword — AI | ai | Google | US |
| The Hill | politics | The Hill | US |
| NPR Politics | politics | NPR | US |
| BBC Politics | politics | BBC | GB |
| RealClearPolitics | politics | RealClearPolitics | US |
| Roll Call | politics | Roll Call | US |
| STAT News | health | STAT | US |
| KFF Health News | health | KFF | US |
| NPR Health (Shots) | health | NPR | US |
| WHO News | health | WHO | CH |
| ScienceDaily Health | health | ScienceDaily | US |

## Non-goals for schema v2

- No backend execution rules
- No auth/quota/usage model
- No SSRF or network hardening implementation details
- No Giti personalization/ranking behavior
