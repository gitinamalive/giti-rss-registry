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

export interface FeedEntry {
  id: string;
  name: string;
  publisher: string;
  url: string;
  homepage?: string;
  language: string;
  countries: string[];
  region?: string;
  category: FeedCategory;
  tags?: string[];
  perspective?: Perspective;
  mediaType?: MediaType;
  format?: FeedFormat;
  official?: boolean;
  active?: boolean;
  lastCheckedAt?: string;
  lastItemPublishedAt?: string;
  healthScore?: number;
  notes?: string;
  description?: string;
}

export interface BootstrapPayload {
  generatedAt: string;
  source: string;
  stats: {
    feeds: number;
    duplicateIds: number;
    duplicateUrls: number;
  };
  warnings: {
    duplicateIds: string[];
    duplicateUrls: string[];
  };
  feeds: FeedEntry[];
}

export const allowedCategories = new Set<FeedCategory>([
  'world',
  'us',
  'europe',
  'technology',
  'ai',
  'space',
  'finance',
  'science',
  'climate',
  'politics',
  'investigative',
  'sports',
  'entertainment',
  'health',
  'culture',
]);

export const allowedFormats = new Set<FeedFormat>(['rss', 'atom', 'jsonfeed', 'rdf']);

export const allowedMediaTypes = new Set<MediaType>([
  'print',
  'tv',
  'radio',
  'digital',
  'wire',
  'aggregator',
  'broadcast',
]);

export const allowedPerspectives = new Set<Perspective>([
  'independent',
  'state-affiliated',
  'independent-exile',
  'regional',
  'state-monitor',
  'aggregator',
]);