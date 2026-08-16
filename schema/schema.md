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
- `homepage`, `tags`, `perspective`, `mediaType`, `format`, `official`, `active`, `lastCheckedAt`, `lastItemPublishedAt`, `healthScore`, `notes`, `description`, `coverageType`, `publisherCountries`

## Validation rules (minimum)

1. `id`
   - opaque and immutable — never regenerated after minting
   - unique across dataset
   - exactly one new-ID algorithm:
     `toFileSafeSegment(publisher) + '-' + sha1(normalizeUrl(url)).slice(0, 8)`
     (canonical implementation in `src/id.ts`; the shape matches historical IDs)
2. `url`
   - valid URL
   - unique across dataset
   - unique under URL normalization (trim, lowercase host, strip trailing slash
     and fragment) — equivalent normalized URLs must not produce two feeds
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

- `id`: keep the existing `id` verbatim (opaque + immutable). Only NEW feeds
  mint IDs via `src/id.ts` (`generateFeedId`: publisher slug + 8-hex sha1 of
  the normalized URL), never from `name + url`.
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

## Current population status (2026-07-28)

`description` is now declared on `FeedEntry` in `src/types.ts` and included in
the server-side CSV output. ~55 feeds carry descriptions (the 22 added July 28
plus ~33 from earlier additions).

The following optional fields are not yet populated in `data/feeds.json`:

- `perspective` — partially populated (Xinhua: state-affiliated, TASS: state-affiliated,
  KPL: state-affiliated, KCNA Watch: state-monitor, BERNAMA: state-affiliated — TBD URL dead)
- `tags` — reserved
- `region` — reserved
- `notes` — reserved
- `active`, `lastCheckedAt`, `lastItemPublishedAt`, `healthScore` — reserved
  for automated health-check (`scripts/health-check.ts`, not yet wired to CI)

Fields currently populated:
- `homepage` — ~55 feeds
- `description` — ~55 feeds
- `official` — OpenAI, DeepMind, WHO, and select public broadcasters
- `mediaType` — `broadcast` (BBC, NPR, BBC Politics, NPR Politics/Health, DW, ABC AU, France 24,
  NHK, KBS World, VOV World); `wire` (Reuters, Xinhua); `aggregator` (RealClearPolitics);
  rest `digital`
- `format` — predominantly `rss` with a few `rdf`/`atom` entries

Category distribution (2026-07-28):
- `world`: 188, `europe`: 42, `technology`: 20, `finance`: 15, `science`: 14,
  `us`: 13, `politics`: 13, `investigative`: 10, `climate`: 10, `sports`: 10,
  `ai`: 10, `health`: 10, `space`: 8, `culture`: 8, `entertainment`: 8
- All 15 categories now have at least 8 feeds (previously `space`, `entertainment`, `culture` were empty)
- **Total feeds**: 379 (up from 357 after 22-feed batch addition)
- **Unique countries**: 186 (up from 167)
- **Sovereign state coverage**: 176/195 = 90.3% (up from 157/195 = 80.5%)

### July 28, 2026 — 22 new feeds added (country coverage gap fill)

| Feed | Category | Publisher | Countries | Language |
|---|---|---|---|---|
| 24.kg | world | 24.kg News Agency | KG | ru |
| Asia-Plus | world | Asia-Plus | TJ | en |
| Breaking Belize News | world | Breaking Belize News | BZ | en |
| Civil Georgia | world | Civil Georgia | GE | en |
| DVB English | world | Democratic Voice of Burma | MM | en |
| El Periòdic d'Andorra | world | El Periòdic d'Andorra | AD | ca |
| El Salvador Times | world | El Salvador Times | SV | en |
| Honduras.com | world | Honduras.com | HN | es |
| Island Times | world | Island Times | PW | en |
| Kuensel | world | Kuensel | BT | en |
| Laotian Times | world | Laotian Times | LA | en |
| Malay Mail | world | Malay Mail | MY | en |
| Malaysiakini | world | Malaysiakini | MY | en |
| Matangi Tonga | world | Matangi Tonga | TO | en |
| Myanmar Now | world | Myanmar Now | MM | en |
| OC Media | world | OC Media | GE | en |
| OnCubaNews | world | OnCubaNews | CU | en |
| Post Courier | world | Post Courier | PG | en |
| Tatoli | world | Tatoli | TL | en |
| Tirana Times | world | Tirana Times | AL | en |
| Vatican News | politics | Vatican News | VA | en |
| VBTC | world | VBTC | VU | en |

**Note on 24.kg (KG):** English feed `/english/feed/` returned 404.
Russian-language feed `/rss/` used instead (`language: "ru"`).

**3 candidates dropped (2026-07-28) due to dead/broken URLs:**
- BERNAMA (MY): All 6 URL variations returned 404 or HTML landing pages
- Samoa Observer (WS): All 3 endpoints returned HTML, not RSS
- Trinidad Express (TT): Rate-limited (HTTP 429)

### June 23, 2026 — 20 new feeds added (category diversity)

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
