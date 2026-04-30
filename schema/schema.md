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

## Non-goals for schema v2

- No backend execution rules
- No auth/quota/usage model
- No SSRF or network hardening implementation details
- No Giti personalization/ranking behavior
